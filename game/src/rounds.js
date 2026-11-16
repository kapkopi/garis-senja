// Rounds and the match: the buy phase, the round timer, the bomb (carry, plant,
// defuse, explode), win conditions, money, and the match end. The round state
// machine lives here; the HUD reads it, the bots react to it, and the player acts
// through it. A round is won by elimination, by the bomb exploding, by a defuse,
// or by the clock with no plant — and if the attackers are wiped after planting,
// the defenders still have to defuse before the bomb goes off.
import { CONFIG } from './config.js';
import { isInteracting } from './input.js';
import { resetBot } from './bots.js';
import { playBeep, playExplosion, playPlant, playRoundLose, playRoundWin } from './audio.js';

const R = CONFIG.rounds;
const E = CONFIG.economy;

// Defender hold positions: node index + facing angle (radians, 0 = north).
const DEFENDER_HOLDS = [
  { node: 22, yaw: Math.PI },
  { node: 17, yaw: -Math.PI * 0.75 },
  { node: 18, yaw: Math.PI * 0.75 },
  { node: 15, yaw: Math.PI },
];

export function createRoundState() {
  return {
    number: 1,
    wins: { elang: 0, bayang: 0 },
    timer: 0,
    buyTimer: 0,
    endTimer: 0,
    endWinner: null,
    endReason: null,
    survived: true,
    bomb: {
      state: 'carried',
      carrier: null,
      x: 0,
      z: 0,
      site: null,
      timer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      beepTimer: 0,
    },
  };
}

export function startMatch(state) {
  state.round = createRoundState();
  state.stats = { shots: 0, hits: 0, kills: 0, deaths: 0 };
  state.feed = [];
  state.player.money = E.start;
  state.player.weaponsOwned = ['pistol'];
  state.player.mags = { pistol: CONFIG.weapons.pistol.mag };
  state.player.reserves = { pistol: CONFIG.weapons.pistol.reserveMax };
  state.player.grenades = { frag: 0, smoke: 0 };
  state.player.armor = 0;
  startRound(state);
}

export function startRound(state) {
  const player = state.player;
  const spawns = state.map.spawns;
  const survived = state.round.survived;
  // The player respawns at the attacker spawn. Weapons and armor survive a round
  // the player lived through; dying sends them back to the starter pistol.
  player.x = spawns.attackers[0][0];
  player.z = spawns.attackers[0][1];
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.yaw = 0;
  player.pitch = 0;
  player.hp = CONFIG.player.hp;
  player.alive = true;
  player.reloading = 0;
  player.fireCooldown = 0;
  player.bloom = 0;
  player.damageFlash = 0;
  player.grenadeSelected = null;
  if (!survived) {
    player.weaponsOwned = ['pistol'];
    player.mags = { pistol: CONFIG.weapons.pistol.mag };
    player.reserves = { pistol: CONFIG.weapons.pistol.reserveMax };
    player.grenades = { frag: 0, smoke: 0 };
    player.armor = 0;
  }
  player.weapon = player.weaponsOwned.includes('rifle') ? 'rifle'
    : player.weaponsOwned.includes('smg') ? 'smg'
    : 'pistol';
  player.lastWeapon = player.weapon;

  // Bots respawn with loadouts that scale by round: pistols first, rifles from
  // round 2, and the first defender picks up the sniper from round 3.
  const roundNo = state.round.number;
  let allyIndex = 0;
  let enemyIndex = 0;
  for (const bot of state.bots) {
    let weapon = 'pistol';
    if (roundNo >= 2) weapon = 'rifle';
    if (bot.team === 'bayang' && enemyIndex === 0 && roundNo >= 3) weapon = 'sniper';
    if (bot.team === 'elang') {
      const [x, z] = spawns.attackers[1 + allyIndex];
      resetBot(bot, x, z, weapon);
      allyIndex++;
    } else {
      const [x, z] = spawns.defenders[enemyIndex];
      resetBot(bot, x, z, weapon);
      const hold = DEFENDER_HOLDS[enemyIndex];
      bot.ai.holdNode = hold.node;
      bot.ai.holdYaw = hold.yaw;
      enemyIndex++;
    }
  }

  // The bomb starts with the player. Clear the field.
  state.round.bomb = {
    state: 'carried', carrier: player, x: 0, z: 0, site: null,
    timer: 0, plantProgress: 0, defuseProgress: 0, beepTimer: 0,
  };
  state.grenades.forEach((g) => state.scene.remove(g.mesh));
  state.grenades = [];
  for (const s of state.smokes) {
    for (const sprite of s.sprites) state.scene.remove(sprite);
  }
  state.smokes = [];
  state.playerNoise = null;
  state.hitmark = null;
  if (state.bombMesh) state.bombMesh.visible = false;

  state.round.buyTimer = R.buyTime;
  state.round.timer = R.roundTime;
  state.round.endWinner = null;
  state.round.endReason = null;
  state.phase = 'buy';
}

export function inSite(state, x, z) {
  const half = CONFIG.map.siteHalf;
  for (const site of state.map.sites) {
    if (Math.abs(x - site.x) <= half && Math.abs(z - site.z) <= half) return site;
  }
  return null;
}

function aliveCount(state, team) {
  let n = 0;
  for (const actor of state.actors) {
    if (actor.alive && actor.team === team) n++;
  }
  return n;
}

