export type BoneName =
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
  airborne: boolean;
  gliding: boolean;
  dashing: boolean;
  /** 1 when a swing starts, falling to 0 as it ends. */
  swing: number;
}

export interface Pose {
  bones: Record<BoneName, Euler3>;
  hipsDrop: number;
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
  let hipsDrop = Math.abs(step) * 0.025 * moving + (1 - moving) * breathe * 0.004;

  if (m.airborne) {
    bones.leftUpperLeg = [-0.75, 0, -0.04];
    bones.leftLowerLeg = [1.05, 0, 0];
    bones.rightUpperLeg = [-0.2, 0, 0.04];
    bones.rightLowerLeg = [0.55, 0, 0];
    bones.leftUpperArm = [0.25, 0, -0.95];
    bones.rightUpperArm = [0.25, 0, 0.95];
    hipsDrop = 0;
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
  }
  if (m.dashing) {
    bones.spine = [0.3, 0, 0];
    bones.chest = [0.25, 0, 0];
    bones.leftUpperArm = [0.65, 0, -ARM_DOWN];
    bones.rightUpperArm = [0.65, 0, ARM_DOWN];
  }
  if (m.swing > 0) {
    const progress = 1 - m.swing;
    const slash = progress * progress * (3 - 2 * progress);
    bones.chest = [0.08, mix(0.55, -0.6, slash), 0];
    bones.rightUpperArm = [mix(-2.2, -0.75, slash), 0, mix(1.15, 0.55, slash)];
    bones.rightLowerArm = [0, mix(0.9, 0.1, slash), 0];
  }
  return { bones, hipsDrop };
};
