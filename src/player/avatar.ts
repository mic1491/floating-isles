import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { AdditiveBlending, Box3, Group, MathUtils, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D, type Scene } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { computePose, type BoneName, type Motion } from './avatarPose';
import { addOutline, toonMaterial } from '../render/toon';
import type { Element, WeaponKind } from '../core/balance';
import { addAccessories } from './accessories';
import { clipTime, clipWeight, COMBO_CLIPS, sampleBone, sampleHipsY, type Clip, type ClipLibrary } from './clips';
import { ATTACKS } from './attackTable';
import { Locomotion } from './locomotion';
import { plantWeight, solveKnee, swingBone } from './footIk';
import { terrainHeight } from '../world/terrain';
import type { Accessories } from './accessories';
import { shiftHue } from './recolor';
import { buildSword } from './swordModel';
import { buildSpear, buildStaff } from './weaponModels';
import { glowMaterial, sparkles, SwingTrail, weaponTime } from './weaponFx';

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

/** Bones below the waist: a swing lets go of them while the player is running. */
const LOWER_BODY = new Set(['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']);
const FLINCH_BONES = ['spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder'];

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
  /** Recorded swings, played whatever the weapon: a staff sweeps and a spear lunges with the same body motion. */
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
  private move: Locomotion | null = null;
  private cloth: Accessories | null = null;
  private readonly ik = { weight: 0, offset: [0, 0], drop: 0 };
  private readonly ikScratch = {
    hip: new Vector3(),
    knee: new Vector3(),
    ankle: new Vector3(),
    target: new Vector3(),
    newKnee: new Vector3(),
    clampedTarget: new Vector3(),
    from: new Vector3(),
    to: new Vector3(),
    base: new Vector3(),
    foot: new Quaternion(),
    parent: new Quaternion(),
  };
  private moveBones: string[] = [];
  private clipHipsScale = 1;
  /** Bones the recorded motion has moved that the hand-made one never touches, so they can be put back. */
  private readonly clipTouched = new Set<string>();
  private readonly clipQuat = new Quaternion();
  private readonly clipQuatB = new Quaternion();
  private weaponKind: WeaponKind = 'sword';
  /** How far the weapon reaches along its own axis, before its scale. */
  private tipLocal = 1;
  private trail: SwingTrail | null = null;
  private trailInScene = false;
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
        // The inlay carries a band of light running up it; the file's blade lies along +Y.
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        mesh.material = glowMaterial(glow, { flow: true, axis: 'y', length: Math.max(0.1, box.max.y - box.min.y) });
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
    const embers = sparkles(glow, 10, 0.09, (life, i, out) => {
      const a = i * 2.2;
      out.set(Math.sin(a) * 0.05, Math.cos(a) * 0.05 + life * 0.04, 0.12 + ((i * 0.37) % 1) * 0.7 + life * 0.08);
    });
    sword.add(embers.points);
    sword.userData.tick = embers.tick;
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
    avatar.cloth = addAccessories(avatar.vrm, look.element, look.color);
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
    weapon.updateMatrixWorld(true);
    avatar.tipLocal = new Box3().setFromObject(weapon).max.z / weapon.scale.z;
    avatar.trail = new SwingTrail(look.weaponColor);
    if (look.clips) {
      avatar.clips = new Map(look.clips.clips.map((clip) => [clip.name, clip]));
      avatar.clipHipsScale = avatar.hipsRestY / look.clips.restHipsY;
      if (Locomotion.available(avatar.clips)) {
        avatar.move = new Locomotion(avatar.clips);
        avatar.moveBones = Object.keys(avatar.clips.get('Idle_Loop')!.bones);
      }
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
    return this.clips.get((COMBO_CLIPS[this.weaponKind] ?? COMBO_CLIPS.sword)[motion.attack.step - 1]) ?? null;
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
    // The swing owns the upper body; the legs keep running under it unless the player stands still.
    const legs = this.move && (motion.airborne || motion.dashing || (motion.speed ?? motion.pace * 8.5) > 1.5) ? 0.12 : 1;
    for (const bone of Object.keys(clip.bones)) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone as 'hips');
      if (!node) continue;
      sampleBone(clip, bone, time, this.clipQuat);
      if (!this.move && !HAND_MADE_BONES.has(bone) && bone !== 'rightHand') {
        node.quaternion.identity();
        this.clipTouched.add(bone);
      }
      if (bone === 'rightHand') this.clipTouched.add(bone);
      node.quaternion.slerp(this.clipQuat, weight * (LOWER_BODY.has(bone) ? legs : 1));
    }
    this.hips.position.y += sampleHipsY(clip, time) * this.clipHipsScale * weight * legs;
  }

  /** Lays the recorded body motion over the hand-made pose, bone by bone, leaving the sword hand to its aim. */
  private applyLocomotion(dt: number, motion: Motion): void {
    const move = this.move;
    if (!move) return;
    move.update(dt, {
      time: motion.time,
      speed: motion.speed ?? motion.pace * 8.5,
      airborne: motion.airborne,
      gliding: motion.gliding,
      dashing: motion.dashing,
      hitAge: motion.hitAge ?? 99,
    });
    // Bones the hand-made poses never touch start from rest each frame, so nothing recorded lingers.
    for (const bone of this.moveBones) {
      if (HAND_MADE_BONES.has(bone) || bone === 'rightHand') continue;
      this.node(bone as BoneName)?.quaternion.identity();
    }
    if (move.base < 0.002) return;
    for (const bone of this.moveBones) {
      if (bone === 'rightHand' || !move.sample(bone, this.clipQuat)) continue;
      this.node(bone as BoneName)?.quaternion.slerp(this.clipQuat, move.base);
    }
    this.hips.position.y += move.hipsY() * this.clipHipsScale * move.base;
  }

  /**
   * Plants the feet on the ground under them. Each foot that is down is moved to the terrain's height at its own
   * spot, by a two-bone solve through the knee, and the pelvis sinks so the lower foot can reach. Feet in the
   * air part of a stride are left alone, so running still looks like running.
   */
  private applyFootIk(dt: number, motion: Motion): void {
    const k = this.ikScratch;
    const ik = this.ik;
    const active = !motion.airborne && !motion.gliding && !motion.dashing;
    ik.weight += ((active ? 1 : 0) - ik.weight) * (1 - Math.exp(-dt * 12));
    if (ik.weight < 0.01) {
      ik.drop = 0;
      return;
    }
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldPosition(k.base);
    const groundHere = terrainHeight(k.base.x, k.base.z);
    const follow = 1 - Math.exp(-dt * 16);
    const legs = [
      ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
      ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
    ] as const;
    const feet: Array<{ upper: Object3D; lower: Object3D; foot: Object3D; ankle: Vector3; facing: Quaternion }> = [];
    let lowest = 0;
    legs.forEach(([upperName, lowerName, footName], side) => {
      const upper = this.node(upperName);
      const lower = this.node(lowerName);
      const foot = this.vrm.humanoid.getNormalizedBoneNode(footName);
      if (!upper || !lower || !foot) return;
      const ankle = foot.getWorldPosition(new Vector3());
      const delta = terrainHeight(ankle.x, ankle.z) - groundHere;
      const planted = plantWeight(ankle.y - k.base.y);
      const want = Math.max(-0.4, Math.min(0.4, delta)) * planted;
      ik.offset[side] += (want - ik.offset[side]) * follow;
      lowest = Math.min(lowest, ik.offset[side]);
      feet[side] = { upper, lower, foot, ankle, facing: foot.getWorldQuaternion(new Quaternion()) };
    });
    ik.drop += (Math.min(0.25, -lowest * 0.85) - ik.drop) * follow;
    if (ik.drop < 0.002 && Math.abs(ik.offset[0]) < 0.003 && Math.abs(ik.offset[1]) < 0.003) return;
    this.hips.position.y -= ik.drop * ik.weight;
    this.root.updateWorldMatrix(true, true);
    feet.forEach((leg, side) => {
      if (!leg) return;
      const { upper, lower, foot, ankle, facing } = leg;
      k.target.copy(ankle);
      k.target.y += ik.offset[side] * ik.weight;
      upper.getWorldPosition(k.hip);
      lower.getWorldPosition(k.knee);
      foot.getWorldPosition(k.ankle);
      solveKnee(k.hip, k.knee, k.ankle, k.target, k.newKnee, k.clampedTarget);
      // Swing the thigh so the knee goes where the solve wants it, then the shin so the ankle follows.
      k.from.copy(k.knee).sub(k.hip).normalize();
      k.to.copy(k.newKnee).sub(k.hip).normalize();
      swingBone(upper, k.from, k.to);
      lower.getWorldPosition(k.knee);
      foot.getWorldPosition(k.ankle);
      k.from.copy(k.ankle).sub(k.knee).normalize();
      k.to.copy(k.clampedTarget).sub(k.knee).normalize();
      swingBone(lower, k.from, k.to);
      // The foot keeps the way it was facing, rather than twisting with the shin.
      lower.getWorldQuaternion(k.parent);
      foot.quaternion.copy(k.parent.invert().multiply(facing));
      foot.updateMatrix();
      foot.updateWorldMatrix(false, true);
    });
  }

  /** A short upper-body flinch when hurt. */
  private applyFlinch(): void {
    const hit = this.move?.hit;
    if (!hit || !this.clipQuatB) return;
    for (const bone of FLINCH_BONES) {
      if (!hit.clip.bones[bone]) continue;
      sampleBone(hit.clip, bone, hit.time, this.clipQuatB);
      this.node(bone as BoneName)?.quaternion.slerp(this.clipQuatB, hit.weight * 0.8);
    }
  }

  /** Runs the weapon's own motion: pulsing gems, scrolling runes, fluttering streamers. */
  private tickWeapon(time: number): void {
    weaponTime.value = time;
    (this.weaponNode?.userData.tick as ((t: number) => void) | undefined)?.(time);
  }

  /** Draws a ribbon of light behind the weapon through the part of a swing where the blade is moving fast. */
  private updateTrail(dt: number, motion: Motion): void {
    const trail = this.trail;
    const weapon = this.weaponNode;
    if (!trail || !weapon) return;
    if (!this.trailInScene) {
      let top: Object3D = this.root;
      while (top.parent) top = top.parent;
      if (!(top as Scene).isScene) return;
      top.add(trail.mesh);
      this.trailInScene = true;
    }
    let emit = false;
    if (motion.attack && !motion.attack.hold && !motion.attack.cast) {
      const strike = ATTACKS[motion.attack.step - 1].strikeAt;
      emit = motion.attack.t > strike - 0.3 && motion.attack.t < strike + 0.2;
    }
    if (emit) weapon.updateWorldMatrix(true, false);
    // A sword's whole blade sweeps a ribbon; a staff or spear only trails its head.
    const base = this.weaponKind === 'sword' ? this.tipLocal * 0.3 : this.tipLocal - 0.42;
    trail.update(dt, emit ? weapon : null, base, this.tipLocal);
  }

  /** A spear thrusts forward as its hit lands, and a staff's orb flares. */
  private animateWeapon(motion: Motion): void {
    const node = this.weaponNode;
    if (!node) return;
    let punch = 0;
    if (motion.attack && !motion.attack.hold && !motion.attack.cast) {
      const strike = ATTACKS[motion.attack.step - 1].strikeAt;
      const near = Math.max(0, 1 - Math.abs(motion.attack.t - strike) / 0.2);
      punch = near * near * (3 - 2 * near);
    }
    if (this.weaponKind === 'spear') node.position.z = GRIP_OFFSET.z + punch * 0.6;
    const halo = node.userData.glow as Object3D | undefined;
    if (halo) halo.scale.setScalar(1 + punch * 1.6 + (motion.charge ?? 0) * (0.5 + Math.sin(motion.time * 18) * 0.12));
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
    this.applyLocomotion(dt, motion);
    this.aimSword(this.aimWeight, this.aimBlade);
    this.playClip(clip, motion);
    this.applyFlinch();
    this.cloth?.update(dt, { time: motion.time, speed: motion.speed ?? motion.pace * 8.5, airborne: motion.airborne, turn: motion.turn ?? 0 });
    this.applyFootIk(dt, motion);
    this.animateWeapon(motion);
    this.tickWeapon(motion.time);
    const blink = motion.time % BLINK_EVERY < BLINK_LENGTH ? 1 : 0;
    this.vrm.expressionManager?.setValue('blink', blink);
    this.vrm.update(dt);
    this.updateTrail(dt, motion);
  }
}
