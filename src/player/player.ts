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
import { ATTACKS, CHARGE_HOLD, CHARGED_STEP, PLUNGE } from './attackTable';
import { Glider } from './glider';
import { Stamina } from './stamina';

const cfg = balance.player;
const HALF_HEIGHT = 0.5;
const RADIUS = 0.36;
const FOOT_OFFSET = HALF_HEIGHT + RADIUS;

/** What the player's body does that the rest of the game may want to hear or show. */
export interface PlayerEvents {
  step?(speed: number): void;
  jump?(): void;
  /** `impact` is how fast the player was falling, so a long drop can land harder. */
  land?(impact: number): void;
  dash?(): void;
  glide?(): void;
}

/** How far the body has turned, in radians, a fraction `t` of the way through the charged strike. */
export const whirlAngle = (t: number): number => {
  const u = Math.min(1, Math.max(0, (t - 0.28) / 0.5));
  return Math.PI * 2 * u * u * (3 - 2 * u);
};

export class Player {
  events: PlayerEvents = {};
  readonly view = new Group();
  readonly stamina = new Stamina();
  readonly position = new Vector3();
  readonly facing = new Vector3(0, 0, -1);
  readonly body: RAPIER.RigidBody;
  maxHp: number = cfg.maxHp;
  hp: number = cfg.maxHp;
  gliding = false;
  verticalSpeed = 0;
  /** Gathered charge from 0 to 1, or -1 when not charging; the combat system sets it. */
  chargeLevel = -1;
  /** Whether this weapon spins the body round through the charged strike. */
  whirl = false;
  /** True while diving down for the plunge attack. */
  plunging = false;
  /** Set on the frame a plunge reaches the ground; the combat system reads and clears it. */
  plungeLanded = false;
  /** Set when a blow was slipped by dashing; the combat system reads and clears it. */
  dodged = false;
  /** Seconds since the player fell, or 0 while alive. */
  private deadAge = 0;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly lastSafe = new Vector3();
  private readonly dashDirection = new Vector3();
  private readonly coat: MeshToonMaterial;
  private readonly weapon = new Mesh(new BoxGeometry(0.08, 0.08, 1.1), toonMaterial('#eef0f5'));
  private readonly glider = new Glider();
  private readonly placeholder = new Group();
  private readonly avatars = new Map<string, Avatar>();
  private avatar: Avatar | null = null;
  private characterId = '';
  private clock = 0;
  private grounded = true;
  /** Jumps already spent in the air since leaving the ground. */
  private airJumps = 0;
  private dashTime = 0;
  private dashCooldown = 0;
  private invulnerable = 0;
  /** Seconds since the last hit taken, for the flinch. */
  private hitAge = 99;
  private lastYaw = 0;
  private walkPhase = 0;
  private walkSpeed = 0;
  private attack: { step: number; elapsed: number; id: number; lungeScale: number } | null = null;
  private attackCount = 0;

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
    this.placeholder.add(torso, head, hair, this.weapon);
    this.view.add(this.placeholder, this.glider.group);
  }

  /** Whether the player is on the ground and actually moving, so only real steps leave a trail. */
  get walkingOnGround(): boolean {
    return this.grounded && !this.gliding && this.walkSpeed > 0.5;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  setCharacter(character: CharacterDef): void {
    this.coat.color.set(character.color);
    this.glider.setColor(character.color);
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

  /** Starts hit `step` (1-based) of the sword combo. `lungeScale` shortens the step forward near a target. */
  startAttack(step: number, lungeScale = 1, from = 0): void {
    this.attack = { step, elapsed: from * ATTACKS[step - 1].duration, id: ++this.attackCount, lungeScale };
  }

  /** Whether a charge can be gathered or held: on the ground, not flying, dashing or reeling. */
  get canCharge(): boolean {
    return this.alive && this.grounded && !this.gliding && this.dashTime <= 0 && this.hitAge > 0.35;
  }

  /** Height of the feet above the ground below. */
  get heightAboveGround(): number {
    return this.position.y - terrainHeight(this.position.x, this.position.z);
  }

  /** Whether a plunge can start: in the air, high enough, and not already diving or reeling. */
  get canPlunge(): boolean {
    return this.alive && !this.grounded && !this.plunging && this.hitAge > 0.35 && this.heightAboveGround >= PLUNGE.minHeight;
  }

  startPlunge(): void {
    this.plunging = true;
    this.gliding = false;
    this.attack = null;
    this.verticalSpeed = -PLUNGE.speed;
  }

  cancelAttack(): void {
    this.attack = null;
  }

  /** The hit being swung and how far through it, or null when not attacking. */
  get swinging(): { step: number; t: number } | null {
    if (!this.attack) return null;
    return { step: this.attack.step, t: this.attack.elapsed / ATTACKS[this.attack.step - 1].duration };
  }

  /** Applies damage unless dashing through it; returns whether it landed. */
  takeDamage(amount: number): boolean {
    if (this.invulnerable > 0 && this.alive) this.dodged = true;
    if (this.invulnerable > 0 || !this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hitAge = 0;
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
    this.hp = this.maxHp;
    this.stamina.value = balance.stamina.max;
    this.teleport(position);
  }

  update(dt: number, actions: Actions, yaw: number): void {
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.hitAge += dt;

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
    if (this.plunging && this.dashTime > 0) this.plunging = false;
    this.handleJumpAndGlide(actions);

    const sprinting = actions.sprint && wishLength > 0.1 && this.grounded && !this.stamina.empty;
    if (sprinting) this.stamina.drain(balance.stamina.sprintPerSecond * dt);
    const dashing = this.dashTime > 0;
    if (!sprinting && !this.gliding && !dashing) this.stamina.update(dt);

    let speed = (sprinting ? cfg.sprintSpeed : cfg.walkSpeed) * wishLength * (this.plunging ? 0 : this.attack ? 0.3 : this.chargeLevel >= 0 ? 0.35 : 1);
    if (this.gliding) {
      speed = cfg.glideSpeed * wishLength;
      this.stamina.drain(balance.stamina.glidePerSecond * dt);
      if (this.stamina.empty) this.gliding = false;
    }

    this.verticalSpeed -= cfg.gravity * dt;
    if (this.gliding) this.verticalSpeed = Math.max(this.verticalSpeed, -cfg.glideFallSpeed);
    if (this.plunging) this.verticalSpeed = -PLUNGE.speed;

    const delta = dashing
      ? this.dashDirection.clone().multiplyScalar(balance.dash.speed * dt)
      : wish.clone().multiplyScalar(speed * dt);
    delta.addScaledVector(this.facing, this.lungeSpeed() * dt);
    delta.y = this.verticalSpeed * dt;

    this.controller.computeColliderMovement(this.collider, delta);
    const move = this.controller.computedMovement();
    const current = this.body.translation();
    const next = { x: current.x + move.x, y: current.y + move.y, z: current.z + move.z };
    this.body.setNextKinematicTranslation(next);

    const wasGrounded = this.grounded;
    const fallSpeed = -this.verticalSpeed;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && !wasGrounded && fallSpeed > 3) this.events.land?.(fallSpeed);
    if (this.grounded && this.plunging) {
      this.plunging = false;
      this.plungeLanded = true;
    }
    if (this.grounded) {
      this.verticalSpeed = Math.max(this.verticalSpeed, -1);
      this.gliding = false;
      this.airJumps = 0;
    }

    this.position.set(next.x, next.y - FOOT_OFFSET, next.z);
    if (this.grounded && terrainHeight(next.x, next.z) > 0) this.lastSafe.copy(this.position);
    if (this.position.y < cfg.respawnY) {
      this.teleport(this.lastSafe);
      this.takeDamage(10);
    }

    if (wishLength > 0.05 && !dashing) {
      const turn = this.attack ? (this.attack.elapsed / ATTACKS[this.attack.step - 1].duration < 0.25 ? 4 : 0) : 14;
      if (turn > 0) this.facing.lerp(wish, 1 - Math.exp(-turn * dt)).normalize();
    }
    this.updateView(dt, wishLength * speed);
  }

  /** Keeps the body placed and breathing while the world itself is paused. */
  refreshView(dt: number): void {
    this.updateView(dt, 0);
  }

  private handleDash(dt: number, actions: Actions, wish: Vector3): void {
    this.dashTime = Math.max(0, this.dashTime - dt);
    if (!actions.dashPressed || this.dashCooldown > 0 || this.gliding) return;
    if (!this.stamina.spend(balance.stamina.dashCost)) return;
    this.dashTime = balance.dash.duration;
    this.events.dash?.();
    this.dashCooldown = balance.dash.cooldown;
    this.invulnerable = balance.dash.invulnerable;
    this.dashDirection.copy(wish.lengthSq() > 0 ? wish : this.facing);
    this.attack = null;
  }

  /** Forward speed of the step taken into a strike, from just before the blade lands to just after. */
  private lungeSpeed(): number {
    if (!this.attack) return 0;
    const style = ATTACKS[this.attack.step - 1];
    const t = this.attack.elapsed / style.duration;
    const from = style.strikeAt - 0.22;
    const to = style.strikeAt + 0.04;
    if (t < from || t > to) return 0;
    return (style.lunge * this.attack.lungeScale) / ((to - from) * style.duration);
  }

  private handleJumpAndGlide(actions: Actions): void {
    if (!actions.jumpPressed) return;
    if (this.grounded) {
      this.verticalSpeed = cfg.jumpVelocity;
      this.grounded = false;
      this.events.jump?.();
      return;
    }
    if (this.gliding) {
      this.gliding = false;
      return;
    }
    // The first press in the air is a second jump; only after that does a press open the glider.
    if (this.airJumps < cfg.airJumps) {
      this.airJumps++;
      this.verticalSpeed = cfg.jumpVelocity * cfg.airJumpScale;
      this.events.jump?.();
      return;
    }
    const height = this.position.y - terrainHeight(this.position.x, this.position.z);
    if (height >= cfg.glideMinHeight && !this.stamina.empty) {
      this.gliding = true;
      this.events.glide?.();
    }
  }

  private updateView(dt: number, speed: number): void {
    this.walkSpeed = speed;
    const before = Math.floor(this.walkPhase / Math.PI);
    this.walkPhase += speed * dt * 2.2;
    // One footfall each time the stride passes a half-turn, only while actually walking on the ground.
    if (this.grounded && speed > 1 && Math.floor(this.walkPhase / Math.PI) !== before) this.events.step?.(speed);
    if (this.attack) {
      this.attack.elapsed += dt;
      if (this.attack.elapsed >= ATTACKS[this.attack.step - 1].duration) this.attack = null;
    }
    const swinging = this.swinging;
    this.view.position.copy(this.position);
    this.view.position.y += this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.06 * Math.min(1, speed) : 0;
    const yaw = Math.atan2(-this.facing.x, -this.facing.z);
    // The charged sword strike whirls the body once round through the swing.
    const spin = this.whirl && this.attack?.step === CHARGED_STEP ? whirlAngle(this.attack.elapsed / ATTACKS[CHARGED_STEP - 1].duration) : 0;
    this.view.rotation.y = yaw + spin;
    const turn = dt > 0 ? Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw)) / dt : 0;
    this.lastYaw = yaw;
    this.deadAge = this.alive ? 0 : this.deadAge + dt;
    // A fallen player topples slowly backward and lies flat until revived.
    const fall = Math.min(1, this.deadAge / 0.55);
    this.view.rotation.order = this.alive ? 'XYZ' : 'YXZ';
    this.view.rotation.x = this.alive ? (this.gliding ? -0.5 : 0) : 1.5 * fall * fall * (3 - 2 * fall);
    if (!this.alive) this.view.position.y += 0.15 * fall;
    this.clock += dt;
    this.avatar?.update(dt, {
      time: this.clock,
      stride: this.walkPhase * 0.75,
      pace: Math.min(1, speed / cfg.sprintSpeed),
      speed,
      hitAge: this.hitAge,
      turn,
      airborne: !this.grounded,
      gliding: this.gliding,
      dashing: this.dashTime > 0,
      plunging: this.plunging,
      dead: !this.alive,
      attack:
        !this.alive
          ? null
          : swinging && this.attack
            ? { ...swinging, id: this.attack.id, cast: this.attack.step > CHARGED_STEP }
          : this.chargeLevel >= 0
            ? { step: 4, t: CHARGE_HOLD, id: -1, hold: true }
            : null,
      charge: Math.max(0, this.chargeLevel),
    });
    this.weapon.rotation.y = swinging ? 1.2 - 2.4 * swinging.t : 0;
    this.glider.group.visible = this.gliding;
    this.view.visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 30) % 2 === 0;
  }
}
