// Turns Quaternius UAL2 sword clips into a small JSON the game can play on a VRM.
// Usage: node tools/retargetClips.mjs <UAL2_Standard.glb> public/assets/animations/sword_clips.json
//
// The source rig stands in a T-pose facing +Z with its left side on +X, exactly like a VRM's normalised
// skeleton, so a bone's turn away from its T-pose orientation can be copied across as it is. For each
// frame a bone's world turn is `anim * bind^-1`; its local rotation on the VRM is then its parent's turn
// undone and its own applied.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Quaternion } from 'three';
import { readGlb, skeleton, clipPoseAt, worldMatrices } from './ualRig.mjs';

const [, , source, output] = process.argv;
const FPS = 30;

/** VRM bone → [UAL2 bone, VRM parent]. */
const MAP = {
  hips: ['pelvis', null],
  spine: ['spine_01', 'hips'],
  chest: ['spine_02', 'spine'],
  upperChest: ['spine_03', 'chest'],
  neck: ['neck_01', 'upperChest'],
  head: ['Head', 'neck'],
  leftShoulder: ['clavicle_l', 'upperChest'],
  leftUpperArm: ['upperarm_l', 'leftShoulder'],
  leftLowerArm: ['lowerarm_l', 'leftUpperArm'],
  leftHand: ['hand_l', 'leftLowerArm'],
  rightShoulder: ['clavicle_r', 'upperChest'],
  rightUpperArm: ['upperarm_r', 'rightShoulder'],
  rightLowerArm: ['lowerarm_r', 'rightUpperArm'],
  rightHand: ['hand_r', 'rightLowerArm'],
  leftUpperLeg: ['thigh_l', 'hips'],
  leftLowerLeg: ['calf_l', 'leftUpperLeg'],
  leftFoot: ['foot_l', 'leftLowerLeg'],
  leftToes: ['ball_l', 'leftFoot'],
  rightUpperLeg: ['thigh_r', 'hips'],
  rightLowerLeg: ['calf_r', 'rightUpperLeg'],
  rightFoot: ['foot_r', 'rightLowerLeg'],
  rightToes: ['ball_r', 'rightFoot'],
};

/** Which clip to cut, over which stretch of seconds. The strike is found from the sword hand's fastest moment. */
const CUTS = [
  { name: 'Sword_Regular_A', from: 0, to: 0.43 },
  { name: 'Sword_Regular_B', from: 0, to: 0.53 },
  { name: 'Sword_Regular_C', from: 0, to: 1.1 },
  { name: 'Sword_Heavy_Combo', from: 0, to: 1.3 },
];

const glb = readGlb(source);
const { byName } = skeleton(glb);

const rotationOf = (matrix) => new Quaternion().setFromRotationMatrix(matrix);
const tposeClip = glb.json.animations.find((a) => a.name === 'A_TPose');
const bindWorld = worldMatrices(glb, clipPoseAt(glb, tposeClip, 0));
const bindRot = {};
const bindPelvisY = { y: 0 };
for (const [vrm, [src]] of Object.entries(MAP)) {
  bindRot[vrm] = rotationOf(bindWorld[byName.get(src)]);
}
bindPelvisY.y = bindWorld[byName.get('pelvis')].elements[13];

const round = (v) => Math.round(v * 10000) / 10000;

const clips = CUTS.map(({ name, from, to }) => {
  const clip = glb.json.animations.find((a) => a.name === name);
  const frames = Math.round((to - from) * FPS) + 1;
  const bones = Object.fromEntries(Object.keys(MAP).map((b) => [b, []]));
  const hipsY = [];
  const handSpeed = [];
  let previousHand = null;
  for (let f = 0; f < frames; f++) {
    const time = from + f / FPS;
    const world = worldMatrices(glb, clipPoseAt(glb, clip, time));
    const delta = {};
    for (const [vrm, [src]] of Object.entries(MAP)) {
      delta[vrm] = rotationOf(world[byName.get(src)]).multiply(bindRot[vrm].clone().invert());
    }
    for (const [vrm, [, parent]] of Object.entries(MAP)) {
      const local = parent ? delta[parent].clone().invert().multiply(delta[vrm]) : delta[vrm].clone();
      // Keep neighbouring frames on the same side of the sphere so they interpolate the short way.
      const previous = bones[vrm][f - 1];
      if (previous && local.x * previous[0] + local.y * previous[1] + local.z * previous[2] + local.w * previous[3] < 0) {
        local.set(-local.x, -local.y, -local.z, -local.w);
      }
      bones[vrm].push([round(local.x), round(local.y), round(local.z), round(local.w)]);
    }
    hipsY.push(round(world[byName.get('pelvis')].elements[13] - bindPelvisY.y));
    const hand = world[byName.get('hand_r')];
    const position = [hand.elements[12], hand.elements[13], hand.elements[14]];
    if (previousHand) handSpeed.push(Math.hypot(...position.map((v, i) => v - previousHand[i])) * FPS);
    previousHand = position;
  }
  const peak = handSpeed.indexOf(Math.max(...handSpeed));
  return { name, fps: FPS, duration: to - from, strike: round((peak + 0.5) / FPS), bones, hipsY };
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ fps: FPS, restHipsY: round(bindPelvisY.y), clips }));
for (const c of clips) console.log(c.name, `${c.duration.toFixed(2)}s`, 'strike', c.strike, 'frames', c.bones.hips.length);
