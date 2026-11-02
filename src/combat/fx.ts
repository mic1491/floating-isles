import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { AttackStyle } from '../player/attackTable';

interface Trail {
  mesh: Mesh;
  age: number;
  indices: number;
}

const TRAIL_SEGMENTS = 28;
const TRAIL_SWEEP = 0.12;
const TRAIL_LIFE = 0.34;


interface Burst {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

const sphere = new SphereGeometry(1, 16, 12);
const ring = new RingGeometry(0.82, 1, 40);

export class Fx {
  private readonly bursts: Burst[] = [];
  private readonly trails: Trail[] = [];

  constructor(private readonly scene: Scene) {}

  /** An expanding fading dome, for skill and reaction impacts. */
  dome(at: Vector3, radius: number, color: string, life = 0.4): void {
    this.add(new Mesh(sphere, this.material(color)), at, radius, life);
  }

  /** A flat ground ring, for area attacks. */
  ring(at: Vector3, radius: number, color: string, life = 0.35): void {
    const mesh = new Mesh(ring, this.material(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.material.side = 2;
    this.add(mesh, at.clone().setY(at.y + 0.1), radius, life);
  }

  /** A short white flash where a blade lands. */
  spark(at: Vector3, color: string, size = 0.6): void {
    this.add(new Mesh(sphere, this.material(color)), at, size, 0.14);
  }

  /**
   * A crescent that sweeps along the blade's path: wide and bright at the head, fading to nothing
   * at the tail. It is parented to the player view so it follows through the lunge.
   */
  slash(parent: Object3D, style: AttackStyle['trail'], color: string): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const tint = new Color(color);
    const white = new Color('#ffffff');
    const cos = Math.cos(style.roll);
    const sin = Math.sin(style.roll);
    const point = (angle: number, radius: number): [number, number, number] => {
      // Flat arc in front of the player (forward is -Z), then rolled around the forward axis.
      const x = Math.cos(angle) * radius;
      const y = 0;
      return [x * cos - y * sin, x * sin + y * cos + style.height, -Math.sin(angle) * radius];
    };
    for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
      const g = i / TRAIL_SEGMENTS;
      const angle = style.from + (style.to - style.from) * g;
      const reach = style.radius * (0.85 + 0.15 * g);
      const thick = style.width * Math.sin((g * Math.PI) / 2) ** 1.3;
      positions.push(...point(angle, reach), ...point(angle, reach - thick));
      const glow = tint.clone().lerp(white, g ** 3 * 0.8);
      colors.push(glow.r, glow.g, glow.b, 0.95 * g ** 1.4, glow.r, glow.g, glow.b, 0);
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    geometry.setDrawRange(0, 0);
    parent.add(mesh);
    this.trails.push({ mesh, age: 0, indices: indices.length });
  }

  update(dt: number): void {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      trail.age += dt;
      const reveal = Math.min(1, trail.age / TRAIL_SWEEP);
      trail.mesh.geometry.setDrawRange(0, Math.floor((trail.indices / 6) * reveal) * 6);
      const material = trail.mesh.material as MeshBasicMaterial;
      material.opacity = 1 - Math.max(0, (trail.age - TRAIL_SWEEP) / (TRAIL_LIFE - TRAIL_SWEEP));
      if (trail.age >= TRAIL_LIFE) {
        trail.mesh.removeFromParent();
        trail.mesh.geometry.dispose();
        material.dispose();
        this.trails.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const t = burst.age / burst.life;
      burst.mesh.scale.setScalar(burst.size * (0.35 + 0.65 * Math.sqrt(t)));
      (burst.mesh.material as MeshBasicMaterial).opacity = 0.75 * (1 - t);
      if (t >= 1) {
        this.scene.remove(burst.mesh);
        (burst.mesh.material as MeshBasicMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private material(color: string): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
  }

  private add(mesh: Mesh, at: Vector3, size: number, life: number): void {
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, size });
  }
}
