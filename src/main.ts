import { Vector3 } from 'three';
import { OrbitCamera } from './camera/orbitCamera';
import { Combat } from './combat/combat';
import { balance } from './core/balance';
import { isTouchDevice } from './core/device';
import { qualitySettings, type QualityTier } from './core/quality';
import { ExplorationField } from './exploration/field';
import { exploration, ExplorationProgress, nextObjective } from './exploration/progress';
import { Actions } from './input/actions';
import { bindKeyboardMouse } from './input/keyboardMouse';
import { bindTouch } from './input/touch';
import { MapProgress } from './map/mapProgress';
import { WaypointField } from './map/waypointField';
import { Party } from './party/party';
import { Avatar } from './player/avatar';
import { Player } from './player/player';
import { GameRenderer } from './render/renderer';
import { SAVE_VERSION } from './save/saveData';
import { loadSave, writeSave } from './save/saveStore';
import { Hud } from './ui/hud';
import { t } from './ui/i18n';
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
  player.hp = save.hp > 0 ? save.hp : balance.player.maxHp;
  scene.add(player.view);

  const party = new Party(save.activeCharacter);
  player.setCharacter(party.active);
  for (const member of party.members) {
    if (!member.model) continue;
    // The placeholder keeps the game playable while a model downloads, or if it fails.
    const base = import.meta.env.BASE_URL;
    const weapon = member.weaponModel ? `${base}${member.weaponModel}` : null;
    Avatar.load(`${base}${member.model}`, member.weaponColor ?? member.color, weapon)
      .then((avatar) => player.addAvatar(member.id, avatar))
      .catch((error: unknown) => console.warn(`Could not load ${member.model}`, error));
  }

  const actions = new Actions();
  const orbit = new OrbitCamera(camera, physics, player.body);
  orbit.yaw = save.cameraYaw;

  const applyQuality = () => {
    graphics.setQuality(tier, sky.sun);
    const settings = qualitySettings(tier);
    grass.configure(settings.grassRadius, settings.grassDensity);
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
  const field = new ExplorationField(scene, progress, {
    discovered: (point) => {
      hud.toast(t(`found.${point.kind}`));
      showProgress();
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
    void persist();
  });
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
    reaction: (at, reaction) => hud.floatText(at, t(`reaction.${reaction}`), '#ffe27a', true),
    playerHurt: () => hud.flashHurt(),
    elementArea: (center, radius, element) => field.elementHit(center, radius, element),
    impact: (strength) => orbit.kick(strength),
  });

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
    });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void persist();
  });
  addEventListener('pagehide', () => void persist());

  let last = performance.now();
  let saveTimer = AUTOSAVE_SECONDS;
  let deadTimer = 0;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    terrain.update(player.position);
    grass.update(dt, player.position);

    if (actions.mapPressed && menu.playing) map.toggle();

    if (!menu.playing || map.open) {
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
    hud.setObjective(nextObjective(progress, player.position.x, player.position.z, orbit.yaw));
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
    Object.assign(window, { __game: { player, party, combat, sky, orbit, actions, persist, graphics, menu, terrain, grass, field, progress, map, mapProgress } });
  }
};

void boot();
