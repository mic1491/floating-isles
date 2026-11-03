import { Color, CylinderGeometry, DoubleSide, Group, Mesh, Quaternion, Vector3, type MeshToonMaterial } from 'three';
import { toonMaterial } from '../render/toon';

const RADIUS = 2.2;
const ARC = 1.2;
const CREST = 2.15;
const WHITE = new Color('#ffffff');
const UP = new Vector3(0, 1, 0);

/** A paraglider: an arched cloth canopy tinted by the character, held by four thin lines. */
export class Glider {
  readonly group = new Group();
  private readonly cloth: MeshToonMaterial;

  constructor() {
    this.cloth = toonMaterial('#ffffff');
    this.cloth.side = DoubleSide;
    // A slice of a short cylinder lying on its side makes a gently drooping wing.
    const canopy = new Mesh(new CylinderGeometry(RADIUS, RADIUS, 1, 24, 1, true, Math.PI - ARC / 2, ARC), this.cloth);
    canopy.rotation.x = Math.PI / 2;
    canopy.position.y = CREST - RADIUS;
    canopy.castShadow = true;
    this.group.add(canopy);

    const edge = Math.sin(ARC / 2) * RADIUS;
    const drop = CREST - RADIUS * (1 - Math.cos(ARC / 2)) - 0.05;
    const line = toonMaterial('#f2ead8');
    for (const side of [-1, 1]) {
      for (const depth of [-0.4, 0.4]) {
        this.group.add(this.rod(new Vector3(side * edge, drop, depth), new Vector3(side * 0.22, 1.3, depth * 0.25), line));
      }
    }
    this.group.visible = false;
  }

  setColor(color: string): void {
    this.cloth.color.set(color).lerp(WHITE, 0.45);
  }

  private rod(from: Vector3, to: Vector3, material: MeshToonMaterial): Mesh {
    const direction = to.clone().sub(from);
    const mesh = new Mesh(new CylinderGeometry(0.012, 0.012, direction.length(), 4), material);
    mesh.position.copy(from).addScaledVector(direction, 0.5);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
    return mesh;
  }
}
