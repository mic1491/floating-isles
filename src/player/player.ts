import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  Group,
  MathUtils,
  Mesh,
  SphereGeometry,
  Vector3,
  type MeshToonMaterial,
} from 'three';
import { balance, type CharacterDef } from '../core/balance';
import type { Actions } from '../input/actions';
import { addOutline, toonMaterial } from '../render/toon';
import type { Physics } from '../world/physics';
import { terrainHeight } from '../world/terrain';
import type { Avatar } from './avatar';
import { Stamina } from './stamina';

const cfg = balance.player;
const HALF_HEIGHT = 0.5;
const RADIUS = 0.36;
const FOOT_OFFSET = HALF_HEIGHT + RADIUS;

export class Player {
  readonly view = new Group();
  readonly stamina = new Stamina();
  readonly position = new Vector3();
  readonly facing = new Vector3(0, 0, -1);
  readonly body: RAPIER.RigidBody;
  hp: number = cfg.maxHp;
  gliding = false;
  verticalSpeed = 0;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly lastSafe = new Vector3();
  private readonly dashDirection = new Vector3();
  private readonly coat: MeshToonMaterial;
  private readonly weapon = new Mesh(new BoxGeometry(0.08, 0.08, 1.1), toonMaterial('#eef0f5'));
  private readonly wing = new Mesh(new BoxGeometry(2.4, 0.04, 0.7), toonMaterial('#f6efe0'));
  private readonly placeholder = new Group();
  private readonly avatars = new Map<string, Avatar>();
  private avatar: Avatar | null = null;
  private characterId = '';
  private clock = 0;
  private grounded = false;
  private dashTime = 0;
  private dashCooldown = 0;
  private invulnerable = 0;
  private walkPhase = 0;
  private swing = 0;

