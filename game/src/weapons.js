// Weapons: firing, reloading, switching, grenades, and every shot effect. Hits are
// hitscan raycasts against the map's occluders and the combatants' own meshes: each
// bot mesh that can be hit carries userData.hit = { actor, part } (set by bots.js),
// so what the ray hits is what the player sees. Tracers, impact sparks and decals
// come from fixed pools, reused, never allocated per shot. The first-person gun is
// a procedural viewmodel attached to the camera, with bob, kick, reload and switch
// motion, ADS positioning and a muzzle flash.
import * as THREE from 'three';
import { CONFIG, WEAPON_ORDER } from './config.js';
import { makeGlowTexture } from './textures.js';
import { isAiming, isFiring, wasPressed } from './input.js';
import { collideXZ, groundHeight } from './map.js';
import { eyeHeight, playerSpeedFactor } from './player.js';
import {
  playBeep, playBuy, playEmpty, playExplosion, playHit, playHurt,
  playReload, playShot, playThrow,
} from './audio.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _targets = [];
const _normal = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

// ---- Spread ----

export function currentSpread(state, weaponKey) {
  const player = state.player;
  const w = CONFIG.weapons[weaponKey];
  const aiming = isAiming();
  let base = w.spread;
  if (weaponKey === 'sniper' && aiming) base = w.scopedSpread;
  let spread = base + w.moveSpread * playerSpeedFactor(player) + player.bloom;
  if (!player.onGround) spread *= 1.5;
  if (player.crouched) spread *= 0.7;
  if (aiming && weaponKey !== 'sniper') spread *= w.adsSpreadMult;
  return spread;
}

function spreadDirection(dir, spread, out) {
  // A random direction inside a cone of the given half-angle around dir.
  const u = Math.random();
  const angle = spread * Math.sqrt(-2 * Math.log(Math.max(u, 1e-9)));
  const around = Math.random() * Math.PI * 2;
  out.copy(dir);
  const right = _seg.set(1, 0, 0);
  if (Math.abs(dir.y) > 0.9) right.set(0, 0, 1);
  right.cross(dir).normalize();
  const up = _closest.copy(dir).cross(right).normalize();
  out.addScaledVector(right, Math.cos(around) * angle);
  out.addScaledVector(up, Math.sin(around) * angle);
  out.normalize();
  return out;
}

// ---- Damage ----

export function damageActor(state, target, rawDamage, attacker, isHead, weaponKey) {
  if (!target.alive) return;
  let damage = rawDamage;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, damage * 0.5);
    target.armor -= absorbed;
    damage -= absorbed;
  }
  target.hp -= damage;
  if (target.kind === 'player') {
    target.damageFlash = 1;
    playHurt();
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deathTimer = 0;
    if (attacker && attacker.kind === 'player') state.stats.kills++;
    if (target.kind === 'player') state.stats.deaths++;
    state.feed.push({
      text: `${attacker ? attacker.name : 'Bom'} ${isHead ? '◉' : '→'} ${target.name}`,
      time: state.time,
      headshot: isHead,
    });
    if (state.round.bomb.carrier === target) {
      state.round.bomb.state = 'dropped';
      state.round.bomb.carrier = null;
      state.round.bomb.x = target.x;
      state.round.bomb.z = target.z;
    }
  }
}

function falloffMult(weapon, distance) {
  if (distance <= weapon.rangeFull) return 1;
  if (distance >= weapon.rangeFar) return weapon.rangeMinMult;
  const t = (distance - weapon.rangeFull) / (weapon.rangeFar - weapon.rangeFull);
  return 1 - t * (1 - weapon.rangeMinMult);
}

// ---- Effects pools ----

let tracerPool = [];
let impactPool = [];
let decalPool = [];
let decalIndex = 0;
let sparkTex = null;

