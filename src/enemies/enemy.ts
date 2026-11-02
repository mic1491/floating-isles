import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
  type MeshToonMaterial,
} from 'three';
import { balance, type Element } from '../core/balance';
import { addOutline, toonMaterial } from '../render/toon';
import { terrainHeight } from '../world/terrain';
import { nextEnemyState, type EnemyState } from './fsm';

export type EnemyKind = 'melee' | 'ranged';

export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff7a45',
  water: '#45b6ff',
  thunder: '#b97aff',
};

export class Enemy {
  readonly view = new Group();
  readonly position: Vector3;
  readonly cfg;
  state: EnemyState = 'patrol';
  hp: number;
  aura: Element | null = null;
  electroTicks = 0;
  electroTimer = 0;
  private auraTimer = 0;
  private flash = 0;
  private windup = 0;
  private cooldown = 0;
  private respawn = 0;
  private patrolAngle = Math.random() * Math.PI * 2;
  private readonly knockback = new Vector3();
  private readonly material: MeshToonMaterial;
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
    this.cfg = balance.enemies[kind] as typeof balance.enemies.melee & { projectileSpeed?: number };
    this.hp = this.cfg.hp;
    this.position = home.clone();
    this.material = toonMaterial(kind === 'melee' ? '#7c5cc4' : '#c45c8a');

    const body = new Mesh(
      kind === 'melee' ? new BoxGeometry(0.95, 1.05, 0.8) : new ConeGeometry(0.55, 1.35, 8),
      this.material,
    );
    body.position.y = 0.62;
    body.castShadow = true;
    addOutline(body);
    const eyes = new Mesh(new BoxGeometry(0.6, 0.11, 0.05), new MeshBasicMaterial({ color: '#fff3a8' }));
    eyes.position.set(0, 0.8, kind === 'melee' ? -0.42 : -0.34);
    this.hpBack.position.y = 1.72;
    this.hpBar.position.y = 1.72;
    this.hpBack.renderOrder = 10;
    this.hpBar.renderOrder = 11;
    this.auraOrb.position.y = 2;
    this.auraOrb.visible = false;
    this.view.add(body, eyes, this.hpBack, this.hpBar, this.auraOrb);
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

  hurt(amount: number): void {
    this.hp -= amount;
    this.flash = 0.14;
    if (this.state === 'patrol') this.state = 'chase';
    if (!this.alive) {
      this.view.visible = false;
      this.respawn = this.cfg.respawnDelay;
      this.windup = 0;
      this.electroTicks = 0;
      this.setAura(null);
    }
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
        this.view.visible = true;
      }
      return false;
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
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

    const move = new Vector3();
    let landed = false;
    if (this.state === 'patrol') {
      this.patrolAngle += dt * 0.35;
      move.set(Math.cos(this.patrolAngle), 0, Math.sin(this.patrolAngle)).multiplyScalar(this.cfg.speed * 0.3);
    } else if (this.state === 'chase') {
      move.copy(toPlayer).normalize().multiplyScalar(this.cfg.speed);
    } else if (this.state === 'return') {
      move.copy(fromHome).normalize().multiplyScalar(this.cfg.speed);
    } else {
      landed = this.tickAttack(dt);
    }

    this.position.addScaledVector(move, dt).addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-6 * dt));
    this.position.y = terrainHeight(this.position.x, this.position.z);

    const face = this.state === 'attack' || this.state === 'chase' ? toPlayer : move;
    if (face.lengthSq() > 0.001) this.view.rotation.y = Math.atan2(-face.x, -face.z);
    this.flash = Math.max(0, this.flash - dt);
    this.syncView(camera);
    return landed;
  }

  private tickAttack(dt: number): boolean {
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.cooldown = this.cfg.attackCooldown;
        return true;
      }
    } else if (this.cooldown <= 0) {
      this.windup = this.cfg.attackWindup;
    }
    return false;
  }

  private tickAura(dt: number): void {
    if (!this.aura) return;
    this.auraTimer -= dt;
    if (this.auraTimer <= 0) this.setAura(null);
  }

  private syncView(camera?: Camera): void {
    this.view.position.copy(this.position);
    const telegraph = this.windup > 0 ? 1 : 0;
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
