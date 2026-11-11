import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { Euler, Group, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { shiftHue } from './recolor';

/** One recorded motion: every bone's rotation per frame (x, y, z, w), sampled at a fixed rate. */
export interface Clip {
  name: string;
  fps: number;
  duration: number;
  loop?: boolean;
  bones: Record<string, Array<[number, number, number, number]>>;
  hipsY: number[];
}

export interface ClipLibrary {
  restHipsY: number;
  clips: Map<string, Clip>;
}

export const loadClips = async (...urls: string[]): Promise<ClipLibrary> => {
  const clips = new Map<string, Clip>();
  let restHipsY = 0.917;
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    const library = (await response.json()) as { restHipsY: number; clips: Clip[] };
    restHipsY = library.restHipsY;
    for (const clip of library.clips) clips.set(clip.name, clip);
  }
  return { restHipsY, clips };
};

/**
 * A hand-made pose: bone name to [x, y, z] turn in the VRM's normalised T-pose (facing +Z, left arm on +X).
 * `_drop` lowers the hips by that many metres.
 */
export type Pose = Record<string, [number, number, number] | [number]>;

/** Mirrors a pose left to right. */
export const mirror = (pose: Pose): Pose => {
  const out: Pose = {};
  for (const [name, value] of Object.entries(pose)) {
    const swapped = name.startsWith('left') ? `right${name.slice(4)}` : name.startsWith('right') ? `left${name.slice(5)}` : name;
    out[swapped] = value.length === 3 ? [value[0], -value[1], -value[2]] : value;
  }
  return out;
};

export interface Anim {
  clip: string;
  time: number;
  pose: Pose | null;
  /** How fast the body chases the target pose, per second. */
  rate: number;
  /** Backward lean of the whole body about the hips, in radians: -PI/2 lies flat on the back. */
  tilt: number;
  /** Extra height of the whole body. */
  lift: number;
}

const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

/** Finger curls that close a hand into a fist, for the right hand; the left mirrors them. */
const FIST: Array<[string, [number, number, number]]> = [
  ['IndexProximal', [0, 0, 1.35]], ['IndexIntermediate', [0, 0, 1.5]], ['IndexDistal', [0, 0, 0.9]],
  ['MiddleProximal', [0, 0, 1.45]], ['MiddleIntermediate', [0, 0, 1.5]], ['MiddleDistal', [0, 0, 0.9]],
  ['RingProximal', [0, 0, 1.5]], ['RingIntermediate', [0, 0, 1.5]], ['RingDistal', [0, 0, 0.9]],
  ['LittleProximal', [0, 0, 1.55]], ['LittleIntermediate', [0, 0, 1.5]], ['LittleDistal', [0, 0, 0.9]],
  ['ThumbMetacarpal', [0, -0.5, 0.3]], ['ThumbProximal', [0, -0.5, 0.5]], ['ThumbDistal', [0, -0.3, 0.4]],
];

const euler = new Euler();
const target = new Quaternion();
const qa = new Quaternion();
const qb = new Quaternion();

const sample = (clip: Clip, bone: string, time: number, into: Quaternion): boolean => {
  const frames = clip.bones[bone];
  if (!frames) return false;
  const count = frames.length;
  const at = clip.loop ? (((time * clip.fps) % count) + count) % count : Math.min(count - 1, Math.max(0, time * clip.fps));
  const i = Math.floor(at);
  const next = clip.loop ? (i + 1) % count : Math.min(count - 1, i + 1);
  qa.fromArray(frames[i]);
  qb.fromArray(frames[next]);
  into.copy(qa).slerp(qb, at - i);
  return true;
};

const sampleHips = (clip: Clip, time: number): number => {
  const count = clip.hipsY.length;
  const at = clip.loop ? (((time * clip.fps) % count) + count) % count : Math.min(count - 1, Math.max(0, time * clip.fps));
  const i = Math.floor(at);
  const next = clip.loop ? (i + 1) % count : Math.min(count - 1, i + 1);
  return clip.hipsY[i] + (clip.hipsY[next] - clip.hipsY[i]) * (at - i);
};

