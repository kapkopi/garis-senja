// The HUD: DOM overlays driven by the game state, updated once per rendered frame.
// Text and bar updates are skipped when the value did not change, the minimap
// redraws at 10 Hz from a pre-rendered static layer, and the buy menu rebuilds
// only when money or inventory changes. Screens (title, pause, match end) are
// shown by phase; the buy menu is keyboard-driven because the pointer stays
// locked while playing.
import { CONFIG } from './config.js';
import { currentSpread } from './weapons.js';
import { isAiming } from './input.js';
import { isMuted } from './audio.js';
import { inSite, roundEndText } from './rounds.js';
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();

let els = {};
let minimapCtx = null;
let minimapStatic = null;
let minimapTimer = 0;
let prevPhase = null;
let bannerUntil = 0;
let buySignature = '';
let feedSignature = '';

function el(id) {
  return document.getElementById(id);
}

function setText(node, value) {
  if (node._last !== value) {
    node._last = value;
    node.textContent = value;
  }
}

function setWidth(node, pct) {
  const v = Math.max(0, Math.min(100, pct));
  if (node._lastPct !== v) {
    node._lastPct = v;
    node.style.width = v + '%';
  }
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function initHud(state, callbacks) {
  els = {
    hud: el('hud'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    timer: el('timer'),
    scoreElang: el('score-elang'),
    scoreBayang: el('score-bayang'),
    roundLabel: el('round-label'),
    money: el('money'),
    muteState: el('mute-state'),
    bombStatus: el('bomb-status'),
    healthBar: el('health-bar'),
    healthNum: el('health-num'),
    armorWrap: el('armor-wrap'),
    armorBar: el('armor-bar'),
    armorNum: el('armor-num'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    grenadeInfo: el('grenade-info'),
    reloadState: el('reload-state'),
    bombBadge: el('bomb-badge'),
    feed: el('feed'),
    minimap: el('minimap'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    prompt: el('prompt'),
    promptText: el('prompt-text'),
    progressWrap: el('progress-wrap'),
    progressBar: el('progress-bar'),
    progressLabel: el('progress-label'),
    vignette: el('vignette'),
    scope: el('scope'),
    buyMenu: el('buy-menu'),
    buyList: el('buy-list'),
    buyMoney: el('buy-money'),
    screenTitle: el('screen-title'),
    screenPause: el('screen-pause'),
    screenEnd: el('screen-end'),
    endTitle: el('end-title'),
    endScore: el('end-score'),
    endStats: el('end-stats'),
  };
  el('btn-start').addEventListener('click', callbacks.onStart);
  el('btn-resume').addEventListener('click', callbacks.onResume);
  el('btn-restart-pause').addEventListener('click', callbacks.onRestart);
  el('btn-restart').addEventListener('click', callbacks.onRestart);
  minimapCtx = els.minimap.getContext('2d');
  buildMinimapStatic(state);
}

function buildMinimapStatic(state) {
  const size = 180;
  const scale = size / 64;
  minimapStatic = document.createElement('canvas');
  minimapStatic.width = size;
  minimapStatic.height = size;
  const g = minimapStatic.getContext('2d');
  g.fillStyle = '#10151d';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#3d4450';
  for (const c of state.map.colliders) {
    const x = (c.minX + 32) * scale;
    const y = (c.minZ + 32) * scale;
    g.fillRect(x, y, (c.maxX - c.minX) * scale, (c.maxZ - c.minZ) * scale);
  }
  g.font = 'bold 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const site of state.map.sites) {
    const x = (site.x + 32) * scale;
    const y = (site.z + 32) * scale;
    g.strokeStyle = '#ffb454';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffb454';
    g.fillText(site.id, x, y);
  }
}

function drawMinimap(state) {
  const size = 180;
  const scale = size / 64;
  const g = minimapCtx;
  g.drawImage(minimapStatic, 0, 0);
  const toX = (x) => (x + 32) * scale;
  const toY = (z) => (z + 32) * scale;
  // Enemies the player could plausibly track: near and in line of sight.
  const player = state.player;
  _from.set(player.x, player.y + 1.5, player.z);
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    if (bot.team === 'elang') {
      g.fillStyle = '#4fd1c5';
      g.beginPath();
      g.arc(toX(bot.x), toY(bot.z), 3.5, 0, Math.PI * 2);
      g.fill();
    } else {
      const dist = Math.hypot(bot.x - player.x, bot.z - player.z);
      if (dist > 22) continue;
      _to.set(bot.x, bot.y + 1.1, bot.z);
      _dir.subVectors(_to, _from);
      const len = _dir.length();
      _dir.normalize();
      _ray.set(_from, _dir);
      _ray.far = len;
      const hits = _ray.intersectObjects(state.map.occluders, false);
      if (hits.length > 0 && hits[0].distance < len - 0.5) continue;
      g.fillStyle = '#e0655a';
      g.beginPath();
      g.arc(toX(bot.x), toY(bot.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const bomb = state.round.bomb;
  if (bomb.state === 'dropped' || bomb.state === 'planted') {
    const blink = bomb.state === 'planted' ? Math.sin(state.time * 8) > 0 : true;
    if (blink) {
      g.fillStyle = bomb.state === 'planted' ? '#ff5a5a' : '#ffb454';
      g.fillRect(toX(bomb.x) - 3, toY(bomb.z) - 3, 6, 6);
    }
  }
  // The player: a triangle pointing where they face.
  g.save();
  g.translate(toX(player.x), toY(player.z));
  g.rotate(-player.yaw);
  g.fillStyle = '#f2ede4';
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4, 4);
  g.lineTo(-4, 4);
  g.closePath();
  g.fill();
  g.restore();
}

const BUY_ITEMS = [
  { key: 'smg', label: 'SMG Kilat K-9', num: 1 },
  { key: 'rifle', label: 'Senapan SR-7', num: 2 },
  { key: 'sniper', label: 'Penembak LJ-2', num: 3 },
  { key: 'frag', label: 'Granat Ledak', num: 4 },
  { key: 'smoke', label: 'Granat Asap', num: 5 },
  { key: 'armor', label: 'Rompi Antipeluru', num: 6 },
  { key: 'ammo', label: 'Isi Amunisi', num: 7 },
];

function buyPrice(key) {
  if (CONFIG.weapons[key]) return CONFIG.weapons[key].price;
  if (CONFIG.grenades[key]) return CONFIG.grenades[key].price;
  if (key === 'armor') return CONFIG.economy.armorPrice;
  return CONFIG.economy.ammoPrice;
}

function renderBuyMenu(state) {
  const player = state.player;
  const sig = [player.money, player.weaponsOwned.join(','), player.grenades.frag, player.grenades.smoke, player.armor].join('|');
  if (sig === buySignature) return;
  buySignature = sig;
  setText(els.buyMoney, '$' + player.money);
  els.buyList.innerHTML = '';
  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    const owned = CONFIG.weapons[item.key] && player.weaponsOwned.includes(item.key);
    const afford = player.money >= buyPrice(item.key);
    if (owned) row.classList.add('owned');
    else if (!afford) row.classList.add('poor');
    const num = document.createElement('span');
    num.className = 'buy-num';
    num.textContent = item.num;
    const label = document.createElement('span');
    label.className = 'buy-label';
    let extra = '';
    if (CONFIG.grenades[item.key]) extra = ' ×' + (player.grenades[item.key] || 0);
    if (item.key === 'armor' && player.armor > 0) extra = ' (' + Math.ceil(player.armor) + ')';
    label.textContent = item.label + extra;
    const price = document.createElement('span');
    price.className = 'buy-price';
    price.textContent = owned ? 'DIMILIKI' : '$' + buyPrice(item.key);
    row.append(num, label, price);
    els.buyList.appendChild(row);
  }
}

export function updateHud(state, renderDt) {
  const player = state.player;
  const round = state.round;
  const phase = state.phase;

  // Screens by phase and pause.
  els.screenTitle.hidden = phase !== 'title';
  els.screenPause.hidden = !(state.paused && (phase === 'playing' || phase === 'buy'));
  els.screenEnd.hidden = phase !== 'matchEnd';
  if (phase === 'matchEnd') {
    const won = round.wins.elang > round.wins.bayang;
    setText(els.endTitle, won ? 'MISI BERHASIL' : 'MISI GAGAL');
    setText(els.endScore, `Elang ${round.wins.elang} — ${round.wins.bayang} Bayang`);
    const acc = state.stats.shots > 0 ? Math.round((state.stats.hits / state.stats.shots) * 100) : 0;
    setText(els.endStats, `Membunuh ${state.stats.kills} · Gugur ${state.stats.deaths} · Akurasi ${acc}% · ${state.stats.shots} tembakan`);
  }
  els.hud.style.display = phase === 'title' || phase === 'matchEnd' ? 'none' : '';

  // Banners on phase changes.
  if (phase !== prevPhase && !state.shotMode) {
    if (phase === 'playing') {
      setText(els.bannerTitle, 'RONDE ' + round.number);
      setText(els.bannerSub, round.number === 1 ? 'Pasang bom di Site A atau B, atau habisi tim Bayang' : '');
      bannerUntil = state.time + 2.2;
    } else if (phase === 'roundEnd') {
      const text = roundEndText(state);
      setText(els.bannerTitle, text.title);
      setText(els.bannerSub, text.reason);
      bannerUntil = state.time + 3.2;
    }
    prevPhase = phase;
  }
  els.banner.classList.toggle('show', state.time < bannerUntil && (phase === 'playing' || phase === 'roundEnd'));

  if (state.paused || phase === 'title' || phase === 'matchEnd') return;

  // Top bar.
  const bomb = round.bomb;
  if (bomb.state === 'planted') {
    setText(els.timer, '◉ ' + formatTime(bomb.timer));
    els.timer.classList.add('bomb');
  } else {
    setText(els.timer, formatTime(phase === 'buy' ? round.buyTimer : round.timer));
    els.timer.classList.remove('bomb');
  }
  setText(els.scoreElang, String(round.wins.elang));
  setText(els.scoreBayang, String(round.wins.bayang));
  setText(els.roundLabel, 'RONDE ' + round.number + ' / ' + CONFIG.rounds.maxRounds);
  setText(els.money, '$' + player.money);
  setText(els.muteState, isMuted() ? 'SUARA MATI (M)' : '');
  setText(els.bombStatus, bomb.state === 'planted' ? 'BOM AKTIF — Site ' + bomb.site : '');

  // Health and armor.
  setWidth(els.healthBar, player.hp);
  els.healthBar.classList.toggle('low', player.hp <= 30);
  setText(els.healthNum, String(Math.ceil(player.hp)));
  els.armorWrap.style.display = player.armor > 0 ? '' : 'none';
  setWidth(els.armorBar, player.armor);
  setText(els.armorNum, String(Math.ceil(player.armor)));

  // Ammo and loadout.
  if (player.grenadeSelected) {
    const def = CONFIG.grenades[player.grenadeSelected];
    setText(els.weaponName, def.name);
    setText(els.ammoMag, String(player.grenades[player.grenadeSelected] || 0));
    setText(els.ammoReserve, '');
  } else {
    const w = CONFIG.weapons[player.weapon];
    setText(els.weaponName, w.name);
    setText(els.ammoMag, String(player.mags[player.weapon] || 0));
    setText(els.ammoReserve, '/ ' + (player.reserves[player.weapon] || 0));
  }
  els.ammoMag.parentElement.classList.toggle('empty', !player.grenadeSelected && (player.mags[player.weapon] || 0) === 0);
  setText(els.grenadeInfo, `G: Ledak ×${player.grenades.frag || 0} · Asap ×${player.grenades.smoke || 0}`);
  setText(els.reloadState, player.reloading > 0 ? 'MEMUAT ULANG…' : '');
  els.bombBadge.style.display = bomb.carrier === player ? '' : 'none';

  // Crosshair: gap grows with spread; hidden under the sniper scope.
  const scoped = player.weapon === 'sniper' && isAiming() && !player.grenadeSelected;
  els.scope.style.display = scoped && player.alive ? '' : 'none';
  els.crosshair.style.display = scoped || !player.alive ? 'none' : '';
  if (!scoped && player.alive) {
    const spread = currentSpread(state, player.weapon);
    const gap = Math.round(6 + spread * 700);
    els.crosshair.style.setProperty('--gap', gap + 'px');
  }
  const hit = state.hitmark;
  const hitOn = hit && state.time - hit.time < 0.15;
  els.hitmarker.classList.toggle('on', !!hitOn);
  els.hitmarker.classList.toggle('head', !!(hitOn && hit.headshot));

  // Damage vignette + low-health pulse.
  const lowPulse = player.alive && player.hp <= 30 ? 0.25 + Math.sin(state.time * 4) * 0.12 : 0;
  els.vignette.style.opacity = String(Math.max(player.damageFlash, lowPulse, player.alive ? 0 : 0.55));

  // Interact prompt and progress bars.
  let prompt = '';
  let progress = -1;
  let progressLabel = '';
  if (bomb.state === 'carried' && bomb.carrier === player) {
    const inZone = inSite(state, player.x, player.z) !== null;
    if (inZone && player.alive) {
      prompt = 'Tahan F — Pasang bom';
      if (bomb.plantProgress > 0) {
        progress = bomb.plantProgress;
        progressLabel = 'Memasang bom…';
      }
    }
  }
  if (bomb.state === 'planted' && bomb.defuseProgress > 0) {
    progress = bomb.defuseProgress;
    progressLabel = 'Musuh menjinakkan bom!';
  }
  setText(els.promptText, prompt);
  els.prompt.style.display = prompt ? '' : 'none';
  els.progressWrap.style.display = progress >= 0 ? '' : 'none';
  if (progress >= 0) {
    setWidth(els.progressBar, progress * 100);
    setText(els.progressLabel, progressLabel);
  }

  // Kill feed: rebuild only when it changes.
  const recent = state.feed.filter((e) => state.time - e.time < 5).slice(-4);
  const feedSig = recent.map((e) => e.text).join('|');
  if (feedSig !== feedSignature) {
    feedSignature = feedSig;
    els.feed.innerHTML = '';
    for (const entry of recent) {
      const div = document.createElement('div');
      div.className = 'feed-row' + (entry.headshot ? ' head' : '');
      div.textContent = entry.text;
      els.feed.appendChild(div);
    }
  }

  // Buy menu: open during the buy phase unless the player closed it.
  els.buyMenu.style.display = phase === 'buy' && state.buyMenuOpen ? '' : 'none';
  if (phase === 'buy' && state.buyMenuOpen) renderBuyMenu(state);

  // Minimap at 10 Hz.
  minimapTimer -= renderDt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.1;
    drawMinimap(state);
  }
}
