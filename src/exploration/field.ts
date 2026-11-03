import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Element } from '../core/balance';
import { ELEMENT_COLORS } from '../enemies/enemy';
import { addOutline, toonMaterial } from '../render/toon';
import { terrainHeight } from '../world/terrain';
import { exploration, puzzleResponds, type ExplorationPoint, type ExplorationProgress, type Reward } from './progress';

interface Site {
  point: ExplorationPoint;
  position: Vector3;
  root: Group;
  spinner: Mesh | null;
  lid: Group | null;
  /** A marker that bobs above something still unclaimed, and goes out once it is. */
  glow: Mesh | null;
  orbiters: Mesh[];
  glyph: Mesh | null;
  flag: Mesh | null;
  /** Counts down a short pop as a shard is collected. */
  pop: number;
  phase: number;
}

const POP_SECONDS = 0.25;

export interface ExplorationEvents {
  discovered(point: ExplorationPoint, reward: Reward): void;
}

const wood = toonMaterial('#a56a3a');
const gold = toonMaterial('#f2c04c');
const stone = toonMaterial('#c9bfae');
const opened = new MeshBasicMaterial({ color: '#e8e4d8' });
const shardMaterial = new MeshBasicMaterial({ color: '#fff0b0' });
const beaconMaterial = new MeshBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.32, depthWrite: false });

const shardGeometry = new OctahedronGeometry(0.34);
const crystalGeometry = new OctahedronGeometry(0.75);
const ringGeometry = new TorusGeometry(1.2, 0.08, 8, 28);

const outlined = (mesh: Mesh): Mesh => {
  mesh.castShadow = true;
  addOutline(mesh);
  return mesh;
};

const woodBothSides = toonMaterial('#a56a3a');
woodBothSides.side = DoubleSide;
const glowMaterial = new MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.85 });
const sparkleMaterial = new MeshBasicMaterial({ color: '#fffbe0' });
const sparkleGeometry = new SphereGeometry(0.05, 8, 6);
const shellGeometry = new OctahedronGeometry(0.5);
const shellMaterial = new MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.28, depthWrite: false });

interface Chest {
  lid: Group;
  glow: Mesh;
}

/** A treasure chest with a rounded lid, gold bands and a lock, and a glint floating above it. */
const buildChest = (root: Group): Chest => {
  const body = outlined(new Mesh(new BoxGeometry(1.1, 0.6, 0.75), wood));
  body.position.y = 0.3;
  root.add(body);
  for (const side of [-1, 1]) {
    const band = new Mesh(new BoxGeometry(0.1, 0.64, 0.8), gold);
    band.position.set(side * 0.38, 0.3, 0);
    root.add(band);
  }
  const lock = outlined(new Mesh(new BoxGeometry(0.2, 0.22, 0.06), gold));
  lock.position.set(0, 0.5, 0.39);
  root.add(lock);

  const hinge = new Group();
  hinge.position.set(0, 0.6, -0.37);
  const dome = outlined(new Mesh(new CylinderGeometry(0.385, 0.385, 1.14, 18, 1, false, 0, Math.PI), woodBothSides));
  dome.rotation.z = Math.PI / 2;
  dome.position.z = 0.37;
  hinge.add(dome);
  for (const side of [-1, 1]) {
    const strap = new Mesh(new CylinderGeometry(0.4, 0.4, 0.1, 18, 1, false, 0, Math.PI), gold);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(side * 0.38, 0, 0.37);
    hinge.add(strap);
  }
  root.add(hinge);

  const glow = new Mesh(new SphereGeometry(0.14, 12, 10), glowMaterial);
  glow.position.y = 1.5;
  root.add(glow);
  return { lid: hinge, glow };
};

const buildCollectible = (root: Group): { shard: Mesh; orbiters: Mesh[] } => {
  const shard = new Mesh(shardGeometry, shardMaterial);
  shard.position.y = 1;
  shard.add(new Mesh(shellGeometry, shellMaterial));
  const orbiters = [0, 1, 2].map(() => {
    const spark = new Mesh(sparkleGeometry, sparkleMaterial);
    shard.add(spark);
    return spark;
  });
  root.add(shard);
  return { shard, orbiters };
};

