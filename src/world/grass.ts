import {
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type IUniform,
  type MeshToonMaterial,
  type Scene,
} from 'three';
import { toonMaterial } from '../render/toon';
import { cellsAround, cellOf } from './streaming';
import { flowerMask, isGrassy, terrainHeight } from './terrain';

const TILE_SIZE = 12;
const TILES_PER_FRAME = 1;
const GRASS_FADE_END = 46;

/** Thin tapered blade: arcs forward, dark at the root and bright at the tip. */
const bladeGeometry = (rows: number): BufferGeometry => {
  const height = 0.52;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const half = i === rows ? 0 : 0.034 * (1 - t) ** 0.7;
    const y = t * height;
    const z = t * t * 0.2;
    const shade = 0.62 + 0.55 * t ** 1.4;
    for (const x of i === rows ? [0] : [-half, half]) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      colors.push(shade, shade, shade);
    }
    if (i > 0) {
      const base = 2 * (i - 1);
      index.push(...(i === rows ? [base, base + 1, base + 2] : [base, base + 1, base + 2, base + 2, base + 1, base + 3]));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  return geometry;
};

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SHADES = ['#8fd163', '#a8dc72', '#bfe47e', '#7cc35e'].map((c) => new Color(c));
const PETALS = ['#e8dce2', '#f2c4dc', '#e8a3cc', '#f0d795'].map((c) => new Color(c));

const pick = (palette: Color[], roll: number): Color => palette.at(Math.floor(roll * palette.length))!;

/** Tiles of instanced grass kept around the player and recycled as they walk. */
export class GrassField {
  private geometry = bladeGeometry(6);
  private readonly material: MeshToonMaterial;
  private readonly time: IUniform<number> = { value: 0 };
  private readonly active = new Map<string, InstancedMesh>();
  private readonly pool: InstancedMesh[] = [];
  private blades = 0;
  private tileRadius = 0;

  constructor(private readonly scene: Scene) {
    this.material = toonMaterial('#ffffff');
    this.material.side = DoubleSide;
    this.material.vertexColors = true;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.time;
      shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
         vec2 root = instanceMatrix[3].xz;
         vec2 away = root - cameraPosition.xz;
         float dist = length(away);
         // Per-blade hash thins the field with distance: dense underfoot, sparse far away.
         float pick = fract(sin(dot(root, vec2(12.9898, 78.233))) * 43758.5453);
         float keep = 1.0 - smoothstep(6.0, ${GRASS_FADE_END.toFixed(1)}, dist);
         float visible = step(pick, keep * keep * 0.92 + 0.08 * keep);
         float lean = position.y * position.y * 3.2;
         float gust = sin(windTime * 1.6 + root.x * 0.22 + root.y * 0.17)
                    + 0.5 * sin(windTime * 3.1 + root.x * 0.6);
         transformed.x += gust * 0.12 * lean;
         transformed.z += 0.05 * sin(windTime * 2.3 + root.y * 0.4) * lean;
         // Far blades that survive are widened so the thinned field still reads as lawn.
         transformed.x *= 1.0 + smoothstep(8.0, ${GRASS_FADE_END.toFixed(1)}, dist) * 1.4;
         transformed *= visible;`,
      );
      // Blades share an upward normal on both faces so they light like the ground.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        'vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;',
      );
    };
  }

  get tileCount(): number {
    return this.active.size;
  }

  /** `rows` sets how finely each blade is built: phones use fewer, since thousands of blades add up fast. */
  configure(radius: number, density: number, rows = 6): void {
    for (const mesh of this.active.values()) this.scene.remove(mesh);
    this.active.clear();
    this.pool.length = 0;
    this.geometry.dispose();
    this.geometry = bladeGeometry(rows);
    this.tileRadius = Math.ceil(radius / TILE_SIZE);
    this.blades = Math.round(density * TILE_SIZE * TILE_SIZE);
  }

  update(dt: number, focus: Vector3): void {
    this.time.value += dt;
    const fx = cellOf(focus.x, TILE_SIZE);
    const fz = cellOf(focus.z, TILE_SIZE);
    for (const [key, mesh] of this.active) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot(ix - fx, iz - fz) <= this.tileRadius + 1) continue;
      this.scene.remove(mesh);
      this.pool.push(mesh);
      this.active.delete(key);
    }
    // Tiles beyond the near ones keep only part of their blades; far grass reads as lawn anyway.
    for (const [key, mesh] of this.active) {
      const [ix, iz] = key.split(',').map(Number);
      const d = Math.hypot(ix - fx, iz - fz);
      const share = d <= 1.2 ? 1 : d <= 2.2 ? 0.55 : 0.3;
      mesh.count = Math.ceil((mesh.userData.placed as number) * share);
    }
    let budget = TILES_PER_FRAME;
    for (const cell of cellsAround(focus.x, focus.z, TILE_SIZE, this.tileRadius)) {
      if (budget === 0) break;
      if (this.active.has(cell.key) || Math.hypot(cell.ix - fx, cell.iz - fz) > this.tileRadius) continue;
      this.active.set(cell.key, this.buildTile(cell.ix, cell.iz));
      budget--;
    }
  }

  private buildTile(ix: number, iz: number): InstancedMesh {
    const mesh = this.pool.pop() ?? new InstancedMesh(this.geometry, this.material, this.blades);
    mesh.receiveShadow = true;
    const random = seeded(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663));
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler();
    const scale = new Vector3();
    let placed = 0;
    for (let i = 0; i < this.blades; i++) {
      const x = (ix + random()) * TILE_SIZE;
      const z = (iz + random()) * TILE_SIZE;
      const spin = random();
      const size = 0.7 + random() * 0.75;
      const roll = random();
      const shade = random();
      if (!isGrassy(x, z)) continue;
      position.set(x, terrainHeight(x, z) - 0.02, z);
      rotation.setFromEuler(euler.set(0, spin * Math.PI, 0));
      scale.setScalar(size);
      mesh.setMatrixAt(placed, matrix.compose(position, rotation, scale));
      const petal = roll < 0.04 + flowerMask(x, z) * 0.42;
      mesh.setColorAt(placed, pick(petal ? PETALS : SHADES, shade));
      placed++;
    }
    mesh.userData.placed = placed;
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mesh;
  }
}
