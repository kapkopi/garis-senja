// Bots: six AI combatants, two allies and four enemies. Each bot is an actor like
// the player (same fields for health, weapons and hit meshes) plus an ai block with
// its state, path, target and skill. Bots walk a waypoint graph (see map.js), hold
// positions, see with a field of view and a line-of-sight raycast, hear the player's
// noise, and react with a human-like delay before firing in bursts. Attackers push
// and plant; defenders hold and retake. Bot meshes are procedural soldiers whose
// hitboxes are their own visible parts: every hittable mesh carries
// userData.hit = { actor, part }.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeGlowTexture } from './textures.js';
import { collideXZ, findPath, groundHeight, nearestWaypoint } from './map.js';
import { fireWeapon, isBlockedBySmoke, startReload, updateReload } from './weapons.js';
import { playDistantShot, playShot } from './audio.js';

const BC = CONFIG.bots;
const _eye = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _targets = [];

let flashTex = null;

export const BOT_NAMES = {
  elang: ['Rani', 'Bimo'],
  bayang: ['Saka', 'Dara', 'Jaka', 'Lala'],
};

export function createBot(id, team, name, x, z, skill) {
  const weapon = 'pistol';
  return {
    id,
    kind: 'bot',
    team,
    name,
    x, y: 0, z,
    vx: 0, vz: 0,
    yaw: team === 'elang' ? 0 : Math.PI,
    hp: BC.hp,
    armor: 0,
    alive: true,
    radius: BC.radius,
    height: BC.height,
    weapon,
    mag: CONFIG.weapons[weapon].mag,
    reserve: CONFIG.weapons[weapon].reserveMax,
    reloading: 0,
    reloadWeapon: null,
    fireCooldown: 0,
    walkCycle: 0,
    deathTimer: 0,
    mesh: null,
    ai: {
      skill,
      aimError: BC.aimErrorMin + (BC.aimErrorMax - BC.aimErrorMin) * (1 - skill),
      reaction: BC.reactionMin + (BC.reactionMax - BC.reactionMin) * (1 - skill),
      state: 'hold',
      path: [],
      pathIndex: 0,
      target: null,
      lastKnown: null,
      lastSeenTime: -99,
      reactionTimer: 0,
      burstLeft: 0,
      burstPause: 0,
      visionTimer: (id % 6) * 0.025,
      holdNode: 0,
      holdYaw: 0,
      strafeDir: 1,
      strafeTimer: 0,
      stuckTimer: 0,
      lastX: x,
      lastZ: z,
      lastHeardTime: -99,
      investigateUntil: 0,
      moveSpeed: BC.walk,
    },
  };
}

export function buildBotMesh(scene, bot) {
  const teamColor = bot.team === 'elang' ? CONFIG.palette.elang : CONFIG.palette.bayang;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });
  const mark = (mesh, part) => {
    mesh.userData.hit = { actor: bot, part };
    mesh.castShadow = true;
    return mesh;
  };
  const body = mark(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 10), bodyMat), 'body');
  body.position.y = 0.95;
  group.add(body);
  const head = mark(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), skinMat), 'head');
  head.position.y = 1.55;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), darkMat);
  helmet.position.y = 1.57;
  group.add(helmet);
  const legGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
  const legL = mark(new THREE.Mesh(legGeo, darkMat), 'body');
  legL.position.set(-0.12, 0.28, 0);
  group.add(legL);
  const legR = mark(new THREE.Mesh(legGeo, darkMat), 'body');
  legR.position.set(0.12, 0.28, 0);
  group.add(legR);
  const armGeo = new THREE.BoxGeometry(0.11, 0.5, 0.11);
  const armL = mark(new THREE.Mesh(armGeo, bodyMat), 'body');
  armL.position.set(-0.4, 1.05, 0);
  group.add(armL);
  const armR = mark(new THREE.Mesh(armGeo, bodyMat), 'body');
  armR.position.set(0.4, 1.05, -0.15);
  armR.rotation.x = -1.2;
  group.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), darkMat);
  gun.position.set(0.3, 1.25, -0.45);
  group.add(gun);
  if (!flashTex) {
    flashTex = makeGlowTexture([[0, 'rgba(255,240,200,1)'], [0.3, 'rgba(255,190,90,0.8)'], [1, 'rgba(255,150,40,0)']]);
  }
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flash.scale.set(0.4, 0.4, 1);
  flash.position.set(0.3, 1.25, -0.75);
  group.add(flash);
  const bombBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.7 }),
  );
  bombBox.position.set(0, 1.1, 0.35);
  bombBox.visible = false;
  group.add(bombBox);
  group.position.set(bot.x, bot.y, bot.z);
  group.rotation.y = bot.yaw;
  scene.add(group);
  bot.mesh = group;
  bot.parts = { body, head, legL, legR, armL, armR, gun, flash, bombBox };
  bot.flashTimer = 0;
}