/** A VRM character driven by recorded clips with hand-made poses laid over them. */
export class Rig {
  /** Placed and turned by the fighter. Forward is +Z. */
  readonly root = new Group();
  private readonly tilt = new Group();
  private readonly nodes = new Map<string, Object3D>();
  private readonly current = new Map<string, Quaternion>();
  private readonly hips: Object3D;
  private readonly hipsRestY: number;
  private hipsOffset = 0;
  private tiltNow = 0;
  private liftNow = 0;
  private readonly hipsScale: number;
  private time = 0;

  private constructor(private readonly vrm: VRM, private readonly library: ClipLibrary) {
    vrm.scene.traverse((node) => {
      node.frustumCulled = false;
      if ((node as Mesh).isMesh) node.castShadow = true;
    });
    this.hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
    this.hipsRestY = this.hips.position.y;
    this.hipsScale = this.hipsRestY / library.restHipsY;
    for (const name of BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as 'hips');
      if (node) {
        this.nodes.set(name, node);
        this.current.set(name, new Quaternion());
      }
    }
    for (const [name, [x, y, z]] of FIST) {
      vrm.humanoid.getNormalizedBoneNode(`right${name}` as 'rightIndexProximal')?.rotation.set(x, y, z);
      vrm.humanoid.getNormalizedBoneNode(`left${name}` as 'leftIndexProximal')?.rotation.set(x, -y, -z);
    }
    // The body leans about the hips, so falling flat pivots around the waist rather than the feet.
    this.tilt.position.y = this.hipsRestY;
    vrm.scene.position.y = -this.hipsRestY;
    this.tilt.add(vrm.scene);
    this.root.add(this.tilt);
  }

  static async load(url: string, library: ClipLibrary, hue = 0): Promise<Rig> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    VRMUtils.combineSkeletons(gltf.scene);
    const vrm = gltf.userData.vrm as VRM;
    if (hue) shiftHue(vrm.scene, hue, true);
    return new Rig(vrm, library);
  }

  /** Where a bone is in the world, for effects that start at a hand or the chest. */
  bonePosition(name: string, into: Vector3): Vector3 {
    const node = this.vrm.humanoid.getRawBoneNode(name as 'hips');
    if (!node) return into.copy(this.root.position).setY(this.root.position.y + 1.2);
    return node.getWorldPosition(into);
  }

  face(name: 'happy' | 'angry' | 'sad' | 'neutral', closed = false): void {
    const faces = this.vrm.expressionManager;
    if (!faces) return;
    for (const other of ['happy', 'angry', 'sad']) faces.setValue(other, other === name ? 1 : 0);
    faces.setValue('blink', closed ? 1 : this.time % 3.6 < 0.14 ? 1 : 0);
  }

  /** Jumps straight to the target pose, so a reset does not blend from the last round's fall. */
  snap(): void {
    this.snapNext = true;
    this.vrm.springBoneManager?.reset();
  }
  private snapNext = false;

  update(dt: number, anim: Anim): void {
    this.time += dt;
    const clip = this.library.clips.get(anim.clip) ?? null;
    const follow = this.snapNext ? 1 : 1 - Math.exp(-dt * anim.rate);
    for (const [name, node] of this.nodes) {
      const posed = anim.pose?.[name];
      if (posed && posed.length === 3) target.setFromEuler(euler.set(posed[0], posed[1], posed[2]));
      else if (!clip || !sample(clip, name, anim.time, target)) target.identity();
      const now = this.current.get(name)!;
      now.slerp(target, follow);
      node.quaternion.copy(now);
    }
    const drop = (anim.pose?._drop?.[0] as number | undefined) ?? 0;
    const wantHips = (clip ? sampleHips(clip, anim.time) * this.hipsScale : 0) - drop;
    this.hipsOffset += (wantHips - this.hipsOffset) * follow;
    this.hips.position.y = this.hipsRestY + this.hipsOffset;
    const lean = this.snapNext ? 1 : 1 - Math.exp(-dt * 13);
    this.tiltNow += (anim.tilt - this.tiltNow) * lean;
    this.liftNow += (anim.lift - this.liftNow) * lean;
    this.tilt.rotation.x = this.tiltNow;
    this.tilt.position.y = this.hipsRestY + this.liftNow;
    this.snapNext = false;
    this.vrm.update(dt);
  }
}
