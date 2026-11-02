import raw from '../../data/map.json';
import { FogGrid } from './fogGrid';

export interface Waypoint {
  id: string;
  x: number;
  z: number;
  starter?: boolean;
}

export type Marker = [number, number];

export const mapConfig = raw as Omit<typeof raw, 'waypoints'> & { waypoints: Waypoint[] };

export class MapProgress {
  readonly fog: FogGrid;
  readonly markers: Marker[];
  private readonly unlocked: Set<string>;

  constructor(fog: string, waypoints: string[], markers: Marker[]) {
    this.fog = FogGrid.decode(fog);
    this.markers = [...markers];
    this.unlocked = new Set(waypoints);
    for (const point of mapConfig.waypoints) if (point.starter) this.unlocked.add(point.id);
  }

  get unlockedIds(): string[] {
    return [...this.unlocked];
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  /** Returns true only the first time, so callers can announce it once. */
  unlock(id: string): boolean {
    if (this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    return true;
  }

  nearestUnlocked(x: number, z: number): Waypoint {
    const open = mapConfig.waypoints.filter((point) => this.unlocked.has(point.id));
    const distance = (point: Waypoint) => Math.hypot(point.x - x, point.z - z);
    return open.reduce((best, point) => (distance(point) < distance(best) ? point : best));
  }

  /** Clicking near an existing marker removes it; otherwise adds one, up to the limit. */
  toggleMarker(x: number, z: number): void {
    const near = this.markers.findIndex(
      ([mx, mz]) => Math.hypot(mx - x, mz - z) <= mapConfig.markerRemoveRange,
    );
    if (near >= 0) this.markers.splice(near, 1);
    else if (this.markers.length < mapConfig.maxMarkers) this.markers.push([x, z]);
  }
}
