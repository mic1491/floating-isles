import type { Collider } from '@dimforge/rapier3d-compat';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Mesh,
  PlaneGeometry,
  type MeshToonMaterial,
  type Scene,
  type Vector3,
} from 'three';
import { toonMaterial } from '../render/toon';
import type { Physics } from './physics';
import { cellsAround, cellKey, cellOf } from './streaming';
import { CLIFF_BOTTOM, edgeRatio, ISLAND_RADIUS, surfaceColor, terrainHeight } from './terrain';

const CHUNK_SIZE = 64;
const CHUNK_CELLS = 40;
const OVERVIEW_SIZE = ISLAND_RADIUS * 2.4;
const OVERVIEW_CELLS = 96;
const OVERVIEW_DROP = 0.3;

interface Chunk {
  mesh: Mesh | null;
  collider: Collider | null;
}

const buildGeometry = (size: number, cells: number, cx: number, cz: number): BufferGeometry | null => {
  const geometry = new PlaneGeometry(size, size, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(cx, 0, cz);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  const step = size / cells;

  // Sample each height once, one cell past the border. Normals then come from the same
  // grid, so shading stays continuous across chunk seams.
  const side = cells + 3;
  const heights = new Float32Array(side * side);
  const left = cx - size / 2 - step;
  const back = cz - size / 2 - step;
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      heights[row * side + column] = terrainHeight(left + column * step, back + row * step);
    }
  }

  for (let row = 0; row <= cells; row++) {
    for (let column = 0; column <= cells; column++) {
      const i = row * (cells + 1) + column;
      const at = (row + 1) * side + column + 1;
      const nx = heights[at - 1] - heights[at + 1];
      const nz = heights[at - side] - heights[at + side];
      const length = Math.hypot(nx, 2 * step, nz);
      const y = heights[at];
      positions.setY(i, y);
      normals.setXYZ(i, nx / length, (2 * step) / length, nz / length);
      const slope = Math.hypot(nx, nz) / (2 * step);
      surfaceColor(positions.getX(i), positions.getZ(i), y, slope, color).toArray(colors, i * 3);
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const source = geometry.index!;
  const kept: number[] = [];
  for (let i = 0; i < source.count; i += 3) {
    const triangle = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
    if (triangle.some((v) => edgeRatio(positions.getX(v), positions.getZ(v)) < 1.03)) kept.push(...triangle);
  }
  if (kept.length === 0) {
    geometry.dispose();
    return null;
  }
  geometry.setIndex(kept);
  return geometry;
};

export class TerrainStreamer {
  private readonly chunks = new Map<string, Chunk>();
  private readonly material: MeshToonMaterial = toonMaterial('#ffffff', { vertexColors: true });
  private radius = 2;

  constructor(private readonly scene: Scene, private readonly physics: Physics) {
    // A coarse whole-island shell keeps the horizon solid beyond the detailed chunks.
    const overview = new Mesh(buildGeometry(OVERVIEW_SIZE, OVERVIEW_CELLS, 0, 0)!, this.material);
    overview.position.y = -OVERVIEW_DROP;
    const underside = new Mesh(new ConeGeometry(ISLAND_RADIUS * 1.04, 120, 32, 6), toonMaterial('#5a4a44'));
    underside.rotation.x = Math.PI;
    underside.position.y = CLIFF_BOTTOM - 59;
    scene.add(overview, underside);
  }

  get loadedCount(): number {
    return [...this.chunks.values()].filter((chunk) => chunk.mesh).length;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  /** Loads the chunks under a point immediately, so nothing falls through after a teleport. */
  loadAround(position: Vector3): void {
    for (const cell of cellsAround(position.x, position.z, CHUNK_SIZE, 1)) this.load(cell.ix, cell.iz);
  }

  update(position: Vector3): void {
    const home = cellKey(cellOf(position.x, CHUNK_SIZE), cellOf(position.z, CHUNK_SIZE));
    if (!this.chunks.has(home)) this.loadAround(position);

    const wanted = cellsAround(position.x, position.z, CHUNK_SIZE, this.radius);
    const next = wanted.find((cell) => !this.chunks.has(cell.key));
    if (next) this.load(next.ix, next.iz);

    const keep = new Set(cellsAround(position.x, position.z, CHUNK_SIZE, this.radius + 1).map((c) => c.key));
    for (const [key, chunk] of this.chunks) {
      if (keep.has(key)) continue;
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      if (chunk.collider) this.physics.removeCollider(chunk.collider);
      this.chunks.delete(key);
    }
  }

  private load(ix: number, iz: number): void {
    const key = cellKey(ix, iz);
    if (this.chunks.has(key)) return;
    const geometry = buildGeometry(
      CHUNK_SIZE,
      CHUNK_CELLS,
      (ix + 0.5) * CHUNK_SIZE,
      (iz + 0.5) * CHUNK_SIZE,
    );
    if (!geometry) {
      this.chunks.set(key, { mesh: null, collider: null });
      return;
    }
    const mesh = new Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const collider = this.physics.addTrimesh(
      new Float32Array(geometry.attributes.position.array),
      new Uint32Array(geometry.index!.array),
    );
    this.chunks.set(key, { mesh, collider });
  }
}
