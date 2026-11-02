export const SAVE_VERSION = 2;

export interface SaveData {
  version: number;
  position: [number, number, number];
  cameraYaw: number;
  hp: number;
  activeCharacter: number;
  timeOfDay: number;
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  position: [0, 0, 0],
  cameraYaw: 0,
  hp: 100,
  activeCharacter: 0,
  timeOfDay: 0.68,
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
  const merged = { ...defaultSave(), ...save };
  return merged.position.every(Number.isFinite) ? merged : defaultSave();
};
