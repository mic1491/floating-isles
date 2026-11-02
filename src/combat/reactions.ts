import type { Element } from '../core/balance';

export type Reaction = 'vaporize' | 'overload' | 'electroCharged';

/** Returns the reaction two different elements produce. Same element refreshes the aura. */
export const reactionOf = (aura: Element | null, incoming: Element): Reaction | null => {
  if (!aura || aura === incoming) return null;
  const pair = new Set([aura, incoming]);
  if (pair.has('fire') && pair.has('water')) return 'vaporize';
  if (pair.has('fire') && pair.has('thunder')) return 'overload';
  return 'electroCharged';
};
