import { describe, expect, it } from 'vitest';
import { reactionOf } from '../combat/reactions';
import { exploration, ExplorationProgress, puzzleResponds } from '../exploration/progress';
import { nextEnemyState, type EnemySenses } from '../enemies/fsm';
import { FogGrid } from '../map/fogGrid';
import { mapConfig, MapProgress } from '../map/mapProgress';
import { computePose, type Motion } from '../player/avatarPose';
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

  it('adds empty map progress to a version 3 save', () => {
    const save = migrateSave({ ...defaultSave(), version: 3, coins: 80 });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.coins).toBe(80);
    expect(save.waypoints).toEqual([]);
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

describe('FogGrid', () => {
  it('reveals around a point and only reports new cells once', () => {
    const fog = new FogGrid();
    expect(fog.reveal(0, 0, 30).length).toBeGreaterThan(0);
    expect(fog.reveal(0, 0, 30)).toEqual([]);
    expect(fog.isRevealed(50, 50)).toBe(true);
    expect(fog.isRevealed(0, 0)).toBe(false);
  });

  it('survives a round trip and ignores damaged data', () => {
    const fog = new FogGrid();
    fog.reveal(-40, 60, 25);
    const copy = FogGrid.decode(fog.encode());
    expect(copy.encode()).toBe(fog.encode());
    expect(FogGrid.decode('').isRevealed(50, 50)).toBe(false);
    expect(FogGrid.decode('not base64!').isRevealed(50, 50)).toBe(false);
  });

  it('keeps cells beyond the map hidden', () => {
    expect(new FogGrid().reveal(1000, 1000, 30)).toEqual([]);
  });
});

describe('MapProgress', () => {
  const fresh = () => new MapProgress('', [], []);

  it('always starts with the starter waypoint', () => {
    const starter = mapConfig.waypoints.find((p) => p.starter)!;
    expect(fresh().isUnlocked(starter.id)).toBe(true);
  });

  it('finds the nearest unlocked waypoint, skipping locked ones', () => {
    const map = fresh();
    const far = mapConfig.waypoints.at(-1)!;
    expect(map.nearestUnlocked(far.x, far.z).id).not.toBe(far.id);
    map.unlock(far.id);
    expect(map.nearestUnlocked(far.x, far.z).id).toBe(far.id);
  });

  it('announces an unlock only once', () => {
    const map = fresh();
    expect(map.unlock('wp-west-coast')).toBe(true);
    expect(map.unlock('wp-west-coast')).toBe(false);
  });

  it('adds, removes and caps markers', () => {
    const map = fresh();
    map.toggleMarker(10, 10);
    expect(map.markers).toHaveLength(1);
    map.toggleMarker(12, 11);
    expect(map.markers).toHaveLength(0);
    for (let i = 0; i < mapConfig.maxMarkers + 5; i++) map.toggleMarker(i * 20, 0);
    expect(map.markers).toHaveLength(mapConfig.maxMarkers);
  });

  it('places every waypoint on solid ground', () => {
    for (const point of mapConfig.waypoints) {
      expect(edgeRatio(point.x, point.z), point.id).toBeLessThan(0.88);
      expect(terrainHeight(point.x, point.z), point.id).toBeGreaterThan(1);
    }
  });
});

describe('computePose', () => {
  const still: Motion = { time: 0, stride: 0, pace: 0, airborne: false, gliding: false, dashing: false, attack: null };

  it('stands with both arms down and mirrored', () => {
    const { bones } = computePose(still);
    expect(bones.leftUpperArm[2]).toBeLessThan(-1);
    expect(bones.rightUpperArm[2]).toBeGreaterThan(1);
    expect(bones.leftUpperLeg[0]).toBeCloseTo(0);
  });

  it('swings legs in opposition while running', () => {
    const { bones } = computePose({ ...still, stride: Math.PI / 2, pace: 1 });
    expect(bones.leftUpperLeg[0]).toBeLessThan(0);
    expect(bones.rightUpperLeg[0]).toBeCloseTo(-bones.leftUpperLeg[0]);
  });

  it('opens the arms to glide', () => {
    const { bones } = computePose({ ...still, airborne: true, gliding: true });
    expect(Math.abs(bones.leftUpperArm[2])).toBeLessThan(0.3);
  });

  it('sweeps the sword arm across the body through a strike', () => {
    const pose = (t: number) => computePose({ ...still, attack: { step: 1, t, id: 1 } }).bones.rightUpperArm[2];
    expect(pose(0.5)).toBeGreaterThan(pose(0.1) + 1);
  });

  it('gives each hit of the combo its own pose', () => {
    const at = (step: number) => computePose({ ...still, attack: { step, t: 0.45, id: step } }).bones.chest;
    const poses = [1, 2, 3, 4].map((step) => at(step).join());
    expect(new Set(poses).size).toBe(4);
  });

  it('returns to the walking pose when a swing ends', () => {
    const rest = computePose(still).bones.rightUpperArm;
    const end = computePose({ ...still, attack: { step: 2, t: 1, id: 1 } }).bones.rightUpperArm;
    expect(end[2]).toBeCloseTo(rest[2], 1);
  });
});
