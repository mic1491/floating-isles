import { scaledStats } from './levels';
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import { balance, type Element } from '../core/balance';
import { addOutline, toonMaterial } from '../render/toon';
import { terrainHeight } from '../world/terrain';

/** What the boss needs from the fight around it; the combat system supplies this. */
export interface BossHost {
  hurtPlayer(amount: number): void;
  shoot(from: Vector3, velocity: Vector3, damage: number): void;
  /** A ring of light on the ground, for impacts. */
  burst(at: Vector3, radius: number, color: string, life?: number): void;
  shake(strength: number): void;
  announce(text: string): void;
}

type Attack = 'slam' | 'rocks' | 'wave' | 'meteor';

/** A warning painted on the ground: a pale ring marks the reach and a red disc fills in as the hit nears. */
interface Telegraph {
  disc: Mesh;
  ring: Mesh;
  radius: number;
  /** Negative until its turn comes, so several can be staged one after another. */
  age: number;
  total: number;
  fire(): void;
}

interface Wave {
  mesh: Mesh;
  radius: number;
  hit: boolean;
}

const RADIUS = 2.3;
const WAKE_RANGE = 26;
const SLAM_RADIUS = 5.4;
const WAVE_START = 3;
const WAVE_END = 15;
const WAVE_SPEED = 9;
const METEOR_RADIUS = 2.6;
const PHASE_GLOW = ['#7be8ff', '#ffd166', '#ff5a5a'];

const discGeometry = new CircleGeometry(1, 48);
const ringGeometry = new RingGeometry(0.94, 1, 48);
const waveGeometry = new RingGeometry(0.88, 1, 56);
const rockGeometry = new OctahedronGeometry(0.28);
const rockMaterial = new MeshBasicMaterial({ color: '#c8d2f0' });

const flat = (geometry: CircleGeometry | RingGeometry, color: string, opacity: number): Mesh => {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 4;
  return mesh;
};

const outlined = <T extends Mesh>(mesh: T): T => {
  mesh.castShadow = true;
  addOutline(mesh);
  return mesh;
};

/**
 * The island's guardian: a floating-stone golem with three phases. Each attack is announced on the ground
 * for at least half a second before it lands, and the fight gets faster and busier as its health falls.
 */
export class Boss {
  readonly view = new Group();
  readonly position: Vector3;
  readonly home: Vector3;
  readonly cfg: typeof balance.enemies.boss;
  readonly level: number;
  readonly kind = 'melee' as const;
  readonly radius = RADIUS;
  hp: number;
  aura: Element | null = null;
  electroTicks = 0;
  electroTimer = 0;
  awake = false;
  phase = 1;
  private auraTimer = 0;
  private flash = 0;
  private cooldown = 1.6;
  /** The attack in progress: `windup` seconds of warning, then the strike and a short recovery up to `duration`. */
  private doing: { attack: Attack; elapsed: number; windup: number; duration: number } | null = null;
  private last: Attack | null = null;
  private forced: Attack | null = null;
  private clock = 0;
  private deathClock = 0;
  private readonly telegraphs: Telegraph[] = [];
  private readonly waves: Wave[] = [];
  private readonly stone: MeshToonMaterial;
  private readonly dark: MeshToonMaterial;
  private readonly glow: MeshBasicMaterial;
  private readonly body = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly orbiters: Mesh[] = [];
  private readonly auraOrb = new Mesh(new SphereGeometry(0.2, 10, 8), new MeshBasicMaterial());
  /** How far the arms are raised, 0 to 1, easing toward what the current attack wants. */
  private lift = 0;

