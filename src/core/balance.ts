import raw from '../../data/balance.json';

export type Element = 'fire' | 'water' | 'thunder';

export interface CharacterDef {
  id: string;
  element: Element;
  color: string;
  /** Path under the site root; characters without one use the placeholder body. */
  model?: string;
  weaponColor?: string;
  /** A glb sword; characters without one carry the plain built-in blade. */
  weaponModel?: string;
  attack: number;
  skill: { damage: number; cooldown: number; radius: number };
  burst: { damage: number; radius: number };
}

export const balance = raw as Omit<typeof raw, 'characters'> & { characters: CharacterDef[] };