function endRound(state, winner, reason) {
  const round = state.round;
  round.wins[winner]++;
  round.endWinner = winner;
  round.endReason = reason;
  round.endTimer = R.roundEndDelay;
  round.survived = state.player.alive;
  const playerWon = winner === 'elang';
  state.player.money = Math.min(E.max, state.player.money + (playerWon ? E.win : E.loss));
  if (playerWon) playRoundWin();
  else playRoundLose();
  state.phase = 'roundEnd';
}

export function updateRounds(state, dt) {
  const round = state.round;
  if (state.phase === 'buy') {
    round.buyTimer -= dt;
    if (round.buyTimer <= 0) {
      state.phase = 'playing';
      round.timer = R.roundTime;
    }
    return;
  }
  if (state.phase === 'roundEnd') {
    round.endTimer -= dt;
    if (round.endTimer <= 0) {
      if (round.wins.elang >= R.winsToWin || round.wins.bayang >= R.winsToWin || round.number >= R.maxRounds) {
        state.phase = 'matchEnd';
      } else {
        round.number++;
        startRound(state);
      }
    }
    return;
  }
  if (state.phase !== 'playing') return;

  const bomb = round.bomb;
  const player = state.player;

  // Pickup: any living attacker walking over a dropped bomb takes it.
  if (bomb.state === 'dropped') {
    for (const actor of state.actors) {
      if (!actor.alive || actor.team !== 'elang') continue;
      if (Math.hypot(actor.x - bomb.x, actor.z - bomb.z) < 2.5) {
        bomb.state = 'carried';
        bomb.carrier = actor;
        playBeep();
        break;
      }
    }
  }

  // Plant: the carrier stands in a site and holds still (the player holds F;
  // a bot plants when it sees no enemy). Moving or letting go drains progress.
  if (bomb.state === 'carried' && bomb.carrier && bomb.carrier.alive) {
    const carrier = bomb.carrier;
    const site = inSite(state, carrier.x, carrier.z);
    let planting = false;
    if (site) {
      if (carrier.kind === 'player') {
        const speed = Math.hypot(carrier.vx, carrier.vz);
        planting = isInteracting() && speed < 0.5;
      } else {
        planting = carrier.ai.target === null;
      }
    }
    if (planting) {
      bomb.plantProgress += dt / R.plantTime;
      if (bomb.plantProgress >= 1) {
        bomb.state = 'planted';
        bomb.site = site.id;
        bomb.x = site.x;
        bomb.z = site.z;
        bomb.timer = R.bombTime;
        bomb.plantProgress = 0;
        bomb.carrier = null;
        if (carrier.kind === 'player') {
          player.money = Math.min(E.max, player.money + E.plantBonus);
          state.feed.push({ text: 'Bom dipasang di Site ' + site.id + '!', time: state.time, headshot: false });
        }
        playPlant();
        if (state.bombMesh) {
          state.bombMesh.visible = true;
          state.bombMesh.position.set(site.x, 0.15, site.z);
        }
      }
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
    }
  } else {
    bomb.plantProgress = 0;
  }

  // Planted bomb: beeps that quicken, then the blast wins it for the attackers.
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    bomb.beepTimer -= dt;
    const interval = bomb.timer > 20 ? 1.0 : bomb.timer > 10 ? 0.5 : 0.25;
    if (bomb.beepTimer <= 0) {
      bomb.beepTimer = interval;
      playBeep();
    }
    if (state.bombMesh) {
      const blink = Math.sin(state.time * (bomb.timer > 10 ? 6 : 14)) > 0;
      state.bombMesh.material.emissiveIntensity = blink ? 2 : 0.2;
    }
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      playExplosion();
      endRound(state, 'elang', 'bomb');
      return;
    }
    // Defuse: a defender in the site with no enemy in sight works the bomb.
    let defusing = false;
    for (const bot of state.bots) {
      if (!bot.alive || bot.team !== 'bayang') continue;
      const site = inSite(state, bot.x, bot.z);
      if (site && site.id === bomb.site && bot.ai.target === null) {
        defusing = true;
        break;
      }
    }
    if (defusing) {
      bomb.defuseProgress += dt / R.defuseTime;
      if (bomb.defuseProgress >= 1) {
        bomb.state = 'defused';
        endRound(state, 'bayang', 'defuse');
        return;
      }
    } else {
      bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 2);
    }
  }

  // The round clock: expiry with no plant wins it for the defenders.
  if (bomb.state !== 'planted') {
    round.timer -= dt;
    if (round.timer <= 0) {
      round.timer = 0;
      endRound(state, 'bayang', 'time');
      return;
    }
  }

  // Elimination: wiping the defenders always ends it; wiping the attackers after
  // the plant does not — the defenders still have to beat the bomb.
  const elangAlive = aliveCount(state, 'elang');
  const bayangAlive = aliveCount(state, 'bayang');
  if (bayangAlive === 0) {
    endRound(state, 'elang', 'elimination');
  } else if (elangAlive === 0 && bomb.state !== 'planted') {
    endRound(state, 'bayang', 'elimination');
  }
}

export function roundEndText(state) {
  const round = state.round;
  const won = round.endWinner === 'elang';
  const reasons = {
    elimination: won ? 'Tim Bayang dihabisi' : 'Tim Elang dihabisi',
    bomb: 'Bom meledak',
    defuse: 'Bom dijinakkan',
    time: 'Waktu habis, bom tidak dipasang',
  };
  return {
    title: won ? 'RONDE MENANG' : 'RONDE KALAH',
    reason: reasons[round.endReason] || '',
  };
}
