import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { addOutline, toonMaterial } from '../render/toon';

/** Blade stations as [distance along the blade, half width, half thickness]; the last one is the point. */
const STATIONS: Array<[number, number, number]> = [
  [0.1, 0.03, 0.011],
  [0.24, 0.032, 0.011],
  [0.84, 0.028, 0.009],
  [1.02, 0.0, 0.0],
];

/** A flat-shaded diamond-section blade that tapers to a point, built along +Z. */
const bladeGeometry = (): BufferGeometry => {
  const rings = STATIONS.map(([z, w, h]) => [
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

/**
 * A longsword whose origin is the middle of the grip and whose blade runs along +Z. The `glow` strip
 * down the blade carries the wielder's colour, so each character's sword reads as theirs.
 */
export const buildSword = (glow: string): Group => {
  const sword = new Group();
  const steel = toonMaterial('#dfe6f0');
  const gold = toonMaterial('#d9aa45');
  const leather = toonMaterial('#4a2c24');

  const blade = new Mesh(bladeGeometry(), steel);
  addOutline(blade);

  const strip = new Mesh(new BoxGeometry(0.01, 0.024, 0.62), new MeshBasicMaterial({ color: glow }));
  strip.position.z = 0.5;

  const guard = new Mesh(new BoxGeometry(0.24, 0.03, 0.035), gold);
  guard.position.z = 0.085;
  for (const side of [-1, 1]) {
    const tip = new Mesh(new SphereGeometry(0.022, 8, 6), gold);
    tip.position.set(side * 0.12, 0, 0.085);
    guard.add(tip);
  }

  const grip = new Mesh(new CylinderGeometry(0.019, 0.019, 0.17, 8), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.01;

  const pommel = new Mesh(new SphereGeometry(0.034, 10, 8), gold);
  pommel.position.z = -0.105;

  for (const part of [guard, grip, pommel]) addOutline(part);
  sword.add(blade, strip, guard, grip, pommel);
  return sword;
};
