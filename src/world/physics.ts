import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

export class Physics {
  readonly world = new RAPIER.World({ x: 0, y: 0, z: 0 });

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array): void {
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  }

  addBox(center: Vector3, half: Vector3, rotationY = 0): void {
    const s = Math.sin(rotationY / 2);
    const c = Math.cos(rotationY / 2);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: 0, y: s, z: 0, w: c }),
    );
  }

  /** Distance from origin to the first solid along dir, ignoring one body. */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number, ignore: RAPIER.RigidBody): number {
    const hit = this.world.castRay(
      new RAPIER.Ray(origin, dir),
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      ignore,
    );
    return hit ? hit.timeOfImpact : maxDistance;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}
