import { Color } from 'three';

export const ISLAND_RADIUS = 150;
export const CLIFF_BOTTOM = -34;

const hash = (x: number, y: number): number => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const bottom = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Normalised distance from the island centre, with a wobbly coastline. */
export const edgeRatio = (x: number, z: number): number => {
  const angle = Math.atan2(z, x);
  const wobble = 1 + 0.1 * Math.sin(angle * 3 + 1) + 0.05 * Math.sin(angle * 7);
  return Math.hypot(x, z) / (ISLAND_RADIUS * wobble);
};

const hill = (x: number, z: number, cx: number, cz: number, height: number, spread: number): number =>
  height * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / spread);

export const terrainHeight = (x: number, z: number): number => {
  const rolling =
    valueNoise(x * 0.03, z * 0.03) * 5 + valueNoise(x * 0.09, z * 0.09) * 1.6 + valueNoise(x * 0.25, z * 0.25) * 0.3;
  const hills =
    hill(x, z, 17, -15, 13, 520) +
    hill(x, z, -66, 38, 20, 2800) +
    hill(x, z, 64, 50, 14, 2400) +
    hill(x, z, 50, -68, 24, 3400);
  const ratio = edgeRatio(x, z);
  const shore = smooth(clamp01((ratio - 0.78) / 0.12));
  const surface = 3 + rolling + hills;
  const coast = surface + (2.4 + rolling * 0.08 - surface) * shore;
  const falloff = smooth(clamp01((1 - ratio) / 0.07));
  return CLIFF_BOTTOM + (coast - CLIFF_BOTTOM) * falloff;
};

export const slopeAt = (x: number, z: number): number => {
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};

/** 0 to 1: how much of a flower meadow this spot is. */
export const flowerMask = (x: number, z: number): number => {
  const patches = smooth(clamp01((valueNoise(x * 0.022 + 5, z * 0.022 - 3) - 0.46) / 0.14));
  return patches * (1 - smooth(clamp01((edgeRatio(x, z) - 0.72) / 0.1)));
};

export const isGrassy = (x: number, z: number): boolean => edgeRatio(x, z) < 0.86 && slopeAt(x, z) < 0.6;

const grassLow = new Color('#8fcb66');
const grassHigh = new Color('#c9e27c');
const meadow = new Color('#d7dd8a');
const rock = new Color('#b3a595');
const sand = new Color('#ecdcae');
const soil = new Color('#5f4b3e');

export const surfaceColor = (x: number, z: number, y: number, slope: number, out: Color): Color => {
  const ratio = edgeRatio(x, z);
  out.lerpColors(grassLow, grassHigh, clamp01((y - 3) / 18) * 0.7 + valueNoise(x * 0.2, z * 0.2) * 0.3);
  out.lerp(meadow, flowerMask(x, z) * 0.6);
  out.lerp(sand, smooth(clamp01((ratio - 0.82) / 0.06)));
  out.lerp(rock, clamp01((slope - 0.75) / 0.4) * 0.8);
  if (ratio > 0.95) out.lerp(soil, clamp01((ratio - 0.95) / 0.05));
  return out;
};
