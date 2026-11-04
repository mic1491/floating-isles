import { attackPose } from './attackPose';

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'rightUpperLeg'
  | 'rightLowerLeg';

export type Euler3 = [number, number, number];

export interface Motion {
  time: number;
  /** Advances with distance travelled, so feet match ground speed. */
  stride: number;
  /** 0 standing still, 1 full sprint. */
  pace: number;
  /** Ground speed in metres per second; the recorded locomotion chooses and times its loops by it. */
  speed?: number;
  /** Seconds since the player was hurt. */
  hitAge?: number;
  /** How fast the character is turning, in radians per second, for cloth to swing with. */
  turn?: number;
  airborne: boolean;
  gliding: boolean;
  dashing: boolean;
  /** Diving onto the ground for the plunge attack. */
  plunging?: boolean;
  /** The sword hit in progress: which of the combo and how far through it (0 to 1). */
  attack: { step: number; t: number; id: number; hold?: boolean } | null;
  /** 0 to 1 while a charge is being gathered, for the weapon to swell with. */
  charge?: number;
}

export interface Pose {
  bones: Record<BoneName, Euler3>;
  hipsDrop: number;
  /** 0 leaves the sword along the forearm; 1 points it along `blade`. */
  swordAim: number;
  /** Where that blade points, as [yaw, pitch] from the character's forward. */
  blade: [number, number];
}

const ARM_DOWN = 1.22;
const ELBOW_REST = 0.25;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Hand-made animation for a VRM humanoid. Angles are for its normalised T-pose, facing +Z:
 * negative X swings a limb forward, and each arm's Z brings it down from the T.
 */
export const computePose = (m: Motion): Pose => {
  const breathe = Math.sin(m.time * 1.7);
  const step = Math.sin(m.stride);
  const lift = Math.cos(m.stride);
  const reach = 0.25 + m.pace * 0.5;
  const moving = Math.min(1, m.pace * 2.5);

  const bones: Record<BoneName, Euler3> = {
    hips: [0, 0, 0],
    spine: [m.pace * 0.1, 0, 0],
    chest: [breathe * 0.015 + m.pace * 0.08, step * 0.1 * moving, 0],
    head: [-m.pace * 0.1, 0, 0],
    leftUpperArm: [step * reach * moving * 0.9, 0, -ARM_DOWN + breathe * 0.012],
    leftLowerArm: [0, -ELBOW_REST - moving * 0.45, 0],
    rightUpperArm: [-step * reach * moving * 0.9, 0, ARM_DOWN - breathe * 0.012],
    rightLowerArm: [0, ELBOW_REST + moving * 0.45, 0],
    leftUpperLeg: [-step * reach * moving, 0, -0.03],
    leftLowerLeg: [Math.max(0, lift) * reach * 1.5 * moving, 0, 0],
    rightUpperLeg: [step * reach * moving, 0, 0.03],
    rightLowerLeg: [Math.max(0, -lift) * reach * 1.5 * moving, 0, 0],
  };
  // The sword is always carried: low and forward at the side, trailing back when running.
  const swordAim = 1;
  let blade: [number, number] = [-0.12, -0.55 - m.pace * 0.35];
  let hipsDrop = Math.abs(step) * 0.025 * moving + (1 - moving) * breathe * 0.004;

  if (m.airborne) {
    bones.leftUpperLeg = [-0.75, 0, -0.04];
    bones.leftLowerLeg = [1.05, 0, 0];
    bones.rightUpperLeg = [-0.2, 0, 0.04];
    bones.rightLowerLeg = [0.55, 0, 0];
    bones.leftUpperArm = [0.25, 0, -0.95];
    bones.rightUpperArm = [0.25, 0, 0.95];
    hipsDrop = 0;
    blade = [-0.3, -0.7];
  }
  if (m.gliding) {
    bones.chest = [0.3, 0, 0];
    bones.head = [-0.45, 0, 0];
    bones.leftUpperArm = [-0.1, 0, -0.08];
    bones.rightUpperArm = [-0.1, 0, 0.08];
    bones.leftLowerArm = [0, 0, 0];
    bones.rightLowerArm = [0, 0, 0];
    bones.leftUpperLeg = [0.25, 0, -0.05];
    bones.leftLowerLeg = [0.45, 0, 0];
    bones.rightUpperLeg = [0.25, 0, 0.05];
    bones.rightLowerLeg = [0.3, 0, 0];
    blade = [-0.5, -0.2];
  }
  if (m.plunging) {
    bones.spine = [0.25, 0, 0];
    bones.chest = [0.2, 0, 0];
    bones.head = [-0.3, 0, 0];
    bones.leftUpperArm = [-2.6, 0, -0.35];
    bones.rightUpperArm = [-2.6, 0, 0.35];
    bones.leftLowerArm = [0, 0, 0];
    bones.rightLowerArm = [0, 0, 0];
    bones.leftUpperLeg = [0.1, 0, -0.04];
    bones.leftLowerLeg = [0.2, 0, 0];
    bones.rightUpperLeg = [0.1, 0, 0.04];
    bones.rightLowerLeg = [0.2, 0, 0];
    blade = [-0.1, 1.3];
  }
  if (m.dashing) {
    bones.spine = [0.3, 0, 0];
    bones.chest = [0.25, 0, 0];
    bones.leftUpperArm = [0.65, 0, -ARM_DOWN];
    bones.rightUpperArm = [0.65, 0, ARM_DOWN];
  }
  if (m.attack) {
    const { bones: swing, weight, drop, blade: aim } = attackPose(m.attack.step, m.attack.t);
    for (const key of Object.keys(swing) as BoneName[]) {
      const from = bones[key];
      const to = swing[key]!;
      bones[key] = [mix(from[0], to[0], weight), mix(from[1], to[1], weight), mix(from[2], to[2], weight)];
    }
    hipsDrop = mix(hipsDrop, drop, weight);
    blade = [mix(blade[0], aim[0], weight), mix(blade[1], aim[1], weight)];
  }
  return { bones, hipsDrop, swordAim, blade };
};
