export const MAP_EXTENT = 170;
export const FOG_CELLS = 100;

const CELL_SIZE = (MAP_EXTENT * 2) / FOG_CELLS;
const BYTES = Math.ceil((FOG_CELLS * FOG_CELLS) / 8);

const cellCentre = (cell: number): number => (cell + 0.5) * CELL_SIZE - MAP_EXTENT;

/** One bit per map cell: has the player been near it? */
export class FogGrid {
  private readonly bits = new Uint8Array(BYTES);

  static decode(text: string): FogGrid {
    const grid = new FogGrid();
    try {
      const raw = atob(text);
      if (raw.length === BYTES) grid.bits.set(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    } catch {
      // A damaged fog string only costs the player their revealed map, never the save.
    }
    return grid;
  }

  encode(): string {
    return btoa(String.fromCharCode(...this.bits));
  }

  isRevealed(column: number, row: number): boolean {
    if (column < 0 || row < 0 || column >= FOG_CELLS || row >= FOG_CELLS) return false;
    const i = row * FOG_CELLS + column;
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** Clears the fog around a point and returns the cells that were newly revealed. */
  reveal(x: number, z: number, radius: number): Array<[number, number]> {
    const fresh: Array<[number, number]> = [];
    const reach = Math.ceil(radius / CELL_SIZE);
    const cx = Math.floor((x + MAP_EXTENT) / CELL_SIZE);
    const cz = Math.floor((z + MAP_EXTENT) / CELL_SIZE);
    for (let row = Math.max(0, cz - reach); row <= Math.min(FOG_CELLS - 1, cz + reach); row++) {
      for (let column = Math.max(0, cx - reach); column <= Math.min(FOG_CELLS - 1, cx + reach); column++) {
        if (Math.hypot(cellCentre(column) - x, cellCentre(row) - z) > radius) continue;
        if (this.isRevealed(column, row)) continue;
        const i = row * FOG_CELLS + column;
        this.bits[i >> 3] |= 1 << (i & 7);
        fresh.push([column, row]);
      }
    }
    return fresh;
  }
}
