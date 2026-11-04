import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3, type Camera } from 'three';
import { balance, type Element } from '../core/balance';
import { Boss, type BossHost } from '../enemies/boss';
import type { Reward } from '../exploration/progress';
import { ELEMENT_COLORS, Enemy } from '../enemies/enemy';
import { SPAWNS } from './spawns';
import { gapFactor, regionLevel, xpFactor } from '../enemies/levels';
import type { Actions } from '../input/actions';
import type { Party } from '../party/party';
import type { Player } from '../player/player';
import { terrainHeight } from '../world/terrain';
import { ATTACKS, CHARGE_AFTER, CHARGE_HOLD, CHARGE_TIME, CHARGED_LUNGE, CHARGED_STEP, COMBO_LENGTH, KNOCKBACK } from '../player/attackTable';
import { Fx } from './fx';
import { reactionOf, type Reaction } from './reactions';

const cfg = balance.combat;
const rx = balance.reactions;
/** Seconds the slash trail starts before the blade lands, so the sweep reads as the cause of the hit. */
const TRAIL_LEAD = 0.09;
const INPUT_BUFFER = 0.25;

export interface CombatEvents {
  damage(at: Vector3, amount: number, color: string): void;
  reaction(at: Vector3, reaction: Reaction): void;
  playerHurt(): void;
  elementArea(center: Vector3, radius: number, element: Element): void;
  impact(strength: number): void;
  swing(step: number): void;
  skill(): void;
  burst(): void;
  charge(stage: 'start' | 'full' | 'release'): void;
  defeated(at: Vector3, reward: Reward, kind: string): void;
  shake(strength: number): void;
  announce(textKey: string): void;
}

/** Anything the player's attacks can land on. */
export type Fighter = Enemy | Boss;

interface Projectile {
  mesh: Mesh;
  velocity: Vector3;
  damage: number;
  life: number;
}



const orb = new SphereGeometry(0.22, 10, 8);
const orbMaterial = new MeshBasicMaterial({ color: '#ff8fd0' });

