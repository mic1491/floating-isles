import { PCFSoftShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, Vector2, Vector3, WebGLRenderer, type Object3D } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Ai } from './ai';
import { buildArena } from './arena';
import { CHARS, Fighter, noIntent, ULT_CINE_TIME, type Intent, type Match, type Projectile } from './fighter';
import { Fx } from './fx';
import { Hud, type MenuChoice } from './hud';
import { Input } from './input';
import { loadClips, Rig } from './rig';
import { Sfx } from './sfx';

type Phase = 'menu' | 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';
const ROUND_TIME = 60;
const WINS_NEEDED = 2;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
const scene = new Scene();
const camera = new PerspectiveCamera(48, 1, 0.1, 1200);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(512, 512), 0.45, 0.5, 0.97);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const resize = (): void => {
  const width = canvas.clientWidth || innerWidth;
  const height = canvas.clientHeight || innerHeight;
  const ratio = Math.min(devicePixelRatio, 2);
  camera.aspect = width / height;
  // A tall window would crop the two fighters, so the view widens as the window narrows.
  camera.fov = camera.aspect < 1.2 ? 48 + (1.2 - camera.aspect) * 40 : 48;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(ratio);
  composer.setSize(width, height);
};
addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);

const { sun } = buildArena(scene);
const fx = new Fx(scene);
const sfx = new Sfx();
const hud = new Hud();
const input = new Input(() => sfx.unlock());

let fighters: Fighter[] = [];
let player!: Fighter;
let foe!: Fighter;
let ai = new Ai(1);
const choice: MenuChoice = { char: 0, level: 1 };
const projectiles: Projectile[] = [];
let phase: Phase = 'menu';
let phaseT = 0;
let round = 1;
let timer = ROUND_TIME;
const wins: [number, number] = [0, 0];
let hitstop = 0;
let shake = 0;
let timeScale = 1;
let clock = 0;
let called = false;
const combo = [
  { n: 0, t: 0 },
  { n: 0, t: 0 },
];

const match: Match = {
  fx,
  sfx,
  projectiles,
  hitstop: (s) => (hitstop = Math.max(hitstop, s)),
  shake: (a) => (shake = Math.max(shake, a)),
  lines: (s) => hud.speedLines(s),
  ultBanner: (by) => hud.ultBanner(by.def),
  landed: (by, _on, result, strike) => {
    if (result !== 'hit') return;
    const side = by === player ? 0 : 1;
    combo[side].n += 1;
    combo[side].t = 1.3;
    if (combo[side].n >= 2) hud.combo(side, combo[side].n);
    if (strike.power >= 3) hud.whiteout(0.5, 260);
  },
  add: (node: Object3D) => scene.add(node),
  remove: (node: Object3D) => scene.remove(node),
};

const clearProjectiles = (): void => {
  for (const p of projectiles) p.end(match, false);
  projectiles.length = 0;
};

const startRound = (): void => {
  clearProjectiles();
  player.reset(-3.6, 0, Math.PI / 2, match);
  foe.reset(3.6, 0, -Math.PI / 2, match);
  phase = 'intro';
  phaseT = 0;
  called = false;
  timer = ROUND_TIME;
  timeScale = 1;
  combo[0].n = combo[1].n = 0;
  camDir.set(1, 0, 0);
  camSnap = true;
  hud.announce(`ROUND ${round}`, round === WINS_NEEDED * 2 - 1 ? '最終回合' : '', 1.2);
};

const startMatch = (): void => {
  player = fighters[choice.char];
  const others = fighters.filter((f) => f !== player);
  foe = others[Math.floor(Math.random() * others.length)];
  for (const f of fighters) f.rig.root.visible = f === player || f === foe;
  ai = new Ai(choice.level);
  wins[0] = wins[1] = 0;
  round = 1;
  hud.startMatch(player.def, foe.def);
  input.flush();
  startRound();
};

const showMenu = (): void => {
  phase = 'menu';
  clearProjectiles();
  const pick = (): void => {
    fighters.forEach((f, i) => {
      f.rig.root.visible = i === choice.char;
      if (i === choice.char) f.reset(0, 0, 0, match);
    });
    player = fighters[choice.char];
  };
  pick();
  camSnap = true;
  hud.showMenu(choice, pick, startMatch);
};

// The camera stands behind the player's shoulder and keeps both fighters in view.
const camDir = new Vector3(1, 0, 0);
const camPos = new Vector3(0, 2, 6);
const camLook = new Vector3(0, 1.2, 0);
const wantPos = new Vector3();
const wantLook = new Vector3();
let camSnap = true;
const flat = new Vector3();