  constructor(physics: Physics, start: Vector3) {
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + FOOT_OFFSET, start.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = world.createCharacterController(0.03);
    this.controller.enableAutostep(0.5, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(MathUtils.degToRad(52));
    this.position.copy(start);
    this.lastSafe.copy(start);

    this.coat = toonMaterial('#ffffff');
    const torso = new Mesh(new CapsuleGeometry(0.3, 0.55, 6, 12), this.coat);
    torso.position.y = 0.72;
    const head = new Mesh(new SphereGeometry(0.28, 16, 12), toonMaterial('#ffe0c8'));
    head.position.y = 1.42;
    const hair = new Mesh(new ConeGeometry(0.33, 0.42, 12), this.coat);
    hair.position.y = 1.66;
    for (const mesh of [torso, head, hair, this.weapon]) {
      mesh.castShadow = true;
      addOutline(mesh);
    }
    this.weapon.position.set(0.42, 0.85, -0.45);
    this.wing.position.y = 1.9;
    this.wing.visible = false;
    this.placeholder.add(torso, head, hair, this.weapon);
    this.view.add(this.placeholder, this.wing);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  setCharacter(character: CharacterDef): void {
    this.coat.color.set(character.color);
    this.characterId = character.id;
    this.showActiveBody();
  }

  addAvatar(id: string, avatar: Avatar): void {
    this.avatars.set(id, avatar);
    this.view.add(avatar.root);
    this.showActiveBody();
  }

  private showActiveBody(): void {
    this.avatar = this.avatars.get(this.characterId) ?? null;
    for (const [id, avatar] of this.avatars) avatar.root.visible = id === this.characterId;
    this.placeholder.visible = this.avatar === null;
  }

  playSwing(): void {
    this.swing = 1;
  }

  /** Applies damage unless dashing through it; returns whether it landed. */
  takeDamage(amount: number): boolean {
    if (this.invulnerable > 0 || !this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    return true;
  }

  teleport(position: Vector3): void {
    this.body.setNextKinematicTranslation({ x: position.x, y: position.y + FOOT_OFFSET, z: position.z });
    this.body.setTranslation({ x: position.x, y: position.y + FOOT_OFFSET, z: position.z }, true);
    this.position.copy(position);
    this.verticalSpeed = 0;
    this.gliding = false;
    this.dashTime = 0;
    for (const avatar of this.avatars.values()) avatar.resetPhysics();
  }

  revive(position: Vector3): void {
    this.hp = cfg.maxHp;
    this.stamina.value = balance.stamina.max;
    this.teleport(position);
  }

  update(dt: number, actions: Actions, yaw: number): void {
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    // Movement is relative to where the camera looks.
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const wish = new Vector3(
      forwardX * actions.moveY + -forwardZ * actions.moveX,
      0,
      forwardZ * actions.moveY + forwardX * actions.moveX,
    );
    const wishLength = Math.min(1, wish.length());
    if (wish.lengthSq() > 0) wish.normalize();

    this.handleDash(dt, actions, wish);
    this.handleJumpAndGlide(actions);

    const sprinting = actions.sprint && wishLength > 0.1 && this.grounded && !this.stamina.empty;
    if (sprinting) this.stamina.drain(balance.stamina.sprintPerSecond * dt);
    const dashing = this.dashTime > 0;
    if (!sprinting && !this.gliding && !dashing) this.stamina.update(dt);

    let speed = (sprinting ? cfg.sprintSpeed : cfg.walkSpeed) * wishLength;
    if (this.gliding) {
      speed = cfg.glideSpeed * wishLength;
      this.stamina.drain(balance.stamina.glidePerSecond * dt);
      if (this.stamina.empty) this.gliding = false;
    }

    this.verticalSpeed -= cfg.gravity * dt;
    if (this.gliding) this.verticalSpeed = Math.max(this.verticalSpeed, -cfg.glideFallSpeed);

    const delta = dashing
      ? this.dashDirection.clone().multiplyScalar(balance.dash.speed * dt)
      : wish.clone().multiplyScalar(speed * dt);
    delta.y = this.verticalSpeed * dt;

    this.controller.computeColliderMovement(this.collider, delta);
    const move = this.controller.computedMovement();
    const current = this.body.translation();
    const next = { x: current.x + move.x, y: current.y + move.y, z: current.z + move.z };
    this.body.setNextKinematicTranslation(next);

    this.grounded = this.controller.computedGrounded();
    if (this.grounded) {
      this.verticalSpeed = Math.max(this.verticalSpeed, -1);
      this.gliding = false;
    }

    this.position.set(next.x, next.y - FOOT_OFFSET, next.z);
    if (this.grounded && terrainHeight(next.x, next.z) > 0) this.lastSafe.copy(this.position);
    if (this.position.y < cfg.respawnY) {
      this.teleport(this.lastSafe);
      this.takeDamage(10);
    }

    if (wishLength > 0.05 && !dashing) this.facing.lerp(wish, 1 - Math.exp(-14 * dt)).normalize();
    this.updateView(dt, wishLength * speed);
  }

  private handleDash(dt: number, actions: Actions, wish: Vector3): void {
    this.dashTime = Math.max(0, this.dashTime - dt);
    if (!actions.dashPressed || this.dashCooldown > 0 || this.gliding) return;
    if (!this.stamina.spend(balance.stamina.dashCost)) return;
    this.dashTime = balance.dash.duration;
    this.dashCooldown = balance.dash.cooldown;
    this.invulnerable = balance.dash.invulnerable;
    this.dashDirection.copy(wish.lengthSq() > 0 ? wish : this.facing);
  }

  private handleJumpAndGlide(actions: Actions): void {
    if (!actions.jumpPressed) return;
    if (this.grounded) {
      this.verticalSpeed = cfg.jumpVelocity;
      this.grounded = false;
      return;
    }
    if (this.gliding) {
      this.gliding = false;
      return;
    }
    const height = this.position.y - terrainHeight(this.position.x, this.position.z);
    if (height >= cfg.glideMinHeight && !this.stamina.empty) this.gliding = true;
  }

  private updateView(dt: number, speed: number): void {
    this.walkPhase += speed * dt * 2.2;
    this.swing = Math.max(0, this.swing - dt * 5);
    this.view.position.copy(this.position);
    this.view.position.y += this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.06 * Math.min(1, speed) : 0;
    this.view.rotation.y = Math.atan2(-this.facing.x, -this.facing.z);
    this.view.rotation.x = this.gliding ? -0.5 : 0;
    this.clock += dt;
    this.avatar?.update(dt, {
      time: this.clock,
      stride: this.walkPhase * 0.75,
      pace: Math.min(1, speed / cfg.sprintSpeed),
      airborne: !this.grounded,
      gliding: this.gliding,
      dashing: this.dashTime > 0,
      swing: this.swing,
    });
    this.weapon.rotation.y = this.swing * 2.4 - 1.2 * Math.min(this.swing * 4, 1);
    this.wing.visible = this.gliding;
    this.view.visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 30) % 2 === 0;
  }
}
