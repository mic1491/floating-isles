import { Vector3, type Object3D, type Sprite } from 'three';
import { Beam, makeGlow, type Fx } from './fx';
import { mirror, type Anim, type Pose, type Rig } from './rig';
import type { Sfx } from './sfx';

export interface CharDef {
  id: string;
  name: string;
  element: string;
  color: number;
  hot: number;
  css: string;
  url: string;
  ult: string;
  line: string;
  /** Degrees to turn the hue of the hair and eyes, which are painted red in every model file. */
  hue?: number;
}

export const CHARS: CharDef[] = [
  { id: 'ember', name: '燼羽', element: '火', color: 0xff5a1e, hot: 0xffe2a0, css: '#ff7a3a', url: 'assets/characters/ember_wing.vrm', ult: '焚星破', line: '速度與爆發兼具的拳士' },
  { id: 'tide', name: '汐音', element: '水', color: 0x2f9bff, hot: 0xc8f4ff, css: '#4ab4ff', url: 'assets/characters/tide_song.vrm', ult: '滄瀾衝', line: '以柔勁化解攻勢的鬥者', hue: 210 },
  { id: 'thunder', name: '鳴川', element: '雷', color: 0xa85cff, hot: 0xf2dcff, css: '#b97bff', url: 'assets/characters/thunder_river.vrm', ult: '雷殛閃', line: '一閃即至的迅雷武者', hue: 275 },
];

export interface Intent {
  /** Where to walk, in the world, at most length 1. */
  mx: number;
  mz: number;
  light: boolean;
  heavy: boolean;
  blast: boolean;
  dash: boolean;
  jump: boolean;
  ult: boolean;
  guard: boolean;
  charge: boolean;
}

export const noIntent = (): Intent => ({ mx: 0, mz: 0, light: false, heavy: false, blast: false, dash: false, jump: false, ult: false, guard: false, charge: false });

export type State = 'idle' | 'attack' | 'dash' | 'guard' | 'charge' | 'hit' | 'launched' | 'down' | 'getup' | 'blast' | 'ult' | 'win';

export interface Strike {
  dmg: number;
  /** How fast the struck fighter is thrown back. */
  push: number;
  /** Upward speed, when the blow lifts them off the floor. */
  launch?: number;
  stun: number;
  guardBreak?: boolean;
  power: number;
  height?: number;
}

interface Move extends Strike {
  dur: number;
  /** When the blow lands, and from when the next one may start. */
  at: number;
  cancel: number;
  range: number;
  lunge: number;
  wind: Pose;
  hitPose: Pose;
}

// Poses are written for the right side and mirrored where the left arm leads. In the normalised T-pose the
// right arm lies along -X: turning it about Y by +1.5 points it forward, about Z by +1.2 hangs it down.
const STANCE: Pose = {
  leftUpperArm: [0, -0.7, -1.05], leftLowerArm: [0, -2.0, 0],
  rightUpperArm: [0, 0.35, 1.2], rightLowerArm: [0, 2.25, 0],
  spine: [0.1, 0.3, 0], chest: [0, 0.1, 0], head: [0, -0.35, 0],
  leftUpperLeg: [-0.35, 0, 0.1], leftLowerLeg: [0.45, 0, 0],
  rightUpperLeg: [0.12, 0.3, -0.12], rightLowerLeg: [0.35, 0, 0],
  _drop: [0.05],
};
const over = (pose: Pose): Pose => ({ ...STANCE, ...pose });

