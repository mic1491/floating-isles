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
  /** Where the blade points, as [yaw, pitch] from the character's forward; yaw is positive to their left. */
  blade: [number, number];
}

/** How hard a key's tangent is scaled: arriving by 'in' means the blade is still fast, 'out' means it settles. */
const SPEED: Record<Ease, number> = { in: 1.6, out: 0.5, io: 1 };

/**
 * Builds a track from sparse frames: any bone a frame leaves out keeps its previous value, so each
 * frame only needs to say what changes. Arm angles are shoulder rotations of the sword arm:
 * Z swings it across the body in the horizontal plane (0 out to the right, 1.57 ahead, 3 to the
 * left) and X lifts it forward (negative is up and ahead).
 */
const track = (frames: Array<[number, Ease, Partial3, number?, [number, number]?]>): Frame[] => {
  const held: Partial3 = {};
  let drop = 0;
  let blade: [number, number] = [0, 0];
  return frames.map(([t, ease, pose, d, aim]) => {
    Object.assign(held, pose);
    drop = d ?? drop;
    blade = aim ?? blade;
    const copy: Partial3 = {};
    for (const key of Object.keys(held) as BoneName[]) copy[key] = [...held[key]!] as Euler3;
    return { t, ease, pose: copy, drop, blade };
  });
};

/** Sword arm poses are solved so the fist lands where a person's would: elbows bend to coil and straighten to strike. */
const READY_RIGHT: Partial3 = { rightUpperArm: [-0.05, 0, 1.1], rightLowerArm: [0, 1.42, 0] };
const GUARD_LEFT: Partial3 = { leftUpperArm: [0.1, 0, -1.55], leftLowerArm: [0, -1.72, 0] };
const SWING_LEFT: Partial3 = { leftUpperArm: [0.4, 0, -1.0], leftLowerArm: [0, -0.4, 0] };

