import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import { balance, type Element } from '../core/balance';
import { toonMaterial } from '../render/toon';
import { terrainHeight } from '../world/terrain';
import { nextEnemyState, type EnemyState } from './fsm';
import { buildBlob, buildBomber, buildCharger, buildGuard, buildWisp, type Rig } from './models';

export type EnemyKind = 'melee' | 'ranged' | 'charger' | 'bomber' | 'guard';

/** Tuning for one kind of enemy; the extra fields belong to the kinds that use them. */
export interface EnemyCfg {
  hp: number;
  coins: number;
  xp: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackWindup: number;
  attackCooldown: number;
  aggroRange: number;
  leashRange: number;
  respawnDelay: number;
  projectileSpeed?: number;
  chargeSpeed?: number;
  chargeTime?: number;
  stagger?: number;
  /** Share of damage that gets through the shell. */
  armor?: number;
  /** Seconds the shell stays off after a reaction cracks it. */
  armorBreak?: number;
}

const BODY_COLORS: Record<EnemyKind, string> = {
  melee: '#7c5cc4',
  ranged: '#c45c8a',
  charger: '#c9803f',
  bomber: '#4a3f58',
  guard: '#5fae7c',
};

export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff7a45',
  water: '#45b6ff',
  thunder: '#b97aff',
};

export class Enemy {
  readonly view = new Group();
  readonly position: Vector3;
  readonly cfg: EnemyCfg;
  readonly radius = 0;
  state: EnemyState = 'patrol';
  hp: number;
  aura: Element | null = null;
  electroTicks = 0;
  electroTimer = 0;
  private auraTimer = 0;
  private flash = 0;
  private windup = 0;
  private charge = 0;
  private chargeHit = false;
  private stun = 0;
  private armorTimer = 0;
  private readonly lock = new Vector3(0, 0, -1);
  private readonly warning = new Group();
  private warningFill: Object3D | null = null;
  private cooldown = 0;
  private respawn = 0;
  private patrolAngle = Math.random() * Math.PI * 2;
  private readonly knockback = new Vector3();
  private readonly material: MeshToonMaterial;
  private readonly rig: Rig;
  private clock = Math.random() * 10;
  private readonly hpBar = new Mesh(
    new PlaneGeometry(1, 0.09),
    new MeshBasicMaterial({ color: '#ff5a5a', depthTest: false }),
  );
  private readonly hpBack = new Mesh(
    new PlaneGeometry(1.06, 0.14),
    new MeshBasicMaterial({ color: '#2b2230', depthTest: false }),
  );
  private readonly auraOrb = new Mesh(new SphereGeometry(0.13, 10, 8), new MeshBasicMaterial());

