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

const bladeGeometry = (): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-0.09, 0, 0, 0.09, 0, 0, -0.05, 0.22, 0, 0.05, 0.22, 0, 0, 0.46, 0], 3),
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  return geometry;
};

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SHADES = ['#9ad56b', '#b4e07a', '#cbe885', '#86c964'].map((c) => new Color(c));
const PETALS = ['#ffffff', '#ffd9ec', '#ffb8dc', '#ffe9a8'].map((c) => new Color(c));

const pick = (palette: Color[], roll: number): Color => palette.at(Math.floor(roll * palette.length))!;

/** Tiles of instanced grass kept around the player and recycled as they walk. */
export class GrassField {
  private readonly geometry = bladeGeometry();
  private readonly material: MeshToonMaterial;
  private readonly time: IUniform<number> = { value: 0 };
  private readonly active = new Map<string, InstancedMesh>();
  private readonly pool: InstancedMesh[] = [];
  private blades = 0;
  private tileRadius = 0;

  constructor(private readonly scene: Scene) {
    this.material = toonMaterial('#ffffff');
    this.material.side = DoubleSide;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.time;
      shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
         vec2 root = instanceMatrix[3].xz;
         float gust = sin(windTime * 1.6 + root.x * 0.22 + root.y * 0.17)
                    + 0.5 * sin(windTime * 3.1 + root.x * 0.6);
         transformed.x += gust * 0.16 * position.y * position.y * 3.0;`,
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

  configure(radius: number, density: number): void {
    for (const mesh of this.active.values()) this.scene.remove(mesh);
    this.active.clear();
    this.pool.length = 0;
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
      const size = 0.55 + random() * 0.6;
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
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    return mesh;
  }
}