export function initEffects(scene) {
  sparkTex = makeGlowTexture([[0, 'rgba(255,240,200,1)'], [0.3, 'rgba(255,190,90,0.8)'], [1, 'rgba(255,150,40,0)']]);
  tracerPool = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  impactPool = [];
  for (let i = 0; i < 24; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sparkTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.scale.set(0.5, 0.5, 1);
    sprite.visible = false;
    scene.add(sprite);
    impactPool.push({ sprite, life: 0 });
  }
  decalPool = [];
  const decalTex = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(10,10,12,0.85)';
    g.beginPath();
    g.arc(16, 16, 12, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  })();
  for (let i = 0; i < 30; i++) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    decalPool.push({ mesh, life: 0 });
  }
}

function spawnTracer(from, to) {
  for (const t of tracerPool) {
    if (t.life > 0) continue;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.life = 0.08;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
    return;
  }
}

function spawnImpact(point, normal) {
  for (const imp of impactPool) {
    if (imp.life > 0) continue;
    imp.sprite.position.copy(point);
    imp.life = 0.12;
    imp.sprite.visible = true;
    imp.sprite.material.opacity = 1;
    break;
  }
  const d = decalPool[decalIndex];
  decalIndex = (decalIndex + 1) % decalPool.length;
  d.mesh.position.copy(point).addScaledVector(normal, 0.012);
  d.mesh.quaternion.setFromUnitVectors(_zAxis, normal);
  d.life = 5;
  d.mesh.visible = true;
  d.mesh.material.opacity = 0.85;
}

export function updateEffects(dt) {
  for (const t of tracerPool) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
    if (t.life <= 0) t.line.visible = false;
  }
  for (const imp of impactPool) {
    if (imp.life <= 0) continue;
    imp.life -= dt;
    imp.sprite.material.opacity = Math.max(0, imp.life / 0.12);
    if (imp.life <= 0) {
      imp.sprite.visible = false;
      imp.sprite.scale.set(0.5, 0.5, 1);
    }
  }
  for (const d of decalPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life < 1) d.mesh.material.opacity = 0.85 * d.life;
    if (d.life <= 0) d.mesh.visible = false;
  }
}

// ---- Firing ----

export function fireWeapon(state, shooter, origin, dir, spread, weaponKey) {
  const weapon = CONFIG.weapons[weaponKey];
  spreadDirection(dir, spread, _dir);
  raycaster.set(origin, _dir);
  _targets.length = 0;
  for (const m of state.map.occluders) _targets.push(m);
  for (const actor of state.actors) {
    if (!actor.alive || actor === shooter || !actor.mesh) continue;
    for (const child of actor.mesh.children) {
      if (child.userData.hit) _targets.push(child);
    }
  }
  const hits = raycaster.intersectObjects(_targets, false);
  const muzzle = muzzlePosition(state, shooter, weaponKey, _muzzle);
  if (hits.length === 0) {
    _hitPoint.copy(origin).addScaledVector(_dir, 120);
    spawnTracer(muzzle, _hitPoint);
    return null;
  }
  const hit = hits[0];
  _hitPoint.copy(hit.point);
  spawnTracer(muzzle, _hitPoint);
  const hitInfo = hit.object.userData.hit;
  if (hitInfo) {
    const isHead = hitInfo.part === 'head';
    const damage = weapon.damage * falloffMult(weapon, hit.distance) * (isHead ? weapon.headMult : 1);
    damageActor(state, hitInfo.actor, damage, shooter, isHead, weaponKey);
    if (shooter.kind === 'player') {
      state.stats.hits++;
      state.hitmark = { time: state.time, headshot: isHead };
      playHit(isHead);
    }
    return { actor: hitInfo.actor, headshot: isHead, point: _hitPoint, distance: hit.distance };
  }
  if (hit.face) _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  else _normal.set(0, 1, 0);
  spawnImpact(_hitPoint, _normal);
  return { point: _hitPoint, distance: hit.distance };
}

function muzzlePosition(state, shooter, weaponKey, out) {
  if (shooter.kind === 'player' && state.viewmodel) {
    state.viewmodel.flashTip.getWorldPosition(out);
    return out;
  }
  // Bots: the gun tip, half a metre ahead of the chest.
  out.set(
    shooter.x - Math.sin(shooter.yaw) * 0.55,
    shooter.y + 1.35,
    shooter.z - Math.cos(shooter.yaw) * 0.55,
  );
  return out;
}

