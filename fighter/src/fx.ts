import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
  type Texture,
} from 'three';

const canvasTexture = (size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const glowTexture = canvasTexture(128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

/** A burst of thin spikes thrown out from a point: the flash of a landed blow. */
const starTexture = canvasTexture(256, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 40; i++) {
    const length = s * (0.2 + Math.random() * 0.29);
    const width = s * 0.011 * (0.4 + Math.random());
    ctx.save();
    ctx.rotate(Math.random() * Math.PI * 2);
    const g = ctx.createLinearGradient(0, 0, length, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, width);
    ctx.fill();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-s / 2, -s / 2, s, s);
});

const crackTexture = canvasTexture(256, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = 'rgba(30,26,36,0.8)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    let angle = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
    let x = 0;
    let y = 0;
    const steps = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < steps; k++) {
      ctx.lineWidth = 3 * (1 - k / steps) + 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      angle += (Math.random() - 0.5) * 0.9;
      x += Math.cos(angle) * s * 0.075;
      y += Math.sin(angle) * s * 0.075;
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
});

const MAX = 1600;

/** A length of light: an outer coloured sheath round a white core, for the finishing move. */
export class Beam {
  readonly group = new Group();
  private readonly outer: Mesh;
  private readonly inner: Mesh;
  private readonly head: Sprite;
  private readonly q = new Quaternion();

