import raw from '../../data/quests.json';
import { exploration, type ExplorationProgress, type ExplorationPoint, type PointKind, type Reward } from '../exploration/progress';
import type { Element } from '../core/balance';
import { mapConfig, type MapProgress } from '../map/mapProgress';

export type Step = { type: 'find'; kind: PointKind; count: number } | { type: 'waypoint'; count: number };

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
}

export const countsOf = (progress: ExplorationProgress, map: MapProgress): Counts => {
  const find: Record<PointKind, number> = { chest: 0, collectible: 0, puzzle: 0, viewpoint: 0 };
  for (const point of exploration.points) if (progress.has(point.id)) find[point.kind]++;
  const waypoints = mapConfig.waypoints.filter((w) => !w.starter && map.isUnlocked(w.id)).length;
  return { find, waypoints };
};

const have = (step: Step, counts: Counts): number =>
  step.type === 'find' ? counts.find[step.kind] : counts.waypoints;

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
  const candidates: Array<{ x: number; z: number; element?: Element }> =
    step.type === 'find'
      ? exploration.points.filter((p: ExplorationPoint) => p.kind === step.kind && !progress.has(p.id))
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
