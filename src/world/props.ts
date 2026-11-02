import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { addOutline, toonMaterial } from '../render/toon';
import type { Physics } from './physics';
import { terrainHeight } from './terrain';

const stone = toonMaterial('#c9bfae');
const mossy = toonMaterial('#9aa77f');

const block = (
  group: Group,
  physics: Physics,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  ry = 0,
  lift = 0,
) => {
  const base = terrainHeight(x, z) - 0.4 + lift;
  const mesh = new Mesh(new BoxGeometry(w, h, d), Math.abs(x + z) % 2 < 1 ? stone : mossy);
  mesh.position.set(x, base + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh);
  group.add(mesh);
  physics.addBox(mesh.position, new Vector3(w / 2, h / 2, d / 2), ry);
};

const pillar = (group: Group, physics: Physics, x: number, z: number, h: number) => {
  const base = terrainHeight(x, z) - 0.4;
  const mesh = new Mesh(new CylinderGeometry(0.75, 0.95, h, 10), stone);
  mesh.position.set(x, base + h / 2, z);
  mesh.castShadow = true;
  addOutline(mesh);
  group.add(mesh);
  physics.addBox(mesh.position, new Vector3(0.75, h / 2, 0.75));
};

export const createProps = (physics: Physics): Group => {
  const group = new Group();
  // Ruined archway gives the camera something to collide with.
  pillar(group, physics, -14, -8, 8);
  pillar(group, physics, -8, -8, 8);
  block(group, physics, -11, -8, 8, 1.2, 2, 0, 7.6);
  pillar(group, physics, -18, 6, 4.5);
  pillar(group, physics, -22, 2, 6);
  block(group, physics, 8, 14, 7, 2.6, 1.4, 0.4);
  block(group, physics, 13, 19, 1.4, 3.4, 6, 0.4);
  block(group, physics, -3, 22, 3, 1.4, 3, 0.8);
  block(group, physics, 26, 8, 4, 2, 4, 0.3);
  return group;
};
