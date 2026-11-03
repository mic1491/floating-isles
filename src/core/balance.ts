import raw from '../../data/balance.json';

export type Element = 'fire' | 'water' | 'thunder';

export type WeaponKind = 'sword' | 'staff' | 'spear';

export interface CharacterDef {
  id: string;
  weapon: WeaponKind;
  element: Element;
  color: string;
  /** Path under the site root; characters without one use the placeholder body. */
  model?: string;
  /** Turns the model's hair, jacket and eyes by this many degrees, so one model can play several characters. */
  hue?: number;
  weaponColor?: string;
  /** A glb sword; characters without one carry the plain built-in blade. */
  weaponModel?: string;
  attack: number;
  skill: { damage: number; cooldown: number; radius: number };
  burst: { damage: number; radius: number };
}

export const balance = raw as Omit<typeof raw, 'characters'> & { characters: CharacterDef[] };