export function tryFirePlayer(state) {
  const player = state.player;
  if (!player.alive || state.phase !== 'playing' || state.paused) return;
  if (player.switchTimer > 0 || player.reloading > 0) {
    player.prevFire = isFiring();
    return;
  }
  const firing = isFiring();
  if (player.grenadeSelected) {
    if (firing && !player.prevFire) throwGrenade(state, player, player.grenadeSelected);
    player.prevFire = firing;
    return;
  }
  const weapon = CONFIG.weapons[player.weapon];
  const trigger = weapon.auto ? firing : firing && !player.prevFire;
  player.prevFire = firing;
  if (!trigger || player.fireCooldown > 0) return;
  const mag = player.mags[player.weapon] || 0;
  if (mag <= 0) {
    playEmpty();
    player.fireCooldown = 0.3;
    startReload(state, player);
    return;
  }
  player.mags[player.weapon] = mag - 1;
  player.fireCooldown = weapon.interval;
  player.bloom = Math.min(0.05, player.bloom + weapon.bloom);
  player.pitch += weapon.recoil;
  state.stats.shots++;
  _origin.set(player.x, player.y + eyeHeight(player), player.z);
  _dir.set(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  fireWeapon(state, player, _origin, _dir, currentSpread(state, player.weapon), player.weapon);
  playShot(player.weapon);
  state.viewmodel.flashTimer = 0.05;
  state.viewmodel.kick = Math.min(0.06, state.viewmodel.kick + 0.02);
  state.playerNoise = { x: player.x, z: player.z, radius: CONFIG.bots.hearShot, time: state.time };
}

// ---- Reload, switch, buy ----

export function startReload(state, actor) {
  if (actor.reloading > 0) return;
  const weapon = CONFIG.weapons[actor.weapon];
  const mag = actor.kind === 'player' ? (actor.mags[actor.weapon] || 0) : actor.mag;
  const reserve = actor.kind === 'player' ? (actor.reserves[actor.weapon] || 0) : actor.reserve;
  if (mag >= weapon.mag || reserve <= 0) return;
  actor.reloading = weapon.reload;
  actor.reloadWeapon = actor.weapon;
  if (actor.kind === 'player') playReload();
}

export function updateReload(state, actor, dt) {
  if (actor.reloading <= 0) return;
  actor.reloading -= dt;
  if (actor.reloading > 0) return;
  const key = actor.reloadWeapon;
  const weapon = CONFIG.weapons[key];
  if (actor.kind === 'player') {
    const need = weapon.mag - (actor.mags[key] || 0);
    const take = Math.min(need, actor.reserves[key] || 0);
    actor.mags[key] = (actor.mags[key] || 0) + take;
    actor.reserves[key] = (actor.reserves[key] || 0) - take;
  } else {
    const need = weapon.mag - actor.mag;
    const take = Math.min(need, actor.reserve);
    actor.mag += take;
    actor.reserve -= take;
  }
}

export function switchWeapon(state, key) {
  const player = state.player;
  if (!player.weaponsOwned.includes(key) || player.weapon === key) return;
  player.lastWeapon = player.weapon;
  player.weapon = key;
  player.grenadeSelected = null;
  player.reloading = 0;
  player.fireCooldown = 0.25;
  player.switchTimer = 0.25;
}

export function selectGrenade(state, type) {
  const player = state.player;
  if ((player.grenades[type] || 0) <= 0) return;
  if (player.grenadeSelected === type) {
    player.grenadeSelected = null;
    return;
  }
  player.grenadeSelected = type;
  player.reloading = 0;
  player.switchTimer = 0.2;
}

export function handleWeaponKeys(state) {
  const player = state.player;
  if (!player.alive || state.phase !== 'playing') return;
  for (const key of WEAPON_ORDER) {
    if (wasPressed(`Digit${CONFIG.weapons[key].slot}`)) switchWeapon(state, key);
  }
  if (wasPressed('Digit5')) selectGrenade(state, 'frag');
  if (wasPressed('Digit6')) selectGrenade(state, 'smoke');
  if (wasPressed('KeyQ')) switchWeapon(state, player.lastWeapon);
  if (wasPressed('KeyG') && (player.grenades.frag || 0) > 0) throwGrenade(state, player, 'frag');
  if (wasPressed('KeyR')) startReload(state, player);
}

export function buyItem(state, item) {
  const player = state.player;
  const econ = CONFIG.economy;
  const price = item === 'armor' ? econ.armorPrice
    : item === 'ammo' ? econ.ammoPrice
    : CONFIG.weapons[item] ? CONFIG.weapons[item].price
    : CONFIG.grenades[item].price;
  if (player.money < price) return false;
  if (CONFIG.weapons[item]) {
    if (player.weaponsOwned.includes(item)) return false;
    player.weaponsOwned.push(item);
    player.mags[item] = CONFIG.weapons[item].mag;
    player.reserves[item] = CONFIG.weapons[item].reserveMax;
    switchWeapon(state, item);
  } else if (CONFIG.grenades[item]) {
    player.grenades[item] = (player.grenades[item] || 0) + 1;
  } else if (item === 'armor') {
    if (player.armor >= 100) return false;
    player.armor = 100;
  } else if (item === 'ammo') {
    for (const key of player.weaponsOwned) {
      player.reserves[key] = CONFIG.weapons[key].reserveMax;
    }
  }
  player.money -= price;
  playBuy();
  return true;
}

// ---- Grenades ----

export function throwGrenade(state, actor, type) {
  if (actor.kind === 'player') {
    if ((actor.grenades[type] || 0) <= 0) return;
    actor.grenades[type]--;
    actor.grenadeSelected = null;
    switchWeapon(state, actor.lastWeapon);
  }
  const def = CONFIG.grenades[type];
  const dir = _dir.set(0, 0, -1).applyEuler(new THREE.Euler(actor.pitch || 0, actor.yaw, 0, 'YXZ'));
  const mesh = new THREE.Mesh(
    state.grenadeGeo,
    type === 'frag' ? state.grenadeMats.frag : state.grenadeMats.smoke,
  );
  mesh.position.set(actor.x, actor.y + 1.5, actor.z);
  state.scene.add(mesh);
  state.grenades.push({
    type, x: actor.x, y: actor.y + 1.5, z: actor.z,
    vx: dir.x * 14, vy: dir.y * 14 + 4, vz: dir.z * 14,
    fuse: def.fuse ?? 1.2, owner: actor, mesh, rest: false,
  });
  playThrow();
}

export function updateGrenades(state, dt) {
  const colliders = state.map.colliders;
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    if (!g.rest) {
      g.vy -= 18 * dt;
      const pos = { x: g.x, z: g.z };
      collideXZ(colliders, pos, 0.12, g.y, g.vx * dt, g.vz * dt);
      if (pos.x !== g.x + g.vx * dt) g.vx *= -0.4;
      if (pos.z !== g.z + g.vz * dt) g.vz *= -0.4;
      g.x = pos.x;
      g.z = pos.z;
      g.y += g.vy * dt;
      const ground = groundHeight(colliders, g.x, g.z, g.y);
      if (g.y <= ground + 0.12) {
        g.y = ground + 0.12;
        if (Math.abs(g.vy) > 2) {
          g.vy *= -0.4;
          g.vx *= 0.7;
          g.vz *= 0.7;
        } else {
          g.vy = 0;
          g.vx = 0;
          g.vz = 0;
          g.rest = true;
        }
      }
      g.mesh.position.set(g.x, g.y, g.z);
    }
    if (g.fuse <= 0) {
      state.scene.remove(g.mesh);
      state.grenades.splice(i, 1);
      if (g.type === 'frag') explodeFrag(state, g);
      else spawnSmoke(state, g);
    }
  }
}

