import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3, type Camera } from 'three';
import { balance, type Element } from '../core/balance';
import { ELEMENT_COLORS, Enemy, type EnemyKind } from '../enemies/enemy';
import type { Actions } from '../input/actions';
import type { Party } from '../party/party';
import type { Player } from '../player/player';
import { terrainHeight } from '../world/terrain';
import { ATTACKS, COMBO_LENGTH } from '../player/attackTable';
import { Fx } from './fx';
import { reactionOf, type Reaction } from './reactions';

const cfg = balance.combat;
const rx = balance.reactions;
/** Seconds the slash trail starts before the blade lands, so the sweep reads as the cause of the hit. */
const TRAIL_LEAD = 0.09;
const INPUT_BUFFER = 0.25;
const KNOCKBACK = [2.5, 2.5, 4.5, 9];

export interface CombatEvents {
  damage(at: Vector3, amount: number, color: string): void;
  reaction(at: Vector3, reaction: Reaction): void;
  playerHurt(): void;
  elementArea(center: Vector3, radius: number, element: Element): void;
  impact(strength: number): void;
  swing(step: number): void;
  skill(): void;
  burst(): void;
}

interface Projectile {
  mesh: Mesh;
  velocity: Vector3;
  damage: number;
  life: number;
}

const SPAWNS: Array<[EnemyKind, number, number]> = [
  ['melee', 18, 12],
  ['melee', 21, 9],
  ['melee', -10, 26],
  ['melee', -26, -14],
  ['ranged', 30, -2],
  ['ranged', -18, 24],
  ['melee', -86, -50],
  ['melee', -96, -62],
  ['ranged', -84, -64],
  ['melee', 98, -2],
  ['ranged', 108, -14],
];

const orb = new SphereGeometry(0.22, 10, 8);
const orbMaterial = new MeshBasicMaterial({ color: '#ff8fd0' });

