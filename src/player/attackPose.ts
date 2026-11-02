import { ATTACKS } from './attackTable';
import type { BoneName, Euler3 } from './avatarPose';

type Ease = 'in' | 'out' | 'io';
type Partial3 = Partial<Record<BoneName, Euler3>>;

interface Frame {
  t: number;
  /** How the swing travels from the previous frame to this one. */
  ease: Ease;
  pose: Partial3;
  /** Metres the hips sink, for crouching into a strike. */
  drop: number;
}

const EASES: Record<Ease, (u: number) => number> = {
  in: (u) => u ** 2.2,
  out: (u) => 1 - (1 - u) ** 3,
  io: (u) => u * u * (3 - 2 * u),
};

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/**
 * Builds a track from sparse frames: any bone a frame leaves out keeps its previous value, so each
 * frame only needs to say what changes. Arm angles are shoulder rotations of the sword arm:
 * Z swings it across the body in the horizontal plane (0 out to the right, 1.57 ahead, 3 to the
 * left) and X lifts it forward (negative is up and ahead).
 */
const track = (frames: Array<[number, Ease, Partial3, number?]>): Frame[] => {
  const held: Partial3 = {};
  let drop = 0;
  return frames.map(([t, ease, pose, d]) => {
    Object.assign(held, pose);
    drop = d ?? drop;
    const copy: Partial3 = {};
    for (const key of Object.keys(held) as BoneName[]) copy[key] = [...held[key]!] as Euler3;
    return { t, ease, pose: copy, drop };
  });
};

const READY_LEFT: Partial3 = { leftUpperArm: [-0.5, 0, -0.95], leftLowerArm: [0, -0.9, 0] };

