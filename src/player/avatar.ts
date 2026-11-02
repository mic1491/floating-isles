import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { addOutline, toonMaterial } from '../render/toon';
import { computePose, type BoneName, type Motion } from './avatarPose';

const BLINK_EVERY = 3.6;
const BLINK_LENGTH = 0.14;
const BLADE_AXIS = new Vector3(0, 0, 1);

/** Where the grip sits in the sword hand: just past the knuckles, in the hollow the fingers close around. */
const GRIP_OFFSET = new Vector3(-0.058, -0.02, -0.005);

/**
 * Finger curls in the normalised T-pose, where each hand points along X with the palm down and the
 * knuckles lined up on Z. Curling about Z closes the finger toward the palm; the sign flips per side.
 */
const FINGER_CURL: Array<[string, [number, number, number]]> = [
  ['IndexProximal', [0, 0, 1.35]],
  ['IndexIntermediate', [0, 0, 1.5]],
  ['IndexDistal', [0, 0, 0.9]],
  ['MiddleProximal', [0, 0, 1.45]],
  ['MiddleIntermediate', [0, 0, 1.5]],
  ['MiddleDistal', [0, 0, 0.9]],
  ['RingProximal', [0, 0, 1.5]],
  ['RingIntermediate', [0, 0, 1.5]],
  ['RingDistal', [0, 0, 0.9]],
  ['LittleProximal', [0, 0, 1.55]],
  ['LittleIntermediate', [0, 0, 1.5]],
  ['LittleDistal', [0, 0, 0.9]],
  ['ThumbMetacarpal', [0, -0.5, 0.3]],
  ['ThumbProximal', [0, -0.5, 0.5]],
  ['ThumbDistal', [0, -0.3, 0.4]],
];

const buildSword = (color: string): Group => {
  const sword = new Group();
  // The sword's origin is the middle of the grip, which sits inside the closed fist.
  const blade = new Mesh(new BoxGeometry(0.055, 0.018, 0.92), new MeshBasicMaterial({ color }));
  blade.position.z = 0.54;
  const guard = new Mesh(new BoxGeometry(0.2, 0.035, 0.04), toonMaterial('#e0b24a'));
  guard.position.z = 0.075;
  const grip = new Mesh(new BoxGeometry(0.032, 0.032, 0.13), toonMaterial('#5a3424'));
  for (const part of [guard, grip]) addOutline(part);
  sword.add(blade, guard, grip);
  return sword;
};

/** A VRM character posed from code, parented inside the player's view. */
export class Avatar {
  readonly root = new Group();
  private readonly nodes = new Map<BoneName, Object3D>();
  private readonly hips: Object3D;
  private readonly hipsRestY: number;
  private readonly applied = new Map<BoneName, [number, number, number]>();
  private attackId = -1;
  private blend = 1;
  private readonly hand: Object3D;
  private readonly scratch = { aim: new Vector3(), q: new Quaternion(), r: new Quaternion() };

  private constructor(private readonly vrm: VRM) {
    // VRM 1.0 models face +Z and the player view faces -Z.
    vrm.scene.rotation.y = Math.PI;
    vrm.scene.traverse((node) => {
      node.frustumCulled = false;
      if ((node as Mesh).isMesh) node.castShadow = true;
    });
    this.root.add(vrm.scene);
    this.hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
    this.hipsRestY = this.hips.position.y;
    this.hand = vrm.humanoid.getNormalizedBoneNode('rightHand')!;
  }

  static async load(url: string, weaponColor: string): Promise<Avatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    VRMUtils.combineSkeletons(gltf.scene);
    const avatar = new Avatar(gltf.userData.vrm as VRM);
    const sword = buildSword(weaponColor);
    sword.position.copy(GRIP_OFFSET);
    avatar.vrm.humanoid.getNormalizedBoneNode('rightHand')?.add(sword);
    avatar.closeHands();
    return avatar;
  }

  private node(name: BoneName): Object3D | null {
    let node = this.nodes.get(name);
    if (!node) {
      node = this.vrm.humanoid.getNormalizedBoneNode(name) ?? undefined;
      if (node) this.nodes.set(name, node);
    }
    return node ?? null;
  }

  /** Wraps the right fingers around the grip and lets the left hand hang loosely curled. */
  private closeHands(): void {
    const humanoid = this.vrm.humanoid;
    for (const [name, [x, y, z]] of FINGER_CURL) {
      humanoid.getNormalizedBoneNode(`right${name}` as 'rightIndexProximal')?.rotation.set(x, y, z);
      const loose = name.startsWith('Thumb') ? 0.25 : 0.38;
      humanoid.getNormalizedBoneNode(`left${name}` as 'leftIndexProximal')?.rotation.set(0, -y * 0.3, -z * loose);
    }
  }

  /** Settles hair and cloth at once, so a teleport does not whip them across the map. */
  resetPhysics(): void {
    this.vrm.springBoneManager?.reset();
  }

  /**
   * Turns the wrist so the blade points where the swing wants it, whatever the arm is doing.
   * `blade` is [yaw, pitch] from the character's forward, yaw positive to their left.
   */
  private aimSword(weight: number, blade: [number, number]): void {
    this.hand.quaternion.identity();
    if (weight < 0.001) return;
    const { aim, q, r } = this.scratch;
    this.vrm.scene.updateMatrixWorld(true);
    const [yaw, pitch] = blade;
    // The model faces +Z, so its own left is +X.
    aim.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    aim.applyQuaternion(this.vrm.scene.getWorldQuaternion(q));
    this.hand.parent!.getWorldQuaternion(q);
    const current = BLADE_AXIS.clone().applyQuaternion(q);
    r.setFromUnitVectors(current, aim);
    // World-space turn r, expressed in the parent's frame: q^-1 * r * q.
    r.premultiply(q.clone().invert()).multiply(q);
    this.hand.quaternion.slerp(r, weight);
  }

  update(dt: number, motion: Motion): void {
    const { bones, hipsDrop, swordAim, blade } = computePose(motion);
    // A new hit starts from wherever the last pose ended, so chained swings never pop.
    const id = motion.attack?.id ?? -1;
    if (id !== this.attackId) {
      if (id !== -1) this.blend = 0;
      this.attackId = id;
    }
    this.blend = Math.min(1, this.blend + dt / 0.09);
    const mix = this.blend < 1 ? this.blend * this.blend * (3 - 2 * this.blend) : 1;
    for (const name of Object.keys(bones) as BoneName[]) {
      const target = bones[name];
      const previous = this.applied.get(name) ?? target;
      const x = previous[0] + (target[0] - previous[0]) * mix;
      const y = previous[1] + (target[1] - previous[1]) * mix;
      const z = previous[2] + (target[2] - previous[2]) * mix;
      this.applied.set(name, [x, y, z]);
      this.node(name)?.rotation.set(x, y, z);
    }
    this.hips.position.y = this.hipsRestY - hipsDrop;
    this.aimSword(swordAim, blade);
    const blink = motion.time % BLINK_EVERY < BLINK_LENGTH ? 1 : 0;
    this.vrm.expressionManager?.setValue('blink', blink);
    this.vrm.update(dt);
  }
}
