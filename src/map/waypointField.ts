import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3, type Scene } from 'three';
import { addOutline, toonMaterial } from '../render/toon';
import { terrainHeight } from '../world/terrain';
import { mapConfig, type MapProgress, type Waypoint } from './mapProgress';

const stone = toonMaterial('#c9bfae');
const lockedGem = new MeshBasicMaterial({ color: '#8f93a8' });
const unlockedGem = new MeshBasicMaterial({ color: '#7fe6ff' });
const baseGeometry = new CylinderGeometry(1.6, 1.9, 0.4, 12);
const gemGeometry = new OctahedronGeometry(0.55);

interface Site {
  point: Waypoint;
  position: Vector3;
  gem: Mesh;
}

export class WaypointField {
  private readonly sites: Site[];

  constructor(
    scene: Scene,
    private readonly map: MapProgress,
    private readonly onUnlock: () => void,
  ) {
    this.sites = mapConfig.waypoints.map((point) => {
      const root = new Group();
      const position = new Vector3(point.x, terrainHeight(point.x, point.z), point.z);
      root.position.copy(position);
      const base = new Mesh(baseGeometry, stone);
      base.position.y = 0.15;
      base.castShadow = true;
      addOutline(base);
      const gem = new Mesh(gemGeometry, map.isUnlocked(point.id) ? unlockedGem : lockedGem);
      gem.position.y = 1.7;
      root.add(base, gem);
      scene.add(root);
      return { point, position, gem };
    });
  }

  update(dt: number, player: Vector3): void {
    for (const site of this.sites) {
      site.gem.rotation.y += dt;
      if (this.map.isUnlocked(site.point.id)) continue;
      if (Math.hypot(site.position.x - player.x, site.position.z - player.z) > mapConfig.unlockRange) continue;
      if (this.map.unlock(site.point.id)) {
        site.gem.material = unlockedGem;
        this.onUnlock();
      }
    }
  }
}
