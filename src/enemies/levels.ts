import { balance } from '../core/balance';

const cfg = balance.enemyLevels;
export const MAX_ENEMY_LEVEL = 20;

/** Kinds that hit above their weight sit a level higher than the ground around them. */
const TOUGH = new Set(['guard', 'charger']);

/** An enemy's level from where it lives: the farther from the start, the higher. */
export const regionLevel = (x: number, z: number, kind: string): number => {
  const level = Math.round(1 + Math.hypot(x, z) * cfg.regionPerMetre) + (TOUGH.has(kind) ? 1 : 0);
  return Math.min(MAX_ENEMY_LEVEL, Math.max(1, level));
};

/** Health, damage and rewards of a base enemy at `level`. Health starts above the old fixed values and grows with level. */
export const scaledStats = <T extends { hp: number; damage: number; xp: number; coins: number }>(base: T, level: number): T => {
  const up = level - 1;
  return {
    ...base,
    hp: Math.round(base.hp * cfg.hpBase * (1 + cfg.hpPerLevel * up)),
    damage: Math.round(base.damage * (1 + cfg.damagePerLevel * up)),
    xp: Math.round(base.xp * (1 + cfg.rewardPerLevel * up)),
    coins: Math.round(base.coins * (1 + cfg.rewardPerLevel * up)),
  };
};

/**
 * How much harder a blow lands when its giver is `giver` levels and its taker `taker`: stronger when the giver is
 * higher, weaker when lower, within limits so nothing is ever immune or a one-hit kill.
 */
export const gapFactor = (giver: number, taker: number): number =>
  Math.min(cfg.gapMax, Math.max(cfg.gapMin, 1 + cfg.gapPerLevel * (giver - taker)));

/** Experience fades once the player is more than two levels above an enemy, down to a tenth. */
export const xpFactor = (playerLevel: number, enemyLevel: number): number =>
  Math.max(0.1, Math.min(1, 1 - 0.2 * (playerLevel - 2 - enemyLevel)));

/** The colour a level badge takes against the player's own level: red when far above, grey when far below. */
export const badgeColor = (enemyLevel: number, playerLevel: number): string => {
  const gap = enemyLevel - playerLevel;
  if (gap >= 5) return '#ff4a4a';
  if (gap >= 2) return '#ffb347';
  if (gap <= -3) return '#9aa3ad';
  return '#ffffff';
};
