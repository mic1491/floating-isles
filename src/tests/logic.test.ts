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
import { plantWeight, solveKnee } from '../player/footIk';
import { groundWeights, Locomotion } from '../player/locomotion';
import { clipTime, clipWeight, COMBO_CLIPS, mergeClips, sampleBone, sampleHipsY, type ClipLibrary } from '../player/clips';
import clipData from '../../public/assets/animations/sword_clips.json';
import moveData from '../../public/assets/animations/move_clips.json';
import { ATTACKS, CHARGE_HOLD, CHARGED_LUNGE, CHARGED_STEP, BURST_STEP, COMBO_LENGTH, KNOCKBACK, PERFECT_DODGE, PLUNGE, TRAITS } from '../player/attackTable';
import { whirlAngle } from '../player/player';
import { badgeColor, gapFactor, MAX_ENEMY_LEVEL, regionLevel, scaledStats, xpFactor } from '../enemies/levels';
import { Quaternion } from 'three';
import { SPAWNS as SPAWN_LIST } from '../combat/spawns';
import { ACCESSORY_SLOTS, defaultGear, Gear, GEAR_ITEMS, MAX_GEAR_LEVEL, sanitizeGear, upgradeCost as gearUpgradeCost } from '../party/gear';
import { balance } from '../core/balance';
import { quests as allQuests } from '../quests/quests';
import { NPCS, pickTalk } from '../story/npcs';
import { BEATS, StoryDirector } from '../story/story';
import { Boss, type BossHost } from '../enemies/boss';
import { Enemy } from '../enemies/enemy';
import { SPAWNS } from '../combat/spawns';
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

describe('move data', () => {
  it('reads every hit from data/moves.json and keeps it sane', () => {
    expect(ATTACKS).toHaveLength(COMBO_LENGTH + 3);
    for (const hit of ATTACKS) {
      expect(hit.strikeAt).toBeGreaterThan(0);
      expect(hit.strikeAt).toBeLessThan(hit.chainAt + 1e-9);
      expect(hit.duration).toBeGreaterThan(0.2);
      expect(Number.isFinite(hit.trail.from + hit.trail.to)).toBe(true);
    }
    expect(KNOCKBACK).toHaveLength(COMBO_LENGTH);
    for (const kind of ['sword', 'staff', 'spear']) expect(CHARGED_LUNGE[kind]).toBeGreaterThan(0);
  });
});

describe('plunge data', () => {
  it('is tuned to hit harder than a finisher and reach a fair radius', () => {
    expect(PLUNGE.damageScale).toBeGreaterThan(ATTACKS[COMBO_LENGTH - 1].damageScale);
    expect(PLUNGE.radius).toBeGreaterThan(2);
    expect(PLUNGE.minHeight).toBeGreaterThan(1);
  });
});

describe('perfect dodge data', () => {
  it('slows enemies and pays back, within sane bounds', () => {
    expect(PERFECT_DODGE.slowScale).toBeGreaterThan(0);
    expect(PERFECT_DODGE.slowScale).toBeLessThan(1);
    expect(PERFECT_DODGE.slowDuration).toBeGreaterThan(0);
    expect(PERFECT_DODGE.cooldown).toBeGreaterThan(0);
  });
});

describe('weapon traits', () => {
  it('give each weapon a distinct, sane combo specialty', () => {
    expect(TRAITS.sword.sweepStep).toBe(COMBO_LENGTH);
    expect(TRAITS.spear.pierceRange).toBeGreaterThan(balance.weapons.spear.range);
    expect(TRAITS.staff.boltFrom).toBeLessThanOrEqual(COMBO_LENGTH);
    expect(TRAITS.staff.boltScale).toBeLessThan(1);
  });
});