export class Combat {
  readonly enemies: Enemy[];
  private readonly fx: Fx;
  private readonly projectiles: Projectile[] = [];
  private comboTimer = 0;
  private comboStep = 0;
  private inputBuffer = 0;
  /** The hit in flight: its trail and damage fire partway through the swing. */
  private strike: { step: number; trailed: boolean; landed: boolean } | null = null;
  /** Seconds of hitstop still to play; the game loop freezes time for this long. */
  hitstop = 0;

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly party: Party,
    private readonly events: CombatEvents,
  ) {
    this.fx = new Fx(scene);
    this.enemies = SPAWNS.map(([kind, x, z]) => {
      const enemy = new Enemy(kind, new Vector3(x, terrainHeight(x, z), z));
      scene.add(enemy.view);
      return enemy;
    });
  }

  update(dt: number, actions: Actions, camera: Camera): void {
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.comboStep = 0;

    if (this.player.alive) {
      this.inputBuffer = actions.attack ? INPUT_BUFFER : Math.max(0, this.inputBuffer - dt);
      this.updateSwing();
      if (actions.skillPressed) this.useSkill();
      if (actions.burstPressed) this.useBurst();
    }

    for (const enemy of this.enemies) {
      const landed = enemy.update(dt, this.player.position, this.player.alive, camera);
      if (landed) this.enemyAttack(enemy);
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
      this.land(this.strike.step);
    }
  }

  private beginAttack(): void {
    this.inputBuffer = 0;
    this.comboStep = (this.comboStep % COMBO_LENGTH) + 1;
    const style = ATTACKS[this.comboStep - 1];
    this.comboTimer = style.duration + 0.35;
    const target = this.faceNearest();
    // Step in only as far as needed to reach a target; stop short of walking through it.
    const gap = target ? target.position.distanceTo(this.player.position) : Infinity;
    const lungeScale = Number.isFinite(gap) ? Math.min(1, Math.max(0.15, (gap - 1.3) / style.lunge)) : 1;
    this.player.startAttack(this.comboStep, lungeScale);
    this.events.swing(this.comboStep);
    this.strike = { step: this.comboStep, trailed: false, landed: false };
  }

  private land(step: number): void {
    const style = ATTACKS[step - 1];
    const finisher = step === COMBO_LENGTH;
    const { active } = this.party;
    const damage = active.attack * style.damageScale * this.party.power;
    let hit = false;
    for (const enemy of this.enemies) {
      if (!enemy.alive || !this.inArc(enemy)) continue;
      this.hit(enemy, damage, finisher ? active.element : null);
      enemy.push(this.player.position, KNOCKBACK[step - 1]);
      this.fx.spark(enemy.position.clone().setY(enemy.position.y + 0.9), ELEMENT_COLORS[active.element], finisher ? 0.6 : 0.35);
      hit = true;
    }
    if (hit) {
      this.hitstop = style.hitstop;
      this.events.impact(style.shake);
      this.party.gainEnergy(cfg.energyPerHit);
    }
    if (finisher) this.fx.ring(this.player.position, 2.6, active.color, 0.25);
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
    this.fx.dome(center, skill.radius, color);
    this.area(center, skill.radius, skill.damage * this.party.power, element);
  }

  private useBurst(): void {
    const i = this.party.activeIndex;
    if (this.party.energy[i] < cfg.energyMax) return;
    const { burst, element, color } = this.party.active;
    this.party.energy[i] = 0;
    this.events.burst();
    this.fx.dome(this.player.position, burst.radius, color, 0.6);
    this.fx.ring(this.player.position, burst.radius, '#ffffff', 0.6);
    this.area(this.player.position, burst.radius, burst.damage * this.party.power, element);
  }

  private area(center: Vector3, radius: number, damage: number, element: Element): void {
    this.events.elementArea(center, radius, element);
    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.position.distanceTo(center) <= radius) this.hit(enemy, damage, element);
    }
  }

  private hit(enemy: Enemy, base: number, element: Element | null): void {
    let damage = base;
    let color = element ? ELEMENT_COLORS[element] : '#ffffff';
    const reaction = element ? reactionOf(enemy.aura, element) : null;
    if (reaction) {
      enemy.setAura(null);
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

  private applyDamage(enemy: Enemy, amount: number, color: string): void {
    enemy.hurt(amount);
    this.events.damage(enemy.position, Math.round(amount), color);
  }

  private overload(source: Enemy): void {
    const center = source.position.clone();
    this.fx.dome(center.clone().setY(center.y + 0.6), rx.overloadRadius, ELEMENT_COLORS.fire, 0.45);
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.position.distanceTo(center) > rx.overloadRadius) continue;
      this.applyDamage(enemy, rx.overloadDamage, ELEMENT_COLORS.fire);
      enemy.push(center, rx.overloadKnockback);
    }
  }

  private tickElectro(enemy: Enemy, dt: number): void {
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

  private inArc(enemy: Enemy): boolean {
    const to = new Vector3().subVectors(enemy.position, this.player.position).setY(0);
    if (to.length() > cfg.attackRange) return false;
    return to.length() < 0.6 || to.normalize().angleTo(this.player.facing.clone().setY(0).normalize()) < cfg.attackArc;
  }

  /** Light auto-aim so attacks stay usable on touch screens. */
  private faceNearest(): Enemy | null {
    let best: Enemy | null = null;
    let bestDistance = cfg.attackRange + 3;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = enemy.position.distanceTo(this.player.position);
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
      const mesh = new Mesh(orb, orbMaterial);
      mesh.position.copy(enemy.position).setY(enemy.position.y + 1);
      const target = this.player.position.clone().setY(this.player.position.y + 0.9);
      const velocity = target.sub(mesh.position).normalize().multiplyScalar(enemy.cfg.projectileSpeed ?? 10);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, velocity, damage: enemy.cfg.damage, life: 2.5 });
      return;
    }
    if (enemy.position.distanceTo(this.player.position) > enemy.cfg.attackRange * 1.3) return;
    if (this.player.takeDamage(enemy.cfg.damage)) this.events.playerHurt();
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