  constructor(readonly kind: EnemyKind, private readonly home: Vector3) {
    this.cfg = balance.enemies[kind] as EnemyCfg;
    this.hp = this.cfg.hp;
    this.position = home.clone();
    this.material = toonMaterial(BODY_COLORS[kind]);

    this.rig = {
      melee: buildBlob,
      ranged: buildWisp,
      charger: buildCharger,
      bomber: buildBomber,
      guard: buildGuard,
    }[kind](this.material);
    this.buildWarning();
    this.hpBack.position.y = 1.72;
    this.hpBar.position.y = 1.72;
    this.hpBack.renderOrder = 10;
    this.hpBar.renderOrder = 11;
    this.auraOrb.position.y = 2;
    this.auraOrb.visible = false;
    this.view.add(this.rig.root, this.warning, this.hpBack, this.hpBar, this.auraOrb);
    this.syncView();
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  setAura(element: Element | null): void {
    this.aura = element;
    this.auraTimer = balance.combat.auraDuration;
    this.auraOrb.visible = element !== null;
    if (element) (this.auraOrb.material as MeshBasicMaterial).color.set(ELEMENT_COLORS[element]);
  }

  /** Whether a protective shell is on, so ordinary blows barely hurt. */
  get armored(): boolean {
    return (this.cfg.armor ?? 0) > 0 && this.armorTimer <= 0;
  }

  /** A reaction cracks the shell for a while. */
  breakArmor(): void {
    if ((this.cfg.armor ?? 0) > 0) this.armorTimer = this.cfg.armorBreak ?? 6;
  }

  /** Blows are weakened by a shell and doubled in effect while it is dazed; returns what was actually dealt. */
  hurt(raw: number): number {
    let amount = raw;
    if (this.armored) amount *= this.cfg.armor ?? 1;
    if (this.stun > 0) amount *= 1.5;
    this.hp -= amount;
    this.flash = 0.14;
    if (this.state === 'patrol') this.state = 'chase';
    if (!this.alive) {
      this.view.visible = false;
      this.respawn = this.cfg.respawnDelay;
      this.windup = 0;
      this.charge = 0;
      this.stun = 0;
      this.electroTicks = 0;
      this.setAura(null);
    }
    return amount;
  }

  /** A bomber spends itself: gone without reward, back after its respawn delay. */
  explode(): void {
    this.hp = 0;
    this.view.visible = false;
    this.respawn = this.cfg.respawnDelay;
    this.windup = 0;
    this.setAura(null);
  }

  push(from: Vector3, force: number): void {
    this.knockback.subVectors(this.position, from).setY(0).normalize().multiplyScalar(force);
  }

  /** Returns true on the frame an attack lands. */
  update(dt: number, player: Vector3, playerAlive: boolean, camera: Camera): boolean {
    if (!this.alive) {
      this.respawn -= dt;
      if (this.respawn <= 0) {
        this.hp = this.cfg.hp;
        this.position.copy(this.home);
        this.state = 'patrol';
        this.armorTimer = 0;
        this.view.visible = true;
      }
      return false;
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.armorTimer = Math.max(0, this.armorTimer - dt);
    this.tickAura(dt);
    const toPlayer = new Vector3().subVectors(player, this.position).setY(0);
    const distance = toPlayer.length();
    const fromHome = new Vector3().subVectors(this.home, this.position).setY(0);
    this.state = nextEnemyState(this.state, {
      distanceToPlayer: distance,
      distanceFromHome: fromHome.length(),
      aggroRange: this.cfg.aggroRange,
      attackRange: this.cfg.attackRange,
      leashRange: this.cfg.leashRange,
      playerAlive,
    });

    // Leaving melee range cancels a wind-up, so a dodge resets the attack instead of freezing it half-done.
    if (this.state !== 'attack' && this.charge <= 0 && this.stun <= 0) this.windup = 0;

    const move = new Vector3();
    let landed = false;
    if (this.stun > 0) {
      // Dazed after a charge: it stands still and is easy to hit.
      this.stun -= dt;
    } else if (this.charge > 0) {
      landed = this.tickCharge(dt, player);
    } else if (this.state === 'patrol') {
      this.patrolAngle += dt * 0.35;
      move.set(Math.cos(this.patrolAngle), 0, Math.sin(this.patrolAngle)).multiplyScalar(this.cfg.speed * 0.3);
    } else if (this.state === 'chase') {
      move.copy(toPlayer).normalize().multiplyScalar(this.cfg.speed);
    } else if (this.state === 'return') {
      move.copy(fromHome).normalize().multiplyScalar(this.cfg.speed);
    } else {
      landed = this.tickAttack(dt, toPlayer);
    }

    this.position.addScaledVector(move, dt).addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-6 * dt));
    this.position.y = terrainHeight(this.position.x, this.position.z);

    // A charger commits to the line it picked when the wind-up began, so a sidestep beats it.
    const committed = this.kind === 'charger' && (this.windup > 0 || this.charge > 0);
    const face = committed ? this.lock : this.state === 'attack' || this.state === 'chase' ? toPlayer : move;
    if (this.stun <= 0 && face.lengthSq() > 0.001) this.view.rotation.y = Math.atan2(-face.x, -face.z);
    this.flash = Math.max(0, this.flash - dt);
    this.clock += dt;
    this.syncView(camera);
    return landed;
  }