const updateCamera = (dt: number): void => {
  let follow = 1 - Math.exp(-dt * 6);
  const cine = [player, foe].find((f) => f && f.state === 'ult' && f.stateT < ULT_CINE_TIME);
  if (phase === 'menu') {
    const a = Math.sin(clock * 0.5) * 0.45 + 0.25;
    wantPos.set(Math.sin(a) * 3.3, 1.15, Math.cos(a) * 3.3);
    wantLook.set(0, 0.72, 0);
  } else if (cine) {
    // Close on the face while the finishing move gathers.
    const f = cine.forward;
    const k = cine.stateT / ULT_CINE_TIME;
    wantPos.set(cine.pos.x + f.x * (1.9 - k * 0.5) - f.z * 1.5, 1.2 + k * 0.2, cine.pos.z + f.z * (1.9 - k * 0.5) + f.x * 1.5);
    wantLook.set(cine.pos.x, 1.3, cine.pos.z);
    follow = cine.stateT < 0.1 ? 1 : 1 - Math.exp(-dt * 10);
  } else if (phase === 'roundEnd' || phase === 'matchEnd') {
    const winner = player.dead || (!foe.dead && foe.state === 'win') ? foe : player;
    const f = winner.forward;
    wantPos.set(winner.pos.x + f.x * 3.4 + f.z * 1.1, 1.3, winner.pos.z + f.z * 3.4 - f.x * 1.1);
    wantLook.set(winner.pos.x, 1.15, winner.pos.z);
    follow = 1 - Math.exp(-dt * 3);
  } else {
    flat.set(foe.pos.x - player.pos.x, 0, foe.pos.z - player.pos.z);
    const dist = flat.length();
    if (dist > 0.6) {
      flat.divideScalar(dist);
      // The line between the fighters turns smoothly, so crossing over does not whip the view round.
      camDir.lerp(flat, camSnap ? 1 : 1 - Math.exp(-dt * (dist > 2 ? 5 : 1.5))).setY(0);
      if (camDir.lengthSq() < 0.001) camDir.copy(flat);
      camDir.normalize();
    }
    const back = 3.0 + dist * 0.36;
    const sideways = 2.5 + dist * 0.1;
    wantPos.set(
      player.pos.x - camDir.x * back - camDir.z * sideways,
      1.75 + dist * 0.08 + player.pos.y * 0.3,
      player.pos.z - camDir.z * back + camDir.x * sideways,
    );
    wantLook.set(player.pos.x * 0.4 + foe.pos.x * 0.6, 1.15 + (player.pos.y + foe.pos.y) * 0.3, player.pos.z * 0.4 + foe.pos.z * 0.6);
  }
  if (camSnap) follow = 1;
  camSnap = false;
  camPos.lerp(wantPos, follow);
  camLook.lerp(wantLook, follow);
  camera.position.copy(camPos);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 9);
  }
  camera.lookAt(camLook);
  // A fixed view for checking poses from the console: __cam = [x, y, z, lookX, lookY, lookZ].
  const fixed = (window as { __cam?: number[] }).__cam;
  if (fixed) {
    camera.position.set(fixed[0], fixed[1], fixed[2]);
    camera.lookAt(fixed[3], fixed[4], fixed[5]);
  }
};

const playerIntent = (): Intent => {
  const out = noIntent();
  const x = (input.held('KeyD', 'ArrowRight') ? 1 : 0) - (input.held('KeyA', 'ArrowLeft') ? 1 : 0);
  const y = (input.held('KeyW', 'ArrowUp') ? 1 : 0) - (input.held('KeyS', 'ArrowDown') ? 1 : 0);
  // Up is "into the screen": along the way the camera is looking.
  flat.set(camLook.x - camPos.x, 0, camLook.z - camPos.z).normalize();
  const length = Math.hypot(x, y) || 1;
  out.mx = (flat.x * y - flat.z * x) / length;
  out.mz = (flat.z * y + flat.x * x) / length;
  out.light = input.hit('KeyJ', 'Mouse0');
  out.heavy = input.hit('KeyK', 'Mouse2');
  out.blast = input.hit('KeyL', 'KeyE');
  out.dash = input.hit('ShiftLeft', 'ShiftRight');
  out.jump = input.hit('Space');
  out.ult = input.hit('KeyQ', 'KeyO');
  out.guard = input.held('KeyF', 'KeyU');
  out.charge = input.held('KeyR', 'KeyI');
  return out;
};

