import { balance } from '../core/balance';

const cfg = balance.growth;

export const MAX_LEVEL = cfg.maxLevel;

/** Experience needed to climb from `level` to the next; each level asks a little more than the last. */
export const xpToNext = (level: number): number => (level >= MAX_LEVEL ? 0 : cfg.baseXp + cfg.xpPerLevel * level);

/** Total experience a character has when they first reach `level`. */
export const totalXpFor = (level: number): number => {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) total += xpToNext(l);
  return total;
};

export interface LevelInfo {
  level: number;
  /** Experience earned toward the next level. */
  into: number;
  /** Experience the next level asks for; 0 at the top. */
  need: number;
  ratio: number;
}

export const levelOf = (xp: number): LevelInfo => {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  const need = xpToNext(level);
  return { level, into: need === 0 ? 0 : left, need, ratio: need === 0 ? 1 : left / need };
};

/** Multiplier on a character's own attack, skill and burst damage. */
export const damageScale = (level: number): number => 1 + cfg.damagePerLevel * (level - 1);

/** The whole party is as tough as its strongest member, so bringing a new character up never costs health. */
export const maxHpFor = (levels: number[]): number =>
  balance.player.maxHp + cfg.hpPerLevel * (Math.max(1, ...levels) - 1);

/** What a benched character earns from experience the active one gets. */
export const benchShare = (xp: number): number => Math.round(xp * cfg.benchShare);
