import { Vector3 } from 'three';
import { OrbitCamera } from './camera/orbitCamera';
import { Combat } from './combat/combat';
import { balance } from './core/balance';
import { isTouchDevice } from './core/device';
import { qualitySettings, type QualityTier } from './core/quality';
import { Actions } from './input/actions';
import { bindKeyboardMouse } from './input/keyboardMouse';
import { bindTouch } from './input/touch';
import { Party } from './party/party';
import { Player } from './player/player';
import { GameRenderer } from './render/renderer';
import { SAVE_VERSION } from './save/saveData';
import { loadSave, writeSave } from './save/saveStore';
import { Hud } from './ui/hud';
import { t } from './ui/i18n';
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
    set(playing: boolean) {
      menu.playing = playing;
      start.classList.toggle('hidden', playing);
    },
  };
  if (touch) addEventListener('pointerdown', () => menu.set(true), { once: true });
  else {
    document.addEventListener('pointerlockchange', () => menu.set(document.pointerLockElement === canvas));
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
  const spawnPoint = new Vector3(0, terrainHeight(0, 0) + 0.1, 0);
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
  player.setColor(party.active.color);

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
  const hud = new Hud(ui, camera, actions, party, tier, () => {
    tier = tier === 'high' ? 'low' : 'high';
    applyQuality();
    hud.setQuality(tier);
  });
  if (touch) {
    bindTouch(ui, actions);
    const rotate = document.createElement('div');
    rotate.className = 'rotate-hint';
    rotate.textContent = t('hint.rotate');
    ui.append(rotate);
  }
  const menu = showStart(ui, touch, canvas);

  const combat = new Combat(scene, player, party, {
    damage: (at, amount, color) => hud.floatText(at, String(amount), color),
    reaction: (at, reaction) => hud.floatText(at, t(`reaction.${reaction}`), '#ffe27a', true),
    playerHurt: () => hud.flashHurt(),
  });

  const persist = () =>
    writeSave({
      version: SAVE_VERSION,
      position: [player.position.x, player.position.y, player.position.z],
      cameraYaw: orbit.yaw,
      hp: player.hp,
      activeCharacter: party.activeIndex,
      timeOfDay: sky.timeOfDay,
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

    if (!menu.playing) {
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
      player.setColor(party.active.color);
    }
    party.update(dt);
    player.update(dt, actions, orbit.yaw);
    combat.update(dt, actions, camera);
    physics.step(dt);
    orbit.update(dt, actions, player.position);

    if (!player.alive) {
      deadTimer += dt;
      if (deadTimer >= RESPAWN_DELAY) {
        deadTimer = 0;
        player.revive(spawnPoint);
      }
    }

    sky.update(dt, player.position);
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
    Object.assign(window, { __game: { player, party, combat, sky, orbit, actions, persist, graphics, menu, terrain, grass } });
  }
};

void boot();