  constructor(color: number, hot: number) {
    const geometry = new CylinderGeometry(1, 1, 1, 20, 1, true);
    const material = (c: number, opacity: number) =>
      new MeshBasicMaterial({ color: c, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.outer = new Mesh(geometry, material(color, 0.4));
    this.inner = new Mesh(geometry, material(hot, 0.6));
    this.head = new Sprite(new SpriteMaterial({ map: glowTexture, color, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    this.group.add(this.outer, this.inner, this.head);
  }

  set(start: Vector3, direction: Vector3, length: number, radius: number): void {
    this.q.setFromUnitVectors(new Vector3(0, 1, 0), direction);
    for (const [mesh, r] of [[this.outer, radius], [this.inner, radius * 0.5]] as Array<[Mesh, number]>) {
      mesh.quaternion.copy(this.q);
      mesh.position.copy(start).addScaledVector(direction, length / 2);
      mesh.scale.set(r, length, r);
    }
    this.head.position.copy(start);
    this.head.scale.setScalar(radius * 3.4);
  }
}

interface Flash {
  sprite: Sprite;
  life: number;
  max: number;
  from: number;
  to: number;
  opacity: number;
}

interface Ring {
  mesh: Mesh;
  life: number;
  max: number;
  from: number;
  to: number;
  flat: boolean;
}

interface Decal {
  mesh: Mesh;
  life: number;
}

export class Fx {
  private readonly position = new Float32Array(MAX * 3);
  private readonly velocity = new Float32Array(MAX * 3);
  private readonly shade = new Float32Array(MAX * 3);
  private readonly base = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly baseSize = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly gravity = new Float32Array(MAX);
  private cursor = 0;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly flashes: Flash[] = [];
  private readonly idleSprites: Sprite[] = [];
  private readonly rings: Ring[] = [];
  private readonly idleRings: Mesh[] = [];
  private readonly decals: Decal[] = [];
  private readonly ringGeometry = new RingGeometry(0.78, 1, 48);
  private readonly color = new Color();

  constructor(private readonly scene: Scene) {
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aColor', new BufferAttribute(this.shade, 3));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a, 1.0);
        }`,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false;
    scene.add(points);
  }

  /** One glowing mote. */
  mote(p: Vector3, vx: number, vy: number, vz: number, color: number, size: number, life: number, gravity = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.position.set([p.x, p.y, p.z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.color.set(color);
    this.base.set([this.color.r, this.color.g, this.color.b], i * 3);
    this.baseSize[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.gravity[i] = gravity;
  }

  /** Motes thrown out in every direction. */
  sparks(p: Vector3, color: number, count: number, speed: number, life: number, size: number, gravity = 9): void {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2 - 1;
      const flat = Math.sqrt(1 - up * up);
      const v = speed * (0.35 + Math.random() * 0.65);
      this.mote(p, Math.cos(a) * flat * v, up * v, Math.sin(a) * flat * v, color, size * (0.5 + Math.random()), life * (0.5 + Math.random() * 0.5), gravity);
    }
  }

  flash(kind: 'star' | 'glow', p: Vector3, color: number, from: number, to: number, life: number, opacity = 1): void {
    const sprite =
      this.idleSprites.pop() ??
      new Sprite(new SpriteMaterial({ blending: AdditiveBlending, depthWrite: false, transparent: true }));
    const material = sprite.material;
    material.map = kind === 'star' ? starTexture : glowTexture;
    material.color.set(color);
    material.rotation = Math.random() * Math.PI * 2;
    material.opacity = opacity;
    material.needsUpdate = true;
    sprite.position.copy(p);
    sprite.scale.setScalar(from);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life, max: life, from, to, opacity });
  }

  ring(p: Vector3, color: number, from: number, to: number, life: number, flat: boolean): void {
    const mesh =
      this.idleRings.pop() ??
      new Mesh(this.ringGeometry, new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    (mesh.material as MeshBasicMaterial).color.set(color);
    mesh.position.copy(p);
    mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    mesh.scale.setScalar(from);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, from, to, flat });
  }

  /** A blow landing: a spiked flash, a glow, a ring and a shower of sparks. `power` is 1 for a jab, 3 for a finisher. */
  hit(p: Vector3, color: number, hot: number, power: number): void {
    this.flash('star', p, hot, 0.5 * power, 2.3 * power, 0.13 + power * 0.03, 0.7);
    this.flash('star', p, color, 0.6 * power, 3.0 * power, 0.2 + power * 0.03, 0.9);
    this.flash('glow', p, color, 0.7 * power, 2.0 * power, 0.2, 0.4);
    this.ring(p, hot, 0.2, 1.5 * power, 0.22, false);
    this.sparks(p, hot, Math.round(12 * power), 9 + power * 3, 0.45, 0.14, 12);
    this.sparks(p, color, Math.round(8 * power), 5 + power * 2, 0.6, 0.2, 4);
  }

  block(p: Vector3): void {
    this.flash('glow', p, 0xbfe8ff, 0.6, 1.8, 0.16, 0.9);
    this.ring(p, 0xdff4ff, 0.3, 1.3, 0.2, false);
    this.sparks(p, 0xdff4ff, 8, 6, 0.3, 0.1, 10);
  }

  /** A body hitting the floor: a ring along the ground, dust and a crack that fades. */
  slam(p: Vector3, strong: boolean): void {
    const at = new Vector3(p.x, 0.05, p.z);
    this.ring(at, 0xd8d0c0, 0.4, strong ? 4.5 : 2.6, 0.4, true);
    for (let n = 0; n < (strong ? 26 : 12); n++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 4;
      this.mote(at, Math.cos(a) * v, 0.6 + Math.random() * 1.6, Math.sin(a) * v, 0x6a6258, 0.5 + Math.random() * 0.5, 0.7, 2);
    }
    if (!strong) return;
    const mesh = new Mesh(new PlaneGeometry(3.4, 3.4), new MeshBasicMaterial({ map: crackTexture, transparent: true, depthWrite: false }));
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
    mesh.position.set(p.x, 0.02 + Math.random() * 0.01, p.z);
    this.scene.add(mesh);
    this.decals.push({ mesh, life: 5 });
  }

  explosion(p: Vector3, color: number, hot: number, scale: number): void {
    this.flash('glow', p, color, scale, scale * 3.5, 0.3, 0.5);
    this.flash('star', p, hot, scale, scale * 4, 0.2, 0.6);
    this.flash('star', p, color, scale, scale * 6, 0.32);
    this.ring(p, color, 0.3, scale * 3.2, 0.35, false);
    this.sparks(p, color, 30, 12, 0.7, 0.24, 5);
    this.sparks(p, hot, 20, 16, 0.4, 0.14, 8);
  }

  update(dt: number, camera: PerspectiveCamera, viewportHeight: number): void {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const o = i * 3;
      this.velocity[o + 1] -= this.gravity[i] * dt;
      const drag = Math.exp(-dt * 2.2);
      this.velocity[o] *= drag;
      this.velocity[o + 1] *= drag;
      this.velocity[o + 2] *= drag;
      this.position[o] += this.velocity[o] * dt;
      this.position[o + 1] += this.velocity[o + 1] * dt;
      this.position[o + 2] += this.velocity[o + 2] * dt;
      this.shade[o] = this.base[o] * k;
      this.shade[o + 1] = this.base[o + 1] * k;
      this.shade[o + 2] = this.base[o + 2] * k;
      this.size[i] = this.life[i] > 0 ? this.baseSize[i] * (0.4 + 0.6 * k) : 0;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = 1 - Math.max(0, f.life / f.max);
      f.sprite.scale.setScalar(f.from + (f.to - f.from) * (1 - (1 - k) * (1 - k)));
      f.sprite.material.opacity = f.opacity * (1 - k * k);
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        this.idleSprites.push(f.sprite);
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - Math.max(0, r.life / r.max);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as MeshBasicMaterial).opacity = 1 - k;
      if (!r.flat) r.mesh.quaternion.copy(camera.quaternion);
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        this.idleRings.push(r.mesh);
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      (d.mesh.material as MeshBasicMaterial).opacity = Math.min(1, d.life / 1.5) * 0.6;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.decals.splice(i, 1);
      }
    }
  }
}

export const makeGlow = (color: number, opacity: number): Sprite =>
  new Sprite(new SpriteMaterial({ map: glowTexture, color, opacity, blending: AdditiveBlending, depthWrite: false, transparent: true }));
