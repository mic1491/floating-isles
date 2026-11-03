import { totalXpFor } from '../party/growth';

export const SAVE_VERSION = 8;

export interface SaveData {
  version: number;
  position: [number, number, number];
  cameraYaw: number;
  hp: number;
  activeCharacter: number;
  timeOfDay: number;
  discovered: string[];
  coins: number;
  shards: number;
  fog: string;
  waypoints: string[];
  markers: Array<[number, number]>;
  xp: number[];
  quest: number;
  bossDefeated: boolean;
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  position: [0, 0, 0],
  cameraYaw: 0,
  hp: 100,
  activeCharacter: 0,
  timeOfDay: 0.68,
  discovered: [],
  coins: 0,
  shards: 0,
  fog: '',
  waypoints: [],
  markers: [],
  xp: [0, 0, 0],
  quest: 0,
  bossDefeated: false,
});

/** Upgrades older saves one version at a time and rejects anything unreadable. */
export const migrateSave = (raw: unknown): SaveData => {
  if (!raw || typeof raw !== 'object') return defaultSave();
  const save = { ...(raw as Partial<SaveData>) };
  if (typeof save.version !== 'number' || save.version > SAVE_VERSION) return defaultSave();
  if (save.version === 1) {
    save.timeOfDay = defaultSave().timeOfDay;
    save.version = 2;
  }
  if (save.version === 2) {
    save.discovered = [];
    save.coins = 0;
    save.shards = 0;
    save.version = 3;
  }
  if (save.version === 3) {
    save.fog = '';
    save.waypoints = [];
    save.markers = [];
    save.version = 4;
  }
  if (save.version === 4) {
    (save as { levels?: number[] }).levels = [1, 1, 1];
    save.version = 5;
  }
  if (save.version === 5) {
    save.quest = 0;
    save.version = 6;
  }
  if (save.version === 6) {
    save.bossDefeated = false;
    save.version = 7;
  }
  if (save.version === 7) {
    // Levels used to be bought with coins; keep each one by giving the experience it is worth.
    const old = (save as { levels?: number[] }).levels ?? [];
    save.xp = [0, 1, 2].map((i) => totalXpFor(Math.floor(Number(old[i]) || 1)));
    delete (save as { levels?: number[] }).levels;
    save.version = 8;
  }
  const merged = { ...defaultSave(), ...save };
  return merged.position.every(Number.isFinite) ? merged : defaultSave();
};