describe('story', () => {
  const beats = [
    { id: 'a', when: 'go', lines: [{ speaker: 'x', text: '1' }, { speaker: 'x', text: '2' }] },
    { id: 'b', when: 'go', lines: [{ speaker: 'y', text: '3' }] },
  ];

  it('plays queued beats line by line, once each', () => {
    const story = new StoryDirector([], beats);
    expect(story.active).toBe(false);
    story.trigger('go');
    expect(story.current?.text).toBe('1');
    expect(story.advance()).toBe(false);
    expect(story.current?.text).toBe('2');
    expect(story.advance()).toBe(true);
    expect(story.current?.text).toBe('3');
    story.advance();
    expect(story.active).toBe(false);
    story.trigger('go');
    expect(story.active).toBe(false);
    expect(story.seenIds.sort()).toEqual(['a', 'b']);
  });

  it('does not replay beats a save has seen, and can skip a trigger', () => {
    const story = new StoryDirector(['a'], beats);
    story.trigger('go');
    expect(story.current?.text).toBe('3');
    const other = new StoryDirector([], beats);
    other.skip('go');
    other.trigger('go');
    expect(other.active).toBe(false);
  });

  it('has a beat for the opening and for every quest finishing', () => {
    const whens = new Set(BEATS.map((b) => b.when));
    expect(whens.has('opening')).toBe(true);
    for (const quest of allQuests) {
      if (quest.id === 'guardian') expect(whens.has('quest:guardian:start')).toBe(true);
      expect(whens.has(`quest:${quest.id}:done`)).toBe(true);
    }
    for (const beat of BEATS) expect(beat.lines.length).toBeGreaterThan(0);
  });

  it('migrates old saves to an empty story record', () => {
    expect(migrateSave({ version: 11, position: [0, 0, 0] } as never).story).toEqual([]);
  });
});

describe('villagers', () => {
  it('pick the latest talk the player has earned', () => {
    const npc = NPCS[0];
    expect(pickTalk(npc, 0)).toBe(npc.talks[0].lines);
    expect(pickTalk(npc, 3)).toBe(npc.talks[1].lines);
    expect(pickTalk(npc, 99)).toBe(npc.talks[npc.talks.length - 1].lines);
  });

  it('stand somewhere real, with talks in order', () => {
    for (const npc of NPCS) {
      expect(Number.isFinite(terrainHeight(npc.x, npc.z))).toBe(true);
      expect(terrainHeight(npc.x, npc.z)).toBeGreaterThan(0);
      expect(npc.talks[0].after).toBe(0);
      for (let i = 1; i < npc.talks.length; i++) expect(npc.talks[i].after).toBeGreaterThan(npc.talks[i - 1].after);
    }
  });

  it('say() plays unremembered lines', () => {
    const story = new StoryDirector([]);
    story.say([{ speaker: 'a', text: 'hi' }]);
    expect(story.current?.text).toBe('hi');
    story.advance();
    expect(story.active).toBe(false);
    expect(story.seenIds).toEqual([]);
  });
});

