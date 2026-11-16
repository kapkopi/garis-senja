// Garis Senja: entry point. Builds the state in one place, runs the fixed-step
// simulation apart from rendering, and owns the frame loop, the camera, pause and
// pointer lock, and the global keys. The simulation steps at 60 Hz from an
// accumulator; rendering (camera, viewmodel, bot animation, effects, HUD) runs once
// per frame on the latest state. Nothing here duplicates a system that lives in
// another module: movement, bots, rounds, weapons and the HUD all own their part.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createScene } from './scene.js';
import { buildMap } from './map.js';
import { createPlayer, eyeHeight, updateLook, updatePlayer } from './player.js';
import { BOT_NAMES, buildBotMesh, createBot, updateBotMeshes, updateBots } from './bots.js';
import {
  buyItem, createViewmodel, handleWeaponKeys, initEffects, tryFirePlayer,
  updateEffects, updateGrenades, updateReload, updateSmokes, updateViewmodel,
} from './weapons.js';
import { createRoundState, startMatch, updateRounds } from './rounds.js';
import { initHud, updateHud } from './hud.js';
import { applyShot, parseShot } from './shots.js';
import { endFrame, initInput, isLocked, requestLock, wasPressed } from './input.js';
import { initAudio, isMuted, setMuted } from './audio.js';

const container = document.getElementById('game');
const { renderer, scene, camera } = createScene(container);
camera.rotation.order = 'YXZ';
scene.add(camera);

const map = buildMap(scene);
const player = createPlayer(map.spawns.attackers[0][0], map.spawns.attackers[0][1]);

const bots = [];
const skills = { elang: [0.6, 0.5], bayang: [0.55, 0.5, 0.45, 0.4] };
let botId = 1;
for (let i = 0; i < CONFIG.bots.allies; i++) {
  const [x, z] = map.spawns.attackers[1 + i];
  bots.push(createBot(botId++, 'elang', BOT_NAMES.elang[i], x, z, skills.elang[i]));
}
for (let i = 0; i < CONFIG.bots.enemies; i++) {
  const [x, z] = map.spawns.defenders[i];
  bots.push(createBot(botId++, 'bayang', BOT_NAMES.bayang[i], x, z, skills.bayang[i]));
}
for (const bot of bots) buildBotMesh(scene, bot);

const viewmodel = createViewmodel(camera);
initEffects(scene);

const bombMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.6, emissive: 0xff3020, emissiveIntensity: 0.2 }),
);
bombMesh.visible = false;
scene.add(bombMesh);

const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = 64;
smokeCanvas.height = 64;
const sg = smokeCanvas.getContext('2d');
const sgrad = sg.createRadialGradient(32, 32, 4, 32, 32, 30);
sgrad.addColorStop(0, 'rgba(220,224,230,0.9)');
sgrad.addColorStop(0.6, 'rgba(200,205,212,0.55)');
sgrad.addColorStop(1, 'rgba(190,195,202,0)');
sg.fillStyle = sgrad;
sg.fillRect(0, 0, 64, 64);
const smokeTex = new THREE.CanvasTexture(smokeCanvas);

const state = {
  time: 0,
  phase: 'title',
  paused: false,
  buyMenuOpen: true,
  scene,
  camera,
  map,
  player,
  bots,
  actors: [player, ...bots],
  grenades: [],
  smokes: [],
  feed: [],
  stats: { shots: 0, hits: 0, kills: 0, deaths: 0 },
  round: createRoundState(),
  viewmodel,
  bombMesh,
  grenadeGeo: new THREE.SphereGeometry(0.12, 10, 8),
  grenadeMats: {
    frag: new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.6, metalness: 0.3 }),
    smoke: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.3 }),
  },
  smokeTex,
  playerNoise: null,
  hitmark: null,
  stagingCamera: null,
};
window.__garis = state;

const shot = parseShot();
const shotMode = shot !== null;
state.shotMode = shotMode;

initHud(state, {
  onStart: () => {
    initAudio();
    startMatch(state);
    requestLock(renderer.domElement);
  },
  onResume: () => {
    requestLock(renderer.domElement);
  },
  onRestart: () => {
    initAudio();
    state.paused = false;
    startMatch(state);
    requestLock(renderer.domElement);
  },
});