const buildPuzzle = (root: Group, element: Element): { crystal: Mesh; glyph: Mesh } => {
  const base = outlined(new Mesh(new CylinderGeometry(1.1, 1.3, 0.5, 10), stone));
  base.position.y = 0.25;
  const crystal = new Mesh(crystalGeometry, new MeshBasicMaterial({ color: ELEMENT_COLORS[element] }));
  crystal.position.y = 1.7;
  const ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: ELEMENT_COLORS[element] }));
  ring.rotation.x = Math.PI / 2;
  crystal.add(ring);
  // A glowing rune circle hovers just over the grass tips, marks the seal from afar and breathes while it is shut.
  const glyph = new Mesh(
    new RingGeometry(1.6, 2.1, 40),
    new MeshBasicMaterial({ color: ELEMENT_COLORS[element], transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false }),
  );
  glyph.rotation.x = -Math.PI / 2;
  glyph.position.y = 0.55;
  root.add(base, crystal, glyph);
  return { crystal, glyph };
};

const flagCloth = toonMaterial('#ff9a7a');
flagCloth.side = DoubleSide;
const FLAG_WIDTH = 1;
const FLAG_COLUMNS = 8;

/** A little lookout: stepped stone base, a pillar topped by a gem and beacon, and a flag that waves. */
const buildViewpoint = (root: Group): { gem: Mesh; flag: Mesh } => {
  const lower = outlined(new Mesh(new CylinderGeometry(1.9, 2.1, 0.25, 12), stone));
  lower.position.y = 0.125;
  const upper = outlined(new Mesh(new CylinderGeometry(1.35, 1.55, 0.25, 12), stone));
  upper.position.y = 0.375;
  const post = outlined(new Mesh(new CylinderGeometry(0.28, 0.45, 2.4, 8), stone));
  post.position.y = 1.7;
  const beacon = new Mesh(new CylinderGeometry(0.22, 0.22, 26, 8, 1, true), beaconMaterial);
  const gem = new Mesh(shardGeometry, shardMaterial);
  gem.position.y = 3.6;
  gem.add(beacon);
  beacon.position.y = 12;

  const pole = outlined(new Mesh(new CylinderGeometry(0.04, 0.05, 2.4, 6), gold));
  pole.position.set(1.15, 1.7, 0);
  const flag = new Mesh(new PlaneGeometry(FLAG_WIDTH, 0.55, FLAG_COLUMNS, 1), flagCloth);
  flag.position.set(1.15 + FLAG_WIDTH / 2, 2.65, 0);
  root.add(lower, upper, post, gem, pole, flag);
  return { gem, flag };
};

/** Ripples the flag with the wind; the cloth is pinned to its pole and freer toward the tip. */
const waveFlag = (flag: Mesh, time: number): void => {
  const positions = flag.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const along = positions.getX(i) / FLAG_WIDTH + 0.5;
    positions.setZ(i, Math.sin(time * 4 - along * 5) * 0.14 * along);
  }
  positions.needsUpdate = true;
};

/** Places every exploration point in the world and reacts to the player reaching them. */
export class ExplorationField {
  private readonly sites: Site[];
  private nearChest: Site | null = null;

  constructor(
    scene: Scene,
    private readonly progress: ExplorationProgress,
    private readonly events: ExplorationEvents,
  ) {
    this.sites = exploration.points.map((point) => {
      const root = new Group();
      const position = new Vector3(point.x, terrainHeight(point.x, point.z), point.z);
      root.position.copy(position);
      root.rotation.y = (point.x + point.z) * 0.7;
      const site: Site = { point, position, root, spinner: null, lid: null, glow: null, orbiters: [], glyph: null, flag: null, pop: 0, phase: point.x };
      if (point.kind === 'chest') {
        const chest = buildChest(root);
        site.lid = chest.lid;
        site.glow = chest.glow;
      }
      if (point.kind === 'collectible') {
        const built = buildCollectible(root);
        site.spinner = built.shard;
        site.orbiters = built.orbiters;
      }
      if (point.kind === 'puzzle') {
        const built = buildPuzzle(root, point.element!);
        site.spinner = built.crystal;
        site.glyph = built.glyph;
      }
      if (point.kind === 'viewpoint') {
        const built = buildViewpoint(root);
        site.spinner = built.gem;
        site.flag = built.flag;
      }
      scene.add(root);
      if (this.progress.has(point.id)) this.showDone(site, true);
      return site;
    });
  }

