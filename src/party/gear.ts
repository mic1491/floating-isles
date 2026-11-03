import raw from '../../data/equipment.json';
import type { Element } from '../core/balance';
import type { Cost } from './costs';

export type GearStat = 'damage' | 'hp' | 'energy' | 'coins' | 'xp';

export interface GearItem {
  id: string;
  slot: 'weapon' | 'accessory';
  /** Weapons belong to one character's element; accessories are for anyone. */
  for?: Element;
  name: string;
  stat: GearStat;
  /** How much of the stat each level adds. */
  perLevel: number;
  buy: Cost;
  /** Cost of the first upgrade; each later level costs that many times more. */
  up: Cost;
  start?: boolean;
}

export const GEAR_ITEMS = raw.items as GearItem[];
export const MAX_GEAR_LEVEL = raw.maxLevel;
export const ACCESSORY_SLOTS = 2;

export interface Loadout {
  weapon: string;
  accessories: Array<string | null>;
}

/** What gear is owned (and at what level) and who wears what. This is the part that is saved. */
export interface GearSave {
  owned: Record<string, number>;
  loadouts: Loadout[];
}

export interface Bonus {
  damage: number;
  hp: number;
  energy: number;
  coins: number;
  xp: number;
}

const empty = (): Bonus => ({ damage: 0, hp: 0, energy: 0, coins: 0, xp: 0 });

export const itemById = (id: string): GearItem | undefined => GEAR_ITEMS.find((item) => item.id === id);

/** What it costs to raise an item from `level` to the next. */
export const upgradeCost = (item: GearItem, level: number): Cost => ({
  coins: item.up.coins * level,
  shards: item.up.shards * level,
});

export const statValue = (item: GearItem, level: number): number => item.perLevel * level;

export const defaultGear = (elements: Element[]): GearSave => {
  const owned: Record<string, number> = {};
  const loadouts: Loadout[] = elements.map((element) => {
    const start = GEAR_ITEMS.find((item) => item.start && item.for === element)!;
    owned[start.id] = 1;
    return { weapon: start.id, accessories: Array.from({ length: ACCESSORY_SLOTS }, () => null) };
  });
  return { owned, loadouts };
};

/** Cleans up a loaded save: unknown items vanish, and anything equipped but not owned is taken off. */
export const sanitizeGear = (value: Partial<GearSave> | undefined, elements: Element[]): GearSave => {
  const base = defaultGear(elements);
  const owned: Record<string, number> = { ...base.owned };
  for (const [id, level] of Object.entries(value?.owned ?? {})) {
    if (itemById(id)) owned[id] = Math.max(1, Math.min(MAX_GEAR_LEVEL, Math.floor(Number(level)) || 1));
  }
  const used = new Set<string>();
  const loadouts = base.loadouts.map((fallback, i) => {
    const saved = value?.loadouts?.[i];
    const weapon = saved && owned[saved.weapon] && itemById(saved.weapon)?.for === elements[i] ? saved.weapon : fallback.weapon;
    const accessories = fallback.accessories.map((_, slot) => {
      const id = saved?.accessories?.[slot] ?? null;
      if (!id || !owned[id] || itemById(id)?.slot !== 'accessory' || used.has(id)) return null;
      used.add(id);
      return id;
    });
    return { weapon, accessories };
  });
  return { owned, loadouts };
};

/** Spending is passed in, so this stays free of the rest of the game. */
export interface Wallet {
  coins: number;
  shards: number;
  spend(coins: number, shards: number): boolean;
}

export class Gear {
  readonly owned: Record<string, number>;
  readonly loadouts: Loadout[];

  constructor(save: GearSave, private readonly elements: Element[]) {
    this.owned = save.owned;
    this.loadouts = save.loadouts;
  }

  toSave(): GearSave {
    return { owned: { ...this.owned }, loadouts: this.loadouts.map((l) => ({ weapon: l.weapon, accessories: [...l.accessories] })) };
  }

  level(id: string): number {
    return this.owned[id] ?? 0;
  }

  /** Who is wearing an accessory, or -1. */
  wearer(id: string): number {
    return this.loadouts.findIndex((l) => l.accessories.includes(id));
  }

  buy(id: string, wallet: Wallet): boolean {
    const item = itemById(id);
    if (!item || this.level(id) > 0) return false;
    if (!wallet.spend(item.buy.coins, item.buy.shards)) return false;
    this.owned[id] = 1;
    return true;
  }

  upgrade(id: string, wallet: Wallet): boolean {
    const item = itemById(id);
    const level = this.level(id);
    if (!item || level === 0 || level >= MAX_GEAR_LEVEL) return false;
    const cost = upgradeCost(item, level);
    if (!wallet.spend(cost.coins, cost.shards)) return false;
    this.owned[id] = level + 1;
    return true;
  }

  /** Puts an owned item on a character; an accessory worn by someone else moves over to them. */
  equip(character: number, id: string, slot = 0): boolean {
    const item = itemById(id);
    if (!item || this.level(id) === 0) return false;
    const loadout = this.loadouts[character];
    if (item.slot === 'weapon') {
      if (item.for !== this.elements[character]) return false;
      loadout.weapon = id;
      return true;
    }
    for (const other of this.loadouts) {
      const at = other.accessories.indexOf(id);
      if (at >= 0) other.accessories[at] = null;
    }
    loadout.accessories[Math.max(0, Math.min(ACCESSORY_SLOTS - 1, slot))] = id;
    return true;
  }

  unequip(character: number, slot: number): void {
    this.loadouts[character].accessories[slot] = null;
  }

  /** Everything one character's gear adds up to. */
  bonus(character: number): Bonus {
    const total = empty();
    const loadout = this.loadouts[character];
    for (const id of [loadout.weapon, ...loadout.accessories]) {
      const item = id ? itemById(id) : undefined;
      if (item) total[item.stat] += statValue(item, this.level(item.id));
    }
    return total;
  }

  /** Health, coins and experience are shared by the whole party, so every member's gear counts. */
  partyBonus(): Bonus {
    const total = empty();
    this.loadouts.forEach((_, i) => {
      const b = this.bonus(i);
      total.hp += b.hp;
      total.coins += b.coins;
      total.xp += b.xp;
    });
    return total;
  }
}
