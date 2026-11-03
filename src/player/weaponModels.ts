import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { addOutline, toonMaterial } from '../render/toon';

const wood = toonMaterial('#6a4634');
const gold = toonMaterial('#d9aa45');

const part = <T extends Mesh>(mesh: T): T => {
  addOutline(mesh);
  return mesh;
};

/** A pole lying along +Z with its middle at the origin, as every weapon is built. */
const pole = (from: number, to: number, radius: number): Mesh => {
  const shaft = part(new Mesh(new CylinderGeometry(radius, radius, to - from, 8), wood));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = (from + to) / 2;
  return shaft;
};

const ring = (z: number, radius: number): Mesh => {
  const band = part(new Mesh(new CylinderGeometry(radius, radius, 0.035, 10), gold));
  band.rotation.x = Math.PI / 2;
  band.position.z = z;
  return band;
};

/** A water mage's staff: a long pole crowned with a glowing orb held inside a golden ring. */
export const buildStaff = (glow: string): Group => {
  const staff = new Group();
  staff.add(pole(-0.62, 1.12, 0.02), ring(0.3, 0.032), ring(-0.4, 0.03));

  const head = new Group();
  head.position.z = 1.22;
  const orb = new Mesh(new SphereGeometry(0.085, 14, 10), new MeshBasicMaterial({ color: glow }));
  const halo = new Mesh(
    new SphereGeometry(0.15, 14, 10),
    new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }),
  );
  const crown = part(new Mesh(new TorusGeometry(0.14, 0.018, 8, 24), gold));
  crown.rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    const prong = part(new Mesh(new ConeGeometry(0.03, 0.15, 6), gold));
    prong.rotation.x = Math.PI / 2;
    prong.position.set(side * 0.1, 0, -0.08);
    head.add(prong);
  }
  head.add(orb, halo, crown);
  staff.add(head);
  staff.userData.glow = halo;
  return staff;
};

/** A thunder lancer's spear: a long shaft, a leaf-shaped head and a ribbon of the wielder's colour. */
export const buildSpear = (glow: string): Group => {
  const spear = new Group();
  spear.add(pole(-0.75, 1.3, 0.017), ring(1.28, 0.03), ring(-0.7, 0.026));

  const blade = part(new Mesh(new ConeGeometry(0.055, 0.5, 4), toonMaterial('#e8eef8')));
  blade.rotation.x = Math.PI / 2;
  blade.scale.set(1, 1, 0.28);
  blade.position.z = 1.55;
  const shine = new Mesh(new ConeGeometry(0.01, 0.4, 4), new MeshBasicMaterial({ color: glow }));
  shine.rotation.x = Math.PI / 2;
  shine.position.z = 1.52;
  const tassel = new Mesh(new ConeGeometry(0.05, 0.3, 6), new MeshBasicMaterial({ color: glow }));
  tassel.rotation.x = -Math.PI / 2;
  tassel.position.z = 1.15;
  spear.add(blade, shine, tassel);
  return spear;
};
