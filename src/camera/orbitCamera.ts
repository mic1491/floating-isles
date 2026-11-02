import type { RigidBody } from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { balance } from '../core/balance';
import type { Actions } from '../input/actions';
import type { Physics } from '../world/physics';
import { terrainHeight } from '../world/terrain';

const cfg = balance.camera;
const WALL_MARGIN = 0.35;
const GROUND_MARGIN = 0.5;

export class OrbitCamera {
  yaw = 0;
  pitch = 0.32;
  private targetDistance = cfg.defaultDistance;
  private distance = cfg.defaultDistance;
  private readonly focus = new Vector3();
  private readonly offset = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly physics: Physics,
    private readonly ignore: RigidBody,
  ) {}

  update(dt: number, actions: Actions, playerPosition: Vector3): void {
    this.yaw -= actions.lookX;
    this.pitch = MathUtils.clamp(this.pitch + actions.lookY, cfg.minPitch, cfg.maxPitch);
    this.targetDistance = MathUtils.clamp(
      this.targetDistance + actions.zoom * 0.8,
      cfg.minDistance,
      cfg.maxDistance,
    );

    this.focus.copy(playerPosition);
    this.focus.y += 1.3;
    this.offset.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    const free = this.physics.raycast(this.focus, this.offset, this.targetDistance, this.ignore);
    const allowed = Math.max(0.6, free - WALL_MARGIN);
    // Snap in when blocked, ease back out when clear, so the camera never clips a wall.
    this.distance = allowed < this.distance ? allowed : MathUtils.damp(this.distance, allowed, 6, dt);

    const position = this.camera.position.copy(this.focus).addScaledVector(this.offset, this.distance);
    position.y = Math.max(position.y, terrainHeight(position.x, position.z) + GROUND_MARGIN);
    this.camera.lookAt(this.focus);
  }
}
