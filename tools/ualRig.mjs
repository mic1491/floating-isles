// Shared helpers for reading the Quaternius UAL2 glb: its skeleton and animation clips as plain data.
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

export const readGlb = (path) => {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
  const binStart = 20 + len + 8;
  const bin = b.slice(binStart);
  return { json, bin };
};

export const accessor = ({ json, bin }, index) => {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset + offset, a.count * comps * 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return { data: out, comps, count: a.count };
};

/** Bones by name with their parent and bind pose (local translation, rotation, scale). */
export const skeleton = ({ json }) => {
  const parent = {};
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const byName = new Map();
  json.nodes.forEach((n, i) => byName.set(n.name, i));
  return { parent, byName };
};

/** Local pose of every node for one clip at one time: starts from the bind pose and overrides animated channels. */
export const clipPoseAt = (glb, clip, time) => {
  const { json } = glb;
  const pose = json.nodes.map((n) => ({
    t: new Vector3(...(n.translation || [0, 0, 0])),
    r: new Quaternion(...(n.rotation || [0, 0, 0, 1])),
    s: new Vector3(...(n.scale || [1, 1, 1])),
  }));
  for (const ch of clip.channels) {
    const sampler = clip.samplers[ch.sampler];
    const input = accessor(glb, sampler.input);
    const output = accessor(glb, sampler.output);
    const times = input.data;
    let k = 0;
    while (k < times.length - 2 && time > times[k + 1]) k++;
    const span = times[k + 1] - times[k] || 1;
    const u = Math.min(1, Math.max(0, (time - times[k]) / span));
    const c = output.comps;
    const at = (i) => output.data.slice(i * c, i * c + c);
    const a = at(k);
    const bb = at(Math.min(k + 1, times.length - 1));
    const node = pose[ch.target.node];
    if (ch.target.path === 'rotation') {
      node.r.set(a[0], a[1], a[2], a[3]).slerp(new Quaternion(bb[0], bb[1], bb[2], bb[3]), u);
    } else if (ch.target.path === 'translation') {
      node.t.set(a[0], a[1], a[2]).lerp(new Vector3(bb[0], bb[1], bb[2]), u);
    }
  }
  return pose;
};

/** World matrices for every node, given a local pose. */
export const worldMatrices = (glb, pose) => {
  const { json } = glb;
  const parent = skeleton(glb).parent;
  const world = new Array(json.nodes.length);
  const build = (i) => {
    if (world[i]) return world[i];
    const m = new Matrix4().compose(pose[i].t, pose[i].r, pose[i].s);
    world[i] = parent[i] !== undefined ? build(parent[i]).clone().multiply(m) : m;
    return world[i];
  };
  json.nodes.forEach((_, i) => build(i));
  return world;
};
