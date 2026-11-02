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
