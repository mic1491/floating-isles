export interface Cell {
  ix: number;
  iz: number;
  key: string;
}

export const cellKey = (ix: number, iz: number): string => `${ix},${iz}`;

export const cellOf = (value: number, size: number): number => Math.floor(value / size);

/** Cells within `radius` cells of a point, nearest first so loading fills outward. */
export const cellsAround = (x: number, z: number, size: number, radius: number): Cell[] => {
  const cx = cellOf(x, size);
  const cz = cellOf(z, size);
  const cells: Array<Cell & { distance: number }> = [];
  for (let ix = cx - radius; ix <= cx + radius; ix++) {
    for (let iz = cz - radius; iz <= cz + radius; iz++) {
      const distance = Math.hypot((ix + 0.5) * size - x, (iz + 0.5) * size - z);
      cells.push({ ix, iz, key: cellKey(ix, iz), distance });
    }
  }
  return cells.sort((a, b) => a.distance - b.distance);
};