const TRACKS: Frame[][] = [
  // 1: right to left horizontal slash
  track([
    [0, 'io', { hips: [0, -0.15, 0], spine: [0.05, -0.2, 0], chest: [0.05, -0.35, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.25, 0, -0.04], rightUpperLeg: [0.3, 0, 0.04], leftLowerLeg: [0.2, 0, 0], rightLowerLeg: [0.35, 0, 0] }, 0.02, [0.3, 0.6]],
    [0.3, 'io', { hips: [0, -0.35, 0], spine: [0.02, -0.35, 0], chest: [0.02, -0.55, 0], rightUpperArm: [0.6, 0, 0.55], rightLowerArm: [0, 0.2, 0] }, 0.04, [-1.4, 0.5]],
    [0.54, 'in', { hips: [0, 0.35, 0], spine: [0.12, 0.35, 0], chest: [0.1, 0.65, 0], rightUpperArm: [-0.8, 0, 1.4], rightLowerArm: [0, 1.13, 0], ...SWING_LEFT, leftUpperLeg: [-0.55, 0, -0.04], leftLowerLeg: [0.45, 0, 0], rightUpperLeg: [0.45, 0, 0.04] }, 0.07, [1.0, 0]],
    [0.72, 'out', { hips: [0, 0.4, 0], chest: [0.1, 0.75, 0], rightUpperArm: [-0.55, 0, 2.05], rightLowerArm: [0, 1.42, 0] }, 0.06, [1.9, -0.2]],
    [1, 'io', {}, 0.03],
  ]),
  // 2: left to right backhand
  track([
    [0, 'io', { hips: [0, 0.35, 0], spine: [0.1, 0.3, 0], chest: [0.1, 0.6, 0], rightUpperArm: [-0.55, 0, 2.05], rightLowerArm: [0, 1.42, 0], ...GUARD_LEFT, leftUpperLeg: [0.3, 0, -0.04], rightUpperLeg: [-0.3, 0, 0.04] }, 0.04, [1.9, -0.2]],
    [0.3, 'io', { hips: [0, 0.5, 0], chest: [0.08, 0.8, 0], rightUpperArm: [-0.15, 0, 2.2], rightLowerArm: [0, 1.71, 0] }, 0.05, [1.6, 0.4]],
    [0.52, 'in', { hips: [0, -0.4, 0], spine: [0.1, -0.3, 0], chest: [0.1, -0.7, 0], rightUpperArm: [-0.15, 0, 0.2], rightLowerArm: [0, 0.74, 0], ...SWING_LEFT, leftUpperLeg: [0.45, 0, -0.04], rightUpperLeg: [-0.55, 0, 0.04], rightLowerLeg: [0.5, 0, 0] }, 0.07, [-1.0, 0]],
    [0.72, 'out', { hips: [0, -0.45, 0], chest: [0.1, -0.8, 0], rightUpperArm: [0, 0, 0], rightLowerArm: [0, 0.1, 0] }, 0.06, [-1.9, -0.1]],
    [1, 'io', {}, 0.03],
  ]),
  // 3: diagonal downward slash
  track([
    [0, 'io', { hips: [0, -0.2, 0], spine: [-0.05, -0.25, 0], chest: [-0.05, -0.4, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.2, 0, -0.04], rightUpperLeg: [0.3, 0, 0.04] }, 0.03, [0.3, 0.6]],
    [0.3, 'io', { hips: [0, -0.4, 0], spine: [-0.15, -0.35, 0], chest: [-0.2, -0.55, 0], rightUpperArm: [-2.15, 0, 0.85], rightLowerArm: [0, 1.23, 0], leftUpperArm: [-0.9, 0, -1.5], leftLowerArm: [0, -1.0, 0] }, 0.02, [-0.6, 1.3]],
    [0.56, 'in', { hips: [0, 0.4, 0], spine: [0.3, 0.3, 0], chest: [0.35, 0.5, 0], rightUpperArm: [-0.45, 0, 1.55], rightLowerArm: [0, 0.93, 0], ...SWING_LEFT, leftUpperLeg: [-0.65, 0, -0.04], leftLowerLeg: [0.55, 0, 0], rightUpperLeg: [0.5, 0, 0.04] }, 0.1, [0.9, -0.6]],
    [0.74, 'out', { chest: [0.4, 0.6, 0], rightUpperArm: [-0.2, 0, 1.85], rightLowerArm: [0, 0.83, 0] }, 0.09, [1.4, -0.8]],
    [1, 'io', {}, 0.04],
  ]),
  // 4: two-handed overhead finisher
  track([
    [0, 'io', { hips: [0, -0.1, 0], spine: [0, -0.1, 0], chest: [-0.05, -0.2, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.1, 0, -0.04], rightUpperLeg: [0.2, 0, 0.04] }, 0.02, [0.3, 0.6]],
    [0.34, 'io', { hips: [0, -0.3, 0], spine: [-0.25, -0.2, 0], chest: [-0.35, -0.3, 0], rightUpperArm: [-2.85, 0, 1.2], rightLowerArm: [0, 1.03, 0], leftUpperArm: [-2.7, 0, -2.1], leftLowerArm: [0, -0.2, 0], leftUpperLeg: [0.2, 0, -0.04], rightUpperLeg: [-0.3, 0, 0.04] }, -0.02, [0, 1.4]],
    [0.5, 'in', { hips: [0, 0.2, 0], spine: [0.45, 0.1, 0], chest: [0.55, 0.15, 0], rightUpperArm: [-1.05, 0, 1.4], rightLowerArm: [0, 0.74, 0], leftUpperArm: [-1.25, 0, -2.05], leftLowerArm: [0, -0.34, 0], leftUpperLeg: [-0.8, 0, -0.04], leftLowerLeg: [0.7, 0, 0], rightUpperLeg: [0.6, 0, 0.04], rightLowerLeg: [0.2, 0, 0] }, 0.14, [0, -0.8]],
    [0.78, 'out', { chest: [0.6, 0.15, 0], rightUpperArm: [-0.7, 0, 1.4], rightLowerArm: [0, 0.54, 0], leftUpperArm: [-0.9, 0, -2.0] }, 0.13, [0, -1.0]],
    [1, 'io', {}, 0.05],
  ]),
  // 5: casting the skill, a thrust forward with the free hand steadying it
  track([
    [0, 'io', { hips: [0, -0.1, 0], spine: [0, -0.1, 0], chest: [0, -0.2, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.1, 0, -0.04], rightUpperLeg: [0.2, 0, 0.04] }, 0.02, [0.3, 0.6]],
    [0.3, 'io', { hips: [0, -0.2, 0], chest: [-0.1, -0.35, 0], rightUpperArm: [-1.0, 0, 0.9], rightLowerArm: [0, 1.2, 0] }, 0.04, [0, 0.9]],
    [0.5, 'in', { hips: [0, 0.15, 0], chest: [0.2, 0.2, 0], rightUpperArm: [-1.55, 0, 1.45], rightLowerArm: [0, 0.15, 0], leftUpperArm: [-1.2, 0, -1.3], leftLowerArm: [0, -0.3, 0], leftUpperLeg: [-0.5, 0, -0.04], leftLowerLeg: [0.4, 0, 0], rightUpperLeg: [0.4, 0, 0.04] }, 0.08, [0, 0.1]],
    [0.75, 'out', { chest: [0.25, 0.2, 0] }, 0.07, [0, 0]],
    [1, 'io', {}, 0.03],
  ]),
  // 6: spear thrust, drawn back and driven straight ahead
  track([
    [0, 'io', { hips: [0, -0.1, 0], spine: [0, -0.1, 0], chest: [0, -0.25, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.15, 0, -0.04], rightUpperLeg: [0.25, 0, 0.04] }, 0.02, [0.2, 0.4]],
    [0.3, 'io', { hips: [0, -0.3, 0], chest: [0, -0.5, 0], rightUpperArm: [0.3, 0, 0.7], rightLowerArm: [0, 1.6, 0], leftUpperArm: [-0.1, 0, -1.2], leftLowerArm: [0, -0.9, 0] }, 0.05, [0, 0.3]],
    [0.54, 'in', { hips: [0, 0.3, 0], chest: [0.1, 0.45, 0], rightUpperArm: [0, 0, 1.57], rightLowerArm: [0, 0.12, 0], leftUpperArm: [-0.2, 0, -1.3], leftLowerArm: [0, -0.4, 0], leftUpperLeg: [-0.6, 0, -0.04], leftLowerLeg: [0.45, 0, 0], rightUpperLeg: [0.5, 0, 0.04] }, 0.09, [0, -0.05]],
    [0.74, 'out', { chest: [0.12, 0.4, 0] }, 0.08, [0, 0]],
    [1, 'io', {}, 0.03],
  ]),
  // 7: a second thrust from the other side, the point rising
  track([
    [0, 'io', { hips: [0, 0.3, 0], chest: [0.1, 0.4, 0], rightUpperArm: [0, 0, 1.57], rightLowerArm: [0, 0.12, 0], ...GUARD_LEFT, leftUpperLeg: [0.3, 0, -0.04], rightUpperLeg: [-0.4, 0, 0.04] }, 0.05, [0, 0]],
    [0.3, 'io', { hips: [0, 0.4, 0], chest: [0.05, 0.6, 0], rightUpperArm: [0.2, 0, 0.9], rightLowerArm: [0, 1.5, 0] }, 0.06, [0.3, 0.2]],
    [0.54, 'in', { hips: [0, -0.3, 0], chest: [-0.05, -0.4, 0], rightUpperArm: [-0.45, 0, 1.55], rightLowerArm: [0, 0.12, 0], leftUpperArm: [-0.4, 0, -1.3], leftLowerArm: [0, -0.4, 0], leftUpperLeg: [0.5, 0, -0.04], rightUpperLeg: [-0.6, 0, 0.04], rightLowerLeg: [0.45, 0, 0] }, 0.09, [0, 0.35]],
    [0.74, 'out', { chest: [0, -0.4, 0] }, 0.08, [0, 0.3]],
    [1, 'io', {}, 0.03],
  ]),
  // 8: a low drag and a rising thrust
  track([
    [0, 'io', { hips: [0, -0.2, 0], chest: [0.1, -0.35, 0], rightUpperArm: [0.4, 0, 0.8], rightLowerArm: [0, 1.4, 0], ...GUARD_LEFT, leftUpperLeg: [-0.2, 0, -0.04], rightUpperLeg: [0.3, 0, 0.04] }, 0.04, [0.2, -0.2]],
    [0.3, 'io', { hips: [0, -0.4, 0], chest: [0.35, -0.55, 0], rightUpperArm: [0.9, 0, 0.9], rightLowerArm: [0, 1.2, 0] }, 0.14, [0, -0.7]],
    [0.56, 'in', { hips: [0, 0.35, 0], chest: [-0.1, 0.4, 0], rightUpperArm: [-0.8, 0, 1.55], rightLowerArm: [0, 0.15, 0], leftUpperArm: [-0.6, 0, -1.3], leftLowerArm: [0, -0.4, 0], leftUpperLeg: [-0.65, 0, -0.04], leftLowerLeg: [0.5, 0, 0], rightUpperLeg: [0.55, 0, 0.04] }, 0.1, [0, 0.55]],
    [0.76, 'out', { chest: [-0.05, 0.4, 0] }, 0.08, [0, 0.5]],
    [1, 'io', {}, 0.04],
  ]),
  // 9: the finisher, a deep two-handed lunge
  track([
    [0, 'io', { hips: [0, -0.1, 0], chest: [0, -0.2, 0], ...READY_RIGHT, ...GUARD_LEFT, leftUpperLeg: [-0.1, 0, -0.04], rightUpperLeg: [0.2, 0, 0.04] }, 0.02, [0.2, 0.4]],
    [0.34, 'io', { hips: [0, -0.45, 0], spine: [-0.1, -0.3, 0], chest: [-0.1, -0.7, 0], rightUpperArm: [0.4, 0, 0.6], rightLowerArm: [0, 1.7, 0], leftUpperArm: [-0.3, 0, -1.0], leftLowerArm: [0, -1.0, 0], leftUpperLeg: [0.3, 0, -0.04], rightUpperLeg: [-0.4, 0, 0.04] }, 0.1, [0, 0.4]],
    [0.5, 'in', { hips: [0, 0.4, 0], spine: [0.2, 0.3, 0], chest: [0.3, 0.7, 0], rightUpperArm: [0, 0, 1.57], rightLowerArm: [0, 0.1, 0], leftUpperArm: [-0.1, 0, -1.45], leftLowerArm: [0, -0.2, 0], leftUpperLeg: [-0.85, 0, -0.04], leftLowerLeg: [0.75, 0, 0], rightUpperLeg: [0.6, 0, 0.04] }, 0.2, [0, -0.05]],
    [0.78, 'out', { chest: [0.35, 0.7, 0] }, 0.18, [0, 0]],
    [1, 'io', {}, 0.06],
  ]),
];