const TRACKS: Frame[][] = [
  // 1: right to left horizontal slash
  track([
    [0, 'io', { hips: [0, -0.15, 0], spine: [0.05, -0.2, 0], chest: [0.05, -0.35, 0], rightUpperArm: [-1.1, 0, 0.7], rightLowerArm: [0, 0.8, 0], ...READY_LEFT, leftUpperLeg: [-0.25, 0, -0.04], rightUpperLeg: [0.3, 0, 0.04], leftLowerLeg: [0.2, 0, 0], rightLowerLeg: [0.35, 0, 0] }, 0.02],
    [0.3, 'io', { hips: [0, -0.35, 0], spine: [0.02, -0.35, 0], chest: [0.02, -0.55, 0], rightUpperArm: [-1.45, 0, 0.1], rightLowerArm: [0, 0.35, 0] }, 0.04],
    [0.54, 'in', { hips: [0, 0.35, 0], spine: [0.12, 0.35, 0], chest: [0.1, 0.65, 0], rightUpperArm: [-1.45, 0, 2.5], rightLowerArm: [0, 0.1, 0], leftUpperArm: [0.25, 0, -1.15], leftUpperLeg: [-0.55, 0, -0.04], leftLowerLeg: [0.45, 0, 0], rightUpperLeg: [0.45, 0, 0.04] }, 0.07],
    [0.72, 'out', { hips: [0, 0.4, 0], chest: [0.1, 0.75, 0], rightUpperArm: [-1.35, 0, 2.75] }, 0.06],
    [1, 'io', {}, 0.03],
  ]),
  // 2: left to right backhand
  track([
    [0, 'io', { hips: [0, 0.35, 0], spine: [0.1, 0.3, 0], chest: [0.1, 0.6, 0], rightUpperArm: [-1.3, 0, 2.4], rightLowerArm: [0, 0.2, 0], ...READY_LEFT, leftUpperLeg: [0.3, 0, -0.04], rightUpperLeg: [-0.3, 0, 0.04] }, 0.04],
    [0.3, 'io', { hips: [0, 0.5, 0], chest: [0.08, 0.8, 0], rightUpperArm: [-1.35, 0, 2.9], rightLowerArm: [0, 0.1, 0] }, 0.05],
    [0.52, 'in', { hips: [0, -0.4, 0], spine: [0.1, -0.3, 0], chest: [0.1, -0.7, 0], rightUpperArm: [-1.3, 0, -0.2], rightLowerArm: [0, 0.5, 0], leftUpperArm: [0.35, 0, -1.1], leftUpperLeg: [0.45, 0, -0.04], rightUpperLeg: [-0.55, 0, 0.04], rightLowerLeg: [0.5, 0, 0] }, 0.07],
    [0.72, 'out', { hips: [0, -0.45, 0], chest: [0.1, -0.8, 0], rightUpperArm: [-1.25, 0, -0.45] }, 0.06],
    [1, 'io', {}, 0.03],
  ]),
  // 3: diagonal downward slash
  track([
    [0, 'io', { hips: [0, -0.2, 0], spine: [-0.05, -0.25, 0], chest: [-0.05, -0.4, 0], rightUpperArm: [-1.8, 0, 0.9], rightLowerArm: [0, 0.9, 0], ...READY_LEFT, leftUpperLeg: [-0.2, 0, -0.04], rightUpperLeg: [0.3, 0, 0.04] }, 0.03],
    [0.3, 'io', { hips: [0, -0.4, 0], spine: [-0.15, -0.35, 0], chest: [-0.2, -0.55, 0], rightUpperArm: [-2.7, 0, 0.5], rightLowerArm: [0, 0.6, 0], leftUpperArm: [-0.9, 0, -1.5] }, 0.02],
    [0.56, 'in', { hips: [0, 0.4, 0], spine: [0.3, 0.3, 0], chest: [0.35, 0.5, 0], rightUpperArm: [-1.1, 0, 2.1], rightLowerArm: [0, 0.15, 0], leftUpperArm: [0.4, 0, -1.1], leftUpperLeg: [-0.65, 0, -0.04], leftLowerLeg: [0.55, 0, 0], rightUpperLeg: [0.5, 0, 0.04] }, 0.1],
    [0.74, 'out', { chest: [0.4, 0.6, 0], rightUpperArm: [-0.9, 0, 2.3] }, 0.09],
    [1, 'io', {}, 0.04],
  ]),
  // 4: two-handed overhead finisher
  track([
    [0, 'io', { hips: [0, -0.1, 0], spine: [0, -0.1, 0], chest: [-0.05, -0.2, 0], rightUpperArm: [-1.8, 0, 0.9], rightLowerArm: [0, 0.9, 0], ...READY_LEFT, leftUpperLeg: [-0.1, 0, -0.04], rightUpperLeg: [0.2, 0, 0.04] }, 0.02],
    [0.34, 'io', { hips: [0, -0.3, 0], spine: [-0.25, -0.2, 0], chest: [-0.35, -0.3, 0], rightUpperArm: [-3.0, 0, 0.9], rightLowerArm: [0, 0.5, 0], leftUpperArm: [-2.8, 0, -1.0], leftLowerArm: [0, -0.5, 0], leftUpperLeg: [0.2, 0, -0.04], rightUpperLeg: [-0.3, 0, 0.04] }, -0.02],
    [0.5, 'in', { hips: [0, 0.2, 0], spine: [0.45, 0.1, 0], chest: [0.55, 0.15, 0], rightUpperArm: [-1.2, 0, 1.4], rightLowerArm: [0, 0.2, 0], leftUpperArm: [-1.1, 0, -1.2], leftLowerArm: [0, -0.2, 0], leftUpperLeg: [-0.8, 0, -0.04], leftLowerLeg: [0.7, 0, 0], rightUpperLeg: [0.6, 0, 0.04], rightLowerLeg: [0.2, 0, 0] }, 0.14],
    [0.78, 'out', { chest: [0.6, 0.15, 0], rightUpperArm: [-1.0, 0, 1.4] }, 0.13],
    [1, 'io', {}, 0.05],
  ]),
];

export interface AttackPose {
  bones: Partial3;
  /** 0 leaves the walking pose alone, 1 is fully the attack pose. */
  weight: number;
  drop: number;
}

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

export const attackPose = (step: number, t: number): AttackPose => {
  const frames = TRACKS[Math.min(Math.max(step, 1), TRACKS.length) - 1];
  const strikeAt = ATTACKS[Math.min(Math.max(step, 1), ATTACKS.length) - 1].strikeAt;
  // The keyframes are authored with the strike at frame 3; stretch time so it lands at strikeAt.
  const hit = frames[2].t;
  const clock = t < strikeAt ? (t / strikeAt) * hit : hit + ((t - strikeAt) / (1 - strikeAt)) * (1 - hit);
  let i = 0;
  while (i < frames.length - 2 && clock > frames[i + 1].t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const u = EASES[b.ease](Math.min(1, Math.max(0, (clock - a.t) / (b.t - a.t))));
  const bones: Partial3 = {};
  for (const key of Object.keys(b.pose) as BoneName[]) {
    const from = a.pose[key] ?? b.pose[key]!;
    const to = b.pose[key]!;
    bones[key] = [lerp(from[0], to[0], u), lerp(from[1], to[1], u), lerp(from[2], to[2], u)];
  }
  const weight = smooth(t / 0.14) * (1 - smooth((t - 0.7) / 0.3));
  return { bones, weight, drop: lerp(a.drop, b.drop, u) };
};
