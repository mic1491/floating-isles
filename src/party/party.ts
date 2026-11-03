import { balance, type CharacterDef } from '../core/balance';
import { damageScale } from './growth';

export class Party {
  readonly members: CharacterDef[] = balance.characters;
  readonly skillCooldowns = this.members.map(() => 0);
  readonly energy = this.members.map(() => 0);
  activeIndex: number;
  private switchCooldown = 0;

  readonly levels: number[];

  constructor(activeIndex: number, levels: number[] = []) {
    this.activeIndex = Math.min(activeIndex, this.members.length - 1);
    this.levels = this.members.map((_, i) => Math.max(1, Math.min(balance.growth.maxLevel, Math.floor(levels[i] ?? 1))));
  }

  /** Damage multiplier of whoever is in the field. */
  get power(): number {
    return damageScale(this.levels[this.activeIndex]);
  }

  get active(): CharacterDef {
    return this.members.at(this.activeIndex)!;
  }

  get switchRemaining(): number {
    return this.switchCooldown;
  }

  trySwitch(index: number): boolean {
    if (index === this.activeIndex || this.switchCooldown > 0) return false;
    this.activeIndex = index;
    this.switchCooldown = balance.party.switchCooldown;
    return true;
  }

  gainEnergy(amount: number): void {
    this.energy[this.activeIndex] = Math.min(balance.combat.energyMax, this.energy[this.activeIndex] + amount);
  }

  update(dt: number): void {
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    this.skillCooldowns.forEach((value, i) => {
      this.skillCooldowns[i] = Math.max(0, value - dt);
    });
  }
}