const JAB: Pose = over({ leftUpperArm: [0, -1.5, -0.08], leftLowerArm: [0, -0.05, 0], spine: [0.14, -0.15, 0], chest: [0, -0.35, 0], head: [0, 0.4, 0] });
const CROSS_WIND: Pose = over({ rightUpperArm: [0, -0.25, 1.0], rightLowerArm: [0, 2.3, 0], chest: [0, -0.35, 0] });
const CROSS: Pose = over({ rightUpperArm: [0, 1.5, 0.08], rightLowerArm: [0, 0.05, 0], spine: [0.16, 0.45, 0], chest: [0, 0.5, 0], head: [0, -0.8, 0], leftUpperArm: [0, -0.2, -1.1], leftLowerArm: [0, -2.3, 0] });
const KICK_WIND: Pose = over({ rightUpperLeg: [-1.25, 0, 0], rightLowerLeg: [1.8, 0, 0], spine: [-0.1, 0, 0], leftUpperLeg: [0, 0, 0], leftLowerLeg: [0.1, 0, 0], _drop: [0] });
const KICK: Pose = over({ rightUpperLeg: [-1.55, 0, 0], rightLowerLeg: [0.05, 0, 0], spine: [-0.35, 0, 0], chest: [0, 0, 0], leftUpperLeg: [0.1, 0, 0], leftLowerLeg: [0.1, 0, 0], _drop: [0] });
const UPPER_WIND: Pose = over({ rightUpperArm: [0, 0.1, 1.15], rightLowerArm: [0, 1.6, 0], spine: [0.4, -0.35, 0], leftUpperLeg: [-0.8, 0, 0.1], leftLowerLeg: [1.2, 0, 0], rightUpperLeg: [-0.5, 0.3, -0.12], rightLowerLeg: [1.2, 0, 0], _drop: [0.28] });
const UPPER: Pose = over({ rightUpperArm: [0, 1.25, -1.0], rightLowerArm: [0, 1.4, 0], spine: [-0.22, 0.45, 0], chest: [-0.1, 0.3, 0], head: [-0.2, -0.6, 0], leftUpperLeg: [0, 0, 0.05], leftLowerLeg: [0.05, 0, 0], rightUpperLeg: [0.25, 0, -0.05], rightLowerLeg: [0.3, 0, 0], _drop: [-0.05] });
const SMASH_WIND: Pose = over({ rightUpperArm: [0, -0.8, 0.15], rightLowerArm: [0, 2.2, 0], spine: [0, -0.35, 0], chest: [0, -0.6, 0], head: [0, 0.8, 0], _drop: [0.14] });
const SMASH: Pose = over({ rightUpperArm: [0, 1.5, 0], rightLowerArm: [0, 0.08, 0], spine: [0.38, 0.4, 0], chest: [0, 0.6, 0], head: [-0.2, -0.9, 0], leftUpperArm: [0, 0.5, -1.0], leftLowerArm: [0, -1.6, 0], leftUpperLeg: [-0.75, 0, 0.1], leftLowerLeg: [0.9, 0, 0], rightUpperLeg: [0.45, 0.2, -0.1], rightLowerLeg: [0.25, 0, 0], _drop: [0.2] });
const GUARD: Pose = over({ leftUpperArm: [0, -1.2, -0.55], leftLowerArm: [0, -2.35, 0], rightUpperArm: [0, 1.2, 0.55], rightLowerArm: [0, 2.35, 0], spine: [0.2, 0, 0], chest: [0, 0, 0], head: [0.1, 0, 0], _drop: [0.1] });
const CHARGE: Pose = {
  rightUpperArm: [0, 0.15, 0.95], rightLowerArm: [0, 1.15, 0],
  spine: [0.15, 0, 0], head: [-0.25, 0, 0],
  rightUpperLeg: [-0.4, 0, -0.32], rightLowerLeg: [0.7, 0, 0],
  _drop: [0.16],
};
Object.assign(CHARGE, { ...mirror(CHARGE), ...CHARGE });
const FIRE: Pose = {
  rightUpperArm: [0, 1.35, -0.12], rightLowerArm: [0, 0.25, 0], leftUpperArm: [0, -1.35, 0.12], leftLowerArm: [0, -0.25, 0],
  spine: [0.25, 0, 0], head: [-0.2, 0, 0],
  leftUpperLeg: [-0.7, 0, 0.1], leftLowerLeg: [0.8, 0, 0], rightUpperLeg: [0.5, 0, -0.1], rightLowerLeg: [0.2, 0, 0],
  _drop: [0.18],
};
const FLAIL: Pose = {
  rightUpperArm: [0, 0.3, -0.3], rightLowerArm: [0, 0.4, 0], leftUpperArm: [0, -0.3, 0.3], leftLowerArm: [0, -0.4, 0],
  spine: [-0.25, 0, 0], head: [-0.3, 0, 0],
  rightUpperLeg: [-0.5, 0, -0.2], rightLowerLeg: [0.7, 0, 0], leftUpperLeg: [-0.2, 0, 0.2], leftLowerLeg: [0.4, 0, 0],
};
const LYING: Pose = {
  rightUpperArm: [0, 0, 0.5], rightLowerArm: [0, 0.3, 0], leftUpperArm: [0, 0, -0.7], leftLowerArm: [0, -0.5, 0],
  rightUpperLeg: [-0.1, 0, -0.15], rightLowerLeg: [0.2, 0, 0], leftUpperLeg: [-0.3, 0, 0.2], leftLowerLeg: [0.5, 0, 0],
  head: [0, 0.3, 0],
};
const WIN: Pose = {
  rightUpperArm: [0, 0.2, -1.2], rightLowerArm: [0, 0.5, 0], leftUpperArm: [0, -0.3, -1.0], leftLowerArm: [0, -1.5, 0],
  spine: [-0.08, 0, 0], head: [-0.15, 0, 0],
};
const DASH: Pose = { spine: [0.55, 0, 0], head: [-0.45, 0, 0] };