export function resetBot(bot, x, z, weaponKey) {
  bot.x = x;
  bot.z = z;
  bot.y = 0;
  bot.vx = 0;
  bot.vz = 0;
  bot.yaw = bot.team === 'elang' ? 0 : Math.PI;
  bot.hp = BC.hp;
  bot.armor = 0;
  bot.alive = true;
  bot.weapon = weaponKey;
  bot.mag = CONFIG.weapons[weaponKey].mag;
  bot.reserve = CONFIG.weapons[weaponKey].reserveMax;
  bot.reloading = 0;
  bot.fireCooldown = 0;
  bot.deathTimer = 0;
  bot.flashTimer = 0;
  const ai = bot.ai;
  ai.state = 'hold';
  ai.path = [];
  ai.pathIndex = 0;
  ai.target = null;
  ai.lastKnown = null;
  ai.lastSeenTime = -99;
  ai.reactionTimer = 0;
  ai.burstLeft = 0;
  ai.burstPause = 0;
  ai.investigateUntil = 0;
  if (bot.mesh) {
    bot.mesh.visible = true;
    bot.mesh.position.set(x, 0, z);
    bot.mesh.rotation.set(0, bot.yaw, 0);
    bot.parts.flash.material.opacity = 0;
    bot.parts.bombBox.visible = false;
  }
}

