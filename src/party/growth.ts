import { balance } from '../core/balance';

const cfg = balance.growth;

export interface Cost {
  coins: number;
  shards: number;
}

/** What it costs to raise a character from `level` to the next one. */
export const upgradeCost = (level: number): Cost => ({
  coins: cfg.coinsPerLevel * level,
  shards: cfg.shardsPerLevel * level,
});

/** Multiplier on a character's own attack, skill and burst damage. */
export const damageScale = (level: number): number => 1 + cfg.damagePerLevel * (level - 1);

/** Every level gained by any character toughens the whole party. */
export const maxHpFor = (levels: number[]): number =>
  balance.player.maxHp + cfg.hpPerLevel * levels.reduce((sum, level) => sum + level - 1, 0);

export const canUpgrade = (level: number, coins: number, shards: number): boolean => {
  const cost = upgradeCost(level);
  return level < cfg.maxLevel && coins >= cost.coins && shards >= cost.shards;
};

export const MAX_LEVEL = cfg.maxLevel;
