import type { EnemyKind } from '../enemies/enemy';

/** Where every ordinary enemy lives: kind, then x and z. */
export const SPAWNS: Array<[EnemyKind, number, number]> = [
  ['melee', 18, 12],
  ['melee', 21, 9],
  ['melee', -10, 26],
  ['melee', -26, -14],
  ['ranged', 30, -2],
  ['ranged', -18, 24],
  ['melee', -86, -50],
  ['melee', -96, -62],
  ['ranged', -84, -64],
  ['melee', 98, -2],
  ['ranged', 108, -14],
  ['charger', 62, -34],
  ['charger', -58, 56],
  ['charger', 88, 30],
  ['bomber', 28, 48],
  ['bomber', -34, -40],
  ['bomber', -70, -8],
  ['bomber', 50, -90],
  ['guard', -64, -48],
  ['guard', 72, 66],
  ['guard', -12, -60],
];