const COMBO: Move[] = [
  { dur: 0.3, at: 0.1, cancel: 0.17, range: 1.9, lunge: 16, dmg: 4, push: 2.6, stun: 0.42, power: 1, wind: STANCE, hitPose: JAB, height: 1.3 },
  { dur: 0.32, at: 0.11, cancel: 0.19, range: 1.9, lunge: 10, dmg: 5, push: 2.6, stun: 0.42, power: 1.1, wind: CROSS_WIND, hitPose: CROSS, height: 1.3 },
  { dur: 0.44, at: 0.17, cancel: 0.27, range: 2.1, lunge: 10, dmg: 7, push: 3.4, stun: 0.48, power: 1.3, wind: KICK_WIND, hitPose: KICK, height: 1.0 },
  { dur: 0.66, at: 0.21, cancel: 9, range: 2.2, lunge: 10, dmg: 11, push: 8, launch: 8.5, stun: 0.6, power: 2, wind: UPPER_WIND, hitPose: UPPER, height: 1.45 },
];
const HEAVY: Move = { dur: 0.74, at: 0.34, cancel: 9, range: 2.3, lunge: 13, dmg: 15, push: 15, launch: 5, stun: 0.7, power: 2.4, guardBreak: true, wind: SMASH_WIND, hitPose: SMASH, height: 1.25 };

export const ARENA_RADIUS = 16.5;
const SPEED = 6.4;
const GRAVITY = 24;
const BLAST_COST = 20;
const ULT_CINE = 1.0;
const ULT_END = 2.3;
const ULT_TICKS = 10;

/** What a fighter needs from the match around it. */
export interface Match {
  fx: Fx;
  sfx: Sfx;
  projectiles: Projectile[];
  hitstop(seconds: number): void;
  shake(amount: number): void;
  lines(seconds: number): void;
  ultBanner(by: Fighter): void;
  landed(by: Fighter, on: Fighter, result: 'hit' | 'block', strike: Strike): void;
  add(node: Object3D): void;
  remove(node: Object3D): void;
}

const turnToward = (from: number, to: number, max: number): number => {
  const delta = ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return from + Math.max(-max, Math.min(max, delta));
};

const scratch = new Vector3();
const scratchB = new Vector3();

export class Fighter {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  hp = 100;
  energy = 30;
  state: State = 'idle';
  stateT = 0;
  invuln = 0;
  dead = false;
  /** Which hit of the combo is playing; -1 is the heavy blow. */
  step = 0;
  moving = false;
  airborne = false;
  private struck = false;
  private queued: '' | 'light' | 'heavy' = '';
  private dashCd = 0;
  private stun = 0;
  private fired = false;
  private readonly dashDir = new Vector3();
  private readonly ultDir = new Vector3();
  private ultTicks = 0;
  private ultTimer = 0;
  private beam: Beam | null = null;
  private animT = 0;
  private auraT = 0;
  private chargeSound = 0;
  private readonly aura: Sprite;