  /** True while a closed chest is in reach, so the HUD can offer the interact prompt. */
  get canInteract(): boolean {
    return this.nearChest !== null;
  }

  update(dt: number, player: Vector3, interactPressed: boolean): void {
    this.nearChest = null;
    for (const site of this.sites) {
      if (site.spinner) {
        site.phase += dt;
        site.spinner.rotation.y += dt * 1.4;
      }
      if (site.point.kind === 'collectible' && site.spinner?.visible) {
        site.spinner.position.y = 1 + Math.sin(site.phase * 2) * 0.12;
        site.orbiters.forEach((spark, i) => {
          const angle = site.phase * 2.2 + i * 2.094;
          spark.position.set(Math.cos(angle) * 0.62, Math.sin(site.phase * 3 + i) * 0.2, Math.sin(angle) * 0.62);
        });
        if (site.pop > 0) {
          site.pop -= dt;
          site.spinner.scale.setScalar(1 + (1 - Math.max(0, site.pop) / POP_SECONDS) * 1.4);
          if (site.pop <= 0) site.spinner.visible = false;
        }
      }
      if (site.flag) waveFlag(site.flag, site.phase);
      if (site.glow?.visible) {
        site.glow.position.y = 1.5 + Math.sin(site.phase * 2.4) * 0.1;
        site.glow.scale.setScalar(1 + Math.sin(site.phase * 4) * 0.2);
      }
      if (site.glyph && !this.progress.has(site.point.id)) {
        (site.glyph.material as MeshBasicMaterial).opacity = 0.4 + Math.sin(site.phase * 2.2) * 0.2;
      }
      if (this.progress.has(site.point.id)) continue;
      const distance = site.position.distanceTo(player);
      const { kind } = site.point;
      if (kind === 'collectible' && distance <= exploration.pickupRange) this.discover(site);
      if (kind === 'viewpoint' && distance <= exploration.viewpointRange) this.discover(site);
      if (kind === 'chest' && distance <= exploration.interactRange) this.nearChest = site;
    }
    if (interactPressed && this.nearChest) {
      this.discover(this.nearChest);
      this.nearChest = null;
    }
  }

  /** Skills and bursts report where they landed, so a matching element can open a seal. */
  elementHit(center: Vector3, radius: number, element: Element): void {
    for (const site of this.sites) {
      if (this.progress.has(site.point.id)) continue;
      if (puzzleResponds(site.point, element, site.position.distanceTo(center), radius)) this.discover(site);
    }
  }

  private discover(site: Site): void {
    const reward = this.progress.claim(site.point);
    if (!reward) return;
    this.showDone(site, false);
    this.events.discovered(site.point, reward);
  }

  private showDone(site: Site, instant: boolean): void {
    const { kind } = site.point;
    if (site.glow) site.glow.visible = false;
    if (kind === 'chest' && site.lid) site.lid.rotation.x = -1.9;
    if (kind === 'collectible' && site.spinner) {
      if (instant) site.spinner.visible = false;
      else site.pop = POP_SECONDS;
    }
    if (kind === 'puzzle' && site.glyph) (site.glyph.material as MeshBasicMaterial).opacity = 0.12;
    if (kind === 'puzzle' && site.spinner) {
      site.spinner.material = opened;
      for (const child of site.spinner.children) (child as Mesh).material = opened;
    }
    if (kind === 'viewpoint' && site.spinner) {
      for (const child of site.spinner.children) child.visible = false;
    }
  }
}
