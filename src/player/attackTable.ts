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

const deg = (d: number): number => (d * Math.PI) / 180;

export const ATTACKS: readonly AttackStyle[] = [
  {
    duration: 0.46,
    strikeAt: 0.34,
    chainAt: 0.62,
    lunge: 0.8,
    damageScale: 1,
    hitstop: 0.045,
    shake: 0.015,
    trail: { roll: 0.1, from: deg(5), to: deg(170), radius: 1.5, width: 0.5, height: 1.05 },
  },
  {
    duration: 0.46,
    strikeAt: 0.33,
    chainAt: 0.62,
    lunge: 0.7,
    damageScale: 1.1,
    hitstop: 0.045,
    shake: 0.015,
    trail: { roll: -0.2, from: deg(175), to: deg(10), radius: 1.5, width: 0.5, height: 1.0 },
  },
  {
    duration: 0.54,
    strikeAt: 0.36,
    chainAt: 0.68,
    lunge: 1.0,
    damageScale: 1.3,
    hitstop: 0.06,
    shake: 0.025,
    trail: { roll: 0.95, from: deg(0), to: deg(175), radius: 1.6, width: 0.6, height: 1.05 },
  },
  {
    duration: 0.78,
    strikeAt: 0.44,
    chainAt: 1,
    lunge: 1.5,
    damageScale: 1.8,
    hitstop: 0.09,
    shake: 0.05,
    trail: { roll: 1.5, from: deg(0), to: deg(180), radius: 1.8, width: 0.8, height: 0.95 },
  },
];

export const COMBO_LENGTH = ATTACKS.length;
