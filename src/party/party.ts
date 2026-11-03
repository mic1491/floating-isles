import { balance, type CharacterDef } from '../core/balance';
import { benchShare, damageScale, levelOf, type LevelInfo } from './growth';

export class Party {
  readonly members: CharacterDef[] = balance.characters;
  readonly skillCooldowns = this.members.map(() => 0);
  readonly energy = this.members.map(() => 0);
  activeIndex: number;
  private switchCooldown = 0;

  /** Experience each character has earned. */
  readonly xp: number[];
  /** Their levels, kept in step with `xp`. */
  readonly levels: number[];

  constructor(activeIndex: number, xp: number[] = []) {
    this.activeIndex = Math.min(activeIndex, this.members.length - 1);
    this.xp = this.members.map((_, i) => Math.max(0, Math.floor(Number(xp[i]) || 0)));
    this.levels = this.xp.map((value) => levelOf(value).level);
  }

  info(index: number): LevelInfo {
    return levelOf(this.xp[index]);
  }

  /** Shares out experience: the one in the field gets all of it, the rest half. Returns who levelled up. */
  gainXp(amount: number): Array<{ index: number; level: number }> {
    const ups: Array<{ index: number; level: number }> = [];
    this.xp.forEach((value, i) => {
      this.xp[i] = value + (i === this.activeIndex ? amount : benchShare(amount));
      const level = levelOf(this.xp[i]).level;
      if (level > this.levels[i]) ups.push({ index: i, level });
      this.levels[i] = level;
    });
    return ups;
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
