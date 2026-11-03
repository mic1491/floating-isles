import raw from '../../data/quests.json';
import { exploration, type ExplorationProgress, type ExplorationPoint, type PointKind, type Reward } from '../exploration/progress';
import { balance, type Element } from '../core/balance';
import { SPAWNS } from '../combat/spawns';
import type { EnemyKind } from '../enemies/enemy';
import { mapConfig, type MapProgress } from '../map/mapProgress';

export type Step =
  | { type: 'find'; kind: PointKind; count: number }
  | { type: 'waypoint'; count: number }
  | { type: 'boss'; count: number }
  /** Defeat enemies, of one kind or `any`. */
  | { type: 'defeat'; kind: 'any' | EnemyKind; count: number }
  | { type: 'reaction'; count: number }
  /** Own this many pieces of gear beyond the starting weapons. */
  | { type: 'gear'; count: number }
  /** Bring any one character up to this level. */
  | { type: 'level'; count: number };

export interface Quest {
  id: string;
  title: string;
  intro: string;
  steps: Step[];
  reward: Reward;
}

export const quests = raw.quests as Quest[];

/** Everything a quest can ask about, read straight from what the player has already done. */
export interface Counts {
  find: Record<PointKind, number>;
  /** Waypoints the player lit up themselves; the one they start at does not count. */
  waypoints: number;
  bossDefeated: boolean;
  kills: Record<string, number>;
  reactions: number;
  newGear: number;
  topLevel: number;
}

/** The parts of the player's record that do not live in the exploration or map progress. */
export interface PlayRecord {
  kills?: Record<string, number>;
  reactions?: number;
  newGear?: number;
  topLevel?: number;
}

export const countsOf = (progress: ExplorationProgress, map: MapProgress, bossDefeated = false, record: PlayRecord = {}): Counts => {
  const find: Record<PointKind, number> = { chest: 0, collectible: 0, puzzle: 0, viewpoint: 0 };
  for (const point of exploration.points) if (progress.has(point.id)) find[point.kind]++;
  const waypoints = mapConfig.waypoints.filter((w) => !w.starter && map.isUnlocked(w.id)).length;
  return {
    find,
    waypoints,
    bossDefeated,
    kills: record.kills ?? {},
    reactions: record.reactions ?? 0,
    newGear: record.newGear ?? 0,
    topLevel: record.topLevel ?? 1,
  };
};

const have = (step: Step, counts: Counts): number => {
  switch (step.type) {
    case 'find':
      return counts.find[step.kind];
    case 'waypoint':
      return counts.waypoints;
    case 'boss':
      return Number(counts.bossDefeated);
    case 'defeat':
      return counts.kills[step.kind] ?? 0;
    case 'reaction':
      return counts.reactions;
    case 'gear':
      return counts.newGear;
    case 'level':
      return counts.topLevel;
  }
};

export interface Status {
  /** The first step not yet met; the last one when everything is met. */
  step: Step;
  have: number;
  need: number;
  done: boolean;
}

export const statusOf = (quest: Quest, counts: Counts): Status => {
  const open = quest.steps.find((step) => have(step, counts) < step.count);
  const step = open ?? quest.steps.at(-1)!;
  return { step, have: Math.min(have(step, counts), step.count), need: step.count, done: open === undefined };
};

/** Where the player should head for the current step, or null when nothing is left to find. */
export const targetOf = (
  step: Step,
  progress: ExplorationProgress,
  map: MapProgress,
  x: number,
  z: number,
): { x: number; z: number; element?: Element } | null => {
  if (step.type === 'boss') {
    const [x, z] = balance.enemies.boss.home;
    return { x, z };
  }
  // Nothing to walk toward: these are met by playing, wherever the player is.
  if (step.type === 'reaction' || step.type === 'gear' || step.type === 'level') return null;
  const candidates: Array<{ x: number; z: number; element?: Element }> =
    step.type === 'find'
      ? exploration.points.filter((p: ExplorationPoint) => p.kind === step.kind && !progress.has(p.id))
      : step.type === 'defeat'
        ? SPAWNS.filter(([kind]) => step.kind === 'any' || kind === step.kind).map(([, sx, sz]) => ({ x: sx, z: sz }))
        : mapConfig.waypoints.filter((w) => !w.starter && !map.isUnlocked(w.id));
  let best: { x: number; z: number; element?: Element } | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - x, candidate.z - z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};

/** The main storyline: quests are taken strictly in order, one at a time. */
export class QuestLog {
  completed: number;

  constructor(completed: number) {
    this.completed = Math.max(0, Math.min(quests.length, Math.floor(completed) || 0));
  }

  get current(): Quest | null {
    return quests.at(this.completed) ?? null;
  }

  /** Finishes the current quest if it is met and returns it, so the caller can pay out once. */
  advance(counts: Counts): Quest | null {
    const quest = this.current;
    if (!quest || !statusOf(quest, counts).done) return null;
    this.completed++;
    return quest;
  }
}