describe('quest reorder migration', () => {
  it('keeps the player on the same quest after the guardian moved', () => {
    const at = (version: number, quest: number) => migrateSave({ version, quest, position: [0, 0, 0] } as never).quest;
    expect(at(10, 3)).toBe(3);
    expect(at(10, 4)).toBe(3);
    expect(at(10, 8)).toBe(7);
    expect(at(10, 9)).toBe(9);
    expect(at(11, 4)).toBe(4);
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

describe('weapons', () => {
  it('gives each character their own weapon, and the three play differently', () => {
    expect(balance.characters.map((c) => c.weapon)).toEqual(['sword', 'staff', 'spear']);
    const { sword, staff, spear } = balance.weapons;
    expect(spear.range).toBeGreaterThan(staff.range);
    expect(staff.range).toBeGreaterThan(sword.range);
    expect(spear.arc).toBeLessThan(sword.arc);
    expect(staff.arc).toBeGreaterThan(sword.arc);
    expect(staff.splash).toBeGreaterThan(0);
    expect(sword.splash).toBe(0);
    expect(spear.lunge).toBeGreaterThan(staff.lunge);
  });
});

describe('weapons and gear', () => {
  const elements = balance.characters.map((c) => c.element);
  const wallet = (coins: number, shards: number) => {
    const w = {
      coins,
      shards,
      spend(c: number, sh: number) {
        if (w.coins < c || w.shards < sh) return false;
        w.coins -= c;
        w.shards -= sh;
        return true;
      },
    };
    return w;
  };
  const fresh = () => new Gear(defaultGear(elements), elements);

  it('starts everyone with their own weapon equipped and nothing else', () => {
    const gear = fresh();
    for (const [i, element] of elements.entries()) {
      const start = GEAR_ITEMS.find((item) => item.start && item.for === element)!;
      expect(gear.loadouts[i].weapon).toBe(start.id);
      expect(gear.level(start.id)).toBe(1);
      expect(gear.loadouts[i].accessories).toEqual(Array(ACCESSORY_SLOTS).fill(null));
    }
  });

  it('buying takes the price once and cannot be repeated or afforded short', () => {
    const gear = fresh();
    const w = wallet(1000, 10);
    expect(gear.buy('charm-guard', w)).toBe(true);
    expect(w.coins).toBe(1000 - 150);
    expect(gear.buy('charm-guard', w)).toBe(false);
    expect(gear.buy('sword-sun', wallet(10, 0))).toBe(false);
    expect(gear.level('sword-sun')).toBe(0);
  });

  it('upgrades cost more at each level and stop at the cap', () => {
    const gear = fresh();
    const item = GEAR_ITEMS.find((i) => i.id === 'charm-guard')!;
    expect(gearUpgradeCost(item, 2).coins).toBeGreaterThan(gearUpgradeCost(item, 1).coins);
    const rich = wallet(1e6, 1e6);
    gear.buy('charm-guard', rich);
    for (let i = 1; i < MAX_GEAR_LEVEL; i++) expect(gear.upgrade('charm-guard', rich)).toBe(true);
    expect(gear.level('charm-guard')).toBe(MAX_GEAR_LEVEL);
    expect(gear.upgrade('charm-guard', rich)).toBe(false);
  });

  it('keeps weapons with their own character and moves an accessory rather than copying it', () => {
    const gear = fresh();
    const rich = wallet(1e6, 1e6);
    gear.buy('staff-tide', rich);
    gear.buy('badge-flame', rich);
    expect(gear.equip(0, 'staff-tide')).toBe(false);
    expect(gear.equip(1, 'staff-tide')).toBe(true);
    gear.equip(0, 'badge-flame', 0);
    gear.equip(2, 'badge-flame', 1);
    expect(gear.wearer('badge-flame')).toBe(2);
    expect(gear.loadouts[0].accessories[0]).toBeNull();
    expect(gear.equip(0, 'ring-resonance')).toBe(false);
  });

  it('adds up bonuses from what is worn, and shares health, coins and experience across the party', () => {
    const gear = fresh();
    const rich = wallet(1e6, 1e6);
    for (const id of ['badge-flame', 'charm-guard', 'pendant-coin']) gear.buy(id, rich);
    gear.equip(0, 'badge-flame', 0);
    gear.equip(1, 'charm-guard', 0);
    gear.equip(2, 'pendant-coin', 0);
    expect(gear.bonus(0).damage).toBeGreaterThan(gear.bonus(1).damage - 1);
    expect(gear.bonus(1).hp).toBeGreaterThan(0);
    expect(gear.bonus(0).hp).toBe(0);
    expect(gear.partyBonus().hp).toBe(gear.bonus(1).hp);
    expect(gear.partyBonus().coins).toBeGreaterThan(0);
  });

  it('cleans a damaged save: unknown, unowned, wrong-owner and duplicated items come off', () => {
    const clean = sanitizeGear(
      {
        owned: { 'charm-guard': 3, ghost: 9, 'sword-sun': 2 },
        loadouts: [
          { weapon: 'staff-tide', accessories: ['charm-guard', 'badge-flame'] },
          { weapon: 'staff-apprentice', accessories: ['charm-guard', null] },
          { weapon: 'spear-iron', accessories: [null, null] },
        ],
      },
      elements,
    );
    expect(clean.owned.ghost).toBeUndefined();
    expect(clean.loadouts[0].weapon).toBe('sword-ember');
    expect(clean.loadouts[0].accessories).toEqual(['charm-guard', null]);
    expect(clean.loadouts[1].accessories[0]).toBeNull();
    expect(sanitizeGear(undefined, elements)).toEqual(defaultGear(elements));
  });
});

describe('recorded sword motion', () => {
  const library = mergeClips(clipData as unknown as ClipLibrary, moveData as unknown as ClipLibrary)!;

  it('has a clip for every hit of the combo, with every bone recorded for every frame', () => {
    for (const names of Object.values(COMBO_CLIPS)) expect(names).toHaveLength(ATTACKS.length);
    for (const name of new Set(Object.values(COMBO_CLIPS).flat().filter(Boolean))) {
      const clip = library.clips.find((c) => c.name === name)!;
      expect(clip, name).toBeDefined();
      const frames = Math.round(clip.duration * clip.fps) + 1;
      expect(clip.hipsY).toHaveLength(frames);
      for (const bone of ['hips', 'rightUpperArm', 'rightHand', 'leftFoot']) expect(clip.bones[bone], bone).toHaveLength(frames);
      expect(clip.strike).toBeGreaterThan(0);
      expect(clip.strike).toBeLessThan(clip.duration);
    }
  });

  it('records proper rotations: every quaternion has unit length', () => {
    for (const clip of library.clips) {
      for (const frames of Object.values(clip.bones)) {
        for (const [x, y, z, w] of frames) expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 2);
      }
    }
  });

  it("lands the recording's strike exactly when the game's blade lands", () => {
    for (const [i, name] of COMBO_CLIPS.sword.entries()) {
      if (!name) continue;
      const clip = library.clips.find((c) => c.name === name)!;
      const strikeAt = ATTACKS[i].strikeAt;
      expect(clipTime(clip, strikeAt, strikeAt)).toBeCloseTo(clip.strike, 5);
      expect(clipTime(clip, 0, strikeAt)).toBe(0);
      expect(clipTime(clip, 1, strikeAt)).toBeCloseTo(clip.duration, 5);
      expect(clipTime(clip, 9, strikeAt)).toBeLessThanOrEqual(clip.duration);
    }
  });

  it('eases the recording in at the start and out at the end of a hit', () => {
    expect(clipWeight(0)).toBe(0);
    expect(clipWeight(0.4)).toBeCloseTo(1, 5);
    expect(clipWeight(1)).toBe(0);
    expect(clipWeight(0.06)).toBeGreaterThan(0);
    expect(clipWeight(0.06)).toBeLessThan(1);
  });

  it('blends between frames along the short way', () => {
    const clip = library.clips[0];
    const into = new Quaternion();
    const first = sampleBone(clip, 'rightUpperArm', 0, into).clone();
    const mid = sampleBone(clip, 'rightUpperArm', 0.5 / clip.fps, into).clone();
    const second = sampleBone(clip, 'rightUpperArm', 1 / clip.fps, into).clone();
    // The halfway frame sits midway between its neighbours; recorded values are rounded, so allow a little slack.
    expect(Math.abs(first.angleTo(mid) - mid.angleTo(second))).toBeLessThan(0.02);
    expect(mid.angleTo(first)).toBeLessThan(first.angleTo(second) + 0.02);
    expect(Number.isFinite(sampleHipsY(clip, clip.duration * 2))).toBe(true);
  });
});

describe('main quests five to ten', () => {
  const blank = () => ({ progress: new ExplorationProgress([], 0, 0), map: new MapProgress('', [], []) });
  const done = (index: number, record: Parameters<typeof countsOf>[3]) => {
    const { progress, map } = blank();
    return statusOf(quests[index], countsOf(progress, map, false, record)).done;
  };

  it('has ten quests with unique ids, rewards and only real enemy kinds', () => {
    expect(quests).toHaveLength(10);
    expect(new Set(quests.map((q) => q.id)).size).toBe(10);
    const kinds = new Set(['any', ...SPAWN_LIST.map(([kind]) => kind)]);
    for (const quest of quests) {
      expect(quest.reward.xp, quest.id).toBeGreaterThan(0);
      for (const step of quest.steps) if (step.type === 'defeat') expect(kinds.has(step.kind), `${quest.id}:${step.kind}`).toBe(true);
    }
  });

  it('counts kills, reactions, new gear and levels toward their quests', () => {
    const byId = (id: string) => quests.findIndex((q) => q.id === id);
    expect(done(byId('trial-of-arms'), { kills: { any: 7 } })).toBe(false);
    expect(done(byId('trial-of-arms'), { kills: { any: 8 } })).toBe(true);
    expect(done(byId('resonance'), { reactions: 2 })).toBe(false);
    expect(done(byId('resonance'), { reactions: 3 })).toBe(true);
    expect(done(byId('arm-yourself'), { newGear: 1 })).toBe(false);
    expect(done(byId('arm-yourself'), { newGear: 2 })).toBe(true);
    expect(done(byId('seasoned'), { topLevel: 7 })).toBe(false);
    expect(done(byId('seasoned'), { topLevel: 8 })).toBe(true);
  });

  it('asks for every kind in the final trial, one step at a time', () => {
    const final = quests.findIndex((q) => q.id === 'island-trial');
    const { progress, map } = blank();
    const some = statusOf(quests[final], countsOf(progress, map, false, { kills: { guard: 2, charger: 1 } }));
    expect(some.done).toBe(false);
    expect(some.step).toMatchObject({ type: 'defeat', kind: 'charger' });
    expect(done(final, { kills: { guard: 2, charger: 2, bomber: 3 } })).toBe(true);
  });

  it('points at where the right enemies live, and at nothing for goals met by playing', () => {
    const { progress, map } = blank();
    const guard = targetOf({ type: 'defeat', kind: 'guard', count: 1 }, progress, map, 0, 0)!;
    expect(SPAWN_LIST.some(([kind, x, z]) => kind === 'guard' && x === guard.x && z === guard.z)).toBe(true);
    for (const step of [{ type: 'reaction', count: 1 }, { type: 'gear', count: 1 }, { type: 'level', count: 2 }] as const) {
      expect(targetOf(step, progress, map, 0, 0)).toBeNull();
    }
  });

  it('keeps kill and reaction totals in the save and repairs bad ones', () => {
    expect(migrateSave({ version: 9, position: [0, 0, 0] }).stats).toEqual({ kills: {}, reactions: 0 });
    const kept = migrateSave({ version: 10, position: [0, 0, 0], stats: { kills: { any: 5, guard: -2 }, reactions: 4.9 } } as never).stats;
    expect(kept).toEqual({ kills: { any: 5, guard: 0 }, reactions: 4 });
  });
});

describe('recorded locomotion', () => {
  const library = mergeClips(clipData as unknown as ClipLibrary, moveData as unknown as ClipLibrary)!;
  const clips = new Map(library.clips.map((c) => [c.name, c]));

  it('cross-fades neighbouring ground loops by speed, always summing to one', () => {
    for (const speed of [0, 0.5, 1.8, 2.2, 3.6, 5, 7, 8.5, 12]) {
      const w = groundWeights(speed);
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    }
    expect(groundWeights(0).Idle_Loop).toBe(1);
    expect(groundWeights(5).Jog_Fwd_Loop).toBe(1);
    expect(groundWeights(20).Sprint_Loop).toBe(1);
    expect(groundWeights(3.6).Walk_Loop).toBeGreaterThan(0);
    expect(groundWeights(3.6).Jog_Fwd_Loop).toBeGreaterThan(0);
  });

  it('has every clip the state machine plays', () => {
    expect(Locomotion.available(clips)).toBe(true);
    for (const name of ['Roll', 'Jump_Start', 'Jump_Land', 'Hit_Chest', 'Spell_Simple_Shoot']) expect(clips.has(name), name).toBe(true);
  });

  it('takes over the pose when running and hands it back while gliding', () => {
    const move = new Locomotion(clips);
    const input = { time: 0, speed: 5, airborne: false, gliding: false, dashing: false, hitAge: 99 };
    for (let i = 0; i < 30; i++) move.update(1 / 60, input);
    expect(move.base).toBeGreaterThan(0.95);
    const q = new Quaternion();
    expect(move.sample('leftUpperLeg', q)).toBe(true);
    for (let i = 0; i < 60; i++) move.update(1 / 60, { ...input, gliding: true });
    expect(move.base).toBeLessThan(0.05);
  });

  it('flinches only briefly after a hit', () => {
    const move = new Locomotion(clips);
    move.update(1 / 60, { time: 0, speed: 0, airborne: false, gliding: false, dashing: false, hitAge: 0.1 });
    expect(move.hit).not.toBeNull();
    move.update(1 / 60, { time: 0, speed: 0, airborne: false, gliding: false, dashing: false, hitAge: 1 });
    expect(move.hit).toBeNull();
  });

  it('loops seamlessly: the last frame blends back into the first', () => {
    const jog = clips.get('Jog_Fwd_Loop')!;
    const q = new Quaternion();
    const last = sampleBone(jog, 'leftUpperLeg', jog.duration - 0.5 / jog.fps, q).clone();
    const first = sampleBone(jog, 'leftUpperLeg', 0, q).clone();
    expect(last.angleTo(first)).toBeLessThan(0.3);
  });
});

describe('foot placement', () => {
  it('holds a foot down only while it is near the ground', () => {
    expect(plantWeight(0.05)).toBe(1);
    expect(plantWeight(0.5)).toBe(0);
    expect(plantWeight(0.2)).toBeGreaterThan(0);
    expect(plantWeight(0.2)).toBeLessThan(1);
  });

  it('bends the knee so the ankle reaches a lower target, keeping the bone lengths', () => {
    const hip = new Vector3(0, 1, 0);
    const knee = new Vector3(0, 0.55, 0.1);
    const ankle = new Vector3(0, 0.1, 0);
    const newKnee = new Vector3();
    const reached = new Vector3();
    solveKnee(hip, knee, ankle, new Vector3(0, 0.2, 0.05), newKnee, reached);
    expect(hip.distanceTo(newKnee)).toBeCloseTo(hip.distanceTo(knee), 4);
    expect(newKnee.distanceTo(reached)).toBeCloseTo(knee.distanceTo(ankle), 4);
    expect(reached.distanceTo(new Vector3(0, 0.2, 0.05))).toBeLessThan(1e-3);
    expect(newKnee.z).toBeGreaterThan(0);
  });

  it('straightens the leg when the target is out of reach', () => {
    const hip = new Vector3(0, 1, 0);
    const knee = new Vector3(0, 0.55, 0.05);
    const ankle = new Vector3(0, 0.1, 0);
    const newKnee = new Vector3();
    const reached = new Vector3();
    solveKnee(hip, knee, ankle, new Vector3(0, -2, 0), newKnee, reached);
    expect(hip.distanceTo(reached)).toBeCloseTo(hip.distanceTo(knee) + knee.distanceTo(ankle), 2);
  });
});

describe('charged strike', () => {
  it('sits after the tap combo and shares its swing, striking after the held pose', () => {
    expect(CHARGED_STEP).toBe(COMBO_LENGTH + 1);
    expect(ATTACKS).toHaveLength(BURST_STEP);
    expect(CHARGE_HOLD).toBeLessThan(ATTACKS[CHARGED_STEP - 1].strikeAt);
    expect(ATTACKS[CHARGED_STEP - 1].damageScale).toBeGreaterThan(ATTACKS[COMBO_LENGTH - 1].damageScale);
  });

  it('whirls the body exactly once round, starting and ending at rest', () => {
    expect(whirlAngle(0)).toBe(0);
    expect(whirlAngle(0.28)).toBe(0);
    expect(whirlAngle(0.78)).toBeCloseTo(Math.PI * 2, 5);
    expect(whirlAngle(1)).toBeCloseTo(Math.PI * 2, 5);
    expect(whirlAngle(0.53)).toBeCloseTo(Math.PI, 5);
  });
});

describe('enemy levels', () => {
  it('rises with distance from the start and never leaves the level range', () => {
    expect(regionLevel(0, 0, 'melee')).toBe(1);
    expect(regionLevel(60, 0, 'melee')).toBeGreaterThan(regionLevel(20, 0, 'melee'));
    expect(regionLevel(0, 500, 'melee')).toBe(MAX_ENEMY_LEVEL);
    expect(regionLevel(40, 0, 'guard')).toBe(regionLevel(40, 0, 'melee') + 1);
    for (const [kind, x, z] of SPAWNS) {
      const level = regionLevel(x, z, kind);
      expect(level, `${kind} at ${x},${z}`).toBeGreaterThanOrEqual(1);
      expect(level, `${kind} at ${x},${z}`).toBeLessThanOrEqual(MAX_ENEMY_LEVEL);
    }
  });

  it('grows health, damage and rewards with level and leaves the rest of a kind alone', () => {
    const base = balance.enemies.melee;
    const low = scaledStats(base, 1);
    const high = scaledStats(base, 10);
    expect(low.hp).toBeGreaterThan(base.hp);
    expect(high.hp).toBeGreaterThan(low.hp);
    expect(high.damage).toBeGreaterThan(low.damage);
    expect(high.xp).toBeGreaterThan(low.xp);
    expect(high.speed).toBe(base.speed);
    expect(high.attackRange).toBe(base.attackRange);
  });

  it('gives the higher level the edge, within limits', () => {
    expect(gapFactor(5, 5)).toBe(1);
    expect(gapFactor(8, 5)).toBeGreaterThan(1);
    expect(gapFactor(5, 8)).toBeLessThan(1);
    expect(gapFactor(20, 1)).toBe(balance.enemyLevels.gapMax);
    expect(gapFactor(1, 20)).toBe(balance.enemyLevels.gapMin);
  });

  it('pays full experience near the player’s level and less as it falls behind', () => {
    expect(xpFactor(5, 5)).toBe(1);
    expect(xpFactor(5, 3)).toBe(1);
    expect(xpFactor(8, 3)).toBeLessThan(1);
    expect(xpFactor(20, 1)).toBe(0.1);
    expect(xpFactor(3, 12)).toBe(1);
  });

  it('warns in red of far higher enemies and greys out far lower ones', () => {
    expect(badgeColor(10, 4)).toBe('#ff4a4a');
    expect(badgeColor(6, 4)).toBe('#ffb347');
    expect(badgeColor(4, 4)).toBe('#ffffff');
    expect(badgeColor(1, 6)).toBe('#9aa3ad');
  });

  it('puts the guardian in a level its fight can be won at', () => {
    const boss = new Boss(false, { hurtPlayer() {}, shoot() {}, burst() {}, shake() {}, announce() {} }, new Group());
    expect(boss.level).toBe(balance.enemyLevels.bossLevel);
    expect(boss.cfg.hp).toBeGreaterThan(balance.enemies.boss.hp);
  });
});

describe('quest order', () => {
  it('sends the player to the level 10 guardian only after the level quest and before the final trial', () => {
    const at = (id: string) => quests.findIndex((q) => q.id === id);
    expect(at('guardian')).toBeGreaterThan(at('seasoned'));
    expect(at('guardian')).toBeLessThan(at('island-trial'));
  });
});
