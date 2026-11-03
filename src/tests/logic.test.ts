import { describe, expect, it } from 'vitest';
import { reactionOf } from '../combat/reactions';
import { Group, Vector3 } from 'three';
import { exploration, ExplorationProgress, nextObjective, puzzleResponds } from '../exploration/progress';
import { nextEnemyState, type EnemySenses } from '../enemies/fsm';
import { FogGrid } from '../map/fogGrid';
import { mapConfig, MapProgress } from '../map/mapProgress';
import { computePose, type Motion } from '../player/avatarPose';
import { Stamina } from '../player/stamina';
import { benchShare, damageScale, levelOf, MAX_LEVEL, maxHpFor, totalXpFor, xpToNext } from '../party/growth';
import { FpsWatch } from '../core/fpsWatch';
import { Party } from '../party/party';
import { Boss, type BossHost } from '../enemies/boss';
import { Enemy } from '../enemies/enemy';
import { SPAWNS } from '../combat/combat';
import { countsOf, QuestLog, quests, statusOf, targetOf } from '../quests/quests';
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

describe('next objective', () => {
  const [first] = exploration.points;

  it('points at the closest point not yet found', () => {
    const goal = nextObjective(new ExplorationProgress([], 0, 0), first.x, first.z, 0)!;
    expect(goal.point.id).toBe(first.id);
    const skipped = nextObjective(new ExplorationProgress([first.id], 0, 0), first.x, first.z, 0)!;
    expect(skipped.point.id).not.toBe(first.id);
  });

  it('turns toward the target relative to the camera', () => {
    const progress = new ExplorationProgress(
      exploration.points.filter((p) => p.id !== first.id).map((p) => p.id),
      0,
      0,
    );
    // Camera yaw 0 looks toward -Z, so a target to the north is straight ahead and one to the east is right.
    expect(nextObjective(progress, first.x, first.z + 10, 0)!.bearing).toBeCloseTo(0);
    expect(nextObjective(progress, first.x - 10, first.z, 0)!.bearing).toBeCloseTo(Math.PI / 2);
  });

  it('is null once everything is found', () => {
    const all = new ExplorationProgress(exploration.points.map((p) => p.id), 0, 0);
    expect(nextObjective(all, 0, 0, 0)).toBeNull();
  });
});

describe('character growth', () => {
  it('asks a little more experience for every level and stops at the cap', () => {
    expect(xpToNext(2)).toBeGreaterThan(xpToNext(1));
    expect(xpToNext(MAX_LEVEL)).toBe(0);
    expect(totalXpFor(1)).toBe(0);
    expect(totalXpFor(2)).toBe(xpToNext(1));
  });

  it('turns experience into a level and progress toward the next', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, into: 0 });
    const justShort = levelOf(xpToNext(1) - 1);
    expect(justShort.level).toBe(1);
    expect(levelOf(xpToNext(1))).toMatchObject({ level: 2, into: 0 });
    expect(levelOf(totalXpFor(MAX_LEVEL) + 99999).level).toBe(MAX_LEVEL);
    expect(levelOf(totalXpFor(MAX_LEVEL) + 99999).ratio).toBe(1);
    for (let level = 1; level <= MAX_LEVEL; level++) expect(levelOf(totalXpFor(level)).level).toBe(level);
  });

  it("raises damage with level and the party's health with its strongest member", () => {
    expect(damageScale(1)).toBe(1);
    expect(damageScale(20)).toBeGreaterThan(damageScale(10));
    expect(maxHpFor([1, 1, 1])).toBe(100);
    expect(maxHpFor([3, 1, 2])).toBe(maxHpFor([1, 3, 1]));
    expect(maxHpFor([5, 1, 1])).toBeGreaterThan(maxHpFor([3, 1, 1]));
  });

  it('gives the active character all the experience and the others a share, and reports level-ups', () => {
    const party = new Party(0);
    const gain = xpToNext(1) + 2;
    const ups = party.gainXp(gain);
    expect(party.levels[0]).toBe(2);
    expect(party.xp[1]).toBe(benchShare(gain));
    expect(ups).toEqual([{ index: 0, level: 2 }]);
    expect(party.gainXp(1)).toEqual([]);
  });

  it('starts everyone at level 1 and tolerates junk experience values', () => {
    expect(new Party(0).levels).toEqual([1, 1, 1]);
    expect(new Party(0, [totalXpFor(5), -50, Number.NaN]).levels).toEqual([5, 1, 1]);
  });

  it('spending takes nothing when it cannot be afforded', () => {
    const progress = new ExplorationProgress([], 60, 1);
    expect(progress.spend(50, 2)).toBe(false);
    expect([progress.coins, progress.shards]).toEqual([60, 1]);
    expect(progress.spend(50, 1)).toBe(true);
    expect([progress.coins, progress.shards]).toEqual([10, 0]);
  });

  it('keeps old coin-bought levels by turning them into experience', () => {
    const migrated = migrateSave({ version: 7, position: [0, 0, 0], levels: [4, 1, 7] });
    expect(migrated.xp).toEqual([totalXpFor(4), 0, totalXpFor(7)]);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(new Party(0, migrated.xp).levels).toEqual([4, 1, 7]);
  });
});

