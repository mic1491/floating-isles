import { balance } from '../core/balance';

const cfg = balance.stamina;

export class Stamina {
  value = cfg.max;
  private idle = 0;

  get ratio(): number {
    return this.value / cfg.max;
  }

  get empty(): boolean {
    return this.value <= 0;
  }

  /** Spends a fixed cost, or spends nothing and returns false when short. */
  spend(cost: number): boolean {
    if (this.value < cost) return false;
    this.value -= cost;
    this.idle = 0;
    return true;
  }

  /** Drains over time, clamped at zero. */
  drain(amount: number): void {
    this.value = Math.max(0, this.value - amount);
    this.idle = 0;
  }

  update(dt: number): void {
    this.idle += dt;
    if (this.idle >= cfg.regenDelay) {
      this.value = Math.min(cfg.max, this.value + cfg.regenPerSecond * dt);
    }
  }
}
