import { CanvasTexture, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, Sprite, SpriteMaterial, type Scene, Vector3 } from 'three';
import { addOutline, toonMaterial } from '../render/toon';
import { NPCS, type NpcDef } from '../story/npcs';
import { terrainHeight } from '../world/terrain';

const TALK_RANGE = 2.8;

interface Villager {
  def: NpcDef;
  root: Group;
  position: Vector3;
  phase: number;
}

const nameTag = (text: string): Sprite => {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (canvas) {
    canvas.width = 192;
    canvas.height = 56;
  }
  const context = canvas?.getContext('2d');
  if (canvas && context) {
    context.font = 'bold 34px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 6;
    context.strokeStyle = '#2b2230';
    context.strokeText(text, 96, 30);
    context.fillStyle = '#ffe9a8';
    context.fillText(text, 96, 30);
  }
  const sprite = new Sprite(new SpriteMaterial({ map: canvas ? new CanvasTexture(canvas) : null, depthTest: false, transparent: true }));
  sprite.scale.set(0.9, 0.26, 1);
  sprite.renderOrder = 12;
  return sprite;
};

/** Standing villagers: a simple toon figure with a name over it, turning to face the player when near. */
export class NpcField {
  private readonly villagers: Villager[];
  private near: Villager | null = null;

  constructor(scene: Scene) {
    this.villagers = NPCS.map((def) => {
      const root = new Group();
      const body = new Mesh(new CylinderGeometry(0.3, 0.38, 0.9, 14), toonMaterial(def.color));
      body.position.y = 0.55;
      const head = new Mesh(new SphereGeometry(0.27, 16, 12), toonMaterial('#ffe0c8'));
      head.position.y = 1.35;
      const hair = new Mesh(new ConeGeometry(0.31, 0.4, 12), toonMaterial(def.hair));
      hair.position.y = 1.6;
      for (const mesh of [body, head, hair]) {
        mesh.castShadow = true;
        addOutline(mesh);
        root.add(mesh);
      }
      const tag = nameTag(def.name);
      tag.position.y = 2.1;
      root.add(tag);
      const position = new Vector3(def.x, terrainHeight(def.x, def.z), def.z);
      root.position.copy(position);
      scene.add(root);
      return { def, root, position, phase: def.x };
    });
  }

  /** The villager within talking range, or null. */
  get nearby(): NpcDef | null {
    return this.near?.def ?? null;
  }

  update(dt: number, player: Vector3): void {
    this.near = null;
    let best = TALK_RANGE;
    for (const v of this.villagers) {
      v.phase += dt;
      v.root.position.y = v.position.y + Math.sin(v.phase * 1.8) * 0.015;
      const gap = v.position.distanceTo(player);
      if (gap < 7) {
        const target = Math.atan2(player.x - v.position.x, player.z - v.position.z);
        const diff = Math.atan2(Math.sin(target - v.root.rotation.y), Math.cos(target - v.root.rotation.y));
        v.root.rotation.y += diff * Math.min(1, dt * 5);
      }
      if (gap < best) {
        best = gap;
        this.near = v;
      }
    }
  }
}