export class Combat {
  readonly enemies: Fighter[];
  readonly boss: Boss;
  private readonly fx: Fx;
  private readonly projectiles: Projectile[] = [];
  private comboTimer = 0;
  private chargeClock = 0;
  private comboStep = 0;
  private inputBuffer = 0;
  /** The hit in flight: its trail and damage fire partway through the swing. */
  private strike: { step: number; trailed: boolean; landed: boolean; level: number } | null = null;
  /** Seconds the attack button has been down since it was pressed; negative locks charging out until it is let go. */
  private holdTime = 0;
  /** Seconds of power gathered, or -1 when not charging. */
  private charge = -1;
  private chargeFull = false;
  /** Seconds of hitstop still to play; the game loop freezes time for this long. */
  hitstop = 0;

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly party: Party,
    private readonly events: CombatEvents,
    bossDefeated = false,
  ) {
    this.fx = new Fx(scene);
    this.enemies = SPAWNS.map(([kind, x, z]) => {
      const enemy = new Enemy(kind, new Vector3(x, terrainHeight(x, z), z), regionLevel(x, z, kind));
      scene.add(enemy.view);
      return enemy;
    });
    const host: BossHost = {
      hurtPlayer: (amount) => {
        if (this.player.takeDamage(this.incoming(this.boss, amount))) this.events.playerHurt();
      },
      shoot: (from, velocity, damage) => this.launch(from, velocity, this.incoming(this.boss, damage)),
      burst: (at, radius, color, life) => this.fx.ring(at, radius, color, life),
      shake: (strength) => this.events.shake(strength),
      announce: (key) => this.events.announce(key),
    };
    this.boss = new Boss(bossDefeated, host, scene);
    scene.add(this.boss.view);
    this.enemies.push(this.boss);
  }

  update(dt: number, actions: Actions, camera: Camera): void {
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.comboStep = 0;

    if (this.player.alive) {
      // A tap starts the next hit of the combo; holding gathers a charge instead of repeating it.
      if (actions.attackPressed) {
        this.inputBuffer = INPUT_BUFFER;
        this.holdTime = 0;
      } else {
        this.inputBuffer = Math.max(0, this.inputBuffer - dt);
      }
      actions.attackPressed = false;
      this.holdTime = actions.attack ? this.holdTime + dt : 0;
      if (actions.skillPressed || actions.burstPressed) this.cancelCharge();
      this.updateCharge(dt, actions);
      this.updateSwing();
      if (actions.skillPressed) this.useSkill();
      if (actions.burstPressed) this.useBurst();
    }

    const playerLevel = this.playerLevel;
    for (const enemy of this.enemies) {
      if (enemy instanceof Enemy) enemy.setViewerLevel(playerLevel);
      const landed = enemy.update(dt, this.player.position, this.player.alive, camera);
      if (landed && enemy instanceof Enemy) this.enemyAttack(enemy);
      this.tickElectro(enemy, dt);
    }
    this.updateProjectiles(dt);
    this.fx.update(dt);
  }

  /** Starts the next hit once the current one has reached its chain point, then fires its trail and damage on cue. */
  private updateSwing(): void {
    const swing = this.player.swinging;
    if (this.strike && !swing) this.strike = null;
    const ready = !swing || swing.t >= ATTACKS[swing.step - 1].chainAt;
    if (this.inputBuffer > 0 && ready) this.beginAttack();

    const now = this.player.swinging;
    if (!this.strike || !now) return;
    const style = ATTACKS[this.strike.step - 1];
    if (!this.strike.trailed && now.t >= style.strikeAt - TRAIL_LEAD / style.duration) {
      this.strike.trailed = true;
      this.fx.slash(this.player.view, style.trail, ELEMENT_COLORS[this.party.active.element]);
    }
    if (!this.strike.landed && now.t >= style.strikeAt) {
      this.strike.landed = true;
      if (this.strike.step === CHARGED_STEP) this.landCharged(this.strike.level);
      else this.land(this.strike.step);
    }
  }

  /** Gathers power while the button stays down and unleashes it on release. */
  private updateCharge(dt: number, actions: Actions): void {
    const player = this.player;
    if (this.charge < 0) {
      if (actions.attack && this.holdTime >= CHARGE_AFTER && !player.swinging && player.canCharge) {
        this.charge = 0;
        this.chargeFull = false;
        this.inputBuffer = 0;
        this.faceNearest();
        this.events.charge('start');
      }
      return;
    }
    if (!player.canCharge) {
      this.cancelCharge();
      return;
    }
    if (!actions.attack) {
      this.release();
      return;
    }
    this.charge += dt;
    const level = Math.min(1, this.charge / CHARGE_TIME);
    player.chargeLevel = level;
    this.chargeClock += dt;
    this.fx.charging(player.position, ELEMENT_COLORS[this.party.active.element], level, dt, this.chargeClock);
    if (level >= 1 && !this.chargeFull) {
      this.chargeFull = true;
      this.fx.ring(player.position, 3.4, '#ffffff', 0.45);
      this.fx.scatter(player.position.clone().setY(player.position.y + 1), ELEMENT_COLORS[this.party.active.element], 14, 3, 2, 0.07, 0.6);
      this.events.charge('full');
    }
  }

  private cancelCharge(): void {
    if (this.charge < 0) return;
    this.charge = -1;
    this.holdTime = -999;
    this.player.chargeLevel = -1;
    this.fx.endCharge();
  }

  /** Lets go of the gathered power: the weapon swings, and its strike lands a moment later. */
  private release(): void {
    const level = Math.min(1, this.charge / CHARGE_TIME);
    this.charge = -1;
    this.player.chargeLevel = -1;
    this.fx.endCharge();
    const kind = this.party.active.weapon;
    this.faceNearest();
    this.player.whirl = kind === 'sword';
    this.player.startAttack(CHARGED_STEP, CHARGED_LUNGE[kind], CHARGE_HOLD);
    this.comboStep = 0;
    this.comboTimer = 0;
    this.events.swing(CHARGED_STEP);
    this.events.charge('release');
    this.strike = { step: CHARGED_STEP, trailed: true, landed: false, level };
  }

  private beginAttack(): void {
    this.inputBuffer = 0;
    this.comboStep = (this.comboStep % COMBO_LENGTH) + 1;
    const style = ATTACKS[this.comboStep - 1];
    this.comboTimer = style.duration + 0.35;
    const target = this.faceNearest();
    // Step in only as far as needed to reach a target; stop short of walking through it.
    const gap = target ? this.reach(target, this.player.position) : Infinity;
    const lungeScale = Number.isFinite(gap) ? Math.min(1, Math.max(0.15, (gap - 1.3) / style.lunge)) : 1;
    this.player.startAttack(this.comboStep, lungeScale * this.weapon.lunge);
    this.events.swing(this.comboStep);
    this.strike = { step: this.comboStep, trailed: false, landed: false, level: 0 };
  }

  private land(step: number): void {
    const style = ATTACKS[step - 1];
    const finisher = step === COMBO_LENGTH;
    const { active } = this.party;
    const damage = active.attack * style.damageScale * this.party.power;
    let hit = false;
    const struck: Fighter[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive || !this.inArc(enemy)) continue;
      struck.push(enemy);
      this.hit(enemy, damage, finisher ? active.element : null);
      enemy.push(this.player.position, KNOCKBACK[step - 1]);
      this.fx.spark(enemy.position.clone().setY(enemy.position.y + 0.9), ELEMENT_COLORS[active.element], finisher ? 0.6 : 0.35);
      hit = true;
    }
    // A staff's blow bursts outward, so everything near the target feels some of it.
    const { splash, splashRadius } = this.weapon;
    if (splash > 0 && struck.length > 0) {
      const centre = struck[0].position;
      this.fx.ring(centre, splashRadius, active.color, 0.28);
      for (const other of this.enemies) {
        if (!other.alive || struck.includes(other) || this.reach(other, centre) > splashRadius) continue;
        this.hit(other, damage * splash, null);
      }
    }
    if (hit) {
      this.hitstop = style.hitstop;
      this.events.impact(style.shake);
      this.party.gainEnergy(cfg.energyPerHit);
    }
    if (finisher) this.fx.ring(this.player.position, 2.6, active.color, 0.25);
  }

  /**
   * The charged strike. A sword whirls a ring of fire out round the player, a staff drops a pillar of water on the
   * target, and a spear runs a bolt of lightning down the line in front. Fuller charges hit harder and wider.
   */
  private landCharged(level: number): void {
    const { active } = this.party;
    const kind = active.weapon;
    const style = ATTACKS[CHARGED_STEP - 1];
    const power = 0.55 + 0.45 * level;
    const damage = active.attack * style.damageScale * power * this.party.power;
    const color = ELEMENT_COLORS[active.element];
    const origin = this.player.position;
    const forward = this.player.facing.clone().setY(0).normalize();
    const struck: Fighter[] = [];
    const lift = (point: Vector3, y: number): Vector3 => point.clone().setY(point.y + y);

    if (kind === 'sword') {
      const radius = 3.1 + level * 0.9;
      for (const enemy of this.enemies) {
        if (!enemy.alive || this.reach(enemy, origin) > radius) continue;
        struck.push(enemy);
        this.hit(enemy, damage, active.element);
        enemy.push(origin, 10);
        this.fx.spark(lift(enemy.position, 0.9), color, 0.8);
      }
      this.fx.ring(origin, radius, color, 0.5);
      this.fx.ring(origin, radius * 0.7, '#ffffff', 0.4);
      this.fx.ring(origin, radius * 1.2, color, 0.65);
      this.fx.scatter(lift(origin, 0.4), color, 14 + Math.round(level * 18), radius * 2.4, 4, 0.07, 0.8);
    } else if (kind === 'staff') {
      let centre = origin.clone().addScaledVector(forward, 4.6);
      let nearest = 8;
      for (const enemy of this.enemies) {
        const gap = enemy.alive ? this.reach(enemy, origin) : Infinity;
        if (gap < nearest) {
          nearest = gap;
          centre = enemy.position.clone();
        }
      }
      centre.y = terrainHeight(centre.x, centre.z);
      const radius = 3.2 + level;
      for (const enemy of this.enemies) {
        if (!enemy.alive || this.reach(enemy, centre) > radius) continue;
        struck.push(enemy);
        this.hit(enemy, damage, active.element);
        enemy.push(centre, 6);
      }
      this.fx.pillar(centre, radius * 0.5, 9, color, 0.7);
      this.fx.ring(centre, radius, color, 0.55);
      this.fx.ring(centre, radius * 0.55, '#ffffff', 0.4);
      this.fx.ring(centre, radius * 1.25, color, 0.75);
      this.fx.dome(lift(centre, 0.4), radius * 0.45, color, 0.3);
      this.fx.scatter(lift(centre, 0.4), color, 18 + Math.round(level * 20), radius * 2, 7, 0.07, 1);
    } else {
      const length = 6 + level * 1.5;
      const width = 1.15;
      const rel = new Vector3();
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        rel.subVectors(enemy.position, origin).setY(0);
        const along = rel.dot(forward);
        const side = rel.addScaledVector(forward, -along).length();
        if (along < -1 || along - enemy.radius > length || side - enemy.radius * 0.8 > width) continue;
        struck.push(enemy);
        this.hit(enemy, damage, active.element);
        enemy.push(origin, 8);
        this.fx.bolt(lift(enemy.position, 4), lift(enemy.position, 0.4), color, 0.3, 0.3);
      }
      const start = lift(origin, 1.1).addScaledVector(forward, 0.6);
      const end = lift(origin, 0.9).addScaledVector(forward, length);
      this.fx.bolt(start, end, color, 0.32, 0.4);
      this.fx.bolt(start, end, color, 0.24, 0.55);
      for (let i = 1; i <= 4; i++) {
        const spot = origin.clone().addScaledVector(forward, (length * i) / 4);
        this.fx.ring(spot, 1.1 + i * 0.12, color, 0.3 + i * 0.05);
      }
      this.fx.scatter(end, color, 16 + Math.round(level * 14), 5, 4, 0.09, 0.8);
      this.fx.pillar(end, 0.9, 8, color, 0.5);
    }

    this.hitstop = Math.max(this.hitstop, style.hitstop * (0.6 + 0.4 * level) + (struck.length > 0 ? 0.04 : 0));
    this.events.impact(style.shake * power);
    this.events.shake(0.1 + level * 0.12);
    if (struck.length > 0) this.party.gainEnergy(cfg.energyPerHit * (1 + struck.length * 0.5));
  }

  /** A ring of dust at the player's feet, for jumps, landings and dashes. */
  dust(radius: number): void {
    // Lifted a little so the ring sits over the grass tips instead of disappearing into them.
    this.fx.ring(this.player.position.clone().setY(this.player.position.y + 0.4), radius, '#c9bc98', 0.35);
  }

  private useSkill(): void {
    const i = this.party.activeIndex;
    if (this.party.skillCooldowns[i] > 0) return;
    const { skill, element, color } = this.party.active;
    this.party.skillCooldowns[i] = skill.cooldown;
    this.events.skill();
    this.faceNearest();
    const center = this.player.position.clone().addScaledVector(this.player.facing, 3);
    center.y = terrainHeight(center.x, center.z) + 0.4;
    this.fx.dome(center, skill.radius * 0.55, color, 0.3);
    this.skillFx(this.party.active.weapon, center, skill.radius, color);
    this.area(center, skill.radius, skill.damage * this.party.power, element);
  }

  /** A point scattered about a centre, within `radius`, standing on the ground. */
  private scatterPoint(centre: Vector3, radius: number): Vector3 {
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());
    const x = centre.x + Math.cos(angle) * r;
    const z = centre.z + Math.sin(angle) * r;
    return new Vector3(x, terrainHeight(x, z), z);
  }

  /** Each character's skill looks like its element: fire erupts, water wells up, thunder strikes from the sky. */
  private skillFx(kind: string, centre: Vector3, radius: number, color: string): void {
    const ground = centre.clone().setY(terrainHeight(centre.x, centre.z));
    this.fx.ring(ground, radius, color, 0.5);
    this.fx.ring(ground, radius * 0.6, '#ffffff', 0.35);
    if (kind === 'sword') {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const spot = new Vector3(ground.x + Math.cos(angle) * radius * 0.6, 0, ground.z + Math.sin(angle) * radius * 0.6);
        spot.y = terrainHeight(spot.x, spot.z);
        this.fx.after(0.04 * i, () => {
          this.fx.pillar(spot, 0.55, 4.5, color, 0.5);
          this.fx.scatter(spot.clone().setY(spot.y + 0.3), color, 6, 1.5, 4, 0.06, 0.7);
        });
      }
      this.fx.scatter(ground.clone().setY(ground.y + 0.4), color, 20, radius * 1.4, 5, 0.07, 0.9);
    } else if (kind === 'staff') {
      this.fx.ring(ground, radius * 1.2, color, 0.7);
      for (let i = 0; i < 4; i++) {
        const spot = this.scatterPoint(ground, radius * 0.7);
        this.fx.after(0.07 * i, () => {
          this.fx.pillar(spot, 0.7, 5, color, 0.55);
          this.fx.ring(spot, 1.3, color, 0.4);
        });
      }
      this.fx.scatter(ground.clone().setY(ground.y + 0.4), color, 24, radius * 1.2, 7, 0.07, 1);
    } else {
      for (let i = 0; i < 5; i++) {
        const spot = this.scatterPoint(ground, radius * 0.8);
        this.fx.after(0.06 * i, () => {
          this.fx.bolt(new Vector3(spot.x + (Math.random() - 0.5) * 2, spot.y + 11, spot.z + (Math.random() - 0.5) * 2), spot, color, 0.3, 0.6);
          this.fx.ring(spot, 1.2, color, 0.3);
          this.fx.scatter(spot.clone().setY(spot.y + 0.3), color, 6, 2.5, 3, 0.06, 0.5);
        });
      }
    }
  }

  /** The burst is the same idea at full size, and louder. */
  private burstFx(kind: string, centre: Vector3, radius: number, color: string): void {
    const ground = centre.clone().setY(terrainHeight(centre.x, centre.z));
    for (const [scale, wait, tint] of [[1, 0, color], [0.7, 0.08, '#ffffff'], [1.25, 0.16, color]] as const) {
      this.fx.after(wait, () => this.fx.ring(ground, radius * scale, tint, 0.6));
    }
    this.events.shake(0.3);
    if (kind === 'sword') {
      this.fx.pillar(ground, 2.2, 14, color, 0.9);
      for (let i = 0; i < 10; i++) {
        const spot = this.scatterPoint(ground, radius * 0.8);
        this.fx.after(0.05 * i, () => {
          this.fx.pillar(spot, 0.8, 7, color, 0.6);
          this.fx.scatter(spot.clone().setY(spot.y + 0.3), color, 5, 2, 5, 0.07, 0.8);
        });
      }
      this.fx.scatter(ground.clone().setY(ground.y + 0.5), color, 40, radius * 1.6, 8, 0.08, 1.1);
    } else if (kind === 'staff') {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spot = new Vector3(ground.x + Math.cos(angle) * radius * 0.65, 0, ground.z + Math.sin(angle) * radius * 0.65);
        spot.y = terrainHeight(spot.x, spot.z);
        this.fx.after(0.06 * i, () => {
          this.fx.pillar(spot, 1, 9, color, 0.7);
          this.fx.ring(spot, 2, color, 0.5);
        });
      }
      this.fx.pillar(ground, 1.8, 12, color, 0.9);
      this.fx.scatter(ground.clone().setY(ground.y + 0.5), color, 40, radius * 1.4, 9, 0.08, 1.2);
    } else {
      for (let i = 0; i < 12; i++) {
        const spot = this.scatterPoint(ground, radius * 0.85);
        this.fx.after(0.05 * i, () => {
          this.fx.bolt(new Vector3(spot.x + (Math.random() - 0.5) * 3, spot.y + 13, spot.z + (Math.random() - 0.5) * 3), spot, color, 0.35, 0.8);
          this.fx.ring(spot, 1.6, color, 0.4);
          this.fx.scatter(spot.clone().setY(spot.y + 0.3), color, 6, 3, 4, 0.07, 0.6);
        });
      }
      this.fx.pillar(ground, 1.4, 14, color, 0.8);
    }
  }

  private useBurst(): void {
    const i = this.party.activeIndex;
    if (this.party.energy[i] < cfg.energyMax) return;
    const { burst, element, color } = this.party.active;
    this.party.energy[i] = 0;
    this.events.burst();
    this.fx.dome(this.player.position, burst.radius * 0.5, color, 0.5);
    this.burstFx(this.party.active.weapon, this.player.position, burst.radius, color);
    this.area(this.player.position, burst.radius, burst.damage * this.party.power, element);
  }

  private area(center: Vector3, radius: number, damage: number, element: Element): void {
    this.events.elementArea(center, radius, element);
    for (const enemy of this.enemies) {
      if (enemy.alive && this.reach(enemy, center) <= radius) this.hit(enemy, damage, element);
    }
  }

  private hit(enemy: Fighter, base: number, element: Element | null): void {
    let damage = base;
    let color = element ? ELEMENT_COLORS[element] : '#ffffff';
    const reaction = element ? reactionOf(enemy.aura, element) : null;
    if (reaction) {
      enemy.setAura(null);
      enemy.breakArmor();
      color = '#ffe27a';
      if (reaction === 'vaporize') damage *= rx.vaporizeMultiplier;
      this.events.reaction(enemy.position, reaction);
    } else if (element) {
      enemy.setAura(element);
    }
    this.applyDamage(enemy, damage, color);
    if (reaction === 'overload') this.overload(enemy);
    if (reaction === 'electroCharged' && enemy.alive) {
      enemy.electroTicks = rx.electroTicks;
      enemy.electroTimer = rx.electroInterval;
    }
    this.hitstop = Math.max(this.hitstop, cfg.hitstop);
  }

  private applyDamage(enemy: Fighter, amount: number, color: string): void {
    const wasAlive = enemy.alive;
    const dealt = enemy.hurt(amount * gapFactor(this.playerLevel, enemy.level));
    if (wasAlive && !enemy.alive) {
      const shards = 'shards' in enemy.cfg ? Number(enemy.cfg.shards) : 0;
      // The killing blow lands harder: a longer freeze, a bigger shake and a burst of light.
      this.hitstop = Math.max(this.hitstop, enemy instanceof Boss ? 0.2 : 0.11);
      this.events.shake(enemy instanceof Boss ? 0.2 : 0.06);
      this.fx.ring(enemy.position, enemy instanceof Boss ? 3.5 : 1.6, color, 0.3);
      this.fx.spark(enemy.position.clone().setY(enemy.position.y + 0.9), color, enemy instanceof Boss ? 1.6 : 0.9);
      this.events.defeated(enemy.position, { coins: enemy.cfg.coins, shards, xp: Math.round(enemy.cfg.xp * xpFactor(this.playerLevel, enemy.level)) }, enemy instanceof Boss ? 'boss' : enemy.kind);
    }
    this.events.damage(enemy.position, Math.round(dealt), color);
  }

  private overload(source: Fighter): void {
    const center = source.position.clone();
    this.fx.dome(center.clone().setY(center.y + 0.6), rx.overloadRadius, ELEMENT_COLORS.fire, 0.45);
    for (const enemy of this.enemies) {
      if (!enemy.alive || this.reach(enemy, center) > rx.overloadRadius) continue;
      this.applyDamage(enemy, rx.overloadDamage, ELEMENT_COLORS.fire);
      enemy.push(center, rx.overloadKnockback);
    }
  }

  private tickElectro(enemy: Fighter, dt: number): void {
    if (enemy.electroTicks <= 0 || !enemy.alive) return;
    enemy.electroTimer -= dt;
    if (enemy.electroTimer > 0) return;
    enemy.electroTimer = rx.electroInterval;
    enemy.electroTicks--;
    this.applyDamage(enemy, rx.electroDamage, ELEMENT_COLORS.thunder);
    const jump = this.enemies.find(
      (other) =>
        other !== enemy && other.alive && other.position.distanceTo(enemy.position) <= rx.electroJumpRange,
    );
    if (jump) {
      this.applyDamage(jump, rx.electroDamage, ELEMENT_COLORS.thunder);
      this.fx.dome(jump.position.clone().setY(jump.position.y + 0.8), 0.9, ELEMENT_COLORS.thunder, 0.2);
    }
  }

  private inArc(enemy: Fighter): boolean {
    const to = new Vector3().subVectors(enemy.position, this.player.position).setY(0);
    if (to.length() - enemy.radius > this.weapon.range) return false;
    return to.length() - enemy.radius < 0.6 || to.normalize().angleTo(this.player.facing.clone().setY(0).normalize()) < this.weapon.arc;
  }

  /** Light auto-aim so attacks stay usable on touch screens. */
  /** Distance to the edge of a fighter rather than its centre, so a giant is not out of reach at arm's length. */
  private reach(enemy: Fighter, point: Vector3): number {
    return Math.max(0, enemy.position.distanceTo(point) - enemy.radius);
  }

  /** The level of whoever is in the field. */
  private get playerLevel(): number {
    return this.party.levels[this.party.activeIndex];
  }

  /** What a hit from `enemy` really costs the player, stronger from a higher-level enemy and weaker from a lower one. */
  private incoming(enemy: Fighter, amount: number): number {
    return amount * gapFactor(enemy.level, this.playerLevel);
  }

  /** The reach, sweep and side effects of the weapon in the active character's hand. */
  private get weapon() {
    return balance.weapons[this.party.active.weapon];
  }

  private faceNearest(): Fighter | null {
    let best: Fighter | null = null;
    let bestDistance = this.weapon.range + 3;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = this.reach(enemy, this.player.position);
      if (distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    if (best) this.player.facing.subVectors(best.position, this.player.position).setY(0).normalize();
    return best;
  }

  private enemyAttack(enemy: Enemy): void {
    if (enemy.kind === 'ranged') {
      const from = enemy.position.clone().setY(enemy.position.y + 1);
      const target = this.player.position.clone().setY(this.player.position.y + 0.9);
      const velocity = target.sub(from).normalize().multiplyScalar(enemy.cfg.projectileSpeed ?? 10);
      this.launch(from, velocity, this.incoming(enemy, enemy.cfg.damage));
      return;
    }
    const blast = enemy.cfg.attackRange * 1.3;
    const inReach = enemy.position.distanceTo(this.player.position) <= blast;
    if (enemy.kind === 'bomber') {
      this.fx.ring(enemy.position, blast, '#ffb070', 0.4);
      this.events.shake(0.25);
      enemy.explode();
    }
    if (inReach && this.player.takeDamage(this.incoming(enemy, enemy.cfg.damage))) this.events.playerHurt();
  }

  private launch(from: Vector3, velocity: Vector3, damage: number): void {
    const mesh = new Mesh(orb, orbMaterial);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, velocity, damage, life: 2.5 });
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i];
      shot.life -= dt;
      shot.mesh.position.addScaledVector(shot.velocity, dt);
      const body = this.player.position.clone().setY(this.player.position.y + 0.9);
      const touching = shot.mesh.position.distanceTo(body) < 0.9;
      if (touching && this.player.takeDamage(shot.damage)) this.events.playerHurt();
      if (touching || shot.life <= 0) {
        this.scene.remove(shot.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