describe('main quests', () => {
  const fresh = () => ({ progress: new ExplorationProgress([], 0, 0), map: new MapProgress('', [], []) });
  const ids = (kind: string, count: number) =>
    exploration.points.filter((p) => p.kind === kind).slice(0, count).map((p) => p.id);

  it('starts at the first quest and is unmet with nothing found', () => {
    const { progress, map } = fresh();
    const counts = countsOf(progress, map);
    expect(new QuestLog(0).current).toBe(quests[0]);
    expect(statusOf(quests[0], counts)).toMatchObject({ have: 0, need: 1, done: false });
  });

  it('completes in order and pays out only once', () => {
    const log = new QuestLog(0);
    const { map } = fresh();
    const progress = new ExplorationProgress([...ids('chest', 1), ...ids('collectible', 3)], 0, 0);
    const counts = countsOf(progress, map);
    expect(log.advance(counts)).toBe(quests[0]);
    expect(log.advance(counts)).toBe(quests[1]);
    expect(log.advance(counts)).toBeNull();
    expect(log.current).toBe(quests[2]);
  });

  it('works through a quest step by step', () => {
    const { map } = fresh();
    const progress = new ExplorationProgress(ids('puzzle', 1), 0, 0);
    const status = statusOf(quests[2], countsOf(progress, map));
    expect(status.step.type).toBe('waypoint');
    expect(status.done).toBe(false);
  });

  it('does not count the starting waypoint, and points at one still dark', () => {
    const { progress, map } = fresh();
    expect(countsOf(progress, map).waypoints).toBe(0);
    const step = quests[2].steps[0];
    const target = targetOf(step, progress, map, 0, 0)!;
    expect(map.isUnlocked(mapConfig.waypoints.find((w) => w.x === target.x && w.z === target.z)!.id)).toBe(false);
  });

  it('is finished past the last quest and clamps a bad saved index', () => {
    expect(new QuestLog(99).current).toBeNull();
    expect(new QuestLog(-3).completed).toBe(0);
    expect(migrateSave({ version: 5, position: [0, 0, 0] }).quest).toBe(0);
  });
});

describe('fps watch', () => {
  const run = (watch: FpsWatch, frameSeconds: number, seconds: number): boolean => {
    let fired = false;
    for (let t = 0; t < seconds; t += frameSeconds) fired = watch.add(frameSeconds) || fired;
    return fired;
  };

  it('leaves a device that holds its frame rate alone', () => {
    expect(run(new FpsWatch(), 1 / 60, 60)).toBe(false);
  });

  it('fires after two slow windows in a row, only once', () => {
    const watch = new FpsWatch();
    expect(run(watch, 1 / 20, 4.9)).toBe(false);
    expect(run(watch, 1 / 20, 5.2)).toBe(true);
    expect(run(watch, 1 / 20, 30)).toBe(false);
  });

  it('forgives a single slow window, such as loading', () => {
    const watch = new FpsWatch();
    expect(run(watch, 1 / 20, 5.2)).toBe(false);
    expect(run(watch, 1 / 60, 5.2)).toBe(false);
    expect(run(watch, 1 / 20, 5.2)).toBe(false);
  });

  it('ignores stalls and stops when told to', () => {
    const watch = new FpsWatch();
    expect(run(watch, 2, 40)).toBe(false);
    watch.stop();
    expect(run(watch, 1 / 20, 30)).toBe(false);
  });
});