function faceToward(bot, tx, tz, dt, rate) {
  const want = Math.atan2(-(tx - bot.x), -(tz - bot.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = rate * dt;
  bot.yaw += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
}

function canSee(state, bot, target) {
  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const distSq = dx * dx + dz * dz;
  if (distSq > BC.visionRange * BC.visionRange) return false;
  const dist = Math.sqrt(distSq);
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  if ((dx * fx + dz * fz) / Math.max(dist, 0.001) < Math.cos(BC.visionHalfFov)) return false;
  _eye.set(bot.x, bot.y + 1.5, bot.z);
  _chest.set(target.x, target.y + 1.1, target.z);
  if (isBlockedBySmoke(state, _eye, _chest)) return false;
  _toTarget.subVectors(_chest, _eye).normalize();
  _ray.set(_eye, _toTarget);
  _ray.far = dist;
  _targets.length = 0;
  for (const m of state.map.occluders) _targets.push(m);
  const hits = _ray.intersectObjects(_targets, false);
  return hits.length === 0 || hits[0].distance >= dist - 0.5;
}

function setPath(state, bot, destNode) {
  const from = nearestWaypoint(state.map.waypoints, bot.x, bot.z);
  bot.ai.path = findPath(state.map.edges, state.map.waypoints.length, from, destNode);
  bot.ai.pathIndex = 0;
  bot.ai.stuckTimer = 0;
  bot.ai.lastX = bot.x;
  bot.ai.lastZ = bot.z;
}

function followPath(state, bot, dt, speed) {
  const ai = bot.ai;
  if (ai.pathIndex >= ai.path.length) return true;
  const node = state.map.waypoints[ai.path[ai.pathIndex]];
  const dx = node.x - bot.x;
  const dz = node.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.2) {
    ai.pathIndex++;
    return ai.pathIndex >= ai.path.length;
  }
  moveBot(state, bot, dx / dist, dz / dist, speed, dt);
  faceToward(bot, node.x, node.z, dt, 8);
  // Stuck: no progress for 2 s means a blocked node; skip it.
  ai.stuckTimer += dt;
  if (ai.stuckTimer > 2) {
    const moved = Math.hypot(bot.x - ai.lastX, bot.z - ai.lastZ);
    if (moved < 0.5) ai.pathIndex++;
    ai.stuckTimer = 0;
    ai.lastX = bot.x;
    ai.lastZ = bot.z;
  }
  return false;
}

function moveBot(state, bot, dirX, dirZ, speed, dt) {
  bot.vx = dirX * speed;
  bot.vz = dirZ * speed;
  collideXZ(state.map.colliders, bot, BC.radius, bot.y, bot.vx * dt, bot.vz * dt);
  bot.y = groundHeight(state.map.colliders, bot.x, bot.z, bot.y);
  bot.walkCycle += speed * dt;
  bot.mesh.position.set(bot.x, bot.y, bot.z);
  bot.mesh.rotation.y = bot.yaw;
}

function holdStill(state, bot, dt) {
  bot.vx = 0;
  bot.vz = 0;
  bot.mesh.position.set(bot.x, bot.y, bot.z);
  bot.mesh.rotation.y = bot.yaw;
}

function nearestEnemy(state, bot) {
  let best = null;
  let bestD = Infinity;
  for (const actor of state.actors) {
    if (!actor.alive || actor.team === bot.team) continue;
    const d = (actor.x - bot.x) ** 2 + (actor.z - bot.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = actor;
    }
  }
  return best;
}

function decideObjective(state, bot) {
  const ai = bot.ai;
  const bomb = state.round.bomb;
  if (bot.team === 'elang') {
    if (bomb.state === 'planted') {
      // Defend the plant: go to the site and hold.
      const site = state.map.sites.find((s) => s.id === bomb.site);
      if (site && Math.hypot(bot.x - site.x, bot.z - site.z) > 6) {
        ai.state = 'move';
        setPath(state, bot, bomb.site === 'A' ? 17 : 18);
      } else {
        ai.state = 'hold';
        ai.holdYaw = Math.atan2(-(0 - bot.x), -(-6 - bot.z));
      }
      return;
    }
    if (bomb.state === 'dropped') {
      const others = state.actors.filter((a) => a.kind === 'bot' && a.team === 'elang' && a.alive && a !== bot);
      const nearest = others.every((o) => Math.hypot(bot.x - bomb.x, bot.z - bomb.z) <= Math.hypot(o.x - bomb.x, o.z - bomb.z));
      if (nearest && state.player.alive === false) {
        ai.state = 'move';
        setPath(state, bot, nearestWaypoint(state.map.waypoints, bomb.x, bomb.z));
        return;
      }
    }
    if (bomb.carrier === bot) {
      // Carry the bomb to the nearest site and plant.
      const siteA = state.map.sites[0];
      const siteB = state.map.sites[1];
      const nearA = Math.hypot(bot.x - siteA.x, bot.z - siteA.z) <= Math.hypot(bot.x - siteB.x, bot.z - siteB.z);
      ai.state = 'plant';
      setPath(state, bot, nearA ? 17 : 18);
      return;
    }
    // Otherwise follow the player, offset behind them.
    ai.state = 'follow';
    return;
  }
  // Defenders.
  if (bomb.state === 'planted') {
    ai.state = 'retake';
    setPath(state, bot, bomb.site === 'A' ? 17 : 18);
    return;
  }
  if (ai.state === 'retake' || ai.state === 'investigate') {
    ai.state = 'hold';
    setPath(state, bot, ai.holdNode);
    return;
  }
  ai.state = 'hold';
}

export function updateBots(state, dt) {
  // Objective transitions: a plant, or the player's death, re-decides every bot
  // that is not already fighting (allies fetch the bomb, defenders retake).
  const planted = state.round.bomb.state === 'planted';
  const playerDead = !state.player.alive;
  if (planted !== state._prevPlanted || playerDead !== state._prevPlayerDead) {
    state._prevPlanted = planted;
    state._prevPlayerDead = playerDead;
    for (const bot of state.bots) {
      if (bot.alive && bot.ai.state !== 'engage') decideObjective(state, bot);
    }
  }
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const ai = bot.ai;
    updateReload(state, bot, dt);
    if (bot.fireCooldown > 0) bot.fireCooldown -= dt;
    if (bot.flashTimer > 0) bot.flashTimer -= dt;

    // Vision, staggered so not every bot raycasts on the same tick.
    ai.visionTimer -= dt;
    if (ai.visionTimer <= 0) {
      ai.visionTimer = BC.visionInterval;
      const enemy = nearestEnemy(state, bot);
      let seen = null;
      if (enemy && canSee(state, bot, enemy)) seen = enemy;
      if (seen) {
        if (ai.target !== seen) ai.reactionTimer = ai.reaction;
        ai.target = seen;
        ai.lastKnown = { x: seen.x, z: seen.z };
        ai.lastSeenTime = state.time;
        ai.state = 'engage';
      } else if (ai.target && state.time - ai.lastSeenTime > 1) {
        ai.target = null;
        if (ai.state === 'engage') decideObjective(state, bot);
      }
    }

    // Hearing: enemies investigate the player's noise; allies know better.
    if (bot.team === 'bayang' && ai.state !== 'engage' && state.playerNoise) {
      const n = state.playerNoise;
      if (n.time > ai.lastHeardTime && state.time - n.time < 1.5) {
        ai.lastHeardTime = n.time;
        const d = Math.hypot(bot.x - n.x, bot.z - n.z);
        if (d < n.radius) {
          ai.lastKnown = { x: n.x, z: n.z };
          ai.investigateUntil = state.time + 4;
          ai.state = 'investigate';
          setPath(state, bot, nearestWaypoint(state.map.waypoints, n.x, n.z));
        }
      }
    }
    if (ai.state === 'investigate' && state.time > ai.investigateUntil) {
      decideObjective(state, bot);
    }

    // Act on the current state.
    if (ai.state === 'engage' && ai.target && ai.target.alive) {
      const t = ai.target;
      faceToward(bot, t.x, t.z, dt, 12);
      // Strafe perpendicular to the target, flipping every 1-2 s.
      ai.strafeTimer -= dt;
      if (ai.strafeTimer <= 0) {
        ai.strafeDir *= -1;
        ai.strafeTimer = 1 + Math.random();
      }
      const dx = t.x - bot.x;
      const dz = t.z - bot.z;
      const dist = Math.max(Math.hypot(dx, dz), 0.001);
      const px = -dz / dist * ai.strafeDir;
      const pz = dx / dist * ai.strafeDir;
      // Defenders hold their ground; attackers close in when far.
      const approach = bot.team === 'elang' && dist > 14 ? 0.6 : 0;
      moveBot(state, bot, px + (dx / dist) * approach, pz + (dz / dist) * approach, BC.walk, dt);
      if (ai.reactionTimer > 0) {
        ai.reactionTimer -= dt;
      } else if (bot.reloading <= 0) {
        if (ai.burstLeft <= 0) {
          if (ai.burstPause > 0) {
            ai.burstPause -= dt;
          } else {
            ai.burstLeft = BC.burstMin + Math.floor(Math.random() * (BC.burstMax - BC.burstMin + 1));
          }
        }
        if (ai.burstLeft > 0 && bot.fireCooldown <= 0) {
          if (bot.mag <= 0) {
            startReload(state, bot);
          } else {
            bot.mag--;
            bot.fireCooldown = CONFIG.weapons[bot.weapon].interval;
            ai.burstLeft--;
            if (ai.burstLeft === 0) ai.burstPause = BC.burstPauseMin + Math.random() * (BC.burstPauseMax - BC.burstPauseMin);
            _eye.set(bot.x, bot.y + 1.5, bot.z);
            _toTarget.set(t.x - bot.x, (t.y + 1.1) - (bot.y + 1.5), t.z - bot.z).normalize();
            const targetSpeed = Math.hypot(t.vx || 0, t.vz || 0);
            const spread = ai.aimError * (1 + targetSpeed * 0.08);
            fireWeapon(state, bot, _eye, _toTarget, spread, bot.weapon);
            bot.flashTimer = 0.05;
            const playerDist = Math.hypot(state.player.x - bot.x, state.player.z - bot.z);
            if (playerDist < 15) playShot(bot.weapon);
            else playDistantShot();
          }
        }
      }
    } else if (ai.state === 'follow') {
      // Stay a few metres behind the player, offset by bot id.
      const p = state.player;
      const back = bot.id % 2 === 0 ? 3.5 : 4.5;
      const side = bot.id % 2 === 0 ? -2 : 2;
      const tx = p.x + Math.sin(p.yaw) * back + Math.cos(p.yaw) * side;
      const tz = p.z + Math.cos(p.yaw) * back - Math.sin(p.yaw) * side;
      const dist = Math.hypot(tx - bot.x, tz - bot.z);
      if (dist > 8) {
        setPath(state, bot, nearestWaypoint(state.map.waypoints, tx, tz));
        ai.state = 'move';
      } else if (dist > 1.5) {
        moveBot(state, bot, (tx - bot.x) / dist, (tz - bot.z) / dist, BC.run, dt);
        faceToward(bot, p.x, p.z, dt, 8);
      } else {
        holdStill(state, bot, dt);
        faceToward(bot, p.x - Math.sin(p.yaw) * 10, p.z - Math.cos(p.yaw) * 10, dt, 8);
      }
    } else if (ai.state === 'move' || ai.state === 'plant' || ai.state === 'retake' || ai.state === 'investigate') {
      const done = followPath(state, bot, dt, BC.run);
      if (done) {
        if (ai.state === 'plant') {
          holdStill(state, bot, dt);
        } else if (ai.state === 'retake') {
          ai.state = 'hold';
        } else if (ai.state === 'investigate') {
          holdStill(state, bot, dt);
          bot.yaw += dt * 0.8;
        } else {
          decideObjective(state, bot);
        }
      }
    } else {
      // Hold: defenders return to their hold node while the bomb is not planted;
      // otherwise (a planted bomb, or an ally defending it) hold in place.
      const returning = bot.team === 'bayang' && state.round.bomb.state !== 'planted';
      let pathed = false;
      if (returning) {
        const node = state.map.waypoints[ai.holdNode];
        const dist = Math.hypot(node.x - bot.x, node.z - bot.z);
        if (dist > 1.5 && ai.path.length === 0) setPath(state, bot, ai.holdNode);
        if (ai.path.length > 0) {
          pathed = true;
          if (followPath(state, bot, dt, BC.walk)) ai.path = [];
        }
      }
      if (!pathed) {
        holdStill(state, bot, dt);
        let diff = ai.holdYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += Math.max(-8 * dt, Math.min(8 * dt, diff));
      }
    }
  }
}

