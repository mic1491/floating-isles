import { balance, type CharacterDef } from './core/balance';
import { Vector3 } from 'three';
import { OrbitCamera } from './camera/orbitCamera';
import { Combat } from './combat/combat';
import { isTouchDevice } from './core/device';
import { qualitySettings, type QualityTier } from './core/quality';
import { ExplorationField } from './exploration/field';
import { bearingTo, exploration, ExplorationProgress, nextObjective } from './exploration/progress';
import { Actions } from './input/actions';
import { Sfx } from './audio/sfx';
import { FpsWatch } from './core/fpsWatch';
import { bindKeyboardMouse } from './input/keyboardMouse';
import { bindTouch } from './input/touch';
import { MapProgress } from './map/mapProgress';
import { WaypointField } from './map/waypointField';
import { Gear } from './party/gear';
import { loadClips, mergeClips } from './player/clips';
import { maxHpFor } from './party/growth';
import { Party } from './party/party';
import { countsOf, QuestLog, statusOf, targetOf } from './quests/quests';
import { Avatar } from './player/avatar';
import { Player } from './player/player';
import { GameRenderer } from './render/renderer';
import { SAVE_VERSION } from './save/saveData';
import { loadSave, writeSave } from './save/saveStore';
import { Hud } from './ui/hud';
import { t, type TextKey } from './ui/i18n';
import { GearView } from './ui/gearView';
import { GrowthView } from './ui/growthView';
import { MapView } from './ui/mapView';
import { TerrainStreamer } from './world/chunks';
import { GrassField } from './world/grass';
import { Physics } from './world/physics';
import { createProps } from './world/props';
import { Sky } from './world/sky';
import { terrainHeight } from './world/terrain';

const AUTOSAVE_SECONDS = 10;
const RESPAWN_DELAY = 1.2;
const MAX_FRAME = 0.05;

/** Shows the title overlay; the world stays paused for as long as it is up. */
const showStart = (ui: HTMLElement, touch: boolean, canvas: HTMLCanvasElement) => {
  const start = document.createElement('div');
  start.className = 'start';
  const title = document.createElement('h1');
  title.textContent = t('start.title');
  const prompt = document.createElement('p');
  prompt.textContent = t(touch ? 'start.touch' : 'start.desktop');
  start.append(title, prompt);
  if (!touch) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('hint.desktop');
    start.append(hint);
  }
  ui.append(start);
  const menu = {
    playing: false,
    /** Set while the map holds the pointer, so losing the lock does not reopen the title. */
    keepPlaying: false,
    set(playing: boolean) {
      menu.playing = playing;
      start.classList.toggle('hidden', playing);
    },
  };
  if (touch) addEventListener('pointerdown', () => menu.set(true), { once: true });
  else {
    document.addEventListener('pointerlockchange', () => {
      if (!menu.keepPlaying) menu.set(document.pointerLockElement === canvas);
    });
    document.addEventListener('pointerlockerror', () => menu.set(true));
  }
  return menu;
};