function explodeFrag(state, g) {
  const def = CONFIG.grenades.frag;
  playExplosion();
  for (const actor of state.actors) {
    if (!actor.alive) continue;
    const dx = actor.x - g.x;
    const dy = actor.y + 0.9 - g.y;
    const dz = actor.z - g.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > def.radius) continue;
    const damage = def.maxDamage * (1 - dist / def.radius);
    damageActor(state, actor, damage, g.owner, false, 'frag');
  }
  // A brief flash sprite at the blast, reused from the impact pool.
  for (const imp of impactPool) {
    if (imp.life > 0) continue;
    imp.sprite.position.set(g.x, g.y + 0.3, g.z);
    imp.sprite.scale.set(3, 3, 1);
    imp.life = 0.25;
    imp.sprite.visible = true;
    imp.sprite.material.opacity = 1;
    break;
  }
  const player = state.player;
  const distToPlayer = Math.hypot(player.x - g.x, player.z - g.z);
  if (distToPlayer < 12) player.shake = Math.min(1, 1 - distToPlayer / 12);
  state.playerNoise = { x: g.x, z: g.z, radius: CONFIG.bots.hearShot, time: state.time };
}

function spawnSmoke(state, g) {
  const def = CONFIG.grenades.smoke;
  const sprites = [];
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: state.smokeTex, transparent: true, opacity: 0.55, depthWrite: false, color: 0xd8dce2,
    }));
    const a = (i / 6) * Math.PI * 2;
    sprite.position.set(g.x + Math.cos(a) * 1.2, g.y + 0.5 + (i % 2), g.z + Math.sin(a) * 1.2);
    sprite.scale.set(3.5, 3.5, 1);
    state.scene.add(sprite);
    sprites.push(sprite);
  }
  state.smokes.push({ x: g.x, y: g.y, z: g.z, radius: def.radius, timer: def.duration, sprites });
  playBeep();
}

