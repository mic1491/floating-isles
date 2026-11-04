/** Timing and shape of each hit in the sword combo; shared by pose, movement, damage and trail. */
export interface AttackStyle {
  /** Seconds from input to the end of recovery. */
  duration: number;
  /** Fraction of the swing at which the blade connects. */
  strikeAt: number;
  /** Fraction after which the next input may start the following hit. */
  chainAt: number;
  /** Metres stepped forward over the strike. */
  lunge: number;
  damageScale: number;
  /** Seconds of freeze on hit. */
  hitstop: number;
  /** Camera kick on hit. */
  shake: number;
  trail: {
    /** Roll of the swing plane around the forward axis; 0 is a flat horizontal sweep. */
    roll: number;
    from: number;
    to: number;
    radius: number;
    width: number;
    height: number;
  };
}

import raw from '../../data/moves.json';

const rad = (d: number): number => (d * Math.PI) / 180;

type RawHit = Omit<AttackStyle, 'trail'> & { trail: Omit<AttackStyle['trail'], 'from' | 'to'> & { fromDeg: number; toDeg: number } };

const toStyle = (hit: RawHit): AttackStyle => {
  const { fromDeg, toDeg, ...trail } = hit.trail;
  return { ...hit, trail: { ...trail, from: rad(fromDeg), to: rad(toDeg) } };
};

/** Every hit's timing and shape, read from `data/moves.json`: the tap combo, then the charged strike. */
export const ATTACKS: readonly AttackStyle[] = [...raw.combo, raw.charged].map((hit) => toStyle(hit as RawHit));

/** Hits in the tap combo; the entry after them in `ATTACKS` is the charged strike. */
export const COMBO_LENGTH = raw.combo.length;
export const CHARGED_STEP = COMBO_LENGTH + 1;
/** The point of the overhead swing, as a fraction of it, where the weapon is raised and held while charging. */
export const CHARGE_HOLD = raw.charge.holdPoint;
/** Seconds the button must be held, after the tap's own swing is over, before power starts to gather. */
export const CHARGE_AFTER = raw.charge.holdAfter;
/** Seconds of gathering to a full charge. */
export const CHARGE_TIME = raw.charge.fullTime;
/** How far each weapon steps into its charged strike, as a share of the strike's own lunge. */
export const CHARGED_LUNGE: Record<string, number> = raw.charge.lunge;
/** Knockback distance per combo hit. */
export const KNOCKBACK: readonly number[] = raw.knockback;
/** Which recorded clip plays for each hit (and the charged strike last), per weapon. */
export const MOVE_CLIPS: Record<string, string[]> = raw.clips;
/** The dive-and-smash attack: pressing attack high in the air drops the player onto the ground. */
export const PLUNGE = raw.plunge;