const boot = async (): Promise<void> => {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const ui = document.querySelector<HTMLElement>('#ui')!;
  const touch = isTouchDevice();
  if (touch) ui.classList.add('touch');

  const [physics, save] = await Promise.all([Physics.create(), loadSave()]);
  const graphics = new GameRenderer(canvas);
  const { scene, camera } = graphics;
  const sky = new Sky(scene, save.timeOfDay);

  let tier: QualityTier = touch ? 'low' : 'high';
  const [sx, sy, sz] = save.position;
  const start = new Vector3(sx, Math.max(sy, terrainHeight(sx, sz) + 0.1), sz);

  const terrain = new TerrainStreamer(scene, physics);
  terrain.loadAround(start);
  const grass = new GrassField(scene);
  scene.add(createProps(physics));
  physics.step(1 / 60);

  const player = new Player(physics, start);
  scene.add(player.view);

  const elements = balance.characters.map((c) => c.element);
  const gear = new Gear(save.gear, elements);
  const party = new Party(save.activeCharacter, save.xp, gear);
  const healthCap = () => maxHpFor(party.levels) + gear.partyBonus().hp;
  player.maxHp = healthCap();
  player.setCharacter(party.active);
  // Each model is loaded the first time its character is in the field, not all at start, so phones
  // do not decode three copies at once. The placeholder body stands in until it arrives, or if it fails.
  const base0 = import.meta.env.BASE_URL;
  const clipsLoaded = Promise.all([
    loadClips(`${base0}assets/animations/sword_clips.json`).catch(() => null),
    loadClips(`${base0}assets/animations/move_clips.json`).catch(() => null),
  ]).then(([swords, moves]) => mergeClips(swords, moves));
  const requested = new Set<string>();
  const ensureAvatar = (member: CharacterDef) => {
    if (!member.model || requested.has(member.id)) return;
    requested.add(member.id);
    const base = import.meta.env.BASE_URL;
    clipsLoaded
      .then((clips) =>
        Avatar.load(`${base}${member.model}`, {
          element: member.element,
          color: member.color,
          weapon: member.weapon,
          weaponColor: member.weaponColor ?? member.color,
          weaponModel: member.weaponModel ? `${base}${member.weaponModel}` : null,
          hue: member.hue,
          hairOnly: member.hueParts === 'hair',
          clips,
        }),
      )
      .then((avatar) => player.addAvatar(member.id, avatar))
      .catch((error: unknown) => console.warn(`Could not load ${member.model}`, error));
  };
  ensureAvatar(party.active);

  const actions = new Actions();
  let muted = false;
  try {
    muted = localStorage.getItem('muted') === '1';
  } catch {}
  const sfx = new Sfx(muted);
  addEventListener('pointerdown', () => sfx.unlock());
  addEventListener('keydown', () => sfx.unlock());
  // Walking presses the grass down every half metre or so, leaving a path that springs back in seconds.
  let stepSide = 1;
  const lastStamp = new Vector3(Infinity, 0, 0);
  const trampleGrass = () => {
    const { position, facing } = player;
    if (Math.hypot(position.x - lastStamp.x, position.z - lastStamp.z) < 0.5) return;
    lastStamp.copy(position);
    stepSide = -stepSide;
    grass.stamp(position.x - facing.z * 0.18 * stepSide, position.z + facing.x * 0.18 * stepSide);
  };
  player.events = {
    step: (speed) => sfx.step(speed),
    jump: () => {
      sfx.jump();
      combat.dust(0.9);
    },
    land: (impact) => {
      sfx.land(impact);
      combat.dust(1.1 + Math.min(1, impact / 16) * 1.4);
    },
    dash: () => {
      sfx.dash();
      combat.dust(1.3);
    },
    glide: () => sfx.glide(),
  };
  const orbit = new OrbitCamera(camera, physics, player.body);
  orbit.yaw = save.cameraYaw;

  const fpsWatch = new FpsWatch();
  const applyQuality = () => {
    graphics.setQuality(tier, sky.sun);
    const settings = qualitySettings(tier);
    grass.configure(settings.grassRadius, settings.grassDensity, settings.grassRows);
    terrain.setRadius(settings.chunkRadius);
  };
  applyQuality();

  bindKeyboardMouse(canvas, actions);
  // A per-device look preference, so it lives in local storage rather than the save.
  let pixelArt = false;
  try {
    pixelArt = localStorage.getItem('pixelArt') === '1';
  } catch {}
  graphics.setPixelArt(pixelArt);
  const hud = new Hud(
    ui,
    camera,
    actions,
    party,
    tier,
    () => {
      tier = tier === 'high' ? 'low' : 'high';
      fpsWatch.stop();
      applyQuality();
      hud.setQuality(tier);
    },
    pixelArt,
    () => {
      pixelArt = !pixelArt;
      graphics.setPixelArt(pixelArt);
      hud.setPixel(pixelArt);
      try {
        localStorage.setItem('pixelArt', pixelArt ? '1' : '0');
      } catch {}
    },
  );
  if (touch) {
    bindTouch(ui, actions);
    const rotate = document.createElement('div');
    rotate.className = 'rotate-hint';
    rotate.textContent = t('hint.rotate');
    ui.append(rotate);
  }
  const menu = showStart(ui, touch, canvas);

  const progress = new ExplorationProgress(save.discovered, save.coins, save.shards);
  const showProgress = () =>
    hud.setExploration(progress.count, exploration.points.length, progress.coins, progress.shards);
  showProgress();
  const coinGain = (coins: number) => Math.round(coins * (1 + gear.partyBonus().coins));
  // Experience goes to whoever is in the field, with a share for the rest; a level-up heals fully.
  const award = (xp: number) => {
    if (xp <= 0) return;
    const ups = party.gainXp(Math.round(xp * (1 + gear.partyBonus().xp)));
    if (ups.length === 0) return;
    for (const up of ups) {
      hud.toast(`${t(`character.${party.members[up.index].element}`)} ${t('growth.levelUp')} Lv ${up.level}`);
    }
    sfx.upgrade();
    player.maxHp = healthCap();
    player.hp = player.maxHp;
    void persist();
  };
  const field = new ExplorationField(scene, progress, {
    discovered: (point, reward) => {
      hud.toast(t(`found.${point.kind}`));
      sfx.pickup();
      showProgress();
      award(reward.xp);
      void persist();
    },
  });

  const mapProgress = new MapProgress(save.fog, save.waypoints, save.markers);
  const groundAt = (x: number, z: number) => {
    const point = new Vector3(x, terrainHeight(x, z) + 0.3, z);
    terrain.loadAround(point);
    return point;
  };
  const waypoints = new WaypointField(scene, mapProgress, () => {
    hud.toast(t('found.waypoint'));
    sfx.pickup();
    void persist();
  });
  player.hp = save.hp > 0 ? Math.min(save.hp, player.maxHp) : player.maxHp;
  const stats = save.stats;
  /** Everything the quests can ask about, gathered fresh each time. */
  const questCounts = () =>
    countsOf(progress, mapProgress, !combat.boss.alive, {
      kills: stats.kills,
      reactions: stats.reactions,
      newGear: Object.keys(gear.owned).length - elements.length,
      topLevel: Math.max(...party.levels),
    });
  const questLog = new QuestLog(save.quest);
  const announceQuest = () => {
    if (questLog.current) hud.toast(`${t('quest.title')}:${questLog.current.title} — ${questLog.current.intro}`);
  };
  // Quests read straight from what has been done, so a quest already met pays out at once.
  const updateQuests = () => {
    const done = questLog.advance(questCounts());
    if (!done) return;
    const questCoins = coinGain(done.reward.coins);
    progress.coins += questCoins;
    progress.shards += done.reward.shards;
    showProgress();
    award(done.reward.xp);
    sfx.questDone();
    hud.toast(`${t('quest.done')}:${done.title} · +${questCoins} ${t('explore.coins')} +${done.reward.shards} ${t('explore.shards')}`);
    if (questLog.current) announceQuest();
    else hud.toast(t('quest.chapter'));
    void persist();
  };
  const updateGoal = () => {
    const { x, z } = player.position;
    const quest = questLog.current;
    if (quest) {
      const status = statusOf(quest, questCounts());
      const target = targetOf(status.step, progress, mapProgress, x, z);
      const step = status.step;
      let label =
        step.type === 'find'
          ? t(`quest.find.${step.kind}`)
          : step.type === 'defeat'
            ? t(`quest.defeat.${step.kind}`)
            : t(`quest.${step.type}` as TextKey);
      // A seal only answers its own element, so say who can open the one ahead.
      if (target?.element) label += ` · ${t('quest.use')}${t(`character.${target.element}`)}${t('quest.hit')}`;
      const where = target ? ` · ${Math.round(Math.hypot(target.x - x, target.z - z))} m` : '';
      hud.setGoal(`${quest.title} · ${label} ${status.have}/${status.need}${where}`, target ? bearingTo(target.x - x, target.z - z, orbit.yaw) : null);
      return;
    }
    const goal = nextObjective(progress, x, z, orbit.yaw);
    if (!goal) return hud.setGoal(null, null);
    hud.setGoal(`${t('goal.prefix')}${t(`goal.${goal.point.kind}`)} · ${Math.round(goal.distance)} m`, goal.bearing);
  };
  const growth = new GrowthView(ui, party, progress, {
    opened: () => {
      menu.keepPlaying = true;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    closed: () => {
      if (!touch) void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      queueMicrotask(() => (menu.keepPlaying = false));
    },
  });
  const gearView = new GearView(ui, party, progress, {
    opened: () => {
      menu.keepPlaying = true;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    closed: () => {
      if (!touch) void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      queueMicrotask(() => (menu.keepPlaying = false));
    },
    changed: () => {
      // New health applies at once: the ceiling moves, and current health keeps its share of it.
      const share = player.hp / player.maxHp;
      player.maxHp = healthCap();
      player.hp = Math.min(player.maxHp, Math.max(1, share * player.maxHp));
      showProgress();
      void persist();
    },
  });
  hud.addButton(t('hud.gear'), () => gearView.toggle());
  hud.addButton(t('hud.growth'), () => growth.toggle());
  const soundButton = hud.addButton('', () => {
    muted = !muted;
    sfx.setMuted(muted);
    soundButton.textContent = t(muted ? 'hud.sound.off' : 'hud.sound.on');
    try {
      localStorage.setItem('muted', muted ? '1' : '0');
    } catch {}
  });
  soundButton.textContent = t(muted ? 'hud.sound.off' : 'hud.sound.on');
  const map = new MapView(ui, mapProgress, progress, {
    opened: () => {
      menu.keepPlaying = true;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    closed: () => {
      if (!touch) void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      queueMicrotask(() => (menu.keepPlaying = false));
    },
    teleport: (point) => {
      player.teleport(groundAt(point.x, point.z));
      hud.fade();
      map.hide();
      void persist();
    },
    setTime: (timeOfDay) => {
      sky.timeOfDay = timeOfDay;
      sky.update(0, player.position);
      void persist();
    },
    changed: () => void persist(),
  });

  const combat = new Combat(scene, player, party, {
    damage: (at, amount, color) => hud.floatText(at, String(amount), color),
    reaction: (at, reaction) => {
      stats.reactions++;
      hud.floatText(at, t(`reaction.${reaction}`), '#ffe27a', true);
      sfx.reaction();
    },
    playerHurt: () => {
      hud.flashHurt();
      sfx.hurt();
    },
    elementArea: (center, radius, element) => field.elementHit(center, radius, element),
    impact: (strength) => {
      orbit.kick(strength);
      sfx.hit();
    },
    defeated: (at, reward, kind) => {
      stats.kills[kind] = (stats.kills[kind] ?? 0) + 1;
      if (kind !== 'boss') stats.kills.any = (stats.kills.any ?? 0) + 1;
      const coins = coinGain(reward.coins);
      progress.coins += coins;
      progress.shards += reward.shards;
      showProgress();
      const parts = [`+${coins} ${t('explore.coins')}`];
      if (reward.shards > 0) parts.push(`+${reward.shards} ${t('explore.shards')}`);
      parts.push(`+${reward.xp} ${t('growth.xp')}`);
      hud.floatText(at, parts.join(' '), '#ffd98a', reward.shards > 0);
      sfx.coin();
      award(reward.xp);
      if (!combat.boss.alive) {
        sfx.questDone();
        void persist();
      }
    },
    shake: (strength) => orbit.kick(strength),
    announce: (key) => hud.toast(t(key as TextKey)),
    swing: (step) => sfx.swing(step),
    skill: () => sfx.skill(),
    burst: () => sfx.burst(),
    charge: (stage) => sfx.charge(stage),
  }, save.bossDefeated);

  const persist = () =>
    writeSave({
      version: SAVE_VERSION,
      position: [player.position.x, player.position.y, player.position.z],
      cameraYaw: orbit.yaw,
      hp: player.hp,
      activeCharacter: party.activeIndex,
      timeOfDay: sky.timeOfDay,
      discovered: progress.discovered,
      coins: progress.coins,
      shards: progress.shards,
      fog: mapProgress.fog.encode(),
      waypoints: mapProgress.unlockedIds,
      markers: mapProgress.markers,
      xp: party.xp,
      quest: questLog.completed,
      bossDefeated: !combat.boss.alive,
      gear: gear.toSave(),
      stats,
    });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void persist();
  });
  addEventListener('pagehide', () => void persist());

  let last = performance.now();
  let saveTimer = AUTOSAVE_SECONDS;
  let deadTimer = 0;
  let announced = false;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(rawDt, MAX_FRAME);
    last = now;

    terrain.update(player.position);
    grass.update(dt, player.position);
    if (menu.playing && player.alive && player.walkingOnGround) trampleGrass();

    // On a slow device, step down to the light setting by itself rather than leave the player lagging.
    if (tier === 'high' && menu.playing && fpsWatch.add(rawDt)) {
      tier = 'low';
      applyQuality();
      hud.setQuality(tier);
      hud.toast(t('hud.autoQuality'));
    }
    if (menu.playing && !announced) {
      announced = true;
      announceQuest();
    }
    const screenOpen = map.open || growth.open || gearView.open;
    if (actions.mapPressed && menu.playing && !growth.open && !gearView.open) map.toggle();
    if (actions.growthPressed && menu.playing && !map.open && !gearView.open) growth.toggle();
    if (actions.gearPressed && menu.playing && !map.open && !growth.open) gearView.toggle();

    if (!menu.playing || screenOpen) {
      actions.attackPressed = false;
      player.refreshView(dt);
      if (!map.open) map.update(dt, player.position, player.facing);
      orbit.update(dt, actions, player.position);
      sky.update(0, player.position);
      actions.endFrame();
      graphics.render();
      return;
    }

    if (combat.hitstop > 0) {
      combat.hitstop -= dt;
      orbit.update(dt, actions, player.position);
      actions.endFrame();
      graphics.render();
      return;
    }

    if (actions.switchTo !== null && party.trySwitch(actions.switchTo)) {
      player.setCharacter(party.active);
      ensureAvatar(party.active);
    }
    party.update(dt);
    player.update(dt, actions, orbit.yaw);
    combat.update(dt, actions, camera);
    field.update(dt, player.position, actions.interactPressed);
    hud.setPrompt(field.canInteract);
    waypoints.update(dt, player.position);
    map.update(dt, player.position, player.facing);
    physics.step(dt);
    orbit.update(dt, actions, player.position);

    if (!player.alive) {
      deadTimer += dt;
      if (deadTimer >= RESPAWN_DELAY) {
        deadTimer = 0;
        const nearest = mapProgress.nearestUnlocked(player.position.x, player.position.z);
        player.revive(groundAt(nearest.x, nearest.z));
      }
    }

    sky.update(dt, player.position);
    updateQuests();
    updateGoal();
    hud.setBoss(combat.boss.awake && combat.boss.alive ? `${t('boss.name')} Lv${combat.boss.level}` : null, combat.boss.ratio, combat.boss.phase);
    hud.update(player, party);
    actions.endFrame();
    graphics.render();

    saveTimer -= dt;
    if (saveTimer <= 0) {
      saveTimer = AUTOSAVE_SECONDS;
      void persist();
    }
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    Object.assign(window, { __game: { player, party, combat, sky, orbit, actions, persist, graphics, menu, terrain, grass, field, progress, map, mapProgress, growth, gearView, gear, sfx, questLog, stats } });
  }
};

const hideLoading = (): void => {
  const loading = document.querySelector<HTMLElement>('#loading');
  loading?.classList.add('done');
  setTimeout(() => loading?.remove(), 800);
};

boot().then(hideLoading, (error: unknown) => {
  console.error(error);
  const note = document.querySelector<HTMLElement>('#loading small');
  if (note) note.textContent = '載入失敗,請重新整理頁面';
});
