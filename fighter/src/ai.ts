import { noIntent, type Fighter, type Intent, type Projectile } from './fighter';

const LEVELS = [
  { react: 0.42, guard: 0.18, push: 0.45, chain: 0.5, rest: 0.9 },
  { react: 0.26, guard: 0.42, push: 0.72, chain: 0.8, rest: 0.45 },
  { react: 0.15, guard: 0.7, push: 0.92, chain: 0.96, rest: 0.15 },
];

/** The opponent's mind: looks at the fight a few times a second and decides what to press. */
export class Ai {
  private wait = 0.6;
  private planUntil = 0;
  private plan: { mx: number; mz: number; guard: boolean; charge: boolean } = { mx: 0, mz: 0, guard: false, charge: false };
  private clock = 0;

  constructor(public level: number) {}

  private hold(seconds: number, plan: Partial<Ai['plan']>): void {
    this.plan = { mx: 0, mz: 0, guard: false, charge: false, ...plan };
    this.planUntil = this.clock + seconds;
  }

  think(dt: number, me: Fighter, foe: Fighter, projectiles: Projectile[]): Intent {
    const cfg = LEVELS[this.level];
    this.clock += dt;
    this.wait -= dt;
    const out = noIntent();
    const dx = foe.pos.x - me.pos.x;
    const dz = foe.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const tx = dx / dist;
    const tz = dz / dist;
    const side = Math.sin(this.clock * 0.7) > 0 ? 1 : -1;

    if (this.wait <= 0) {
      this.wait = cfg.react * (0.7 + Math.random() * 0.6);
      const roll = Math.random();
      const incoming = projectiles.some((p) => p.owner === foe && !p.dead && p.pos.distanceTo(me.pos) < 8);
      const beamed = foe.state === 'ult';
      if (me.state === 'attack') {
        // Mid-combo: keep the hits coming, and sometimes end on the heavy blow.
        if (roll < cfg.chain) {
          if (me.step === 2 && Math.random() < 0.25) out.heavy = true;
          else out.light = true;
        }
        this.wait = 0.12;
        if (me.step === 3 || me.step === -1) this.wait = cfg.rest + 0.3;
      } else if (beamed && roll < cfg.guard + 0.2) {
        out.dash = true;
        out.mx = -tz * side;
        out.mz = tx * side;
      } else if (foe.threatening && dist < 3.4 && roll < cfg.guard) {
        if (Math.random() < 0.3) {
          out.dash = true;
          out.mx = -tz * side;
          out.mz = tx * side;
        } else this.hold(0.45, { guard: true });
      } else if (incoming && roll < cfg.guard + 0.15) {
        if (Math.random() < 0.5) this.hold(0.5, { guard: true });
        else {
          out.dash = true;
          out.mx = -tz * side;
          out.mz = tx * side;
        }
      } else if (me.energy >= 100 && dist < 15 && foe.state !== 'down' && foe.state !== 'getup' && roll < 0.3 + cfg.push * 0.4) {
        out.ult = true;
      } else if (dist < 2.4) {
        if (foe.state === 'guard' && roll < cfg.push * 0.6) out.heavy = true;
        else if (roll < cfg.push) out.light = true;
        else if (roll < cfg.push + 0.15) this.hold(0.4, { guard: true });
        else this.hold(0.35, { mx: -tx, mz: -tz });
      } else if (dist < 7) {
        if (roll < 0.12 * cfg.push) {
          out.dash = true;
          out.mx = tx;
          out.mz = tz;
        } else if (roll < 0.2 + cfg.push * 0.75) this.hold(0.3, { mx: tx - tz * side * 0.25, mz: tz + tx * side * 0.25 });
        else this.hold(0.4, { mx: -tz * side, mz: tx * side });
      } else if (roll < 0.3 && me.energy >= 20) {
        out.blast = true;
        this.wait = 0.7;
      } else if (roll < 0.55 && me.energy < 80) {
        this.hold(0.9, { charge: true });
        this.wait = 0.9;
      } else this.hold(0.4, { mx: tx, mz: tz });
    }

    if (this.clock < this.planUntil) {
      out.mx ||= this.plan.mx;
      out.mz ||= this.plan.mz;
      out.guard = this.plan.guard;
      out.charge = this.plan.charge;
      // Drop the charge the moment the opponent gets close.
      if (out.charge && dist < 4.5) this.planUntil = 0;
    }
    return out;
  }
}
