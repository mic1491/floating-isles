import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
} from 'three';
import { makeGlow } from './fx';

const stoneTexture = (): CanvasTexture => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#9a948c';
  ctx.fillRect(0, 0, size, size);
  // Speckle, then four slabs with darker seams and a few hairline cracks.
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const shade = Math.random() * 0.12;
      ctx.fillStyle = `rgba(40,34,50,${shade})`;
      ctx.fillRect(x * 256, y * 256, 256, 256);
    }
  ctx.strokeStyle = 'rgba(46,40,54,0.85)';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.strokeRect(256, 0, 256, 256);
  ctx.strokeRect(0, 256, 256, 256);
  ctx.strokeRect(256, 256, 256, 256);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(40,34,48,0.55)';
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let a = Math.random() * 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      a += (Math.random() - 0.5) * 1.2;
      x += Math.cos(a) * 22;
      y += Math.sin(a) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.anisotropy = 8;
  return texture;
};

/** The ring the fight happens in: a stone disc under a night sky, ringed by old pillars. */
export const buildArena = (scene: Scene): { sun: DirectionalLight } => {
  const sky = new Mesh(
    new SphereGeometry(500, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { top: { value: new Color('#070b24') }, mid: { value: new Color('#27306e') }, low: { value: new Color('#c56f8f') } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.28, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const starCount = 1800;
  const stars = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = Math.random() * 0.95 + 0.03;
    const flat = Math.sqrt(1 - y * y);
    stars.set([Math.cos(a) * flat * 420, y * 420, Math.sin(a) * flat * 420], i * 3);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(stars, 3));
  scene.add(new Points(starGeometry, new PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false })));

  // Clouds of coloured light far off, and one pale moon.
  for (const [x, y, z, color, size, opacity] of [
    [-220, 150, -300, 0x3f6bff, 420, 0.35],
    [260, 110, -240, 0xc04cff, 380, 0.28],
    [60, 210, 330, 0x2ad0c8, 400, 0.2],
    [-300, 90, 200, 0xff6a9a, 300, 0.2],
  ] as Array<[number, number, number, number, number, number]>) {
    const cloud = makeGlow(color, opacity);
    cloud.position.set(x, y, z);
    cloud.scale.setScalar(size);
    scene.add(cloud);
  }
  const moon = makeGlow(0xfff4dc, 1);
  moon.position.set(140, 190, -330);
  moon.scale.setScalar(90);
  scene.add(moon);

  const stone = new MeshLambertMaterial({ color: 0xb9b2a8 });
  const floor = new Mesh(new CircleGeometry(18, 72), new MeshLambertMaterial({ map: stoneTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const base = new Mesh(new CylinderGeometry(18, 20.5, 3, 72, 1, true), new MeshLambertMaterial({ color: 0x6f6876 }));
  base.position.y = -1.5;
  scene.add(base);

  // Rings of light set into the floor.
  for (const [inner, outer, color, opacity] of [
    [17.2, 17.5, 0x7fd8ff, 0.9],
    [6.9, 7.0, 0x7fd8ff, 0.35],
  ] as Array<[number, number, number, number]>) {
    const ring = new Mesh(
      new RingGeometry(inner, outer, 96),
      new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    scene.add(ring);
  }

  const pillars = new Group();
  const count = 14;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.2;
    const broken = i % 5 === 2;
    const height = broken ? 3 + Math.random() * 2.5 : 10;
    const pillar = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.85, 0.95, height, 14), stone);
    shaft.position.y = height / 2 + 0.6;
    const foot = new Mesh(new BoxGeometry(2.6, 0.6, 2.6), stone);
    foot.position.y = 0.3;
    pillar.add(shaft, foot);
    if (!broken) {
      const cap = new Mesh(new BoxGeometry(2.7, 0.7, 2.7), stone);
      cap.position.y = height + 0.95;
      pillar.add(cap);
    } else shaft.rotation.z = (Math.random() - 0.5) * 0.08;
    pillar.position.set(Math.cos(a) * 22.5, -0.6, Math.sin(a) * 22.5);
    pillar.rotation.y = -a;
    pillars.add(pillar);
  }
  // A lintel across each pair of whole pillars that stand side by side.
  for (let i = 0; i < count; i++) {
    if (i % 5 === 2 || (i + 1) % count % 5 === 2 || i % 2) continue;
    const a = ((i + 0.5) / count) * Math.PI * 2 + 0.2;
    const beam = new Mesh(new BoxGeometry(11.2, 1, 2.2), stone);
    beam.position.set(Math.cos(a) * 22.3, 11.2, Math.sin(a) * 22.3);
    beam.rotation.y = -a + Math.PI / 2;
    pillars.add(beam);
  }
  scene.add(pillars);

  const rock = new MeshLambertMaterial({ color: 0x4a4560, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 55 + Math.random() * 110;
    const mesh = new Mesh(new IcosahedronGeometry(5 + Math.random() * 14, 0), rock);
    mesh.position.set(Math.cos(a) * r, -18 + Math.random() * 50, Math.sin(a) * r);
    mesh.scale.y = 0.5 + Math.random() * 0.5;
    mesh.rotation.set(Math.random(), Math.random() * 6, Math.random());
    scene.add(mesh);
  }

  scene.add(new HemisphereLight(0xc4d2ff, 0x5a4a66, 1.5));
  const sun = new DirectionalLight(0xfff1dc, 2.1);
  sun.position.set(-9, 18, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -20;
  cam.right = cam.top = 20;
  cam.near = 1;
  cam.far = 50;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  return { sun };
};
