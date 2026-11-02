import { describe, expect, it } from 'vitest';
import { reactionOf } from '../combat/reactions';
import { exploration, ExplorationProgress, puzzleResponds } from '../exploration/progress';
import { nextEnemyState, type EnemySenses } from '../enemies/fsm';
import { Stamina } from '../player/stamina';
import { defaultSave, migrateSave, SAVE_VERSION } from '../save/saveData';
import { cellsAround } from '../world/streaming';
import { edgeRatio, ISLAND_RADIUS, terrainHeight } from '../world/terrain';

describe('reactionOf', () => {
  it('maps every element pair in both orders', () => {
    expect(reactionOf('fire', 'water')).toBe('vaporize');
    expect(reactionOf('water', 'fire')).toBe('vaporize');
    expect(reactionOf('fire', 'thunder')).toBe('overload');
    expect(reactionOf('thunder', 'fire')).toBe('overload');
    expect(reactionOf('water', 'thunder')).toBe('electroCharged');
    expect(reactionOf('thunder', 'water')).toBe('electroCharged');
  });

  it('does not react with no aura or the same element', () => {
    expect(reactionOf(null, 'fire')).toBeNull();
    expect(reactionOf('fire', 'fire')).toBeNull();
  });
});

describe('Stamina', () => {
  it('refuses a cost it cannot pay', () => {
    const stamina = new Stamina();
    stamina.value = 10;
    expect(stamina.spend(20)).toBe(false);
    expect(stamina.value).toBe(10);
  });

  it('regenerates only after the delay', () => {
    const stamina = new Stamina();
    stamina.drain(50);
    stamina.update(0.1);
    expect(stamina.value).toBe(50);
    stamina.update(1);
    expect(stamina.value).toBeGreaterThan(50);
  });
});

describe('nextEnemyState', () => {
  const senses = (over: Partial<EnemySenses>): EnemySenses => ({
    distanceToPlayer: 50,
    distanceFromHome: 0,
    aggroRange: 10,
    attackRange: 2,
    leashRange: 20,
    playerAlive: true,
    ...over,
  });

  it('walks the patrol, chase, attack path', () => {
    expect(nextEnemyState('patrol', senses({ distanceToPlayer: 8 }))).toBe('chase');
    expect(nextEnemyState('chase', senses({ distanceToPlayer: 1.5 }))).toBe('attack');
    expect(nextEnemyState('attack', senses({ distanceToPlayer: 5 }))).toBe('chase');
  });

  it('returns home past the leash and when the player dies', () => {
    expect(nextEnemyState('chase', senses({ distanceFromHome: 25, distanceToPlayer: 3 }))).toBe('return');
    expect(nextEnemyState('attack', senses({ distanceFromHome: 5, playerAlive: false }))).toBe('return');
    expect(nextEnemyState('return', senses({ distanceFromHome: 0.5 }))).toBe('patrol');
  });
});

describe('migrateSave', () => {
  it('falls back on unreadable or future saves', () => {
    expect(migrateSave(null)).toEqual(defaultSave());
    expect(migrateSave({ version: 99 })).toEqual(defaultSave());
    expect(migrateSave({ version: 3, position: [Number.NaN, 0, 0] })).toEqual(defaultSave());
  });

  it('upgrades a version 1 save and keeps its position', () => {
    const save = migrateSave({ version: 1, position: [1, 2, 3], cameraYaw: 1, hp: 40, activeCharacter: 2 });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.position).toEqual([1, 2, 3]);
    expect(save.hp).toBe(40);
    expect(save.timeOfDay).toBe(defaultSave().timeOfDay);
    expect(save.discovered).toEqual([]);
  });

  it('keeps exploration progress in a current save', () => {
    const save = migrateSave({ ...defaultSave(), discovered: ['chest-ruins'], coins: 50 });
    expect(save.discovered).toEqual(['chest-ruins']);
    expect(save.coins).toBe(50);
  });
});

describe('cellsAround', () => {
  it('returns the full square, nearest cell first', () => {
    const cells = cellsAround(10, 10, 64, 1);
    expect(cells).toHaveLength(9);
    expect(cells[0].key).toBe('0,0');
  });

  it('handles negative coordinates', () => {
    expect(cellsAround(-1, -1, 64, 0)[0].key).toBe('-1,-1');
  });
});

describe('terrainHeight', () => {
  it('keeps the middle above the clouds and drops off the edge', () => {
    expect(terrainHeight(0, 0)).toBeGreaterThan(0);
    expect(terrainHeight(ISLAND_RADIUS * 2, 0)).toBeLessThan(-30);
  });

  it('flattens to a low shore before the cliff', () => {
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      let radius = 0;
      while (edgeRatio(Math.cos(angle) * radius, Math.sin(angle) * radius) < 0.91) radius += 1;
      const height = terrainHeight(Math.cos(angle) * radius, Math.sin(angle) * radius);
      expect(height).toBeGreaterThan(1);
      expect(height).toBeLessThan(5);
    }
  });
});

describe('exploration', () => {
  const chest = exploration.points.find((p) => p.kind === 'chest')!;
  const flame = exploration.points.find((p) => p.id === 'seal-flame')!;

  it('pays a point only once', () => {
    const progress = new ExplorationProgress([], 0, 0);
    expect(progress.claim(chest)).toEqual(exploration.rewards.chest);
    expect(progress.claim(chest)).toBeNull();
    expect(progress.coins).toBe(exploration.rewards.chest.coins);
    expect(progress.count).toBe(1);
  });

  it('restores what was already found', () => {
    expect(new ExplorationProgress([chest.id], 50, 0).claim(chest)).toBeNull();
  });

  it('opens a puzzle only with its element and in reach', () => {
    expect(puzzleResponds(flame, 'fire', 3, 4)).toBe(true);
    expect(puzzleResponds(flame, 'water', 3, 4)).toBe(false);
    expect(puzzleResponds(flame, 'fire', 9, 4)).toBe(false);
    expect(puzzleResponds(chest, 'fire', 0, 4)).toBe(false);
  });

  it('has unique ids on solid ground, with one of each kind', () => {
    expect(new Set(exploration.points.map((p) => p.id)).size).toBe(exploration.points.length);
    expect(exploration.points.length).toBeGreaterThanOrEqual(20);
    for (const point of exploration.points) {
      expect(edgeRatio(point.x, point.z), point.id).toBeLessThan(0.88);
      expect(terrainHeight(point.x, point.z), point.id).toBeGreaterThan(1);
    }
  });

  it('keeps something within 50 m of everywhere on the island', () => {
    for (let x = -150; x <= 150; x += 6) {
      for (let z = -150; z <= 150; z += 6) {
        if (edgeRatio(x, z) > 0.86) continue;
        const nearest = Math.min(...exploration.points.map((p) => Math.hypot(p.x - x, p.z - z)));
        expect(nearest, `${x},${z}`).toBeLessThanOrEqual(50);
      }
    }
  });
});
