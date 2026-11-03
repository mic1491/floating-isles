import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Texture,
} from 'three';
import { addOutline, toonMaterial } from '../render/toon';
import { glowMaterial, goldTexture, poleTexture, runeTexture, sparkles } from './weaponFx';

// A faint emissive keeps shaded faces from going dull against the bright sky, as it does on the sword.
const wood = toonMaterial('#5d3b2c', { emissive: '#1d0f09' });
// Built on first use: painted textures need a canvas, which only exists once the game is running.
let goldMaterial: MeshToonMaterial | null = null;
const goldPaint = (): MeshToonMaterial => (goldMaterial ??= toonMaterial('#ffffff', { map: goldTexture(), emissive: '#4a3410' }));
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

const band = (z: number, radius: number, height = 0.03, material?: MeshToonMaterial): Mesh => {
  const ring = part(new Mesh(new CylinderGeometry(radius, radius, height, 12), material ?? goldPaint()));
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
  const spike = part(new Mesh(new ConeGeometry(radius, length, 8), goldPaint()));
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

/** A painted pole material: its texture repeats along the length so the motif keeps its size on any weapon. */
const poleMaterial = (texture: Texture, length: number, emissive: string): MeshToonMaterial => {
  texture.repeat.set(1, Math.max(1, Math.round(length * 2.2)));
  return toonMaterial('#ffffff', { map: texture, emissive });
};

type Tick = (time: number) => void;

/** Parts that move on their own register here; the avatar calls `userData.tick` once a frame. */
const withTicks = (group: Group, ticks: Tick[]): void => {
  group.userData.tick = (time: number) => {
    for (const tick of ticks) tick(time);
  };
};

/** A cloth streamer hanging back along the shaft from an anchor, fluttering more toward its free end. */
const ribbon = (color: string, length: number, width: number, phase: number, ticks: Tick[]): Mesh => {
  const rows = 8;
  const rest: number[] = [];
  const positions = new Float32Array((rows + 1) * 2 * 3);
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const half = (width / 2) * (1 - (j / rows) * 0.55);
    rest.push(-half, 0, -(j / rows) * length, half, 0, -(j / rows) * length);
    if (j < rows) index.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, new MeshToonMaterial({ color: new Color(color), side: DoubleSide, emissive: new Color(color).multiplyScalar(0.35) }));
  mesh.frustumCulled = false;
  const flutter: Tick = (time) => {
    for (let j = 0; j <= rows; j++) {
      const sway = j / rows;
      const dx = Math.sin(time * 4.2 + j * 0.7 + phase) * 0.05 * sway;
      const dy = Math.cos(time * 3.1 + j * 0.9 + phase) * 0.035 * sway;
      for (const side of [0, 1]) {
        const k = (j * 2 + side) * 3;
        positions[k] = rest[k] + dx;
        positions[k + 1] = dy;
        positions[k + 2] = rest[k + 2];
      }
    }
    geometry.attributes.position.needsUpdate = true;
    // Lit cloth needs normals; without them the shader divides by zero and the bloom smears a NaN over the screen.
    geometry.computeVertexNormals();
  };
  flutter(0);
  ticks.push(flutter);
  return mesh;
};

/** A curved claw of gold swept out round something at the axis and back in over it. */
const claw = (angle: number, points: Array<[number, number]>, radius: number): Mesh => {
  const curve = new CatmullRomCurve3(points.map(([r, z]) => new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z)));
  const tube = part(new Mesh(new TubeGeometry(curve, 14, radius, 6), goldPaint()));
  const tip = part(new Mesh(new SphereGeometry(radius * 1.5, 8, 6), goldPaint()));
  tip.position.copy(curve.getPoint(1));
  tube.add(tip);
  return tube;
};

/** A flat gold ornament cut from a 2D outline (drawn with its length along +Y), lying along +Z with some thickness. */
const plate = (shape: Shape, thickness: number): Mesh => {
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  geometry.translate(0, 0, -thickness / 2);
  const mesh = new Mesh(geometry, goldPaint());
  mesh.rotation.x = Math.PI / 2;
  return mesh;
};

/**
 * A water mage's staff: a lacquered pole painted with a highlight and gold motifs, a glowing rune sleeve that
 * scrolls, three gold claws cradling a faceted crystal that breathes, a ring that turns, droplets that drift
 * and streamers that flutter.
 */
