import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';

/** One clock every glowing weapon part reads, so they all pulse together and the avatar only sets it once a frame. */
export const weaponTime = { value: 0 };

/**
 * A gem or inlay that lights from within: facets catch the light differently (from screen-space derivatives, so the
 * low-poly shape stays crisp), the rim carries the colour, the centre runs white, and it breathes. With `flow` a
 * bright band travels along the part's length, for runes and blade inlays.
 */
export const glowMaterial = (color: string, options: { flow?: boolean; length?: number; axis?: 'x' | 'y' | 'z' } = {}): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: weaponTime, uLength: { value: options.length ?? 1 } },
    defines: options.flow ? { FLOW: '', AXIS: options.axis ?? 'z' } : { AXIS: 'z' },
    vertexShader: `
      varying vec3 vPos;
      varying float vAlong;
      void main() {
        vAlong = position.AXIS;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uLength;
      varying vec3 vPos;
      varying float vAlong;
      void main() {
        // A flat patch can give a zero normal; dividing by nothing would put a NaN into the bloom and blank the screen.
        vec3 n = cross(dFdx(vPos), dFdy(vPos));
        float nl = length(n);
        n = nl > 1e-9 ? n / nl : vec3(0.0, 0.0, 1.0);
        float f = clamp(1.0 - abs(dot(n, normalize(-vPos))), 0.0, 1.0);
        float pulse = 0.9 + 0.1 * sin(uTime * 3.2);
        vec3 col = mix(vec3(1.0), uColor, smoothstep(0.05, 0.85, f));
        col += 0.18 * step(0.72, fract(f * 4.0 + uTime * 0.25));
        #ifdef FLOW
          float band = smoothstep(0.55, 1.0, sin(vAlong / uLength * 14.0 - uTime * 4.5));
          col = mix(uColor, vec3(1.0), 0.15 + 0.7 * band);
        #endif
        gl_FragColor = vec4(col * pulse, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const paint = (width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
};

/** A cheap repeatable noise, so painted textures come out the same every time. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/**
 * A hand-painted pole: a lacquer colour with a bright painted highlight stripe, a soft bounce light on the far side,
 * wood-grain strokes and a gold diamond motif repeating along it. Along a cylinder u runs round and v runs up it.
 */
export const poleTexture = (base: string, light: string, dark: string, motif = '#e6b84c'): CanvasTexture =>
  paint(128, 256, (g, w, h) => {
    const rand = seeded(7);
    const across = g.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, dark);
    across.addColorStop(0.35, base);
    across.addColorStop(0.7, base);
    across.addColorStop(1, dark);
    g.fillStyle = across;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.16;
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = rand() > 0.5 ? dark : light;
      g.lineWidth = 1 + rand() * 2;
      const x = rand() * w;
      const y = rand() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rand() - 0.5) * 6, y + 20, x + (rand() - 0.5) * 4, y + 30 + rand() * 50);
      g.stroke();
    }
    g.globalAlpha = 1;
    // The painted highlight, bright and a little irregular, as on a lacquered stick lit from one side.
    g.fillStyle = light;
    g.globalAlpha = 0.85;
    g.fillRect(w * 0.27, 0, w * 0.045, h);
    g.globalAlpha = 0.35;
    g.fillRect(w * 0.3, 0, w * 0.08, h);
    g.globalAlpha = 0.2;
    g.fillRect(w * 0.78, 0, w * 0.05, h);
    g.globalAlpha = 1;
    g.fillStyle = motif;
    for (const x of [w * 0.17, w * 0.5, w * 0.83]) {
      for (let y = 24; y < h; y += 64) {
        g.beginPath();
        g.moveTo(x, y - 12);
        g.lineTo(x + 7, y);
        g.lineTo(x, y + 12);
        g.lineTo(x - 7, y);
        g.closePath();
        g.fill();
        g.fillRect(x - 1.5, y + 18, 3, 3);
        g.fillRect(x - 1.5, y - 21, 3, 3);
      }
    }
  });

/** Painted gold: dark at the edges and bright in the middle of each band, with a hot spot, like a baked matcap. */
export const goldTexture = (): CanvasTexture =>
  paint(32, 64, (g, w, h) => {
    const bands = g.createLinearGradient(0, 0, 0, h);
    bands.addColorStop(0, '#7a4f12');
    bands.addColorStop(0.2, '#fbe08a');
    bands.addColorStop(0.42, '#e8b94a');
    bands.addColorStop(0.7, '#b07a22');
    bands.addColorStop(1, '#5e3b0c');
    g.fillStyle = bands;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,240,0.8)';
    g.fillRect(w * 0.22, h * 0.14, w * 0.14, h * 0.1);
  });

/** A strip of rune-like glyphs, white on clear, to be tinted and scrolled; it carries no colour of its own. */
export const runeTexture = (): CanvasTexture =>
  paint(64, 256, (g, w, h) => {
    const rand = seeded(11);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let cell = 0; cell < 8; cell++) {
      const top = cell * 32 + 5;
      for (const column of [0, 1]) {
        const x = 8 + column * 30;
        g.beginPath();
        const points = 3 + Math.floor(rand() * 3);
        for (let i = 0; i < points; i++) {
          const px = x + rand() * 18;
          const py = top + rand() * 22;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      }
    }
  });

/** A soft round dot, shared by every sparkle. */
const sparkShader = (color: string, size: number): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `
      attribute float aLife;
      uniform float uSize;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (320.0 / -mv.z) * sin(aLife * 3.14159);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * sin(vLife * 3.14159);
        gl_FragColor = vec4(uColor * (0.6 + a), a);
        #include <colorspace_fragment>
      }`,
  });

export type SparkPath = (life: number, index: number, out: Vector3) => void;

/**
 * A handful of drifting lights that fade in and out, each following its own looping path: droplets round a crystal,
 * embers up a blade, sparks round a spear head. Positions are in the weapon's own space.
 */
export const sparkles = (color: string, count: number, size: number, path: SparkPath): { points: Points; tick: (time: number) => void } => {
  const positions = new Float32Array(count * 3);
  const lives = new Float32Array(count);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aLife', new BufferAttribute(lives, 1));
  const points = new Points(geometry, sparkShader(color, size));
  points.frustumCulled = false;
  const at = new Vector3();
  const tick = (time: number): void => {
    for (let i = 0; i < count; i++) {
      const life = (time * (0.35 + (i % 3) * 0.12) + i / count) % 1;
      path(life, i, at);
      positions.set([at.x, at.y, at.z], i * 3);
      lives[i] = life;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aLife.needsUpdate = true;
  };
  tick(0);
  return { points, tick };
};

/**
 * A ribbon of light following a weapon through a swing: each frame it records where two points on the weapon are, in
 * the world, and draws a strip joining the last few that fades with age. It lives in the scene, not on the weapon.
 */
export class SwingTrail {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly samples: Array<{ a: Vector3; b: Vector3; age: number }> = [];
  private readonly spare: Array<{ a: Vector3; b: Vector3; age: number }> = [];

  constructor(
    color: string,
    private readonly maxSamples = 14,
    private readonly life = 0.16,
  ) {
    this.positions = new Float32Array(maxSamples * 2 * 3);
    this.alphas = new Float32Array(maxSamples * 2);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));
    const index: number[] = [];
    for (let i = 0; i < maxSamples - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    const material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(color) } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(mix(uColor, vec3(1.0), vAlpha * 0.4), vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** Ages the ribbon and, while `emit` is set, adds this frame's position of the two marked points. */
  update(dt: number, emit: Object3D | null, baseZ: number, tipZ: number): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.life) this.spare.push(this.samples.pop()!);
    if (emit) {
      const sample = this.spare.pop() ?? { a: new Vector3(), b: new Vector3(), age: 0 };
      sample.age = 0;
      emit.localToWorld(sample.a.set(0, 0, baseZ));
      emit.localToWorld(sample.b.set(0, 0, tipZ));
      this.samples.unshift(sample);
      if (this.samples.length > this.maxSamples) this.spare.push(this.samples.pop()!);
    }
    this.mesh.visible = this.samples.length > 1;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.maxSamples; i++) {
      const s = this.samples[Math.min(i, this.samples.length - 1)];
      const fade = i < this.samples.length ? 1 - s.age / this.life : 0;
      this.positions.set([s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z], i * 6);
      this.alphas[i * 2] = fade * fade * 0.1;
      this.alphas[i * 2 + 1] = fade * fade * 0.7;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
