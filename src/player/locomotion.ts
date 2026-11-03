import { Quaternion } from 'three';
import { phaseTime, sampleBone, sampleHipsY, type Clip } from './clips';

/** Ground speeds, in metres per second, at which each loop is at full strength. */
const GROUND_NODES: Array<[string, number]> = [
  ['Idle_Loop', 0],
  ['Walk_Loop', 2.2],
  ['Jog_Fwd_Loop', 5],
  ['Sprint_Loop', 8.5],
];
/** Ground covered by one full cycle of each loop, which sets how fast its legs turn at a given speed. */
const CYCLE_LENGTH: Record<string, number> = { Walk_Loop: 1.9, Jog_Fwd_Loop: 3.8, Sprint_Loop: 5.6 };
const DASH_SECONDS = 0.25;
const LAND_SECONDS = 0.3;
const HIT_SECONDS = 0.33;

/** How strongly each ground loop counts at a speed: neighbouring loops cross-fade, the rest sit at zero. */
export const groundWeights = (speed: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [name] of GROUND_NODES) out[name] = 0;
  const s = Math.max(0, speed);
  for (let i = 0; i < GROUND_NODES.length; i++) {
    const [name, at] = GROUND_NODES[i];
    if (i === GROUND_NODES.length - 1 || s <= at) {
      out[name] = 1;
      return out;
    }
    const [next, nextAt] = GROUND_NODES[i + 1];
    if (s < nextAt) {
      const u = (s - at) / (nextAt - at);
      out[name] = 1 - u;
      out[next] = u;
      return out;
    }
  }
  return out;
};

export interface LocomotionInput {
  time: number;
  speed: number;
  airborne: boolean;
  gliding: boolean;
  dashing: boolean;
  /** Seconds since the player was last hurt. */
  hitAge: number;
}

interface Active {
  clip: Clip;
  time: number;
  weight: number;
}

/**
 * The recorded body motion under everything else: idle, walk, jog and sprint cross-fade by speed on one
 * shared stride phase, and a jump, a landing and a roll fade in over them. Bones come back blended.
 */
export class Locomotion {
  private readonly weights = new Map<string, number>();
  private readonly active: Active[] = [];
  private readonly scratch = new Quaternion();
  private phase = 0;
  private airTime = 0;
  private landAge = 99;
  private dashAge = 0;
  private wasAirborne = false;
  /** How much of the pose the recording owns: 0 leaves it to the hand-made one (gliding), 1 is all of it. */
  base = 0;
  /** An upper-body flinch laid over the top while it lasts. */
  hit: Active | null = null;

  constructor(private readonly clips: Map<string, Clip>) {}

  static available(clips: Map<string, Clip>): boolean {
    return ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop'].every((n) => clips.has(n));
  }

  update(dt: number, input: LocomotionInput): void {
    const targets = new Map<string, number>();
    const times = new Map<string, number>();
    const { airborne, gliding, dashing, speed } = input;

    if (airborne) {
      if (!this.wasAirborne) this.airTime = 0;
      this.airTime += dt;
    } else if (this.wasAirborne && this.airTime > 0.45) this.landAge = 0;
    this.wasAirborne = airborne;
    this.landAge += dt;
    this.dashAge = dashing ? this.dashAge + dt : 0;

    if (gliding) {
      // Nothing recorded for the glide, so the hand-made pose takes over.
    } else if (dashing) {
      targets.set('Roll', 1);
      times.set('Roll', Math.min(1, this.dashAge / DASH_SECONDS) * (this.clips.get('Roll')?.duration ?? 0));
    } else if (airborne) {
      const leaving = this.airTime < 0.3;
      targets.set(leaving ? 'Jump_Start' : 'Jump_Loop', 1);
      times.set('Jump_Start', 0.2 + this.airTime * 1.2);
      times.set('Jump_Loop', this.airTime * 0.8);
    } else {
      const landing = this.landAge < LAND_SECONDS ? Math.max(0, 1 - speed / 6) : 0;
      if (landing > 0) {
        targets.set('Jump_Land', landing);
        times.set('Jump_Land', this.landAge);
      }
      const ground = groundWeights(speed);
      for (const name of Object.keys(ground)) targets.set(name, ground[name] * (1 - landing));
    }

    // The ground loops share one stride phase that turns with distance travelled.
    const ground = groundWeights(speed);
    let cycle = 0;
    let total = 0;
    for (const name of Object.keys(CYCLE_LENGTH)) {
      cycle += ground[name] * CYCLE_LENGTH[name];
      total += ground[name];
    }
    if (total > 0.001 && speed > 0.05) this.phase = (this.phase + (dt * speed * total) / cycle) % 1;

    // Weights chase their targets, so a state change is a short cross-fade rather than a pop.
    let sum = 0;
    this.active.length = 0;
    const names = new Set([...this.weights.keys(), ...targets.keys()]);
    for (const name of names) {
      const clip = this.clips.get(name);
      if (!clip) continue;
      const rate = name === 'Roll' ? 30 : 14;
      const goal = targets.get(name) ?? 0;
      const w = (this.weights.get(name) ?? 0) + (goal - (this.weights.get(name) ?? 0)) * (1 - Math.exp(-dt * rate));
      if (w < 0.004 && goal === 0) {
        this.weights.delete(name);
        continue;
      }
      this.weights.set(name, w);
      sum += w;
      let time = times.get(name);
      if (time === undefined) time = name === 'Idle_Loop' ? input.time % clip.duration : phaseTime(clip, this.phase);
      this.active.push({ clip, time, weight: w });
    }
    this.base = Math.min(1, sum);
    if (sum > 1) for (const a of this.active) a.weight /= sum;

    const hitClip = this.clips.get('Hit_Chest');
    this.hit =
      hitClip && input.hitAge < HIT_SECONDS
        ? { clip: hitClip, time: input.hitAge, weight: Math.sin((input.hitAge / HIT_SECONDS) * Math.PI) }
        : null;
  }

  /** The blended rotation of one bone, written into `into`; false when nothing recorded covers it. */
  sample(bone: string, into: Quaternion): boolean {
    let used = 0;
    for (const a of this.active) {
      if (!a.clip.bones[bone]) continue;
      sampleBone(a.clip, bone, a.time, this.scratch);
      if (used === 0) into.copy(this.scratch);
      else into.slerp(this.scratch, a.weight / (used + a.weight));
      used += a.weight;
    }
    return used > 0;
  }

  /** How far the hips sit above their rest height, blended, in the recording's own metres. */
  hipsY(): number {
    let used = 0;
    let y = 0;
    for (const a of this.active) {
      y += sampleHipsY(a.clip, a.time) * a.weight;
      used += a.weight;
    }
    return used > 0 ? y / used : 0;
  }
}