/** Which track each step uses: the charged strike shares the finisher's overhead swing, and the burst cast does too. */
const TRACK_FOR_STEP = [0, 1, 2, 3, 3, 4, 3];
/** A spear thrusts where a sword cuts: its own track for each hit of the combo and for the charged strike. */
const SPEAR_TRACK_FOR_STEP = [5, 6, 7, 8, 8];

export interface AttackPose {
  bones: Partial3;
  /** 0 leaves the walking pose alone, 1 is fully the attack pose. */
  weight: number;
  drop: number;
  blade: [number, number];
}

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/** Cubic Hermite through p0 and p1 with end slopes m0 and m1, both per segment. */
const hermite = (p0: number, p1: number, m0: number, m1: number, u: number): number => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
};

/**
 * Samples one channel with continuous velocity: slopes come from the neighbouring keys, so the limbs
 * flow through each pose instead of stopping at it. The first and last keys are at rest.
 */
const sample = (frames: Frame[], i: number, u: number, read: (f: Frame) => number): number => {
  const slope = (k: number): number => {
    if (k <= 0 || k >= frames.length - 1) return 0;
    const span = frames[k + 1].t - frames[k - 1].t;
    return ((read(frames[k + 1]) - read(frames[k - 1])) / span) * SPEED[frames[k].ease];
  };
  const a = frames[i];
  const b = frames[i + 1];
  const length = b.t - a.t;
  return hermite(read(a), read(b), slope(i) * length, slope(i + 1) * length, u);
};

