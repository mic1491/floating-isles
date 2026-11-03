import { ConeGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry, type MeshToonMaterial } from 'three';
import { addOutline } from '../render/toon';

/** A built enemy body. `update` plays its idle motion; `windup` is 1 while it is winding up an attack. */
export interface Rig {
  root: Group;
  update(time: number, windup: number): void;
}

const white = new MeshBasicMaterial({ color: '#ffffff' });
const dark = new MeshBasicMaterial({ color: '#2b2230' });
const eyeGeometry = new SphereGeometry(0.15, 12, 10);
const pupilGeometry = new SphereGeometry(0.075, 10, 8);

/** Big shiny eyes make anything read as a creature rather than a block. */
const addEyes = (parent: Group, y: number, z: number, spread: number): void => {
  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeometry, white);
    eye.position.set(side * spread, y, z);
    const pupil = new Mesh(pupilGeometry, dark);
    pupil.position.set(side * spread * 0.9, y, z - 0.1);
    parent.add(eye, pupil);
  }
};

const solid = (mesh: Mesh): Mesh => {
  mesh.castShadow = true;
  addOutline(mesh);
  return mesh;
};

/** The close-range enemy: a round, horned blob that squashes as it breathes and rears back before it strikes. */
export const buildBlob = (material: MeshToonMaterial): Rig => {
  const root = new Group();
  const body = solid(new Mesh(new SphereGeometry(0.62, 20, 14), material));
  body.scale.set(1, 0.85, 1);
  body.position.y = 0.52;
  root.add(body);
  for (const side of [-1, 1]) {
    const horn = solid(new Mesh(new ConeGeometry(0.1, 0.32, 8), material));
    horn.position.set(side * 0.27, 1.02, -0.04);
    horn.rotation.z = -side * 0.4;
    root.add(horn);
  }
  addEyes(root, 0.62, -0.5, 0.2);
  const mouth = new Mesh(pupilGeometry, dark);
  mouth.scale.set(1.8, 0.55, 0.4);
  mouth.position.set(0, 0.4, -0.6);
  root.add(mouth);

  return {
    root,
    update(time, windup) {
      const squash = windup > 0 ? 0.78 : 1 + 0.05 * Math.sin(time * 3.2);
      const spread = 1 / Math.sqrt(squash);
      root.scale.set(spread, squash, spread);
    },
  };
};

/** The ranged enemy: a drifting spirit with a ring that spins and a tail of flame. */
export const buildWisp = (material: MeshToonMaterial): Rig => {
  const root = new Group();
  const core = new Group();
  const body = solid(new Mesh(new SphereGeometry(0.4, 18, 14), material));
  core.add(body);
  const tail = solid(new Mesh(new ConeGeometry(0.22, 0.55, 10), material));
  tail.rotation.x = Math.PI;
  tail.position.y = -0.42;
  core.add(tail);
  const ring = solid(new Mesh(new TorusGeometry(0.62, 0.05, 8, 30), material));
  ring.rotation.x = Math.PI / 2;
  core.add(ring);
  addEyes(core, 0.04, -0.34, 0.16);
  root.add(core);

  return {
    root,
    update(time, windup) {
      core.position.y = 1.05 + 0.12 * Math.sin(time * 2.5);
      ring.rotation.z = time * (windup > 0 ? 9 : 1.6);
      core.scale.setScalar(windup > 0 ? 1.25 : 1);
    },
  };
};
