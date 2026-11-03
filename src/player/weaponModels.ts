import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { addOutline, toonMaterial } from '../render/toon';

// A faint emissive keeps shaded faces from going dull against the bright sky, as it does on the sword.
const wood = toonMaterial('#5d3b2c', { emissive: '#1d0f09' });
const lacquer = toonMaterial('#3b2a3e', { emissive: '#120d16' });
const gold = toonMaterial('#e6b84c', { emissive: '#5c4310' });
const leatherDark = toonMaterial('#2c1d24');
const leatherLight = toonMaterial('#7d5a6e');
const steel = toonMaterial('#eef3fb', { emissive: '#6b7a94' });

const part = <T extends Mesh>(mesh: T): T => {
  addOutline(mesh);
  return mesh;
};

/** A cylinder lying along +Z between two heights, as every weapon is built. */
const rod = (from: number, to: number, radiusAtTip: number, radiusAtBase: number, material = wood): Mesh => {
  const shaft = part(new Mesh(new CylinderGeometry(radiusAtTip, radiusAtBase, to - from, 10), material));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = (from + to) / 2;
  return shaft;
};

const band = (z: number, radius: number, height = 0.03, material = gold): Mesh => {
  const ring = part(new Mesh(new CylinderGeometry(radius, radius, height, 12), material));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = z;
  return ring;
};

/** A hand-wrap: thin alternating bands of cloth, which also tells the eye where the grip is. */
const wrap = (from: number, to: number, radius: number): Group => {
  const group = new Group();
  const step = 0.028;
  for (let z = from, i = 0; z < to; z += step, i++) {
    group.add(band(z, radius, step * 0.95, i % 2 === 0 ? leatherDark : leatherLight));
  }
  return group;
};

const cap = (z: number, length: number, radius: number, direction: 1 | -1): Mesh => {
  const spike = part(new Mesh(new ConeGeometry(radius, length, 8), gold));
  spike.rotation.x = (direction * Math.PI) / 2;
  spike.position.z = z + (direction * length) / 2;
  return spike;
};

/** A flat-shaded diamond-section blade along +Z; each station is [distance, half width, half thickness]. */
const bladeGeometry = (stations: Array<[number, number, number]>): BufferGeometry => {
  const rings = stations.map(([z, w, h]) => [
    [-w, 0, z],
    [0, h, z],
    [w, 0, z],
    [0, -h, z],
  ]);
  const positions: number[] = [];
  for (let s = 0; s < rings.length - 1; s++) {
    for (let k = 0; k < 4; k++) {
      const a = rings[s][k];
      const b = rings[s][(k + 1) % 4];
      const c = rings[s + 1][k];
      const d = rings[s + 1][(k + 1) % 4];
      positions.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
};

/** A water mage's staff: a tapered pole with a wrapped grip, gold collars and a crystal held in a ring. */
export const buildStaff = (glow: string): Group => {
  const staff = new Group();
  staff.add(rod(-0.6, 1.05, 0.016, 0.021), wrap(-0.13, 0.13, 0.026));
  for (const z of [-0.45, 0.32, 0.8]) staff.add(band(z, 0.03));
  staff.add(cap(-0.6, 0.09, 0.026, -1));

  const head = new Group();
  head.position.z = 1.18;
  const crystal = part(new Mesh(new IcosahedronGeometry(0.085, 1), new MeshBasicMaterial({ color: glow })));
  const core = new Mesh(new IcosahedronGeometry(0.045, 0), new MeshBasicMaterial({ color: '#ffffff' }));
  const halo = new Mesh(
    new SphereGeometry(0.17, 14, 10),
    new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }),
  );
  const crown = part(new Mesh(new TorusGeometry(0.15, 0.015, 8, 28), gold));
  crown.rotation.y = Math.PI / 2;
  const cross = part(new Mesh(new TorusGeometry(0.15, 0.012, 8, 28), gold));
  cross.rotation.set(Math.PI / 2, 0, 0);
  const socket = part(new Mesh(new CylinderGeometry(0.03, 0.022, 0.1, 8), gold));
  socket.rotation.x = Math.PI / 2;
  socket.position.z = -0.14;
  // Loose gems drifting around the crystal, so the head reads as magic rather than a ball on a stick.
  for (const [angle, z] of [[0, -0.02], [2.1, 0.05], [4.2, -0.04]] as const) {
    const gem = new Mesh(new OctahedronGeometry(0.03), new MeshBasicMaterial({ color: glow }));
    gem.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, z);
    head.add(gem);
  }
  head.add(crystal, core, halo, crown, cross, socket);
  staff.add(head);
  staff.userData.glow = halo;
  return staff;
};

/** A thunder lancer's spear: lacquered shaft, wrapped grip, a leaf blade with a glowing inlay and a streaming tassel. */
export const buildSpear = (glow: string): Group => {
  const spear = new Group();
  spear.add(rod(-0.72, 1.18, 0.015, 0.018, lacquer), wrap(-0.14, 0.14, 0.023));
  spear.add(band(1.17, 0.028), band(-0.5, 0.026), band(0.5, 0.024));
  spear.add(cap(-0.72, 0.1, 0.024, -1));

  const head = new Group();
  head.position.z = 1.2;
  const blade = part(
    new Mesh(bladeGeometry([[0, 0.012, 0.011], [0.1, 0.048, 0.016], [0.24, 0.056, 0.016], [0.42, 0.024, 0.009], [0.56, 0, 0]]), steel),
  );
  const inlay = new Mesh(new BoxGeometry(0.012, 0.034, 0.36), new MeshBasicMaterial({ color: glow }));
  inlay.position.z = 0.28;
  head.add(blade, inlay);
  for (const side of [-1, 1]) {
    const wing = part(new Mesh(new ConeGeometry(0.026, 0.13, 6), gold));
    wing.rotation.z = -side * 1.15;
    wing.position.set(side * 0.055, 0, -0.01);
    head.add(wing);
  }
  spear.add(head);

  // Streamers tied under the blade, trailing back along the shaft.
  const tassel = new Group();
  tassel.position.z = 1.14;
  const colors = [glow, '#e9e2ff', glow];
  colors.forEach((color, i) => {
    const streamer = new Mesh(new ConeGeometry(0.032, 0.34 - i * 0.04, 5), new MeshBasicMaterial({ color }));
    streamer.rotation.x = -Math.PI / 2;
    const angle = (i - 1) * 0.5;
    streamer.rotation.y = angle * 0.45;
    streamer.position.set(Math.sin(angle) * 0.04, Math.cos(angle) * 0.03, -0.17);
    tassel.add(streamer);
  });
  tassel.add(band(0, 0.03, 0.025));
  spear.add(tassel);
  return spear;
};
