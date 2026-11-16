// The player: first-person movement, camera, and per-frame state (bloom, noise,
// footsteps). Movement is acceleration and friction on the ground, reduced control
// in the air, gravity and jumping, and axis-separated collision against the map's
// boxes (see map.js). Crouching lowers the eye and slows the player; sprinting is
// fast, loud and inaccurate (weapons.js reads the speed for spread).
import { CONFIG } from './config.js';
import { collideXZ, groundHeight } from './map.js';
import { consumeMouse, isAiming, isCrouching, isSprinting, moveAxes, wasPressed } from './input.js';
import { playStep } from './audio.js';

const PC = CONFIG.player;
const SENSITIVITY = 0.0022;

export function createPlayer(x, z) {
  return {
    id: 0,
    kind: 'player',
    team: 'elang',
    name: 'Kamu',
    x, y: 0, z,
    vx: 0, vy: 0, vz: 0,
    yaw: 0,
    pitch: 0,
    hp: PC.hp,
    armor: 0,
    alive: true,
    radius: PC.radius,
    height: PC.heightStand,
    weapon: 'pistol',
    lastWeapon: 'pistol',
    weaponsOwned: ['pistol'],
    mags: { pistol: 12 },
    reserves: { pistol: 48 },
    grenades: { frag: 0, smoke: 0 },
    money: CONFIG.economy.start,
    reloading: 0,
    reloadWeapon: null,
    fireCooldown: 0,
    switchTimer: 0,
    bloom: 0,
    crouched: false,
    onGround: true,
    walkCycle: 0,
    stepTimer: 0,
    damageFlash: 0,
    shake: 0,
    prevFire: false,
    grenadeSelected: null,
    mesh: null,
  };
}

export function eyeHeight(player) {
  return player.crouched ? PC.eyeCrouch : PC.eyeStand;
}

export function updateLook(player) {
  // Mouse look: yaw turns the body, pitch the camera, recoil already folded into
  // pitch by weapons.js when a shot fires.
  const { dx, dy } = consumeMouse();
  player.yaw -= dx * SENSITIVITY;
  player.pitch -= dy * SENSITIVITY;
  const pitchLimit = Math.PI / 2 - 0.05;
  if (player.pitch > pitchLimit) player.pitch = pitchLimit;
  if (player.pitch < -pitchLimit) player.pitch = -pitchLimit;
}

export function updatePlayer(state, dt) {
  const player = state.player;
  if (!player.alive) return;
  const colliders = state.map.colliders;

  updateLook(player);

  // Wish direction in world space from the input axes and the yaw.
  const { x: ax, z: az } = moveAxes();
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wishX = ax * cos - az * sin;
  let wishZ = ax * sin + az * cos;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 0) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }
  player.crouched = isCrouching();
  const sprinting = isSprinting() && !player.crouched && az < 0 && !isAiming();
  let speed = player.crouched ? PC.crouch : sprinting ? PC.sprint : PC.walk;
  if (isAiming()) speed *= 0.6;
  const targetX = wishX * speed;
  const targetZ = wishZ * speed;
  const rate = player.onGround ? PC.accel : PC.airAccel;
  const approach = (v, t) => {
    const d = t - v;
    const step = rate * dt;
    if (Math.abs(d) <= step) return t;
    return v + Math.sign(d) * step;
  };
  player.vx = approach(player.vx, targetX);
  player.vz = approach(player.vz, targetZ);
  if (wishLen === 0 && player.onGround) {
    // Friction: bleed speed when no key is held.
    const f = Math.max(0, 1 - PC.friction * dt);
    player.vx *= f;
    player.vz *= f;
  }

  // Jump and gravity.
  if (wasPressed('Space') && player.onGround) {
    player.vy = PC.jumpVel;
    player.onGround = false;
  }
  player.vy -= PC.gravity * dt;
  if (player.vy < -30) player.vy = -30;

  // Move, collide, then resolve the ground.
  collideXZ(colliders, player, PC.radius, player.y, player.vx * dt, player.vz * dt);
  player.y += player.vy * dt;
  const g = groundHeight(colliders, player.x, player.z, player.y);
  if (player.y <= g) {
    player.y = g;
    player.vy = 0;
    player.onGround = true;
  } else if (player.y > g + 0.05) {
    player.onGround = false;
  }
  // Keep inside the map.
  const half = CONFIG.map.half - PC.radius;
  if (player.x > half) player.x = half;
  if (player.x < -half) player.x = -half;
  if (player.z > half) player.z = half;
  if (player.z < -half) player.z = -half;

  // Smooth crouch height.
  const targetHeight = player.crouched ? PC.heightCrouch : PC.heightStand;
  player.height += (targetHeight - player.height) * Math.min(1, dt * 10);

  // Bloom recovery: stopping to aim pays.
  if (player.bloom > 0) player.bloom = Math.max(0, player.bloom - dt * 0.04);
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (player.switchTimer > 0) player.switchTimer -= dt;
  if (player.damageFlash > 0) player.damageFlash -= dt * 2;
  if (player.shake > 0) player.shake = Math.max(0, player.shake - dt * 3);

  // Footsteps: timed by distance, louder and further-heard when sprinting, silent
  // when crouched. Each step writes the noise bots listen for.
  const hSpeed = Math.hypot(player.vx, player.vz);
  if (player.onGround && hSpeed > 0.5) {
    player.walkCycle += hSpeed * dt;
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      player.stepTimer = sprinting ? 0.32 : 0.45;
      if (!player.crouched) {
        playStep(sprinting);
        state.playerNoise = {
          x: player.x, z: player.z, radius: sprinting ? CONFIG.bots.hearSprint : CONFIG.bots.hearWalk, time: state.time,
        };
      }
    }
  }
}

export function playerSpeedFactor(player) {
  const hSpeed = Math.hypot(player.vx, player.vz);
  return Math.min(1.5, hSpeed / PC.walk);
}
