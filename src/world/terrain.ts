import {
  BufferAttribute,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { toonMaterial } from '../render/toon';
import type { Physics } from './physics';

export const ISLAND_RADIUS = 48;
const GRID = 128;
const SIZE = 104;
const CLIFF_BOTTOM = -34;

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
const edgeRatio = (x: number, z: number): number => {
  const angle = Math.atan2(z, x);
  const wobble = 1 + 0.1 * Math.sin(angle * 3 + 1) + 0.05 * Math.sin(angle * 7);
  return Math.hypot(x, z) / (ISLAND_RADIUS * wobble);
};

export const terrainHeight = (x: number, z: number): number => {
  const rolling = valueNoise(x * 0.05, z * 0.05) * 3.5 + valueNoise(x * 0.14, z * 0.14) * 0.9;
  const hill = 15 * Math.exp(-((x - 17) ** 2 + (z + 15) ** 2) / 170);
  const surface = 3 + rolling + hill;
  const falloff = smooth(clamp01((1 - edgeRatio(x, z)) / 0.08));
  return CLIFF_BOTTOM + (surface - CLIFF_BOTTOM) * falloff;
};

export const isOnIsland = (x: number, z: number): boolean => edgeRatio(x, z) < 0.9;

export const slopeAt = (x: number, z: number): number => {
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};

const grassLow = new Color('#8fcb66');
const grassHigh = new Color('#c9e27c');
const rock = new Color('#b3a595');
const soil = new Color('#5f4b3e');

const buildSurface = (): BufferGeometry => {
  const geometry = new PlaneGeometry(SIZE, SIZE, GRID, GRID);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = terrainHeight(x, z);
    positions.setY(i, y);
    const ratio = edgeRatio(x, z);
    color.lerpColors(grassLow, grassHigh, clamp01((y - 3) / 12) * 0.7 + valueNoise(x * 0.2, z * 0.2) * 0.3);
    color.lerp(rock, clamp01((slopeAt(x, z) - 0.7) / 0.35) * 0.8);
    if (ratio > 0.92) color.lerp(soil, clamp01((ratio - 0.92) / 0.08));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const source = geometry.index!;
  const kept: number[] = [];
  for (let i = 0; i < source.count; i += 3) {
    const triangle = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
    if (triangle.some((v) => edgeRatio(positions.getX(v), positions.getZ(v)) < 1.03)) kept.push(...triangle);
  }
  geometry.setIndex(kept);
  geometry.computeVertexNormals();
  return geometry;
};

export const createTerrain = (physics: Physics): Group => {
  const group = new Group();
  const geometry = buildSurface();
  const surface = new Mesh(geometry, toonMaterial('#ffffff', { vertexColors: true }));
  surface.receiveShadow = true;
  group.add(surface);

  const underside = new Mesh(new ConeGeometry(ISLAND_RADIUS * 1.02, 46, 28, 6), toonMaterial('#5a4a44'));
  underside.rotation.x = Math.PI;
  underside.position.y = CLIFF_BOTTOM - 22;
  group.add(underside);

  physics.addTrimesh(
    new Float32Array(geometry.attributes.position.array),
    new Uint32Array(geometry.index!.array),
  );
  return group;
};
