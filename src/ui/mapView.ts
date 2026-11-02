import { Color, type Vector3 } from 'three';
import { exploration, type ExplorationProgress } from '../exploration/progress';
import { FOG_CELLS, MAP_EXTENT } from '../map/fogGrid';
import { mapConfig, type MapProgress, type Waypoint } from '../map/mapProgress';
import { edgeRatio, slopeAt, surfaceColor, terrainHeight } from '../world/terrain';
import { t, type TextKey } from './i18n';

const BASE_SIZE = 200;
const FULL_SIZE = 720;
const MINI_SIZE = 240;
const MINI_RANGE = 70;
const FOG_COLOR = 'rgb(18 22 48 / 92%)';
const MINI_REFRESH = 0.2;
const WAYPOINT_HIT = 9;

const TIMES: Array<[TextKey, number]> = [
  ['map.time.dawn', 0.3],
  ['map.time.noon', 0.5],
  ['map.time.dusk', 0.7],
  ['map.time.night', 0.9],
];

const toMap = (world: number): number => (world + MAP_EXTENT) / (MAP_EXTENT * 2);

const renderBase = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BASE_SIZE;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(BASE_SIZE, BASE_SIZE);
  const color = new Color();
  for (let row = 0; row < BASE_SIZE; row++) {
    for (let column = 0; column < BASE_SIZE; column++) {
      const x = ((column + 0.5) / BASE_SIZE) * MAP_EXTENT * 2 - MAP_EXTENT;
      const z = ((row + 0.5) / BASE_SIZE) * MAP_EXTENT * 2 - MAP_EXTENT;
      if (edgeRatio(x, z) > 1) continue;
      const y = terrainHeight(x, z);
      surfaceColor(x, z, y, slopeAt(x, z), color);
      const relief = 1 + Math.max(0, y - 3) * 0.006;
      const at = (row * BASE_SIZE + column) * 4;
      image.data[at] = Math.min(255, Math.pow(color.r, 1 / 2.2) * 255 * relief);
      image.data[at + 1] = Math.min(255, Math.pow(color.g, 1 / 2.2) * 255 * relief);
      image.data[at + 2] = Math.min(255, Math.pow(color.b, 1 / 2.2) * 255 * relief);
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

const button = (parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement => {
  const node = document.createElement('button');
  node.textContent = label;
  node.addEventListener('click', onClick);
  parent.append(node);
  return node;
};

export interface MapViewEvents {
  opened(): void;
  closed(): void;
  teleport(point: Waypoint): void;
  setTime(timeOfDay: number): void;
  changed(): void;
}

export class MapView {
  open = false;
  private readonly base = renderBase();
  private readonly fog = document.createElement('canvas');
  private readonly mini = document.createElement('canvas');
  private readonly full = document.createElement('canvas');
  private readonly overlay = document.createElement('div');
  private readonly teleportButton: HTMLButtonElement;
  private readonly timeButtons: HTMLButtonElement[] = [];
  private selected: Waypoint | null = null;
  private refresh = 0;
  private readonly player = { x: 0, z: 0, facingX: 0, facingZ: -1 };

  constructor(
    root: HTMLElement,
    private readonly map: MapProgress,
    private readonly found: ExplorationProgress,
    private readonly events: MapViewEvents,
  ) {
    this.fog.width = this.fog.height = FOG_CELLS;
    const fog = this.fog.getContext('2d')!;
    fog.fillStyle = FOG_COLOR;
    fog.fillRect(0, 0, FOG_CELLS, FOG_CELLS);
    for (let row = 0; row < FOG_CELLS; row++) {
      for (let column = 0; column < FOG_CELLS; column++) {
        if (map.fog.isRevealed(column, row)) fog.clearRect(column, row, 1, 1);
      }
    }

    this.mini.className = 'minimap';
    this.mini.width = this.mini.height = MINI_SIZE;
    this.mini.addEventListener('click', () => this.show());
    root.append(this.mini);

    this.overlay.className = 'map-overlay';
    this.full.className = 'map-canvas';
    this.full.width = this.full.height = FULL_SIZE;
    this.full.addEventListener('click', (event) => this.clickMap(event));
    const side = document.createElement('div');
    side.className = 'map-side';
    const title = document.createElement('h2');
    title.textContent = t('map.title');
    const hint = document.createElement('p');
    hint.textContent = t('map.hint');
    side.append(title, hint);
    this.teleportButton = button(side, t('map.teleport'), () => {
      if (this.selected) this.events.teleport(this.selected);
    });
    const times = document.createElement('div');
    times.className = 'map-times';
    for (const [label, value] of TIMES) {
      this.timeButtons.push(button(times, t(label), () => this.events.setTime(value)));
    }
    side.append(times);
    button(side, t('map.close'), () => this.hide());
    this.overlay.append(this.full, side);
    root.append(this.overlay);

    addEventListener('keydown', (event) => {
      if (this.open && event.code === 'Escape') this.hide();
    });
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.selected = null;
    this.overlay.classList.add('on');
    this.events.opened();
    this.syncControls();
    this.drawFull();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.overlay.classList.remove('on');
    this.events.closed();
  }

  update(dt: number, position: Vector3, facing: Vector3): void {
    this.player.x = position.x;
    this.player.z = position.z;
    this.player.facingX = facing.x;
    this.player.facingZ = facing.z;
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = MINI_REFRESH;
    const fresh = this.map.fog.reveal(position.x, position.z, mapConfig.revealRadius);
    const fog = this.fog.getContext('2d')!;
    for (const [column, row] of fresh) fog.clearRect(column, row, 1, 1);
    this.drawMini();
  }

  private syncControls(): void {
    this.teleportButton.disabled = this.selected === null;
    const near = this.nearestWaypointDistance() <= mapConfig.adjustTimeRange;
    for (const node of this.timeButtons) node.disabled = !near;
  }

  private nearestWaypointDistance(): number {
    const point = this.map.nearestUnlocked(this.player.x, this.player.z);
    return Math.hypot(point.x - this.player.x, point.z - this.player.z);
  }

  private clickMap(event: MouseEvent): void {
    const rect = this.full.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * MAP_EXTENT * 2 - MAP_EXTENT;
    const z = ((event.clientY - rect.top) / rect.height) * MAP_EXTENT * 2 - MAP_EXTENT;
    const hit = mapConfig.waypoints.find(
      (point) => this.map.isUnlocked(point.id) && Math.hypot(point.x - x, point.z - z) <= WAYPOINT_HIT,
    );
    if (hit) {
      this.selected = hit;
    } else {
      this.selected = null;
      this.map.toggleMarker(x, z);
      this.events.changed();
    }
    this.syncControls();
    this.drawFull();
  }

  private isRevealedAt(x: number, z: number): boolean {
    return this.map.fog.isRevealed(Math.floor(toMap(x) * FOG_CELLS), Math.floor(toMap(z) * FOG_CELLS));
  }

  private drawOverlays(context: CanvasRenderingContext2D, place: (x: number, z: number) => [number, number], scale: number): void {
    context.fillStyle = '#fff0b0';
    for (const point of exploration.points) {
      if (!this.found.has(point.id)) continue;
      const [px, py] = place(point.x, point.z);
      context.beginPath();
      context.arc(px, py, 3 * scale, 0, Math.PI * 2);
      context.fill();
    }
    for (const point of mapConfig.waypoints) {
      if (!this.isRevealedAt(point.x, point.z)) continue;
      const [px, py] = place(point.x, point.z);
      const size = 8 * scale;
      context.fillStyle = this.map.isUnlocked(point.id) ? '#7fe6ff' : '#8f93a8';
      context.beginPath();
      context.moveTo(px, py - size);
      context.lineTo(px + size, py);
      context.lineTo(px, py + size);
      context.lineTo(px - size, py);
      context.closePath();
      context.fill();
      if (point === this.selected) {
        context.strokeStyle = '#ffffff';
        context.lineWidth = 3 * scale;
        context.stroke();
      }
    }
    context.fillStyle = '#ff6a6a';
    for (const [x, z] of this.map.markers) {
      const [px, py] = place(x, z);
      context.beginPath();
      context.arc(px, py, 6 * scale, 0, Math.PI * 2);
      context.fill();
    }
    const [px, py] = place(this.player.x, this.player.z);
    const angle = Math.atan2(this.player.facingX, -this.player.facingZ);
    context.save();
    context.translate(px, py);
    context.rotate(angle);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#2b2230';
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.moveTo(0, -11 * scale);
    context.lineTo(8 * scale, 9 * scale);
    context.lineTo(0, 4 * scale);
    context.lineTo(-8 * scale, 9 * scale);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawFull(): void {
    const context = this.full.getContext('2d')!;
    context.clearRect(0, 0, FULL_SIZE, FULL_SIZE);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.base, 0, 0, FULL_SIZE, FULL_SIZE);
    context.drawImage(this.fog, 0, 0, FULL_SIZE, FULL_SIZE);
    this.drawOverlays(context, (x, z) => [toMap(x) * FULL_SIZE, toMap(z) * FULL_SIZE], 1.4);
  }

  private drawMini(): void {
    const context = this.mini.getContext('2d')!;
    context.clearRect(0, 0, MINI_SIZE, MINI_SIZE);
    context.save();
    context.beginPath();
    context.arc(MINI_SIZE / 2, MINI_SIZE / 2, MINI_SIZE / 2, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = 'rgb(18 22 48 / 70%)';
    context.fillRect(0, 0, MINI_SIZE, MINI_SIZE);
    const range = MINI_RANGE / (MAP_EXTENT * 2);
    const u = toMap(this.player.x) - range;
    const v = toMap(this.player.z) - range;
    for (const [image, size] of [[this.base, BASE_SIZE], [this.fog, FOG_CELLS]] as const) {
      context.drawImage(image, u * size, v * size, range * 2 * size, range * 2 * size, 0, 0, MINI_SIZE, MINI_SIZE);
    }
    const zoom = MINI_SIZE / (MINI_RANGE * 2);
    this.drawOverlays(
      context,
      (x, z) => [(x - this.player.x) * zoom + MINI_SIZE / 2, (z - this.player.z) * zoom + MINI_SIZE / 2],
      1.2,
    );
    context.restore();
  }
}
