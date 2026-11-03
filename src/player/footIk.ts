import { Quaternion, Vector3, type Object3D } from 'three';

const along = new Vector3();
const pole = new Vector3();
const swingAxis = new Quaternion();
const parentQ = new Quaternion();
const worldQ = new Quaternion();

/** How strongly a foot is held to the ground: fully when it is planted, fading out as it lifts through a stride. */
export const plantWeight = (height: number): number => {
  const u = Math.min(1, Math.max(0, (height - 0.1) / 0.18));
  return 1 - u * u * (3 - 2 * u);
};

/**
 * Two-bone solve. Given where the hip, knee and ankle are and where the ankle should be, finds where the knee
 * must go, keeping it bent the same way. A target out of reach is pulled in until the leg is straight.
 */
export const solveKnee = (hip: Vector3, knee: Vector3, ankle: Vector3, target: Vector3, outKnee: Vector3, outTarget: Vector3): void => {
  const a = hip.distanceTo(knee);
  const b = knee.distanceTo(ankle);
  along.copy(target).sub(hip);
  let d = along.length();
  const longest = a + b - 1e-4;
  const shortest = Math.abs(a - b) + 1e-4;
  const clamped = Math.min(longest, Math.max(shortest, d));
  if (d < 1e-6) {
    outTarget.copy(ankle);
    outKnee.copy(knee);
    return;
  }
  along.multiplyScalar(1 / d);
  d = clamped;
  outTarget.copy(hip).addScaledVector(along, d);
  const reach = (a * a - b * b + d * d) / (2 * d);
  const rise = Math.sqrt(Math.max(0, a * a - reach * reach));
  pole.copy(knee).sub(hip);
  pole.addScaledVector(along, -pole.dot(along));
  if (pole.lengthSq() < 1e-10) pole.set(0, 0, 1).addScaledVector(along, -along.z);
  pole.normalize();
  outKnee.copy(hip).addScaledVector(along, reach).addScaledVector(pole, rise);
};

/** Turns a bone, in the world, so the direction it points in goes from `from` to `to`; its children follow. */
export const swingBone = (bone: Object3D, from: Vector3, to: Vector3): void => {
  swingAxis.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(worldQ);
  bone.parent!.getWorldQuaternion(parentQ);
  worldQ.premultiply(swingAxis);
  bone.quaternion.copy(parentQ.invert().multiply(worldQ));
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
};