export const buildStaff = (glow: string): Group => {
  const staff = new Group();
  const ticks: Tick[] = [];
  const pole = poleMaterial(poleTexture('#2f6286', '#a8e4ff', '#14263a'), 1.65, '#102436');
  staff.add(rod(-0.6, 1.05, 0.017, 0.022, pole), wrap(-0.13, 0.13, 0.027));
  for (const z of [-0.45, 0.32, 0.8]) staff.add(band(z, 0.031));
  staff.add(band(-0.57, 0.027, 0.05), cap(-0.6, 0.09, 0.026, -1));

  // A sleeve of runes in light over the upper pole, scrolling up toward the crystal.
  const runeMap = runeTexture();
  runeMap.repeat.set(1, 1.6);
  const runes = new Mesh(
    new CylinderGeometry(0.0195, 0.0225, 0.5, 14, 1, true),
    new MeshBasicMaterial({ map: runeMap, color: glow, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  runes.rotation.x = Math.PI / 2;
  runes.position.z = 0.58;
  ticks.push((time) => {
    runeMap.offset.y = -time * 0.35;
    (runes.material as MeshBasicMaterial).opacity = 0.65 + Math.sin(time * 2.6) * 0.3;
  });
  staff.add(runes);

  const head = new Group();
  head.position.z = 1.18;
  const crystal = new Mesh(new IcosahedronGeometry(0.088, 0), glowMaterial(glow));
  crystal.scale.set(0.86, 0.86, 1.2);
  const core = new Mesh(new IcosahedronGeometry(0.04, 0), new MeshBasicMaterial({ color: '#ffffff' }));
  const halo = new Mesh(
    new SphereGeometry(0.17, 14, 10),
    new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false }),
  );
  const socket = part(new Mesh(new CylinderGeometry(0.034, 0.022, 0.1, 10), goldPaint()));
  socket.rotation.x = Math.PI / 2;
  socket.position.z = -0.14;
  const collar = band(-0.19, 0.03, 0.035);
  // Three claws sweep out round the crystal and fold back in over its top.
  const claws = new Group();
  const sweep: Array<[number, number]> = [[0.03, -0.14], [0.1, -0.08], [0.138, 0.02], [0.105, 0.125], [0.045, 0.175]];
  for (let k = 0; k < 3; k++) claws.add(claw((k * Math.PI * 2) / 3 + 0.5, sweep, 0.0115));
  // A thin ring tilted about the crystal that slowly turns, with loose gems riding on it.
  const orbit = new Group();
  const ring = new Mesh(new TorusGeometry(0.2, 0.006, 6, 40), new MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false }));
  orbit.add(ring);
  for (let k = 0; k < 3; k++) {
    const gem = new Mesh(new OctahedronGeometry(0.03), glowMaterial(glow));
    const a = (k * Math.PI * 2) / 3;
    gem.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
    orbit.add(gem);
  }
  orbit.rotation.x = 0.5;
  ticks.push((time) => {
    orbit.rotation.z = time * 0.9;
    crystal.rotation.z = time * 0.5;
    core.scale.setScalar(0.9 + Math.sin(time * 3.2) * 0.15);
  });
  head.add(crystal, core, halo, socket, collar, claws, orbit);

  const drops = sparkles(glow, 9, 0.1, (life, i, out) => {
    const a = life * Math.PI * 2 * (1 + (i % 2)) + i * 1.7;
    out.set(Math.cos(a) * (0.17 + (i % 3) * 0.04), Math.sin(a) * (0.17 + (i % 3) * 0.04), -0.1 + life * 0.5);
  });
  head.add(drops.points);
  ticks.push(drops.tick);
  staff.add(head);

  // Two streamers tied below the head, trailing back down the pole.
  for (const [color, phase, x] of [[glow, 0, 0.026], ['#eaf8ff', 1.7, -0.026]] as const) {
    const cloth = ribbon(color, 0.42, 0.055, phase, ticks);
    cloth.position.set(x, 0, 0.98);
    staff.add(cloth);
  }
  withTicks(staff, ticks);
  staff.userData.glow = halo;
  return staff;
};

/**
 * A thunder lancer's spear: a lacquered shaft with painted motifs, a leaf blade carrying a band of light that runs
 * up its inlay, gold crescent wings, a lit gem at the collar, sparks that jump about the head and streamers.
 */
export const buildSpear = (glow: string): Group => {
  const spear = new Group();
  const ticks: Tick[] = [];
  const shaft = poleMaterial(poleTexture('#3a2a58', '#c9a8ff', '#120c1e'), 1.9, '#150d24');
  spear.add(rod(-0.72, 1.18, 0.015, 0.019, shaft), wrap(-0.14, 0.14, 0.024));
  spear.add(band(1.17, 0.029), band(-0.5, 0.027), band(0.5, 0.025), band(-0.69, 0.025, 0.05));
  spear.add(cap(-0.72, 0.1, 0.024, -1));

  const head = new Group();
  head.position.z = 1.2;
  const blade = part(
    new Mesh(bladeGeometry([[0, 0.012, 0.011], [0.1, 0.05, 0.017], [0.24, 0.058, 0.017], [0.42, 0.025, 0.009], [0.58, 0, 0]]), steel),
  );
  const inlay = new Mesh(new BoxGeometry(0.014, 0.036, 0.38), glowMaterial(glow, { flow: true, length: 0.38 }));
  inlay.position.z = 0.28;
  head.add(blade, inlay);
  // Gold crescents curling out and up from the blade's root, like the wings of a halberd.
  for (const side of [-1, 1]) {
    const crescent = new Shape();
    crescent.moveTo(0, 0);
    crescent.bezierCurveTo(side * 0.1, -0.005, side * 0.17, 0.07, side * 0.145, 0.22);
    crescent.bezierCurveTo(side * 0.115, 0.12, side * 0.06, 0.075, 0, 0.07);
    const wing = plate(crescent, 0.016);
    wing.position.z = -0.03;
    head.add(wing);
  }
  const gem = new Mesh(new OctahedronGeometry(0.034), glowMaterial(glow));
  gem.position.z = -0.01;
  gem.scale.set(1, 1, 1.4);
  const neck = band(-0.05, 0.03, 0.06);
  head.add(gem, neck);
  const sparks = sparkles(glow, 8, 0.085, (life, i, out) => {
    const a = i * 2.4 + Math.floor(life * 6) * 1.3;
    out.set(Math.sin(a) * 0.09, Math.cos(a * 1.3) * 0.09, 0.1 + life * 0.5 + (i % 3) * 0.04);
  });
  head.add(sparks.points);
  ticks.push(sparks.tick, (time) => {
    gem.rotation.z = time * 1.4;
  });
  spear.add(head);

  // Streamers tied under the blade, trailing back along the shaft.
  for (const [color, phase, x, length] of [[glow, 0, 0.03, 0.46], ['#efe8ff', 1.4, -0.03, 0.4], [glow, 2.6, 0, 0.34]] as const) {
    const cloth = ribbon(color, length, 0.05, phase, ticks);
    cloth.position.set(x, 0.02, 1.15);
    spear.add(cloth);
  }
  withTicks(spear, ticks);
  return spear;
};