export function updateSmokes(state, dt) {
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    const s = state.smokes[i];
    s.timer -= dt;
    const fade = s.timer < 2 ? s.timer / 2 : 1;
    for (const sprite of s.sprites) {
      sprite.material.opacity = 0.55 * fade;
      sprite.position.y += dt * 0.15;
    }
    if (s.timer <= 0) {
      for (const sprite of s.sprites) state.scene.remove(sprite);
      state.smokes.splice(i, 1);
    }
  }
}

// Does the segment from->to pass through any live smoke cloud?
export function isBlockedBySmoke(state, from, to) {
  for (const s of state.smokes) {
    _seg.subVectors(to, from);
    const lenSq = _seg.lengthSq();
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((s.x - from.x) * _seg.x + (s.y - from.y) * _seg.y + (s.z - from.z) * _seg.z) / lenSq));
    _closest.copy(from).addScaledVector(_seg, t);
    const dx = s.x - _closest.x;
    const dy = s.y - _closest.y;
    const dz = s.z - _closest.z;
    if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) return true;
  }
  return false;
}

// ---- Viewmodel ----

function gunMesh(key) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.5, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 });
  const group = new THREE.Group();
  const box = (w, h, d, x, y, z, mat = dark) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  if (key === 'pistol') {
    box(0.05, 0.06, 0.22, 0, 0, -0.05);
    box(0.045, 0.1, 0.06, 0, -0.07, 0.04, grip);
    box(0.02, 0.02, 0.05, 0, 0.045, -0.14);
  } else if (key === 'smg') {
    box(0.06, 0.08, 0.34, 0, 0, -0.05);
    box(0.04, 0.12, 0.06, 0, -0.09, -0.06, grip);
    box(0.025, 0.025, 0.14, 0, 0.01, -0.28);
    box(0.05, 0.05, 0.1, 0, -0.01, 0.14, grip);
  } else if (key === 'rifle') {
    box(0.06, 0.09, 0.5, 0, 0, -0.1);
    box(0.045, 0.13, 0.07, 0, -0.1, -0.08, grip);
    box(0.025, 0.025, 0.22, 0, 0.01, -0.42);
    box(0.05, 0.07, 0.16, 0, -0.02, 0.2, grip);
    box(0.02, 0.03, 0.06, 0, 0.06, -0.2);
  } else {
    box(0.06, 0.09, 0.62, 0, 0, -0.12);
    box(0.045, 0.12, 0.07, 0, -0.09, -0.05, grip);
    box(0.02, 0.02, 0.3, 0, 0.01, -0.5);
    box(0.05, 0.07, 0.18, 0, -0.02, 0.22, grip);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.1);
    group.add(scope);
  }
  return group;
}

