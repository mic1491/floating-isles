import {
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

interface Palette {
  at: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunPower: number;
  ambient: number;
}

const PALETTES: Palette[] = [
  { at: 0, zenith: '#0b1030', horizon: '#26305f', sun: '#8fa6e0', sunPower: 0.9, ambient: 1.3 },
  { at: 0.22, zenith: '#16204f', horizon: '#6a5a8c', sun: '#ffb38a', sunPower: 1.4, ambient: 1.4 },
  { at: 0.3, zenith: '#5a9be0', horizon: '#ffd2b0', sun: '#ffe2bd', sunPower: 2.8, ambient: 1.7 },
  { at: 0.5, zenith: '#3f8fe8', horizon: '#c9e7fb', sun: '#fff6e6', sunPower: 3.2, ambient: 1.9 },
  { at: 0.68, zenith: '#4d7cd6', horizon: '#ffd9a8', sun: '#ffd09a', sunPower: 3, ambient: 1.7 },
  { at: 0.76, zenith: '#3a3f8f', horizon: '#ff9a7a', sun: '#ff9462', sunPower: 1.9, ambient: 1.4 },
  { at: 0.84, zenith: '#0f1540', horizon: '#3a3a78', sun: '#8fa6e0', sunPower: 0.9, ambient: 1.3 },
  { at: 1, zenith: '#0b1030', horizon: '#26305f', sun: '#8fa6e0', sunPower: 0.9, ambient: 1.3 },
];

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww;
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float t = pow(clamp(dir.y, 0.0, 1.0), 0.55);
    vec3 color = mix(horizon, zenith, t);
    float sun = max(dot(dir, sunDir), 0.0);
    color += sunColor * (pow(sun, 900.0) * 3.0 + pow(sun, 24.0) * 0.28);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }`;

const cloudVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const cloudFragment = /* glsl */ `
  uniform float time; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 center;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = vWorld.xz * 0.012 + vec2(time * 0.012, time * 0.006);
    float puff = smoothstep(0.32, 0.72, fbm(uv));
    vec3 color = mix(horizon * 0.9, mix(sunColor, vec3(1.0), 0.45), puff);
    float fade = smoothstep(120.0, 760.0, distance(vWorld.xz, center.xz));
    gl_FragColor = vec4(mix(color, horizon, fade), 1.0);
    #include <colorspace_fragment>
  }`;

const FULL_DAY_SECONDS = 24 * 60;

export class Sky {
  timeOfDay: number;
  readonly sun = new DirectionalLight('#ffffff', 2);
  private readonly hemi = new HemisphereLight('#ffffff', '#6a7a5a', 1);
  private readonly zenith = new Color();
  private readonly horizon = new Color();
  private readonly sunColor = new Color();
  private readonly sunDirection = new Vector3();
  private readonly dome: ShaderMaterial;
  private readonly clouds: ShaderMaterial;
  private readonly cloudMesh: Mesh;
  private elapsed = 0;

  constructor(scene: Scene, timeOfDay: number) {
    this.timeOfDay = timeOfDay;
    const shared = {
      horizon: { value: this.horizon },
      sunColor: { value: this.sunColor },
    };
    this.dome = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { ...shared, zenith: { value: this.zenith }, sunDir: { value: this.sunDirection } },
    });
    const dome = new Mesh(new SphereGeometry(1, 32, 16), this.dome);
    dome.renderOrder = -1;
    dome.frustumCulled = false;

    this.clouds = new ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: { ...shared, time: { value: 0 }, center: { value: new Vector3() } },
    });
    this.cloudMesh = new Mesh(new CircleGeometry(1400, 48), this.clouds);
    this.cloudMesh.rotation.x = -Math.PI / 2;
    this.cloudMesh.position.y = -42;

    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.12;
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -36;
    shadow.right = shadow.top = 36;
    shadow.far = 180;

    scene.add(dome, this.cloudMesh, this.sun, this.sun.target, this.hemi);
    this.apply(new Vector3());
  }

  update(dt: number, focus: Vector3): void {
    this.elapsed += dt;
    this.timeOfDay = (this.timeOfDay + dt / FULL_DAY_SECONDS) % 1;
    this.clouds.uniforms.time.value = this.elapsed;
    this.apply(focus);
  }

  private apply(focus: Vector3): void {
    const next = PALETTES.findIndex((p) => p.at > this.timeOfDay);
    const b = PALETTES.at(next === -1 ? -1 : next)!;
    const a = PALETTES.at(Math.max(0, (next === -1 ? PALETTES.length : next) - 1))!;
    const mix = b.at === a.at ? 0 : (this.timeOfDay - a.at) / (b.at - a.at);
    this.zenith.set(a.zenith).lerp(new Color(b.zenith), mix);
    this.horizon.set(a.horizon).lerp(new Color(b.horizon), mix);
    this.sunColor.set(a.sun).lerp(new Color(b.sun), mix);

    // The sun arcs overhead by day; the same light becomes a low moon at night.
    const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const height = Math.sin(angle);
    this.sunDirection.set(Math.cos(angle), height > 0 ? height : -height * 0.7 + 0.15, 0.35).normalize();

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = a.sunPower + (b.sunPower - a.sunPower) * mix;
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, 90);
    this.sun.target.position.copy(focus);
    this.hemi.color.copy(this.horizon).lerp(this.zenith, 0.5);
    this.hemi.intensity = a.ambient + (b.ambient - a.ambient) * mix;
    this.cloudMesh.position.x = focus.x;
    this.cloudMesh.position.z = focus.z;
    this.clouds.uniforms.center.value.copy(focus);
  }
}