  constructor(defeated: boolean, private readonly host: BossHost, private readonly parent: Object3D, level: number = balance.enemyLevels.bossLevel) {
    this.level = level;
    this.cfg = scaledStats(balance.enemies.boss, level);
    const [x, z] = this.cfg.home;
    this.home = new Vector3(x, terrainHeight(x, z), z);
    this.position = this.home.clone();
    this.hp = defeated ? 0 : this.cfg.hp;
    this.stone = toonMaterial('#8a94b4');
    this.dark = toonMaterial('#4d5573');
    this.glow = new MeshBasicMaterial({ color: PHASE_GLOW[0] });
    this.build();
    this.view.visible = !defeated;
    this.deathClock = defeated ? 99 : 0;
    this.syncView();
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get ratio(): number {
    return Math.max(0, this.hp / this.cfg.hp);
  }

  setAura(element: Element | null): void {
    this.aura = element;
    this.auraTimer = balance.combat.auraDuration;
    this.auraOrb.visible = element !== null;
    if (element) {
      const colors = { fire: '#ff7a45', water: '#45b6ff', thunder: '#b97aff' };
      (this.auraOrb.material as MeshBasicMaterial).color.set(colors[element]);
    }
  }

  /** Returns what was dealt; a sleeping or defeated boss takes nothing. */
  hurt(amount: number): number {
    if (!this.alive || !this.awake) return 0;
    this.hp -= amount;
    this.flash = 0.1;
    if (!this.alive) {
      this.clearWarnings();
      this.setAura(null);
      this.doing = null;
      return amount;
    }
    const next = this.ratio <= 0.34 ? 3 : this.ratio <= 0.67 ? 2 : 1;
    if (next > this.phase) {
      this.phase = next;
      this.glow.color.set(PHASE_GLOW[next - 1]);
      this.host.announce(next === 2 ? 'boss.phase2' : 'boss.phase3');
      // Each new phase opens with a ground-shaking shockwave, so the change is felt as well as read.
      this.forced = 'wave';
      this.cooldown = Math.min(this.cooldown, 0.5);
    }
    return amount;
  }

  /** The guardian wears no shell to crack. */
  breakArmor(): void {}

  /** The guardian does not budge from blows. */
  push(_from?: Vector3, _force?: number): void {}

  /** Returns false always: the boss deals its own damage through the host. */
  update(dt: number, player: Vector3, playerAlive: boolean, _camera?: Camera): boolean {
    this.clock += dt;
    if (!this.alive) {
      this.updateDeath(dt);
      return false;
    }
    this.flash = Math.max(0, this.flash - dt);
    this.tickAura(dt);
    const away = new Vector3().subVectors(player, this.position).setY(0);
    const distance = away.length();

    if (!this.awake) {
      if (playerAlive && distance < WAKE_RANGE) this.awake = true;
      this.syncView(dt);
      return false;
    }
    if (!playerAlive || new Vector3().subVectors(this.home, player).setY(0).length() > this.cfg.leashRange) {
      this.reset();
      return false;
    }

    this.player.copy(player);
    this.updateTelegraphs(dt);
    this.updateWaves(dt, player);
    this.face(away, dt);

    if (this.doing) {
      this.doing.elapsed += dt;
      if (this.doing.elapsed >= this.doing.duration) {
        this.doing = null;
        this.cooldown = [1.5, 1.1, 0.75][this.phase - 1];
      }
    } else {
      // Close the gap between attacks so the fight stays in reach of the player's sword.
      if (distance > 4.6) {
        const speed = this.cfg.speed * (1 + (this.phase - 1) * 0.25);
        this.position.addScaledVector(away.normalize(), speed * dt);
      }
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.begin(this.choose(distance), player);
    }
    this.position.y = terrainHeight(this.position.x, this.position.z);
    this.syncView(dt);
    return false;
  }

  private choose(distance: number): Attack {
    if (this.forced) {
      const forced = this.forced;
      this.forced = null;
      return forced;
    }
    const pool: Attack[] = ['slam', 'rocks'];
    if (this.phase >= 2) pool.push('wave');
    if (this.phase >= 3) pool.push('meteor');
    // Up close the slam is the natural answer; at range, throw stones.
    const weighted: Attack[] = distance < 8 ? [...pool, 'slam'] : [...pool, 'rocks'];
    const options = weighted.filter((attack) => attack !== this.last);
    return options[Math.floor(Math.random() * options.length)];
  }

  private begin(attack: Attack, player: Vector3): void {
    this.last = attack;
    const hurry = this.phase === 3 ? 0.8 : 1;
    if (attack === 'slam') {
      const windup = 1.0 * hurry;
      this.doing = { attack, elapsed: 0, windup, duration: windup + 0.5 };
      this.telegraph(this.position, SLAM_RADIUS, windup, () => {
        this.host.burst(this.position, SLAM_RADIUS, '#ffffff', 0.45);
        this.host.shake(0.35);
        if (this.flatDistance(this.player) <= SLAM_RADIUS + 0.3) this.host.hurtPlayer(this.cfg.damage + 4);
      });
    } else if (attack === 'rocks') {
      const windup = 0.85 * hurry;
      this.doing = { attack, elapsed: 0, windup, duration: windup + 0.4 };
      const count = this.phase === 1 ? 3 : 5;
      const target = player.clone();
      // A pale lane per stone shows where it will fly before it does.
      const fan: Vector3[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i - (count - 1) / 2) * 0.3;
        const direction = new Vector3().subVectors(target, this.position).setY(0).normalize();
        direction.applyAxisAngle(new Vector3(0, 1, 0), angle);
        fan.push(direction);
        this.lane(direction, windup);
      }
      this.pendingFire(windup, () => {
        for (const direction of fan) {
          const from = this.position.clone().setY(this.position.y + 2.4);
          this.host.shoot(from, direction.clone().multiplyScalar(13), Math.round(this.cfg.damage * 0.6));
        }
        this.host.shake(0.15);
      });
    } else if (attack === 'wave') {
      const windup = 0.9 * hurry;
      this.doing = { attack, elapsed: 0, windup, duration: windup + 1.2 };
      this.telegraph(this.position, WAVE_END, windup, () => this.spawnWave(), 0.12);
    } else {
      const windup = 1.3;
      this.doing = { attack, elapsed: 0, windup, duration: windup + 1.4 };
      for (let i = 0; i < 4; i++) {
        const spot = player.clone();
        if (i > 0) {
          const angle = Math.random() * Math.PI * 2;
          const reach = 2 + Math.random() * 4;
          spot.x += Math.cos(angle) * reach;
          spot.z += Math.sin(angle) * reach;
        }
        spot.y = terrainHeight(spot.x, spot.z);
        this.telegraph(spot, METEOR_RADIUS, windup, () => {
          this.host.burst(spot, METEOR_RADIUS, '#ffb070', 0.4);
          this.host.shake(0.2);
          if (this.flatDistance(this.player, spot) <= METEOR_RADIUS + 0.3) this.host.hurtPlayer(18);
        }, 0.12, i * 0.3);
      }
    }
  }

