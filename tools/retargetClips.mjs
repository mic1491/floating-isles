// Turns Quaternius UAL2 sword clips into a small JSON the game can play on a VRM.
// Usage: node tools/retargetClips.mjs <UAL_Standard.glb> <out.json> <sword|move>
//   sword: the combo swings, cut from UAL2.   move: idle/walk/run/jump/roll/hit/cast, cut from UAL1.
//
// The source rig stands in a T-pose facing +Z with its left side on +X, exactly like a VRM's normalised
// skeleton, so a bone's turn away from its T-pose orientation can be copied across as it is. For each
// frame a bone's world turn is `anim * bind^-1`; its local rotation on the VRM is then its parent's turn
// undone and its own applied.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Quaternion } from 'three';
import { readGlb, skeleton, clipPoseAt, worldMatrices } from './ualRig.mjs';

const [, , source, output, setName = 'sword'] = process.argv;
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

/**
 * Which clip to cut, over which stretch of seconds. The strike is found from the sword hand's fastest moment.
 * Loops keep every frame but the last, so wrapping around is seamless, and record which moment of the cycle
 * has the left foot furthest forward so several loops can share one phase.
 */
const SETS = {
  sword: [
    { name: 'Sword_Regular_A', from: 0, to: 0.43 },
    { name: 'Sword_Regular_B', from: 0, to: 0.53 },
    { name: 'Sword_Regular_C', from: 0, to: 1.1 },
    { name: 'Sword_Heavy_Combo', from: 0, to: 1.3 },
  ],
  move: [
    { name: 'Idle_Loop', from: 0, to: 2.5, fps: 15, loop: true },
    { name: 'Walk_Loop', from: 0, to: 1.33, fps: 24, loop: true },
    { name: 'Jog_Fwd_Loop', from: 0, to: 0.93, loop: true },
    { name: 'Sprint_Loop', from: 0, to: 0.67, loop: true },
    { name: 'Jump_Start', from: 0, to: 0.9, fps: 24 },
    { name: 'Jump_Loop', from: 0, to: 1.5, fps: 15 },
    { name: 'Jump_Land', from: 0, to: 0.6, fps: 24 },
    { name: 'Roll', from: 0, to: 0.95, fps: 24 },
    { name: 'Hit_Chest', from: 0, to: 0.33 },
    { name: 'Spell_Simple_Shoot', from: 0, to: 0.5 },
  ],
};
const CUTS = SETS[setName];

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

const round = (v) => Math.round(v * 1000) / 1000;

const clips = CUTS.map(({ name, from, to, fps = FPS, loop = false }) => {
  const clip = glb.json.animations.find((a) => a.name === name);
  const frames = Math.round((to - from) * fps) + (loop ? 0 : 1);
  const footZ = [];
  const bones = Object.fromEntries(Object.keys(MAP).map((b) => [b, []]));
  const hipsY = [];
  const handSpeed = [];
  let previousHand = null;
  for (let f = 0; f < frames; f++) {
    const time = from + f / fps;
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
    footZ.push(world[byName.get('foot_l')].elements[14] - world[byName.get('pelvis')].elements[14]);
    const hand = world[byName.get('hand_r')];
    const position = [hand.elements[12], hand.elements[13], hand.elements[14]];
    if (previousHand) handSpeed.push(Math.hypot(...position.map((v, i) => v - previousHand[i])) * fps);
    previousHand = position;
  }
  const peak = handSpeed.indexOf(Math.max(...handSpeed));
  const phase0 = loop ? round(footZ.indexOf(Math.max(...footZ)) / frames) : 0;
  return { name, fps, duration: to - from, strike: round((peak + 0.5) / fps), loop, phase0, bones, hipsY };
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ fps: FPS, restHipsY: round(bindPelvisY.y), clips }));
for (const c of clips) console.log(c.name, `${c.duration.toFixed(2)}s`, 'strike', c.strike, 'phase0', c.phase0, 'frames', c.bones.hips.length);
