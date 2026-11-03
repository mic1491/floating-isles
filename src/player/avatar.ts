import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { AdditiveBlending, Group, MathUtils, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { computePose, type BoneName, type Motion } from './avatarPose';
import { addOutline, toonMaterial } from '../render/toon';
import type { Element, WeaponKind } from '../core/balance';
import { addAccessories } from './accessories';
import { clipTime, clipWeight, COMBO_CLIPS, sampleBone, sampleHipsY, type Clip, type ClipLibrary } from './clips';
import { ATTACKS } from './attackTable';
import { shiftHue } from './recolor';
import { buildSword } from './swordModel';
import { buildSpear, buildStaff } from './weaponModels';

const BLINK_EVERY = 3.6;
const BLINK_LENGTH = 0.14;
/** How quickly the body chases its target pose, per second: snappy in a swing, loose otherwise. */
const FOLLOW_SWING = 34;
const FOLLOW_FREE = 15;
const SWORD_COLORS: Record<string, string> = { steel: '#f4f8ff', gold: '#e0b24a', leather: '#4a2c24' };
const BLADE_AXIS = new Vector3(0, 0, 1);
/** The bones the hand-made poses already drive. */
const HAND_MADE_BONES = new Set([
  'hips',
  'spine',
  'chest',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'rightUpperArm',
  'rightLowerArm',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
]);

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

/** Everything that makes one character look like themselves on a shared model. */
export interface AvatarLook {
  element: Element;
  color: string;
  weapon: WeaponKind;
  weaponColor: string;
  weaponModel?: string | null;
  hue?: number;
  hairOnly?: boolean;
  /** Recorded sword motion; characters without a sword keep the hand-made swings. */
  clips?: ClipLibrary | null;
}

/** A VRM character posed from code, parented inside the player's view. */
export class Avatar {
  readonly root = new Group();
  private readonly nodes = new Map<BoneName, Object3D>();
  private readonly hips: Object3D;
  private readonly hipsRestY: number;
  private readonly applied = new Map<BoneName, [number, number, number]>();
  private hipsDrop = 0;
  private aimWeight = 0;
  private readonly aimBlade: [number, number] = [0, -0.5];
  private readonly hand: Object3D;
  private weaponNode: Object3D | null = null;
  private clips: Map<string, Clip> | null = null;
  private clipHipsScale = 1;
  /** Bones the recorded motion has moved that the hand-made one never touches, so they can be put back. */
  private readonly clipTouched = new Set<string>();
  private readonly clipQuat = new Quaternion();
  private weaponKind: WeaponKind = 'sword';
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

  /** Loads a modelled sword (blade along +Y in the file) and dresses it in the game's toon materials. */
  private static async loadSword(url: string, glow: string): Promise<Group> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as { name: string }).name.split('.')[0];
      if (name === 'glow') {
        mesh.material = new MeshBasicMaterial({ color: glow });
        // A wider additive copy reads as light bleeding off the blade, even from the far game camera.
        const halo = new Mesh(
          mesh.geometry,
          new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
        );
        halo.scale.set(1.8, 1.02, 3.2);
        mesh.add(halo);
      } else if (name === 'gem') mesh.material = new MeshBasicMaterial({ color: '#6af0ff' });
      else if (name === 'blade') {
        // The blade carries its two-tone paint in vertex colours.
        mesh.material = toonMaterial('#ffffff', { vertexColors: true, emissive: '#2a2024' });
      } else {
        // A faint emissive keeps the steel's shaded faces from going black against the sky.
        mesh.material = toonMaterial(SWORD_COLORS[name] ?? '#cccccc', { emissive: name === 'steel' ? '#6b7a94' : '#201810' });
        // Flat-shaded blades would tear apart under an inflated shell, so only rounded parts get outlined.
        if (name !== 'steel') addOutline(mesh);
      }
    });
    // Point the model's blade along +Z, the axis the grip is aimed with.
    model.rotation.x = Math.PI / 2;
    const sword = new Group();
    sword.add(model);
    // Held at arm's length from a 7 m camera, so the whole weapon is drawn a little oversize.
    sword.scale.setScalar(1.2);
    return sword;
  }

  static async load(url: string, look: AvatarLook): Promise<Avatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    VRMUtils.combineSkeletons(gltf.scene);
    const avatar = new Avatar(gltf.userData.vrm as VRM);
    if (look.hue) shiftHue(avatar.vrm.scene, look.hue, look.hairOnly);
    addAccessories(avatar.vrm, look.element, look.color);
    let weapon: Group;
    if (look.weapon === 'staff') {
      weapon = buildStaff(look.weaponColor);
      weapon.scale.setScalar(0.8);
    } else if (look.weapon === 'spear') {
      weapon = buildSpear(look.weaponColor);
      weapon.scale.setScalar(0.76);
    } else {
      weapon = look.weaponModel
        ? await Avatar.loadSword(look.weaponModel, look.weaponColor).catch(() => buildSword(look.weaponColor))
        : buildSword(look.weaponColor);
    }
    if (look.clips && look.weapon === 'sword') {
      avatar.clips = new Map(look.clips.clips.map((clip) => [clip.name, clip]));
      avatar.clipHipsScale = avatar.hipsRestY / look.clips.restHipsY;
    }
    avatar.weaponNode = weapon;
    avatar.weaponKind = look.weapon;
    weapon.position.copy(GRIP_OFFSET);
    avatar.vrm.humanoid.getNormalizedBoneNode('rightHand')?.add(weapon);
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

  private clipFor(motion: Motion): Clip | null {
    if (!this.clips || !motion.attack) return null;
    return this.clips.get(COMBO_CLIPS[motion.attack.step - 1]) ?? null;
  }

  /**
   * Lays a recorded swing over the pose: each bone turns toward the recording as the hit begins and back
   * as it ends. Bones the hand-made poses never touch are set from scratch each frame and put back after.
   */
  private playClip(clip: Clip | null, motion: Motion): void {
    if (!clip || !motion.attack) {
      for (const name of this.clipTouched) this.node(name as BoneName)?.quaternion.identity();
      this.clipTouched.clear();
      return;
    }
    const progress = motion.attack.t;
    const time = clipTime(clip, progress, ATTACKS[motion.attack.step - 1].strikeAt);
    const weight = clipWeight(progress);
    for (const bone of Object.keys(clip.bones)) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone as 'hips');
      if (!node) continue;
      sampleBone(clip, bone, time, this.clipQuat);
      if (!HAND_MADE_BONES.has(bone) && bone !== 'rightHand') {
        node.quaternion.identity();
        this.clipTouched.add(bone);
      }
      if (bone === 'rightHand') this.clipTouched.add(bone);
      node.quaternion.slerp(this.clipQuat, weight);
    }
    this.hips.position.y += sampleHipsY(clip, time) * this.clipHipsScale * weight;
  }

  /** A spear thrusts forward as its hit lands, and a staff's orb flares. */
  private animateWeapon(motion: Motion): void {
    const node = this.weaponNode;
    if (!node) return;
    let punch = 0;
    if (motion.attack) {
      const strike = ATTACKS[motion.attack.step - 1].strikeAt;
      const near = Math.max(0, 1 - Math.abs(motion.attack.t - strike) / 0.2);
      punch = near * near * (3 - 2 * near);
    }
    if (this.weaponKind === 'spear') node.position.z = GRIP_OFFSET.z + punch * 0.6;
    const halo = node.userData.glow as Object3D | undefined;
    if (halo) halo.scale.setScalar(1 + punch * 1.6);
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
    const clip = this.clipFor(motion);
    const { bones, hipsDrop, swordAim, blade } = computePose(clip ? { ...motion, attack: null } : motion);
    // Every bone eases toward its target, so a new hit, a landing or a stop never pops.
    const follow = 1 - Math.exp(-dt * (motion.attack ? FOLLOW_SWING : FOLLOW_FREE));
    for (const name of Object.keys(bones) as BoneName[]) {
      const target = bones[name];
      const previous = this.applied.get(name) ?? target;
      const x = previous[0] + (target[0] - previous[0]) * follow;
      const y = previous[1] + (target[1] - previous[1]) * follow;
      const z = previous[2] + (target[2] - previous[2]) * follow;
      this.applied.set(name, [x, y, z]);
      this.node(name)?.rotation.set(x, y, z);
    }
    const drop = this.hipsDrop + (hipsDrop - this.hipsDrop) * follow;
    this.hipsDrop = drop;
    this.hips.position.y = this.hipsRestY - drop;
    this.aimWeight = MathUtils.lerp(this.aimWeight, swordAim, follow);
    // A sword rests low at the side; a staff or spear is carried upright, head held high.
    let aim = blade;
    if (this.weaponKind !== 'sword' && !motion.attack && !motion.airborne && !motion.gliding) {
      aim = [-0.08, (this.weaponKind === 'staff' ? 1.3 : 1.1) - motion.pace * 0.2];
    }
    this.aimBlade[0] = MathUtils.lerp(this.aimBlade[0], aim[0], follow);
    this.aimBlade[1] = MathUtils.lerp(this.aimBlade[1], aim[1], follow);
    this.aimSword(this.aimWeight, this.aimBlade);
    this.playClip(clip, motion);
    this.animateWeapon(motion);
    const blink = motion.time % BLINK_EVERY < BLINK_LENGTH ? 1 : 0;
    this.vrm.expressionManager?.setValue('blink', blink);
    this.vrm.update(dt);
  }
}