  constructor(readonly def: CharDef, readonly rig: Rig) {
    this.aura = makeGlow(def.color, 0);
    this.aura.position.y = 1;
    this.aura.scale.set(3.2, 4.4, 1);
    rig.root.add(this.aura);
  }

  get move(): Move {
    return this.step < 0 ? HEAVY : COMBO[this.step];
  }

  /** True while a swing is on its way but has not landed yet: what an opponent might want to block. */
  get threatening(): boolean {
    return this.state === 'attack' && !this.struck;
  }

  get forward(): Vector3 {
    return scratchB.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  reset(x: number, z: number, yaw: number, match: Match | null): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = 100;
    this.energy = 30;
    this.dead = false;
    this.invuln = 0;
    this.airborne = false;
    this.moving = false;
    this.set('idle');
    this.endBeam(match);
    this.rig.snap();
    this.rig.face('neutral');
  }

  private set(state: State): void {
    this.state = state;
    this.stateT = 0;
  }

  private endBeam(match: Match | null): void {
    if (this.beam && match) match.remove(this.beam.group);
    this.beam = null;
  }

  celebrate(match: Match): void {
    if (this.state === 'win' || this.dead) return;
    this.endBeam(match);
    this.vel.set(0, 0, 0);
    this.set('win');
  }