  private tickAttack(dt: number, toPlayer: Vector3): boolean {
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.cooldown = this.cfg.attackCooldown;
        if (this.kind === 'charger') {
          this.charge = this.cfg.chargeTime ?? 0.5;
          this.chargeHit = false;
          return false;
        }
        return true;
      }
    } else if (this.cooldown <= 0) {
      this.windup = this.cfg.attackWindup;
      this.lock.copy(toPlayer).normalize();
    }
    return false;
  }

  /** Runs along the locked line; returns true on the one frame it barrels into the player. */
  private tickCharge(dt: number, player: Vector3): boolean {
    this.charge -= dt;
    this.position.addScaledVector(this.lock, (this.cfg.chargeSpeed ?? 14) * dt);
    let hit = false;
    if (!this.chargeHit && Math.hypot(player.x - this.position.x, player.z - this.position.z) < 1.4) {
      this.chargeHit = true;
      hit = true;
    }
    if (this.charge <= 0) this.stun = this.cfg.stagger ?? 1.2;
    return hit;
  }

  private tickAura(dt: number): void {
    if (!this.aura) return;
    this.auraTimer -= dt;
    if (this.auraTimer <= 0) this.setAura(null);
  }

  /** The ground warning for the two kinds whose attack is an area: a charge lane or a blast circle. */
  private buildWarning(): void {
    this.warning.visible = false;
    const fill = (geometry: PlaneGeometry | CircleGeometry, color: string, opacity: number): Mesh => {
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 4;
      return mesh;
    };
    if (this.kind === 'charger') {
      const length = (this.cfg.chargeSpeed ?? 14) * (this.cfg.chargeTime ?? 0.5) + 1.5;
      const lane = fill(new PlaneGeometry(1.7, length), '#ffd9c8', 0.5);
      lane.position.set(0, 0.55, -length / 2);
      const bar = fill(new PlaneGeometry(1.7, length), '#ff3a2a', 0.6);
      bar.position.set(0, 0.57, -length / 2);
      // The red fill grows from the beast outward as the charge nears.
      const grow = new Group();
      grow.add(bar);
      this.warning.add(lane, grow);
      this.warningFill = grow;
    } else if (this.kind === 'bomber') {
      const radius = this.cfg.attackRange * 1.3;
      const ring = fill(new CircleGeometry(radius, 40), '#ffd0c0', 0.25);
      ring.position.y = 0.5;
      const disc = fill(new CircleGeometry(1, 40), '#ff4a3a', 0.45);
      disc.position.y = 0.52;
      this.warning.add(ring, disc);
      this.warningFill = disc;
    }
  }

  private syncView(camera?: Camera): void {
    this.view.position.copy(this.position);
    // A blow squashes the body down and wide, then it springs back.
    const squash = Math.min(1, this.flash / 0.14);
    const bounce = squash * squash * (0.16 + Math.sin(this.clock * 50) * 0.04);
    this.view.scale.set(1 + bounce, 1 - bounce * 1.2, 1 + bounce);
    this.rig.update(this.clock, {
      windup: this.windup > 0 ? 1 : 0,
      charging: this.charge > 0,
      stunned: this.stun > 0,
      armored: this.armored,
    });
    const winding = this.windup > 0;
    this.warning.visible = winding && this.warningFill !== null;
    if (winding && this.warningFill) {
      const progress = Math.min(1, 1 - this.windup / this.cfg.attackWindup);
      if (this.kind === 'charger') this.warningFill.scale.z = Math.max(0.001, progress);
      else this.warningFill.scale.setScalar(Math.max(0.001, this.cfg.attackRange * 1.3 * progress));
    }
    const telegraph = winding ? 1 : 0;
    this.material.emissive.setRGB(this.flash > 0 ? 1 : telegraph * 0.5, this.flash > 0 ? 1 : 0, this.flash > 0 ? 1 : 0);
    const ratio = Math.max(0, this.hp / this.cfg.hp);
    this.hpBar.scale.x = ratio;
    if (camera) {
      const inverse = this.view.getWorldQuaternion(this.hpBar.quaternion).invert();
      this.hpBar.quaternion.copy(inverse.multiply(camera.quaternion));
      this.hpBack.quaternion.copy(this.hpBar.quaternion);
    }
  }
}