initInput(renderer.domElement, (locked) => {
  if (shotMode) return;
  if (locked) {
    state.paused = false;
  } else if (state.phase === 'playing' || state.phase === 'buy') {
    state.paused = true;
  }
});

if (shotMode) applyShot(state, shot.shot);

function simulate(dt) {
  state.time += dt;
  if (state.phase === 'playing') {
    updatePlayer(state, dt);
    updateBots(state, dt);
    tryFirePlayer(state);
    handleWeaponKeys(state);
    updateReload(state, player, dt);
    updateGrenades(state, dt);
    updateSmokes(state, dt);
  }
  updateRounds(state, dt);
}

const BUY_KEYS = { Digit1: 'smg', Digit2: 'rifle', Digit3: 'sniper', Digit4: 'frag', Digit5: 'smoke', Digit6: 'armor', Digit7: 'ammo' };

let prevPhase = state.phase;
let last = performance.now();
let acc = 0;
let lastFov = 75;
let readyFlagged = false;

function frame(now) {
  requestAnimationFrame(frame);
  const renderDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // Global keys: mute anywhere, pause and buy-menu keys while in a round.
  if (wasPressed('KeyM')) setMuted(!isMuted());
  if (wasPressed('KeyP') && (state.phase === 'playing' || state.phase === 'buy') && isLocked()) {
    document.exitPointerLock();
  }
  if (state.phase === 'buy' && !state.paused) {
    if (wasPressed('KeyB')) state.buyMenuOpen = !state.buyMenuOpen;
    for (const [code, item] of Object.entries(BUY_KEYS)) {
      if (wasPressed(code)) buyItem(state, item);
    }
  }
  if (state.phase !== prevPhase) {
    if (state.phase === 'buy') state.buyMenuOpen = true;
    prevPhase = state.phase;
  }

  // Fixed-step simulation, skipped while paused or on a menu screen.
  if (!state.paused && state.phase !== 'title' && state.phase !== 'matchEnd') {
    acc += renderDt;
    let steps = 0;
    while (acc >= CONFIG.simDt && steps < CONFIG.maxSimSteps) {
      simulate(CONFIG.simDt);
      acc -= CONFIG.simDt;
      steps++;
    }
    if (steps === CONFIG.maxSimSteps) acc = 0;
  } else {
    acc = 0;
  }

  // Look around while frozen in the buy phase, or after dying, when locked.
  if (isLocked() && (state.phase === 'buy' || !player.alive)) updateLook(player);

  // Camera: the player's eye, with walk bob and explosion shake, or the staged
  // camera for a screenshot. FOV eases toward the weapon's ADS zoom while aiming.
  if (state.stagingCamera) {
    const sc = state.stagingCamera;
    camera.position.set(sc.x, sc.y, sc.z);
    camera.lookAt(sc.tx, sc.ty, sc.tz);
    if (Math.abs(camera.fov - sc.fov) > 0.01) {
      camera.fov = sc.fov;
      camera.updateProjectionMatrix();
    }
  } else {
    const eye = eyeHeight(player);
    const hSpeed = Math.hypot(player.vx, player.vz);
    const bob = player.onGround && hSpeed > 0.5 ? Math.sin(player.walkCycle * 2.2) * 0.02 : 0;
    camera.position.set(
      player.x + (Math.random() - 0.5) * player.shake * 0.06,
      player.y + eye + bob + (Math.random() - 0.5) * player.shake * 0.06,
      player.z,
    );
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    const aiming = state.phase === 'playing' && player.alive && !player.grenadeSelected && player.reloading <= 0
      && document.pointerLockElement === renderer.domElement;
    const targetFov = aiming && isAiming() ? CONFIG.weapons[player.weapon].adsFov : 75;
    if (Math.abs(targetFov - lastFov) > 0.01) {
      lastFov += (targetFov - lastFov) * Math.min(1, renderDt * 12);
      camera.fov = lastFov;
      camera.updateProjectionMatrix();
    }
  }

  updateViewmodel(state, renderDt);
  updateBotMeshes(state, renderDt);
  updateEffects(renderDt);
  updateHud(state, renderDt);
  renderer.render(scene, camera);
  endFrame();

  if (!readyFlagged) {
    readyFlagged = true;
    window.__garisReady = true;
  }
}
requestAnimationFrame(frame);