export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.28, -0.26, -0.65);
  camera.add(group);
  const guns = {};
  for (const key of WEAPON_ORDER) {
    guns[key] = gunMesh(key);
    guns[key].visible = key === 'pistol';
    group.add(guns[key]);
  }
  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.6, metalness: 0.3 }),
  );
  grenadeMesh.position.set(0, -0.02, -0.15);
  grenadeMesh.visible = false;
  group.add(grenadeMesh);
  const flashTex = makeGlowTexture([[0, 'rgba(255,240,200,1)'], [0.3, 'rgba(255,190,90,0.8)'], [1, 'rgba(255,150,40,0)']]);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flash.scale.set(0.3, 0.3, 1);
  flash.position.set(0, 0.01, -0.55);
  group.add(flash);
  const flashLight = new THREE.PointLight(0xffc878, 0, 6, 2);
  flashLight.position.set(0, 0, -0.6);
  group.add(flashLight);
  const flashTip = new THREE.Object3D();
  flashTip.position.set(0, 0.01, -0.6);
  group.add(flashTip);
  // A small warm light at the camera: the gun reads instead of going black, and
  // it falls off before reaching the map.
  const gunLight = new THREE.PointLight(0xffd9a0, 4, 4, 2);
  gunLight.position.set(0.1, 0, -0.3);
  camera.add(gunLight);
  return { group, guns, grenadeMesh, flash, flashLight, flashTip, flashTimer: 0, kick: 0, adsBlend: 0 };
}

export function updateViewmodel(state, dt) {
  const vm = state.viewmodel;
  const player = state.player;
  // No gun on menu screens: the title and match-end panels sit over the map.
  vm.group.visible = state.phase !== 'title' && state.phase !== 'matchEnd';
  if (!vm.group.visible) return;
  const aiming = isAiming() && !player.grenadeSelected && player.reloading <= 0;
  vm.adsBlend += ((aiming ? 1 : 0) - vm.adsBlend) * Math.min(1, dt * 12);
  for (const key of WEAPON_ORDER) vm.guns[key].visible = key === player.weapon && !player.grenadeSelected;
  vm.grenadeMesh.visible = !!player.grenadeSelected;
  if (player.grenadeSelected) {
    vm.grenadeMesh.material.color.set(player.grenadeSelected === 'frag' ? 0x3a4a3a : 0x9aa0a8);
  }
  // Bob from the walk cycle, kick from firing, dip while reloading or switching.
  const hSpeed = Math.hypot(player.vx, player.vz);
  const bobAmp = player.onGround ? Math.min(0.012, hSpeed * 0.002) * (1 - vm.adsBlend) : 0;
  const bobX = Math.sin(player.walkCycle * 2.2) * bobAmp;
  const bobY = Math.abs(Math.cos(player.walkCycle * 2.2)) * bobAmp;
  vm.kick = Math.max(0, vm.kick - dt * 0.25);
  let dip = 0;
  let dipRot = 0;
  if (player.reloading > 0) {
    const w = CONFIG.weapons[player.reloadWeapon || player.weapon];
    const frac = 1 - player.reloading / w.reload;
    dip = Math.sin(frac * Math.PI) * 0.14;
    dipRot = Math.sin(frac * Math.PI) * 0.5;
  }
  if (player.switchTimer > 0) {
    const frac = player.switchTimer / 0.25;
    dip += Math.sin(frac * Math.PI) * 0.1;
  }
  const hip = { x: 0.28, y: -0.26 };
  const ads = { x: 0, y: -0.148 };
  vm.group.position.x = hip.x + (ads.x - hip.x) * vm.adsBlend + bobX;
  vm.group.position.y = hip.y + (ads.y - hip.y) * vm.adsBlend + bobY - dip;
  vm.group.position.z = -0.65 + vm.kick;
  vm.group.rotation.x = vm.kick * 4 + dipRot;
  if (vm.flashTimer > 0) {
    vm.flashTimer -= dt;
    vm.flash.material.opacity = 0.95;
    vm.flash.material.rotation = Math.random() * Math.PI;
    vm.flashLight.intensity = 8;
    if (vm.flashTimer <= 0) {
      vm.flash.material.opacity = 0;
      vm.flashLight.intensity = 0;
    }
  }
}