const simulate = (dt: number): void => {
  const fighting = phase === 'fight';
  const cine = [player, foe].find((f) => f.state === 'ult' && f.stateT < ULT_CINE_TIME);
  const mine = fighting ? playerIntent() : noIntent();
  const theirs = fighting && !cine ? ai.think(dt, foe, player, projectiles) : noIntent();
  input.flush();
  if (!cine || cine === player) player.update(dt, mine, foe, match);
  if (!cine || cine === foe) foe.update(dt, theirs, player, match);
  player.separate(foe);
  if (!cine) {
    for (const p of projectiles) p.update(dt, match);
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
  }
  combo.forEach((c) => {
    if (c.t > 0 && (c.t -= dt) <= 0) c.n = 0;
  });
  if (fighting && !cine) {
    timer -= dt;
    if (player.dead || foe.dead || timer <= 0) {
      phase = 'ko';
      phaseT = 0;
      timeScale = 0.3;
      hud.announce(player.dead || foe.dead ? 'K.O.' : 'TIME UP', '', 2);
      if (player.dead || foe.dead) hud.whiteout(0.8, 500);
      sfx.bell();
    }
  }
};

const advancePhase = (real: number): void => {
  phaseT += real;
  if (phase === 'intro') {
    if (!called && phaseT > 1.3) {
      called = true;
      hud.announce('FIGHT!', '', 0.7);
      sfx.bell();
    }
    if (phaseT > 1.8) {
      phase = 'fight';
      input.flush();
    }
  } else if (phase === 'ko' && phaseT > 2.1) {
    timeScale = 1;
    const playerWon = foe.dead || (!player.dead && player.hp >= foe.hp);
    const winner = playerWon ? player : foe;
    wins[playerWon ? 0 : 1] += 1;
    winner.celebrate(match);
    hud.announce(winner.def.name, '勝利', 2);
    phase = 'roundEnd';
    phaseT = 0;
  } else if (phase === 'roundEnd' && phaseT > 2.6) {
    if (wins[0] >= WINS_NEEDED || wins[1] >= WINS_NEEDED) {
      phase = 'matchEnd';
      const playerWon = wins[0] >= WINS_NEEDED;
      hud.showResult(playerWon, (playerWon ? player : foe).def, startMatch, showMenu);
    } else {
      round += 1;
      startRound();
    }
  }
};

let last = performance.now();
const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += real;
  hitstop -= real;
  const dt = hitstop > 0 ? 0 : real * timeScale;

  if (phase === 'menu') {
    if (input.hit('Enter')) startMatch();
    else if (input.hit('Digit1', 'Digit2', 'Digit3')) {
      choice.char = input.hit('Digit1') ? 0 : input.hit('Digit2') ? 1 : 2;
      showMenu();
    }
    input.flush();
    player.animate(real, match);
  } else {
    if (dt > 0) simulate(dt);
    advancePhase(real);
    if ((phase as Phase) !== 'menu') {
      const cine = [player, foe].find((f) => f.state === 'ult' && f.stateT < ULT_CINE_TIME);
      player.animate(cine && cine !== player ? 0 : dt, match);
      foe.animate(cine && cine !== foe ? 0 : dt, match);
      hud.bars([player, foe], wins, timer);
    }
  }
  // A long freeze on a blow still lets the sparks fly, slowly.
  fx.update(hitstop > 0 ? real * 0.25 : real * Math.max(0.5, timeScale), camera, renderer.domElement.height);
  hud.update(real);
  updateCamera(real);
  sun.position.set(camLook.x - 9, 18, camLook.z + 7);
  sun.target.position.set(camLook.x, 0, camLook.z);
  sun.target.updateMatrixWorld();
  composer.render();
};

// Built, the game sits in a folder beside the main game's assets; while developing they are served alongside it.
const ASSETS = import.meta.env.DEV ? '' : '../';

const boot = async (): Promise<void> => {
  resize();
  const note = document.querySelector('#loading small')!;
  const library = await loadClips(`${ASSETS}assets/animations/move_clips.json`, `${ASSETS}assets/animations/sword_clips.json`);
  let done = 0;
  const rigs = await Promise.all(
    CHARS.map(async (c) => {
      const rig = await Rig.load(ASSETS + c.url, library, c.hue);
      done += 1;
      note.textContent = `載入角色 ${done}/${CHARS.length}`;
      return rig;
    }),
  );
  fighters = CHARS.map((c, i) => new Fighter(c, rigs[i]));
  for (const f of fighters) scene.add(f.rig.root);
  showMenu();
  document.getElementById('loading')!.classList.add('done');
  requestAnimationFrame(frame);
  // For checking the game from the console.
  Object.assign(window, {
    __game: {
      get phase() { return phase; },
      get player() { return player; },
      get foe() { return foe; },
      get wins() { return wins; },
      get timer() { return timer; },
      choice,
      startMatch,
      ai: () => ai,
    },
  });
};

boot().catch((error) => {
  console.error(error);
  document.querySelector('#loading small')!.textContent = `載入失敗:${String(error)}`;
});
