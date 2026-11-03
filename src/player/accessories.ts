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

/** Cloth that moves on its own: given how the wearer is moving, it swings and settles. */
export interface Accessories {
  update(dt: number, motion: { time: number; speed: number; airborne: boolean; turn: number }): void;
}

/** A damped spring: pulled toward a target, it overshoots and rocks back, which is what makes cloth look loose. */
class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}

  step(dt: number, target: number): number {
    // Sub-steps keep a stiff spring stable on a slow frame.
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Props that make each character read as themselves even from behind, where the camera mostly sits. */
const build = (element: Element, color: string, cloths: Accessories[]): Array<[Bone, Object3D]> => {
  const tint = new Color(color);
  const cloth = toonMaterial(`#${tint.clone().multiplyScalar(0.8).getHexString()}`);
  cloth.side = DoubleSide;
  const metal = toonMaterial('#cfd6e6');
  const items: Array<[Bone, Object3D]> = [];

  if (element === 'water') {
    // A flowing cape and a droplet hairpin.
    const geometry = new PlaneGeometry(0.3, 0.5, 3, 6);
    const cape = new Mesh(geometry, cloth);
    cape.position.set(0, -0.25, 0);
    const trim = new Mesh(new BoxGeometry(0.31, 0.025, 0.01), new MeshBasicMaterial({ color: '#e8f6ff' }));
    trim.position.set(0, -0.5, 0);
    // The cape hangs from a hinge at the shoulders and swings about it.
    const hinge = new Group();
    hinge.position.set(0, 0.05, -0.12);
    hinge.add(cape, trim);
    items.push(['chest', hinge]);

    const rest = Float32Array.from(geometry.attributes.position.array);
    const positions = geometry.attributes.position;
    const lift = new Spring(70, 6.5);
    const sway = new Spring(45, 5);
    cloths.push({
      update(dt, motion) {
        const running = Math.min(1, motion.speed / 8.5);
        // Blown back by speed and by falling; swung sideways when the wearer turns.
        const liftTarget = 0.1 + running * 0.75 + (motion.airborne ? 0.35 : 0);
        hinge.rotation.x = lift.step(dt, liftTarget);
        hinge.rotation.z = sway.step(dt, Math.max(-0.6, Math.min(0.6, -motion.turn * 0.09)));
        // A ripple runs down the cloth, free at the hem and pinned at the shoulders.
        const amplitude = 0.008 + running * 0.045 + (motion.airborne ? 0.02 : 0);
        for (let i = 0; i < positions.count; i++) {
          const x = rest[i * 3];
          const y = rest[i * 3 + 1];
          const free = (0.25 - y) / 0.5;
          positions.setZ(i, Math.sin(motion.time * 7.5 + x * 11 + y * 9) * amplitude * free * free);
        }
        positions.needsUpdate = true;
        trim.position.z = positions.getZ(positions.count - 1) * 0.5;
      },
    });

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
export const addAccessories = (vrm: VRM, element: Element, color: string): Accessories | null => {
  const cloths: Accessories[] = [];
  for (const [bone, object] of build(element, color, cloths)) {
    vrm.humanoid.getNormalizedBoneNode(bone)?.add(object);
  }
  if (!cloths.length) return null;
  return { update: (dt, motion) => cloths.forEach((c) => c.update(dt, motion)) };
};
