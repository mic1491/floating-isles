import { Color, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, Vector3 } from 'three';

interface Burst {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

const sphere = new SphereGeometry(1, 16, 12);
const ring = new RingGeometry(0.82, 1, 40);

export class Fx {
  private readonly bursts: Burst[] = [];

  constructor(private readonly scene: Scene) {}

  /** An expanding fading dome, for skill and reaction impacts. */
  dome(at: Vector3, radius: number, color: string, life = 0.4): void {
    this.add(new Mesh(sphere, this.material(color)), at, radius, life);
  }

  /** A flat ground ring, for area attacks. */
  ring(at: Vector3, radius: number, color: string, life = 0.35): void {
    const mesh = new Mesh(ring, this.material(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.material.side = 2;
    this.add(mesh, at.clone().setY(at.y + 0.1), radius, life);
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const t = burst.age / burst.life;
      burst.mesh.scale.setScalar(burst.size * (0.35 + 0.65 * Math.sqrt(t)));
      (burst.mesh.material as MeshBasicMaterial).opacity = 0.75 * (1 - t);
      if (t >= 1) {
        this.scene.remove(burst.mesh);
        (burst.mesh.material as MeshBasicMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private material(color: string): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
  }

  private add(mesh: Mesh, at: Vector3, size: number, life: number): void {
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, size });
  }
}
