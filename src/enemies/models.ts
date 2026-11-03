import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type MeshToonMaterial,
} from 'three';
import { addOutline, toonMaterial } from '../render/toon';

/** What an enemy is doing right now, as far as its body language goes. */
export interface RigState {
  /** 1 while winding up an attack. */
  windup: number;
  charging: boolean;
  stunned: boolean;
  /** Whether a protective shell is still on. */
  armored: boolean;
}

/** A built enemy body. `update` plays its idle motion and reacts to what the enemy is doing. */
export interface Rig {
  root: Group;
  update(time: number, state: RigState): void;
}

const white = new MeshBasicMaterial({ color: '#ffffff' });
const tuskMaterial = toonMaterial('#efe6d0');
const shellMaterial = toonMaterial('#7f8cab');
const sparkMaterial = new MeshBasicMaterial({ color: '#ffb347' });
const starMaterial = new MeshBasicMaterial({ color: '#ffe27a' });
const starGeometry = new OctahedronGeometry(0.1);
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
    update(time, { windup }) {
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
    update(time, { windup }) {
      core.position.y = 1.05 + 0.12 * Math.sin(time * 2.5);
      ring.rotation.z = time * (windup > 0 ? 9 : 1.6);
      core.scale.setScalar(windup > 0 ? 1.25 : 1);
    },
  };
};

const stoneMaterial = (color: string): MeshToonMaterial => toonMaterial(color);

/** The charging enemy: a stocky tusked beast that paws the ground, bolts forward, then reels, dazed. */
export const buildCharger = (material: MeshToonMaterial): Rig => {
  const root = new Group();
  const body = new Group();
  const trunk = solid(new Mesh(new SphereGeometry(0.62, 18, 14), material));
  trunk.scale.set(1, 0.8, 1.35);
  trunk.position.y = 0.7;
  const head = solid(new Mesh(new SphereGeometry(0.4, 16, 12), material));
  head.position.set(0, 0.78, -0.82);
  body.add(trunk, head);
  for (const side of [-1, 1]) {
    const tusk = solid(new Mesh(new ConeGeometry(0.09, 0.5, 8), tuskMaterial));
    tusk.rotation.x = -Math.PI / 2;
    tusk.position.set(side * 0.22, 0.58, -1.12);
    body.add(tusk);
    for (const end of [-0.55, 0.5]) {
      const leg = solid(new Mesh(new CylinderGeometry(0.11, 0.13, 0.4, 8), material));
      leg.position.set(side * 0.36, 0.2, end);
      body.add(leg);
    }
  }
  addEyes(body, 0.88, -1.02, 0.17);
  const stars = [0, 1, 2].map(() => {
    const star = new Mesh(starGeometry, starMaterial);
    body.add(star);
    return star;
  });
  root.add(body);

  return {
    root,
    update(time, { windup, charging, stunned }) {
      // Winding up it stamps; charging it leans in; stunned it tips over and sees stars.
      body.position.y = windup > 0 ? Math.abs(Math.sin(time * 18)) * 0.1 : 0;
      body.rotation.x = charging ? 0.2 : windup > 0 ? -0.15 : 0;
      body.rotation.z = stunned ? 0.45 + Math.sin(time * 9) * 0.05 : 0;
      stars.forEach((star, i) => {
        star.visible = stunned;
        const angle = time * 5 + (i * Math.PI * 2) / 3;
        star.position.set(Math.cos(angle) * 0.5, 1.5, -0.7 + Math.sin(angle) * 0.5);
      });
    },
  };
};

/** The explosive enemy: a little round bomb on legs whose fuse is lit when it gets close. */
export const buildBomber = (material: MeshToonMaterial): Rig => {
  const root = new Group();
  const bomb = solid(new Mesh(new SphereGeometry(0.46, 16, 12), material));
  bomb.position.y = 0.55;
  const fuse = solid(new Mesh(new CylinderGeometry(0.05, 0.05, 0.32, 6), tuskMaterial));
  fuse.position.y = 1.1;
  const spark = new Mesh(new SphereGeometry(0.1, 8, 6), sparkMaterial);
  spark.position.y = 1.32;
  root.add(bomb, fuse, spark);
  for (const side of [-1, 1]) {
    const foot = solid(new Mesh(new SphereGeometry(0.13, 8, 6), material));
    foot.position.set(side * 0.22, 0.12, 0);
    root.add(foot);
  }
  addEyes(root, 0.62, -0.38, 0.17);

  return {
    root,
    update(time, { windup }) {
      const fused = windup > 0;
      // The lit fuse swells the whole body and the spark flickers faster as it burns.
      const swell = fused ? 1.2 + Math.sin(time * 30) * 0.06 : 1 + Math.sin(time * 6) * 0.03;
      root.scale.setScalar(swell);
      spark.scale.setScalar(fused ? 1.4 + Math.sin(time * 40) * 0.5 : 0.8 + Math.sin(time * 12) * 0.2);
    },
  };
};

/** The armoured enemy: a slow stone-shelled tortoise. The shell comes off when a reaction cracks it. */
export const buildGuard = (material: MeshToonMaterial): Rig => {
  const root = new Group();
  const flesh = solid(new Mesh(new SphereGeometry(0.45, 14, 12), material));
  flesh.scale.set(1, 0.8, 1.15);
  flesh.position.y = 0.4;
  const head = solid(new Mesh(new SphereGeometry(0.28, 12, 10), material));
  head.position.set(0, 0.42, -0.62);
  root.add(flesh, head);
  const shell = new Group();
  const dome = solid(new Mesh(new SphereGeometry(0.78, 18, 12), shellMaterial));
  dome.scale.set(1, 0.7, 1.15);
  dome.position.y = 0.55;
  shell.add(dome);
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    const spike = solid(new Mesh(new ConeGeometry(0.12, 0.34, 6), stoneMaterial('#a9b4cc')));
    spike.position.set(Math.cos(angle) * 0.38, 1.02, Math.sin(angle) * 0.38);
    shell.add(spike);
  }
  root.add(shell);
  for (const side of [-1, 1]) {
    for (const end of [-0.4, 0.4]) {
      const leg = solid(new Mesh(new CylinderGeometry(0.13, 0.15, 0.3, 8), material));
      leg.position.set(side * 0.5, 0.15, end);
      root.add(leg);
    }
  }
  addEyes(root, 0.5, -0.78, 0.12);

  return {
    root,
    update(time, { windup, armored }) {
      shell.visible = armored;
      flesh.scale.set(armored ? 1 : 1.25, armored ? 0.8 : 1, armored ? 1.15 : 1.3);
      root.rotation.x = windup > 0 ? -0.18 : 0;
      root.position.y = Math.sin(time * 1.8) * 0.02;
    },
  };
};
