import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Object3D,
} from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Element } from '../core/balance';
import { addOutline, toonMaterial } from '../render/toon';

type Bone = 'head' | 'chest' | 'leftUpperArm' | 'rightUpperArm';

/** Props that make each character read as themselves even from behind, where the camera mostly sits. */
const build = (element: Element, color: string): Array<[Bone, Object3D]> => {
  const tint = new Color(color);
  const cloth = toonMaterial(`#${tint.clone().multiplyScalar(0.8).getHexString()}`);
  cloth.side = DoubleSide;
  const metal = toonMaterial('#cfd6e6');
  const items: Array<[Bone, Object3D]> = [];

  if (element === 'water') {
    // A flowing cape and a droplet hairpin.
    const cape = new Mesh(new PlaneGeometry(0.3, 0.5, 3, 4), cloth);
    cape.position.set(0, -0.2, -0.12);
    cape.rotation.x = 0.12;
    const trim = new Mesh(new BoxGeometry(0.31, 0.025, 0.01), new MeshBasicMaterial({ color: '#e8f6ff' }));
    trim.position.set(0, -0.45, -0.12);
    const group = new Group();
    group.add(cape, trim);
    items.push(['chest', group]);

    const drop = new Group();
    const bulb = new Mesh(new SphereGeometry(0.035, 10, 8), new MeshBasicMaterial({ color: '#bfe8ff' }));
    const tip = new Mesh(new ConeGeometry(0.03, 0.06, 8), new MeshBasicMaterial({ color: '#bfe8ff' }));
    tip.position.y = 0.05;
    drop.add(bulb, tip);
    drop.position.set(0.12, 0.12, 0.07);
    items.push(['head', drop]);
  } else if (element === 'thunder') {
    // Angular shoulder guards and a zig-zag bolt in the hair.
    for (const [bone, side] of [['leftUpperArm', -1], ['rightUpperArm', 1]] as const) {
      const guard = new Mesh(new SphereGeometry(0.085, 10, 8), metal);
      guard.scale.set(1.2, 0.55, 1.1);
      guard.position.set(side * 0.03, 0.045, 0);
      addOutline(guard);
      const spike = new Mesh(new ConeGeometry(0.03, 0.12, 6), new MeshBasicMaterial({ color: color }));
      spike.rotation.z = -side * 1.2;
      spike.position.set(side * 0.1, 0.07, 0);
      const group = new Group();
      group.add(guard, spike);
      items.push([bone, group]);
    }
    const bolt = new Group();
    const glow = new MeshBasicMaterial({ color: '#fff0a0' });
    for (const [x, y, tilt] of [[0, 0.07, 0.5], [0.025, 0.0, -0.5], [0, -0.07, 0.5]] as const) {
      const segment = new Mesh(new BoxGeometry(0.02, 0.07, 0.012), glow);
      segment.position.set(x, y, 0);
      segment.rotation.z = tilt;
      bolt.add(segment);
    }
    bolt.position.set(-0.12, 0.12, 0.08);
    items.push(['head', bolt]);
  }
  return items;
};

/** Hangs a character's props on their bones; fire has none, since the original model is theirs. */
export const addAccessories = (vrm: VRM, element: Element, color: string): void => {
  for (const [bone, object] of build(element, color)) {
    vrm.humanoid.getNormalizedBoneNode(bone)?.add(object);
  }
};
