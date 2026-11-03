import raw from '../../data/exploration.json';
import type { Element } from '../core/balance';

export type PointKind = 'chest' | 'collectible' | 'puzzle' | 'viewpoint';

export interface ExplorationPoint {
  id: string;
  kind: PointKind;
  x: number;
  z: number;
  element?: Element;
}

export const exploration = raw as Omit<typeof raw, 'points'> & { points: ExplorationPoint[] };

export interface Reward {
  coins: number;
  shards: number;
}

/** What the player has found so far. Claiming a point twice never pays twice. */
export class ExplorationProgress {
  private readonly found: Set<string>;
  coins: number;
  shards: number;

  constructor(discovered: string[], coins: number, shards: number) {
    this.found = new Set(discovered);
    this.coins = coins;
    this.shards = shards;
  }

  get discovered(): string[] {
    return [...this.found];
  }

  get count(): number {
    return this.found.size;
  }

  has(id: string): boolean {
    return this.found.has(id);
  }

  /** Pays for something if the player can afford it; takes nothing otherwise. */
  spend(coins: number, shards: number): boolean {
    if (this.coins < coins || this.shards < shards) return false;
    this.coins -= coins;
    this.shards -= shards;
    return true;
  }

  claim(point: ExplorationPoint): Reward | null {
    if (this.found.has(point.id)) return null;
    this.found.add(point.id);
    const reward = exploration.rewards[point.kind];
    this.coins += reward.coins;
    this.shards += reward.shards;
    return reward;
  }
}

/** A puzzle opens only for its own element, and only when the hit reaches it. */
export const puzzleResponds = (
  point: ExplorationPoint,
  element: Element,
  distance: number,
  radius: number,
): boolean =>
  point.kind === 'puzzle' && point.element === element && distance <= radius + exploration.puzzleHitPadding;

/** The angle to a target `dx`, `dz` away, relative to where the camera looks: 0 is ahead, positive is right. */
export const bearingTo = (dx: number, dz: number, cameraYaw: number): number =>
  Math.atan2(dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw), -dx * Math.sin(cameraYaw) - dz * Math.cos(cameraYaw));

export interface Objective {
  point: ExplorationPoint;
  distance: number;
  /** Where the point lies relative to the camera: 0 is straight ahead, positive is to the right. */
  bearing: number;
}

/** The closest point not yet found, and which way to turn to face it. Null once everything is found. */
export const nextObjective = (
  progress: ExplorationProgress,
  x: number,
  z: number,
  cameraYaw: number,
): Objective | null => {
  let best: ExplorationPoint | null = null;
  let bestDistance = Infinity;
  for (const point of exploration.points) {
    if (progress.has(point.id)) continue;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const bearing = bearingTo(best.x - x, best.z - z, cameraYaw);
  return { point: best, distance: bestDistance, bearing };
};
