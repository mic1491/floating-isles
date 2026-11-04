import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  TubeGeometry,
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

/** A speck of light flying free: either thrown with gravity, or drawn in from a start point to an end point. */
interface Mote {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
  velocity: Vector3;
  gravity: number;
  from: Vector3 | null;
  to: Vector3 | null;
}

/** An effect that animates itself over its life: `tick` gets 0 to 1. */
interface Timed {
  object: Object3D;
  age: number;
  life: number;
  tick: (t: number) => void;
  dispose: () => void;
}

const sphere = new SphereGeometry(1, 16, 12);
const speck = new SphereGeometry(1, 6, 4);
const column = new CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
const ring = new RingGeometry(0.82, 1, 40);

export class Fx {
  private readonly bursts: Burst[] = [];
  private readonly trails: Trail[] = [];
  private readonly motes: Mote[] = [];
  private readonly timed: Timed[] = [];
  private readonly specks = new Map<string, MeshBasicMaterial>();
  private sigil: { group: Group; outer: Group; inner: Group; materials: MeshBasicMaterial[] } | null = null;
  private gatherDebt = 0;

  constructor(private readonly scene: Scene) {}


  private glow(color: string, opacity: number, boost = 1.8): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(boost),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
  }

  private speckMaterial(color: string): MeshBasicMaterial {
    let material = this.specks.get(color);
    if (!material) {
      material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(2.2) });
      this.specks.set(color, material);
    }
    return material;
  }

  private mote(at: Vector3, color: string, size: number, life: number, velocity: Vector3, gravity: number, to: Vector3 | null): void {
    const mesh = new Mesh(speck, this.speckMaterial(color));
    mesh.position.copy(at);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.motes.push({ mesh, age: 0, life, size, velocity, gravity, from: to ? at.clone() : null, to });
  }

  /** Sparks thrown outward from a point and falling back, for impacts. */
  scatter(at: Vector3, color: string, count: number, speed: number, lift = 3, size = 0.09, life = 0.7): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const push = speed * (0.4 + Math.random() * 0.6);
      const velocity = new Vector3(Math.cos(angle) * push, lift * (0.4 + Math.random() * 0.8), Math.sin(angle) * push);
      this.mote(at, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.5), velocity, 9, null);
    }
  }

  /** Specks of light appearing round a point and streaming in to it, for gathering power. */
  gather(center: Vector3, color: string, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.7 + Math.random() * 0.5);
      const start = new Vector3(center.x + Math.cos(angle) * r, center.y - 0.9 + Math.random() * 2.2, center.z + Math.sin(angle) * r);
      this.mote(start, color, 0.05 + Math.random() * 0.05, 0.4 + Math.random() * 0.2, new Vector3(), 0, center.clone());
    }
  }

  private timedEffect(object: Object3D, life: number, tick: (t: number) => void, dispose: () => void): void {
    this.scene.add(object);
    this.timed.push({ object, age: 0, life, tick, dispose });
  }

  /** A column of light that shoots up from the ground and widens as it fades. */
  pillar(at: Vector3, radius: number, height: number, color: string, life = 0.6): void {
    const outer = new Mesh(column, this.glow(color, 0.4, 1.1));
    const core = new Mesh(column, this.glow('#ffffff', 0.5, 0.8));
    const group = new Group();
    group.add(outer, core);
    group.position.copy(at);
    group.renderOrder = 4;
    this.timedEffect(
      group,
      life,
      (t) => {
        const rise = 1 - (1 - Math.min(1, t * 2.5)) ** 3;
        const fade = (1 - t) ** 1.6;
        outer.scale.set(radius * (0.45 + 0.55 * rise), height * rise, radius * (0.45 + 0.55 * rise));
        core.scale.set(radius * 0.22 * (1 - t * 0.6), height * 1.05 * rise, radius * 0.22 * (1 - t * 0.6));
        (outer.material as MeshBasicMaterial).opacity = 0.4 * fade;
        (core.material as MeshBasicMaterial).opacity = 0.5 * fade;
      },
      () => {
        (outer.material as MeshBasicMaterial).dispose();
        (core.material as MeshBasicMaterial).dispose();
      },
    );
  }

  /** A jagged bolt between two points that crackles and fades. */
  bolt(from: Vector3, to: Vector3, color: string, life = 0.3, jitter = 0.35): void {
    const points: Vector3[] = [];
    const steps = Math.max(4, Math.round(from.distanceTo(to) / 0.6));
    for (let i = 0; i <= steps; i++) {
      const point = from.clone().lerp(to, i / steps);
      if (i > 0 && i < steps) point.add(new Vector3((Math.random() - 0.5) * jitter * 2, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter * 2));
      points.push(point);
    }
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.1);
    const halo = new Mesh(new TubeGeometry(curve, steps * 3, 0.14, 5), this.glow(color, 0.4, 1.2));
    const core = new Mesh(new TubeGeometry(curve, steps * 3, 0.04, 4), this.glow('#ffffff', 0.9, 0.8));
    const group = new Group();
    group.add(halo, core);
    this.timedEffect(
      group,
      life,
      (t) => {
        const fade = (1 - t) ** 1.4;
        (halo.material as MeshBasicMaterial).opacity = 0.4 * fade;
        (core.material as MeshBasicMaterial).opacity = 0.9 * fade;
        halo.scale.setScalar(1 + t * 0.5);
      },
      () => {
        halo.geometry.dispose();
        core.geometry.dispose();
        (halo.material as MeshBasicMaterial).dispose();
        (core.material as MeshBasicMaterial).dispose();
      },
    );
  }

  /** The magic circle drawn on the ground while a charge builds: it grows, spins and brightens, and light streams in. */
  charging(at: Vector3, color: string, level: number, dt: number, time: number): void {
    if (!this.sigil) {
      const group = new Group();
      const outer = new Group();
      const inner = new Group();
      const materials: MeshBasicMaterial[] = [];
      const add = (parent: Group, geometry: RingGeometry, rotation = 0, c = color, boost = 1.8) => {
        const material = this.glow(c, 0.6, boost === 1.8 ? 1.3 : boost);
        materials.push(material);
        const mesh = new Mesh(geometry, material);
        mesh.rotation.set(-Math.PI / 2, 0, rotation);
        parent.add(mesh);
      };
      add(outer, new RingGeometry(0.93, 1, 56));
      add(outer, new RingGeometry(0.84, 0.855, 56));
      add(outer, new RingGeometry(0.64, 0.68, 6), 0);
      add(inner, new RingGeometry(0.46, 0.5, 3), 0);
      add(inner, new RingGeometry(0.46, 0.5, 3), Math.PI / 3);
      add(inner, new RingGeometry(0.2, 0.26, 24), 0, '#ffffff', 1);
      group.add(outer, inner);
      group.renderOrder = 3;
      this.scene.add(group);
      this.sigil = { group, outer, inner, materials };
    }
    const { group, outer, inner, materials } = this.sigil;
    group.visible = true;
    group.position.set(at.x, at.y + 0.12, at.z);
    group.scale.setScalar(1.1 + level * 1.5);
    outer.rotation.y = time * (0.8 + level * 2);
    inner.rotation.y = -time * (1.2 + level * 3);
    const pulse = level >= 1 ? 0.8 + Math.sin(time * 16) * 0.2 : 1;
    for (const material of materials) material.opacity = (0.3 + level * 0.55) * pulse;
    this.gatherDebt += dt * (10 + level * 50);
    const count = Math.floor(this.gatherDebt);
    this.gatherDebt -= count;
    if (count > 0) this.gather(new Vector3(at.x, at.y + 1.1, at.z), color, 1.6 + level * 1.4, count);
  }

  endCharge(): void {
    if (this.sigil) this.sigil.group.visible = false;
    this.gatherDebt = 0;
  }

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
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const mote = this.motes[i];
      mote.age += dt;
      const t = mote.age / mote.life;
      if (mote.to && mote.from) {
        mote.mesh.position.lerpVectors(mote.from, mote.to, t * t);
      } else {
        mote.velocity.y -= mote.gravity * dt;
        mote.mesh.position.addScaledVector(mote.velocity, dt);
      }
      mote.mesh.scale.setScalar(mote.size * Math.max(0, 1 - t * t));
      if (t >= 1) {
        this.scene.remove(mote.mesh);
        this.motes.splice(i, 1);
      }
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const effect = this.timed[i];
      effect.age += dt;
      const t = Math.min(1, effect.age / effect.life);
      effect.tick(t);
      if (t >= 1) {
        this.scene.remove(effect.object);
        effect.dispose();
        this.timed.splice(i, 1);
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