// Visual-only per-frame update: walk swing, death fall and sink, muzzle flash,
// and the bomb box on the carrier's back. Called from the render loop.
export function updateBotMeshes(state, dt) {
  for (const bot of state.bots) {
    if (!bot.mesh) continue;
    const parts = bot.parts;
    if (!bot.alive) {
      bot.deathTimer += dt;
      const fall = Math.min(1, bot.deathTimer / 0.35);
      bot.mesh.rotation.x = -fall * Math.PI * 0.5;
      if (bot.deathTimer > 4) {
        bot.mesh.position.y -= dt * 0.8;
        if (bot.mesh.position.y < -1.6) bot.mesh.visible = false;
      }
      continue;
    }
    const swing = Math.sin(bot.walkCycle * 2.4) * 0.45;
    const moving = Math.hypot(bot.vx, bot.vz) > 0.3;
    const amp = moving ? swing : 0;
    parts.legL.rotation.x = amp;
    parts.legR.rotation.x = -amp;
    parts.armL.rotation.x = -amp * 0.7;
    parts.body.position.y = 0.95 + (moving ? Math.abs(Math.cos(bot.walkCycle * 2.4)) * 0.03 : 0);
    parts.flash.material.opacity = bot.flashTimer > 0 ? 0.9 : 0;
    parts.bombBox.visible = state.round.bomb.carrier === bot;
  }
}