  private startAttack(step: number, foe: Fighter, match: Match): void {
    this.set('attack');
    this.step = step;
    this.struck = false;
    this.queued = '';
    this.yaw = Math.atan2(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
    match.sfx.swing();
  }

  update(dt: number, inp: Intent, foe: Fighter, match: Match): void {
    this.stateT += dt;
    this.invuln -= dt;
    this.dashCd -= dt;
    const dx = foe.pos.x - this.pos.x;
    const dz = foe.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const foeYaw = Math.atan2(dx, dz);
    const t = this.stateT;
    this.moving = false;

    switch (this.state) {
      case 'idle': {
        const grounded = !this.airborne;
        if (grounded && inp.ult && this.energy >= 100) {
          this.energy = 0;
          this.set('ult');
          this.ultTicks = 0;
          this.ultTimer = 0;
          this.vel.set(0, 0, 0);
          match.ultBanner(this);
          match.sfx.ultStart();
          break;
        }
        if (grounded && inp.light) return this.startAttack(0, foe, match);
        if (grounded && inp.heavy) return this.startAttack(-1, foe, match);
        if (grounded && inp.blast && this.energy >= BLAST_COST) {
          this.energy -= BLAST_COST;
          this.fired = false;
          this.yaw = foeYaw;
          this.vel.set(0, 0, 0);
          this.set('blast');
          break;
        }
        if (inp.dash && this.dashCd <= 0) {
          const length = Math.hypot(inp.mx, inp.mz);
          // With no direction held, a dash slips to the side of the opponent.
          if (length > 0.2) this.dashDir.set(inp.mx / length, 0, inp.mz / length);
          else this.dashDir.set(Math.cos(foeYaw), 0, -Math.sin(foeYaw));
          this.set('dash');
          this.invuln = 0.24;
          this.dashCd = 0.55;
          match.sfx.dash();
          break;
        }
        if (grounded && inp.guard) {
          this.vel.set(0, 0, 0);
          this.set('guard');
          break;
        }
        if (grounded && inp.charge) {
          this.vel.set(0, 0, 0);
          this.set('charge');
          break;
        }
        if (grounded && inp.jump) {
          this.vel.y = 9.5;
          this.airborne = true;
        }
        const length = Math.hypot(inp.mx, inp.mz);
        if (length > 0.15) {
          this.vel.x = (inp.mx / Math.max(1, length)) * SPEED;
          this.vel.z = (inp.mz / Math.max(1, length)) * SPEED;
          this.yaw = turnToward(this.yaw, Math.atan2(inp.mx, inp.mz), dt * 16);
          this.moving = true;
        } else {
          this.vel.x = this.vel.z = 0;
          this.yaw = turnToward(this.yaw, foeYaw, dt * 12);
        }
        break;
      }
      case 'attack': {
        const move = this.move;
        if (inp.light) this.queued = 'light';
        if (inp.heavy) this.queued = 'heavy';
        if (t < move.at) {
          // Close the gap before the blow lands, without running through the opponent.
          const gap = dist - 1.15;
          const speed = gap > 0 && dist < 7 ? Math.min(move.lunge, gap / Math.max(0.02, move.at - t)) : 0;
          this.yaw = turnToward(this.yaw, foeYaw, dt * 20);
          this.vel.x = Math.sin(this.yaw) * speed;
          this.vel.z = Math.cos(this.yaw) * speed;
        } else {
          this.vel.x *= Math.exp(-dt * 14);
          this.vel.z *= Math.exp(-dt * 14);
        }
        if (!this.struck && t >= move.at) {
          this.struck = true;
          const facing = Math.cos(foeYaw - this.yaw);
          if (dist < move.range && facing > 0.4 && foe.pos.y < 2.2) foe.takeHit(this, move, match);
        }
        if (this.struck && t >= move.cancel) {
          if (this.queued === 'light' && this.step >= 0 && this.step < COMBO.length - 1) return this.startAttack(this.step + 1, foe, match);
          if (this.queued === 'heavy' && this.step >= 0) return this.startAttack(-1, foe, match);
          if (inp.dash && this.dashCd <= 0) {
            this.set('idle');
            return this.update(0, inp, foe, match);
          }
        }
        if (t >= move.dur) this.set('idle');
        break;
      }
      case 'dash': {
        const k = Math.max(0, 1 - t / 0.28);
        this.vel.x = this.dashDir.x * 19 * (0.35 + 0.65 * k);
        this.vel.z = this.dashDir.z * 19 * (0.35 + 0.65 * k);
        this.yaw = turnToward(this.yaw, Math.atan2(this.dashDir.x, this.dashDir.z), dt * 30);
        scratch.copy(this.pos).setY(this.pos.y + 0.4 + Math.random() * 1.2);
        match.fx.mote(scratch, 0, 0, 0, this.def.color, 0.5, 0.22);
        if (t >= 0.28) this.set('idle');
        break;
      }
      case 'guard': {
        this.vel.x = this.vel.z = 0;
        this.yaw = turnToward(this.yaw, foeYaw, dt * 14);
        if (inp.light) return this.startAttack(0, foe, match);
        if (inp.dash && this.dashCd <= 0) {
          this.set('idle');
          return this.update(0, inp, foe, match);
        }
        if (!inp.guard && t > 0.12) this.set('idle');
        break;
      }
      case 'charge': {
        this.yaw = turnToward(this.yaw, foeYaw, dt * 10);
        this.energy = Math.min(100, this.energy + dt * 32);
        this.chargeSound -= dt;
        if (this.chargeSound <= 0) {
          this.chargeSound = 0.2;
          match.sfx.charge();
        }
        if (!inp.charge && t > 0.15) this.set('idle');
        break;
      }
      case 'hit': {
        this.vel.x *= Math.exp(-dt * 7);
        this.vel.z *= Math.exp(-dt * 7);
        if (t >= this.stun) this.set('idle');
        break;
      }
      case 'launched': {
        if (this.pos.y <= 0 && this.vel.y <= 0 && t > 0.05) {
          const strong = this.vel.y < -9 || Math.hypot(this.vel.x, this.vel.z) > 7;
          match.fx.slam(this.pos, strong || this.dead);
          match.sfx.slam();
          match.shake(strong ? 0.45 : 0.25);
          this.vel.set(this.vel.x * 0.3, 0, this.vel.z * 0.3);
          this.set('down');
        }
        break;
      }
      case 'down': {
        this.vel.x *= Math.exp(-dt * 6);
        this.vel.z *= Math.exp(-dt * 6);
        if (!this.dead && t >= 0.7) {
          this.set('getup');
          this.invuln = 0.75;
        }
        break;
      }
      case 'getup': {
        this.vel.x = this.vel.z = 0;
        this.yaw = turnToward(this.yaw, foeYaw, dt * 8);
        if (t >= 0.35) this.set('idle');
        break;
      }
      case 'blast': {
        this.yaw = turnToward(this.yaw, foeYaw, dt * 14);
        if (!this.fired && t >= 0.16) {
          this.fired = true;
          const from = this.rig.bonePosition('rightHand', new Vector3()).addScaledVector(this.forward, 0.3);
          match.projectiles.push(new Projectile(this, foe, from, match));
          match.sfx.blast();
          match.fx.flash('glow', from, this.def.hot, 0.6, 2, 0.18);
        }
        if (t >= 0.5) this.set('idle');
        break;
      }
      case 'ult': {
        this.vel.set(0, 0, 0);
        this.invuln = 0.1;
        if (t < ULT_CINE) {
          this.yaw = turnToward(this.yaw, foeYaw, dt * 12);
          break;
        }
        if (!this.beam) {
          this.beam = new Beam(this.def.color, this.def.hot);
          match.add(this.beam.group);
          this.ultDir.set(dist > 0.3 ? dx / dist : Math.sin(this.yaw), 0, dist > 0.3 ? dz / dist : Math.cos(this.yaw));
          this.yaw = Math.atan2(this.ultDir.x, this.ultDir.z);
          match.sfx.beam();
          match.shake(0.6);
          match.lines(1.2);
        }
        const k = Math.min(1, (t - ULT_CINE) / (ULT_END - ULT_CINE));
        const envelope = Math.min(1, k * 9) * (k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1);
        const origin = scratch.copy(this.pos).addScaledVector(this.ultDir, 0.9).setY(1.25);
        this.beam.set(origin, this.ultDir, 36, 1.15 * envelope * (0.88 + Math.random() * 0.24) + 0.001);
        for (let n = 0; n < 5; n++) {
          const along = Math.random() * 30;
          const p = new Vector3().copy(origin).addScaledVector(this.ultDir, along);
          p.x += (Math.random() - 0.5) * 2;
          p.y += (Math.random() - 0.5) * 2;
          p.z += (Math.random() - 0.5) * 2;
          match.fx.mote(p, this.ultDir.x * 14, Math.random() * 2, this.ultDir.z * 14, n % 2 ? this.def.hot : this.def.color, 0.35, 0.4);
        }
        match.shake(0.1);
        this.ultTimer -= dt;
        if (this.ultTimer <= 0 && this.ultTicks < ULT_TICKS && k < 0.9) {
          this.ultTimer = 0.085;
          this.ultTicks += 1;
          const along = dx * this.ultDir.x + dz * this.ultDir.z;
          const off = Math.hypot(dx - this.ultDir.x * along, dz - this.ultDir.z * along);
          if (along > 0.2 && along < 36 && off < 1.7 && foe.pos.y < 3.2) {
            const last = this.ultTicks === ULT_TICKS;
            foe.takeHit(this, last ? { dmg: 13, push: 16, launch: 7.5, stun: 0.6, power: 3 } : { dmg: 3, push: 5, stun: 0.4, power: 1.4 }, match);
          }
        }
        if (t >= ULT_END) {
          this.endBeam(match);
          this.set('idle');
        }
        break;
      }
      case 'win': {
        this.vel.x = this.vel.z = 0;
        break;
      }
    }

    // Gravity acts whenever the fighter is off the floor, whatever they are doing.
    if (this.pos.y > 0 || this.vel.y > 0) {
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        if (this.state !== 'launched') this.vel.y = 0;
        this.airborne = false;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const out = Math.hypot(this.pos.x, this.pos.z);
    if (out > ARENA_RADIUS) {
      this.pos.x *= ARENA_RADIUS / out;
      this.pos.z *= ARENA_RADIUS / out;
    }
    if (this.energy >= 100) this.energy = 100;
  }

  /** Keeps two standing fighters from walking through each other. */
  separate(foe: Fighter): void {
    if (this.pos.y > 1.2 || foe.pos.y > 1.2) return;
    const dx = foe.pos.x - this.pos.x;
    const dz = foe.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const min = 0.95;
    if (dist >= min || dist < 0.0001) return;
    const push = (min - dist) / 2;
    this.pos.x -= (dx / dist) * push;
    this.pos.z -= (dz / dist) * push;
    foe.pos.x += (dx / dist) * push;
    foe.pos.z += (dz / dist) * push;
  }

  takeHit(from: Fighter, strike: Strike, match: Match): 'hit' | 'block' | 'miss' {
    if (this.dead || this.invuln > 0 || this.state === 'down' || this.state === 'getup' || this.state === 'win') return 'miss';
    let dx = this.pos.x - from.pos.x;
    let dz = this.pos.z - from.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    const at = new Vector3(this.pos.x - dx * 0.35, this.pos.y + (strike.height ?? 1.2), this.pos.z - dz * 0.35);
    const facing = -(dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw));
    if (this.state === 'guard' && facing > 0.2 && !strike.guardBreak) {
      this.hp = Math.max(1, this.hp - strike.dmg * 0.15);
      this.vel.x = dx * strike.push * 0.45;
      this.vel.z = dz * strike.push * 0.45;
      this.energy = Math.min(100, this.energy + strike.dmg * 0.5);
      match.fx.block(at);
      match.sfx.block();
      match.hitstop(0.03);
      match.landed(from, this, 'block', strike);
      return 'block';
    }
    const crushed = this.state === 'guard' && !!strike.guardBreak;
    this.hp = Math.max(0, this.hp - strike.dmg);
    this.energy = Math.min(100, this.energy + strike.dmg * 0.7);
    from.energy = Math.min(100, from.energy + strike.dmg * 1.3);
    this.endBeam(match);
    this.vel.x = dx * strike.push;
    this.vel.z = dz * strike.push;
    if (this.hp <= 0) {
      this.dead = true;
      this.vel.x = dx * Math.max(9, strike.push);
      this.vel.z = dz * Math.max(9, strike.push);
      this.vel.y = Math.max(7, strike.launch ?? 0);
      this.set('launched');
    } else if (strike.launch || this.state === 'launched' || this.pos.y > 0.2) {
      this.vel.y = strike.launch ?? 4.5;
      this.set('launched');
    } else {
      this.stun = strike.stun + (crushed ? 0.35 : 0);
      this.set('hit');
    }
    this.airborne = false;
    match.fx.hit(at, from.def.color, from.def.hot, strike.power);
    match.sfx.hit(strike.power);
    match.hitstop(this.dead ? 0.3 : 0.035 + strike.power * 0.03);
    match.shake(0.1 + strike.power * 0.12);
    if (strike.power >= 2 || this.dead) match.lines(0.25);
    match.landed(from, this, 'hit', strike);
    return 'hit';
  }

  /** Poses the body for this frame. Runs even while the world is frozen, with dt 0. */
  animate(dt: number, match: Match): void {
    this.animT += dt;
    const anim: Anim = { clip: 'Idle_Loop', time: this.animT, pose: null, rate: 15, tilt: 0, lift: 0 };
    let glow = this.energy >= 100 ? 0.22 + Math.sin(this.animT * 9) * 0.06 : 0;
    let aura = this.energy >= 100 ? 14 : 0;
    let face: 'neutral' | 'angry' | 'sad' | 'happy' = 'neutral';
    const t = this.stateT;
    switch (this.state) {
      case 'idle':
        if (this.airborne) {
          anim.clip = 'Jump_Loop';
          anim.time = Math.min(1.4, 0.3 + t);
        } else if (this.moving) {
          anim.clip = 'Jog_Fwd_Loop';
          anim.time = this.animT * 1.25;
        } else anim.pose = STANCE;
        break;
      case 'attack': {
        const move = this.move;
        anim.rate = 34;
        anim.pose = t < move.at * 0.55 ? move.wind : t < move.at + 0.16 ? move.hitPose : STANCE;
        if (this.step === 3 && t > move.at && t < move.at + 0.25) anim.lift = 0.25;
        face = 'angry';
        break;
      }
      case 'dash':
        anim.clip = 'Sprint_Loop';
        anim.time = this.animT * 1.6;
        anim.pose = DASH;
        anim.rate = 26;
        break;
      case 'guard':
        anim.pose = GUARD;
        anim.rate = 30;
        break;
      case 'charge':
        anim.pose = CHARGE;
        glow = 0.55 + Math.sin(this.animT * 22) * 0.12;
        aura = 110;
        face = 'angry';
        break;
      case 'hit':
        anim.clip = 'Hit_Chest';
        anim.time = Math.min(0.3, t * 0.8);
        anim.rate = 30;
        anim.tilt = -0.18;
        face = 'sad';
        break;
      case 'launched':
        anim.pose = FLAIL;
        anim.tilt = -1.15;
        anim.rate = 20;
        face = 'sad';
        break;
      case 'down':
        anim.pose = LYING;
        anim.tilt = -Math.PI / 2;
        anim.lift = -0.72;
        anim.rate = 20;
        face = 'sad';
        break;
      case 'getup':
        anim.pose = CHARGE;
        anim.rate = 10;
        break;
      case 'blast':
        anim.clip = 'Spell_Simple_Shoot';
        anim.time = t;
        anim.rate = 30;
        face = 'angry';
        break;
      case 'ult':
        anim.pose = t < ULT_CINE * 0.8 ? CHARGE : FIRE;
        anim.rate = 22;
        glow = 0.8;
        aura = 160;
        face = 'angry';
        break;
      case 'win':
        anim.pose = WIN;
        anim.rate = 8;
        face = 'happy';
        break;
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.face(face, this.dead);
    this.rig.update(dt, anim);
    this.aura.material.opacity += (glow - this.aura.material.opacity) * Math.min(1, dt * 12 + 0.02);

    // Rising motes of the fighter's own light.
    this.auraT += aura * dt;
    while (this.auraT > 1) {
      this.auraT -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.5;
      scratch.set(this.pos.x + Math.cos(a) * r, this.pos.y + Math.random() * 1.3, this.pos.z + Math.sin(a) * r);
      match.fx.mote(scratch, Math.cos(a) * 0.6, 3 + Math.random() * 4, Math.sin(a) * 0.6, Math.random() < 0.4 ? this.def.hot : this.def.color, 0.16 + Math.random() * 0.2, 0.5 + Math.random() * 0.4, -3);
    }
  }
}

/** A ball of light thrown at the opponent, which bends a little toward them as it flies. */
export class Projectile {
  readonly pos = new Vector3();
  private readonly vel = new Vector3();
  private readonly glow: Sprite;
  private readonly core: Sprite;
  private life = 2.4;
  dead = false;

  constructor(readonly owner: Fighter, private readonly target: Fighter, from: Vector3, match: Match) {
    this.pos.copy(from);
    this.vel.copy(target.pos).setY(target.pos.y + 1.1).sub(from).normalize().multiplyScalar(21);
    this.glow = makeGlow(owner.def.color, 1);
    this.glow.scale.setScalar(2.2);
    this.core = makeGlow(owner.def.hot, 0.8);
    this.core.scale.setScalar(0.9);
    match.add(this.glow);
    match.add(this.core);
  }

  update(dt: number, match: Match): void {
    if (this.dead) return;
    this.life -= dt;
    const aim = scratch.copy(this.target.pos).setY(this.target.pos.y + 1.1).sub(this.pos);
    const distance = aim.length();
    // Steers gently, so a sidestep or a dash still gets out of the way.
    if (distance > 2.5) {
      aim.normalize().multiplyScalar(21);
      this.vel.lerp(aim, Math.min(1, dt * 1.6));
      this.vel.setLength(21);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.glow.position.copy(this.pos);
    this.core.position.copy(this.pos);
    this.glow.scale.setScalar(2.0 + Math.random() * 0.5);
    match.fx.mote(this.pos, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, this.owner.def.color, 0.4, 0.3);
    let spent = this.life <= 0 || this.pos.y < 0 || Math.hypot(this.pos.x, this.pos.z) > 30;
    if (!spent && distance < 1.0) {
      const result = this.target.takeHit(this.owner, { dmg: 8, push: 6, stun: 0.48, power: 1.6, height: 1.1 }, match);
      if (result !== 'miss') spent = true;
    }
    if (spent) this.end(match, true);
  }

  end(match: Match, burst: boolean): void {
    if (this.dead) return;
    this.dead = true;
    match.remove(this.glow);
    match.remove(this.core);
    if (burst) {
      match.fx.explosion(this.pos, this.owner.def.color, this.owner.def.hot, 0.7);
      match.sfx.explode();
    }
  }
}

export const ULT_CINE_TIME = ULT_CINE;
