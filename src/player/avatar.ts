import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { addOutline, toonMaterial } from '../render/toon';
import { computePose, type BoneName, type Motion } from './avatarPose';

const BLINK_EVERY = 3.6;
const BLINK_LENGTH = 0.14;
const BLADE_AXIS = new Vector3(0, 0, 1);
const FORWARD = new Vector3(0, 0, -1);

const buildSword = (color: string): Group => {
  const sword = new Group();
  const blade = new Mesh(new BoxGeometry(0.055, 0.018, 0.92), new MeshBasicMaterial({ color }));
  blade.position.z = 0.56;
  const guard = new Mesh(new BoxGeometry(0.2, 0.035, 0.04), toonMaterial('#e0b24a'));
  guard.position.z = 0.09;
  const grip = new Mesh(new BoxGeometry(0.03, 0.03, 0.17), toonMaterial('#5a3424'));
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
  private readonly shoulder: Object3D;
  private readonly scratch = { a: new Vector3(), b: new Vector3(), aim: new Vector3(), q: new Quaternion(), r: new Quaternion() };

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
    this.shoulder = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!;
  }

  static async load(url: string, weaponColor: string): Promise<Avatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    VRMUtils.combineSkeletons(gltf.scene);
    const avatar = new Avatar(gltf.userData.vrm as VRM);
    avatar.vrm.humanoid.getNormalizedBoneNode('rightHand')?.add(buildSword(weaponColor));
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

  /** Settles hair and cloth at once, so a teleport does not whip them across the map. */
  resetPhysics(): void {
    this.vrm.springBoneManager?.reset();
  }

  /**
   * Turns the wrist so the blade carries on along the line of the arm, tilted a little forward.
   * Without it the sword keeps pointing the way the hand did at rest, straight up in a raised swing.
   */
  private aimSword(weight: number): void {
    this.hand.quaternion.identity();
    if (weight < 0.001) return;
    const { a, b, aim, q, r } = this.scratch;
    this.vrm.scene.updateMatrixWorld(true);
    this.shoulder.getWorldPosition(a);
    this.hand.getWorldPosition(b);
    aim.subVectors(b, a).normalize().multiplyScalar(0.75);
    aim.addScaledVector(FORWARD.clone().applyQuaternion(this.root.getWorldQuaternion(q)), 0.25).normalize();
    this.hand.parent!.getWorldQuaternion(q);
    const current = BLADE_AXIS.clone().applyQuaternion(q);
    r.setFromUnitVectors(current, aim);
    // World-space turn r, expressed in the parent's frame: q^-1 * r * q.
    r.premultiply(q.clone().invert()).multiply(q);
    this.hand.quaternion.slerp(r, weight);
  }

  update(dt: number, motion: Motion): void {
    const { bones, hipsDrop, swordAim } = computePose(motion);
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
    this.aimSword(swordAim);
    const blink = motion.time % BLINK_EVERY < BLINK_LENGTH ? 1 : 0;
    this.vrm.expressionManager?.setValue('blink', blink);
    this.vrm.update(dt);
  }
}