describe('world boss', () => {
  const host = () => {
    const calls = { announced: [] as string[], hurt: [] as number[] };
    const api: BossHost = {
      hurtPlayer: (amount) => calls.hurt.push(amount),
      shoot: () => undefined,
      burst: () => undefined,
      shake: () => undefined,
      announce: (key) => calls.announced.push(key),
    };
    return { calls, api };
  };
  const near = new Vector3(-46, 0, -76);

  it('sleeps until the player comes close, then wakes', () => {
    const { api } = host();
    const boss = new Boss(false, api, new Group());
    boss.update(0.016, new Vector3(0, 0, 0), true);
    expect(boss.awake).toBe(false);
    boss.update(0.016, near, true);
    expect(boss.awake).toBe(true);
  });

  it('moves through three phases as its health falls, announcing each once', () => {
    const { api, calls } = host();
    const boss = new Boss(false, api, new Group());
    boss.update(0.016, near, true);
    expect(boss.phase).toBe(1);
    boss.hurt(boss.cfg.hp * 0.4);
    expect(boss.phase).toBe(2);
    boss.hurt(1);
    expect(boss.phase).toBe(2);
    boss.hurt(boss.cfg.hp * 0.3);
    expect(boss.phase).toBe(3);
    expect(calls.announced).toEqual(['boss.phase2', 'boss.phase3']);
  });

  it('dies for good once its health runs out', () => {
    const { api } = host();
    const boss = new Boss(false, api, new Group());
    boss.update(0.016, near, true);
    boss.hurt(boss.cfg.hp + 1);
    expect(boss.alive).toBe(false);
    expect(new Boss(true, api, new Group()).alive).toBe(false);
    expect(new Boss(true, api, new Group()).view.visible).toBe(false);
  });

  it('heals and goes back to sleep when the player falls', () => {
    const { api } = host();
    const boss = new Boss(false, api, new Group());
    boss.update(0.016, near, true);
    boss.hurt(300);
    boss.update(0.016, near, false);
    expect(boss.awake).toBe(false);
    expect(boss.hp).toBe(boss.cfg.hp);
    expect(boss.phase).toBe(1);
  });

  it('warns on the ground before anything hits, and every attack waits at least half a second', () => {
    const { api, calls } = host();
    const arena = new Group();
    const boss = new Boss(false, api, arena);
    const player = near.clone();
    let firstWarning = -1;
    let firstHit = -1;
    for (let frame = 0; frame < 60 * 12 && firstHit < 0; frame++) {
      boss.update(1 / 60, player, true);
      if (firstWarning < 0 && arena.children.length > 0) firstWarning = frame / 60;
      if (calls.hurt.length > 0) firstHit = frame / 60;
    }
    expect(firstWarning).toBeGreaterThanOrEqual(0);
    expect(firstHit - firstWarning).toBeGreaterThanOrEqual(0.5);
  });

  it('counts as a quest step once defeated', () => {
    const progress = new ExplorationProgress([], 0, 0);
    const map = new MapProgress('', [], []);
    const guardian = quests.find((q) => q.id === 'guardian')!;
    expect(statusOf(guardian, countsOf(progress, map, false)).done).toBe(false);
    expect(statusOf(guardian, countsOf(progress, map, true)).done).toBe(true);
    expect(migrateSave({ version: 6, position: [0, 0, 0] }).bossDefeated).toBe(false);
  });
});

describe('enemy variety', () => {
  const origin = new Vector3(0, 0, 0);
  const camera = undefined as never;

  it('has all five kinds on the island, each on land and away from the start', () => {
    expect(new Set(SPAWNS.map(([kind]) => kind)).size).toBe(5);
    for (const [kind, x, z] of SPAWNS) {
      expect(edgeRatio(x, z), `${kind} at ${x},${z}`).toBeLessThan(0.9);
      expect(Math.hypot(x - 5, z - 5), `${kind} at ${x},${z}`).toBeGreaterThan(14);
    }
  });

  it('a shell cuts ordinary damage until a reaction cracks it', () => {
    const guard = new Enemy('guard', origin.clone());
    expect(guard.armored).toBe(true);
    expect(guard.hurt(100)).toBeCloseTo(35);
    guard.breakArmor();
    expect(guard.armored).toBe(false);
    expect(guard.hurt(100)).toBe(100);
  });

  it('a bomber spends itself without dying to a hit', () => {
    const bomber = new Enemy('bomber', origin.clone());
    bomber.explode();
    expect(bomber.alive).toBe(false);
  });

  it('a charger warns, runs its locked line once, then stands dazed and takes extra damage', () => {
    const charger = new Enemy('charger', origin.clone());
    const player = new Vector3(0, 0, -8);
    let hits = 0;
    let dazedAt = -1;
    for (let frame = 0; frame < 60 * 6; frame++) {
      if (charger.update(1 / 60, player, true, camera)) hits++;
      if (dazedAt < 0 && charger.hurt(0) === 0 && (charger as unknown as { stun: number }).stun > 0) dazedAt = frame;
    }
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(dazedAt).toBeGreaterThan(0);
    const dazed = new Enemy('charger', origin.clone());
    (dazed as unknown as { stun: number }).stun = 1;
    expect(dazed.hurt(100)).toBe(150);
  });
});