  /** The player's last known position, kept fresh in `update` so delayed hits judge where they are now. */
  private player = new Vector3();

  private flatDistance(a: Vector3, b: Vector3 = this.position): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private telegraph(at: Vector3, radius: number, seconds: number, fire: () => void, discOpacity = 0.35, delay = 0): void {
    const disc = flat(discGeometry, '#ff4a3a', discOpacity);
    const ring = flat(ringGeometry, '#ffd0c0', 0.9);
    for (const mesh of [disc, ring]) {
      mesh.position.set(at.x, at.y + 0.5, at.z);
      mesh.scale.setScalar(radius);
      this.parent.add(mesh);
    }
    disc.scale.setScalar(0.001);
    this.telegraphs.push({ disc, ring, radius, age: -delay, total: seconds, fire });
    if (delay > 0) {
      disc.visible = false;
      ring.visible = false;
    }
  }

  /** A narrow pale strip from the boss along a direction: the path of a thrown stone. */
  private lane(direction: Vector3, seconds: number): void {
    const length = 16;
    const strip = new Mesh(
      new PlaneGeometry(0.7, length),
      new MeshBasicMaterial({ color: '#ffd0c0', transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.z = length / 2;
    strip.renderOrder = 4;
    const holder = new Group();
    holder.position.set(this.position.x, this.position.y + 0.5, this.position.z);
    holder.rotation.y = Math.atan2(direction.x, direction.z);
    holder.add(strip);
    this.parent.add(holder);
    this.telegraphs.push({
      disc: strip,
      ring: strip,
      radius: 0,
      age: 0,
      total: seconds,
      fire: () => {
        holder.removeFromParent();
        strip.geometry.dispose();
      },
    });
  }

  private pendingFire(seconds: number, fire: () => void): void {
    const ghost = flat(discGeometry, '#000000', 0);
    ghost.visible = false;
    this.telegraphs.push({ disc: ghost, ring: ghost, radius: 0, age: 0, total: seconds, fire });
  }

  private spawnWave(): void {
    const mesh = flat(waveGeometry, '#ffb070', 0.8);
    mesh.position.set(this.position.x, this.position.y + 0.55, this.position.z);
    mesh.scale.setScalar(WAVE_START);
    this.parent.add(mesh);
    this.waves.push({ mesh, radius: WAVE_START, hit: false });
    this.host.shake(0.3);
  }

  private updateTelegraphs(dt: number): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.age += dt;
      if (t.age < 0) continue;
      t.disc.visible = t.ring.visible = true;
      if (t.radius > 0) t.disc.scale.setScalar(Math.max(0.001, t.radius * Math.min(1, t.age / t.total)));
      if (t.age >= t.total) {
        t.fire();
        this.disposeTelegraph(t);
        this.telegraphs.splice(i, 1);
      }
    }
  }

  private updateWaves(dt: number, player: Vector3): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i];
      wave.radius += WAVE_SPEED * dt;
      wave.mesh.scale.setScalar(wave.radius);
      (wave.mesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - (wave.radius - WAVE_START) / (WAVE_END - WAVE_START));
      const airborne = player.y - terrainHeight(player.x, player.z) > 0.9;
      const near = Math.abs(this.flatDistance(player) - wave.radius) < 0.9;
      // Jumping or dashing over the ring is the answer to it.
      if (!wave.hit && near && !airborne) {
        wave.hit = true;
        this.host.hurtPlayer(20);
      }
      if (wave.radius >= WAVE_END) {
        wave.mesh.removeFromParent();
        (wave.mesh.material as MeshBasicMaterial).dispose();
        this.waves.splice(i, 1);
      }
    }
  }

  private disposeTelegraph(t: Telegraph): void {
    for (const mesh of new Set([t.disc, t.ring])) {
      mesh.removeFromParent();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  }

  private clearWarnings(): void {
    for (const t of this.telegraphs) this.disposeTelegraph(t);
    this.telegraphs.length = 0;
    for (const wave of this.waves) {
      wave.mesh.removeFromParent();
      (wave.mesh.material as MeshBasicMaterial).dispose();
    }
    this.waves.length = 0;
  }

  /** If the player falls or runs off, the guardian goes back to sleep and heals fully. */
  private reset(): void {
    this.clearWarnings();
    this.awake = false;
    this.phase = 1;
    this.hp = this.cfg.hp;
    this.doing = null;
    this.forced = null;
    this.cooldown = 1.6;
    this.position.copy(this.home);
    this.glow.color.set(PHASE_GLOW[0]);
    this.syncView();
  }

  private updateDeath(dt: number): void {
    this.deathClock += dt;
    this.view.scale.y = Math.max(0.04, 1 - this.deathClock * 0.9);
    if (this.deathClock > 1.4) this.view.visible = false;
  }

  private tickAura(dt: number): void {
    if (!this.aura) return;
    this.auraTimer -= dt;
    if (this.auraTimer <= 0) this.setAura(null);
  }

  private face(away: Vector3, dt: number): void {
    if (away.lengthSq() < 0.01) return;
    const target = Math.atan2(-away.x, -away.z);
    let delta = target - this.view.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.view.rotation.y += delta * Math.min(1, dt * 3);
  }

  private build(): void {
    const { body, stone, dark } = this;
    const legGeometry = new BoxGeometry(0.9, 1.5, 0.9);
    for (const side of [-1, 1]) {
      const leg = outlined(new Mesh(legGeometry, dark));
      leg.position.set(side * 0.8, 0.75, 0);
      body.add(leg);
    }
    const torso = outlined(new Mesh(new DodecahedronGeometry(1.5), stone));
    torso.scale.set(1.15, 1, 0.9);
    torso.position.y = 2.6;
    body.add(torso);
    const core = new Mesh(new OctahedronGeometry(0.45), this.glow);
    core.position.set(0, 2.7, -1.25);
    body.add(core);

    const head = outlined(new Mesh(new BoxGeometry(1.2, 0.95, 1.05), stone));
    head.position.y = 4.35;
    const eyes = new Mesh(new BoxGeometry(0.95, 0.16, 0.06), this.glow);
    eyes.position.set(0, 4.4, -0.55);
    const crown = outlined(new Mesh(new ConeGeometry(0.28, 0.7, 6), dark));
    crown.position.y = 5.1;
    body.add(head, eyes, crown);

    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 1.85, 3.5, 0);
      const upper = outlined(new Mesh(new CylinderGeometry(0.38, 0.45, 1.7, 8), stone));
      upper.position.y = -0.85;
      const fist = outlined(new Mesh(new DodecahedronGeometry(0.72), dark));
      fist.position.y = -1.85;
      arm.add(upper, fist);
      body.add(arm);
    }

    // Loose stones circling the head: the floating-island theme, and a read on how angry it is.
    for (let i = 0; i < 5; i++) {
      const rock = new Mesh(rockGeometry, rockMaterial);
      rock.scale.setScalar(1.4);
      this.orbiters.push(rock);
      body.add(rock);
    }
    this.auraOrb.position.y = 6;
    this.auraOrb.visible = false;
    body.add(this.auraOrb);
    this.view.add(body);
  }

  private syncView(dt = 1 / 60): void {
    this.view.position.copy(this.position);
    const t = this.clock;
    const move = this.doing;
    const winding = move !== null && move.elapsed < move.windup;
    this.lift = MathUtils.damp(this.lift, winding ? 1 : 0, 8, dt);
    // Raised arms announce a slam, wave or meteor; for stones they reach forward instead.
    const reach = move?.attack === 'rocks' ? 0.5 : 1;
    const swing = move ? 0 : Math.sin(t * 1.6) * 0.12;
    this.armL.rotation.x = -this.lift * 2.5 * reach + swing;
    this.armR.rotation.x = -this.lift * 2.5 * reach - swing;
    this.body.position.y = Math.sin(t * 1.4) * 0.08 + this.lift * 0.25;
    this.body.scale.y = 1 + Math.sin(t * 1.8) * 0.012;
    this.orbiters.forEach((rock, i) => {
      const angle = t * (0.8 + this.phase * 0.35) + (i * Math.PI * 2) / this.orbiters.length;
      rock.position.set(Math.cos(angle) * 2.3, 4.6 + Math.sin(t * 2 + i) * 0.35, Math.sin(angle) * 2.3);
      rock.rotation.y = angle * 2;
    });
    const hot = this.flash > 0 ? 1 : winding ? 0.35 : 0;
    for (const material of [this.stone, this.dark]) material.emissive.setRGB(hot, hot * 0.85, hot * 0.85);
  }
}
