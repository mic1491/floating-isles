import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
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
  phase: number;
}

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

const buildChest = (root: Group): Group => {
  const body = outlined(new Mesh(new BoxGeometry(1.1, 0.6, 0.75), wood));
  body.position.y = 0.3;
  const band = new Mesh(new BoxGeometry(1.14, 0.1, 0.8), gold);
  band.position.y = 0.42;
  const hinge = new Group();
  hinge.position.set(0, 0.6, -0.37);
  const lid = outlined(new Mesh(new BoxGeometry(1.14, 0.26, 0.77), wood));
  lid.position.set(0, 0.13, 0.37);
  hinge.add(lid);
  root.add(body, band, hinge);
  return hinge;
};

const buildCollectible = (root: Group): Mesh => {
  const shard = new Mesh(shardGeometry, shardMaterial);
  shard.position.y = 1;
  root.add(shard);
  return shard;
};

const buildPuzzle = (root: Group, element: Element): Mesh => {
  const base = outlined(new Mesh(new CylinderGeometry(1.1, 1.3, 0.5, 10), stone));
  base.position.y = 0.25;
  const crystal = new Mesh(crystalGeometry, new MeshBasicMaterial({ color: ELEMENT_COLORS[element] }));
  crystal.position.y = 1.7;
  const ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: ELEMENT_COLORS[element] }));
  ring.rotation.x = Math.PI / 2;
  crystal.add(ring);
  root.add(base, crystal);
  return crystal;
};

const buildViewpoint = (root: Group): Mesh => {
  const post = outlined(new Mesh(new CylinderGeometry(0.28, 0.45, 2.4, 8), stone));
  post.position.y = 1.2;
  const beacon = new Mesh(new CylinderGeometry(0.22, 0.22, 26, 8, 1, true), beaconMaterial);
  const gem = new Mesh(shardGeometry, shardMaterial);
  gem.position.y = 2.8;
  gem.add(beacon);
  beacon.position.y = 12;
  root.add(post, gem);
  return gem;
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
      const site: Site = { point, position, root, spinner: null, lid: null, phase: point.x };
      if (point.kind === 'chest') site.lid = buildChest(root);
      if (point.kind === 'collectible') site.spinner = buildCollectible(root);
      if (point.kind === 'puzzle') site.spinner = buildPuzzle(root, point.element!);
      if (point.kind === 'viewpoint') site.spinner = buildViewpoint(root);
      scene.add(root);
      if (this.progress.has(point.id)) this.showDone(site);
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
    this.showDone(site);
    this.events.discovered(site.point, reward);
  }

  private showDone(site: Site): void {
    const { kind } = site.point;
    if (kind === 'chest' && site.lid) site.lid.rotation.x = -1.9;
    if (kind === 'collectible' && site.spinner) site.spinner.visible = false;
    if (kind === 'puzzle' && site.spinner) {
      site.spinner.material = opened;
      for (const child of site.spinner.children) (child as Mesh).material = opened;
    }
    if (kind === 'viewpoint' && site.spinner) {
      for (const child of site.spinner.children) child.visible = false;
    }
  }
}
