import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  type IUniform,
} from 'three';
import { toonMaterial } from '../render/toon';
import { isOnIsland, ISLAND_RADIUS, slopeAt, terrainHeight } from './terrain';

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
const PETALS = ['#ffffff', '#ffd9ec', '#ffe9a8'].map((c) => new Color(c));

export class Grass {
  readonly mesh: InstancedMesh;
  private readonly time: IUniform<number> = { value: 0 };

  constructor(capacity: number) {
    const material = toonMaterial('#ffffff');
    material.side = DoubleSide;
    material.onBeforeCompile = (shader) => {
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
    this.mesh = new InstancedMesh(bladeGeometry(), material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;

    const random = seeded(7);
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler();
    const scale = new Vector3();
    let placed = 0;
    for (let tries = 0; placed < capacity && tries < capacity * 6; tries++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * ISLAND_RADIUS;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!isOnIsland(x, z) || slopeAt(x, z) > 0.6) continue;
      position.set(x, terrainHeight(x, z) - 0.02, z);
      rotation.setFromEuler(euler.set(0, random() * Math.PI, 0));
      const size = 0.55 + random() * 0.6;
      scale.set(size, size, size);
      this.mesh.setMatrixAt(placed, matrix.compose(position, rotation, scale));
      const petal = random() < 0.05;
      const palette = petal ? PETALS : SHADES;
      this.mesh.setColorAt(placed, palette[Math.floor(random() * palette.length) % palette.length]);
      placed++;
    }
    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Grass is placed in shuffled order, so a lower quality just draws fewer instances. */
  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.mesh.instanceMatrix.count);
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}