export const attackPose = (step: number, t: number, weapon = 'sword'): AttackPose => {
  const spear = weapon === 'spear' && step <= SPEAR_TRACK_FOR_STEP.length;
  const frames = TRACKS[spear ? SPEAR_TRACK_FOR_STEP[step - 1] : TRACK_FOR_STEP[Math.min(Math.max(step, 1), TRACK_FOR_STEP.length) - 1]];
  const strikeAt = ATTACKS[Math.min(Math.max(step, 1), ATTACKS.length) - 1].strikeAt;
  // The keyframes are authored with the strike at frame 3; stretch time so it lands at strikeAt.
  const hit = frames[2].t;
  const clock = t < strikeAt ? (t / strikeAt) * hit : hit + ((t - strikeAt) / (1 - strikeAt)) * (1 - hit);
  let i = 0;
  while (i < frames.length - 2 && clock > frames[i + 1].t) i++;
  const u = Math.min(1, Math.max(0, (clock - frames[i].t) / (frames[i + 1].t - frames[i].t)));
  const bones: Partial3 = {};
  for (const key of Object.keys(frames[frames.length - 1].pose) as BoneName[]) {
    // A bone first posed mid-swing starts from that pose, so it never swings in from nowhere.
    const first = frames.find((f) => f.pose[key])!.pose[key]!;
    const read = (axis: number) => (f: Frame) => (f.pose[key] ?? [first[0], first[1], first[2]])[axis];
    bones[key] = [sample(frames, i, u, read(0)), sample(frames, i, u, read(1)), sample(frames, i, u, read(2))];
  }
  const weight = smooth(t / 0.14) * (1 - smooth((t - 0.7) / 0.3));
  return {
    bones,
    weight,
    drop: sample(frames, i, u, (f) => f.drop),
    blade: [sample(frames, i, u, (f) => f.blade[0]), sample(frames, i, u, (f) => f.blade[1])],
  };
};
