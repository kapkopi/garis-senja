// Screenshot staging: ?shot=combat|title|buy|objective&seed=1 renders a composed
// moment with no pointer lock and no input. Staging starts a real round and then
// moves the actors into place, so every screenshot is the game's own code running:
// the HUD, the bots and the map are live, not drawn for the shot. Positions are
// fixed; the seed is accepted for the ?shot= convention and does not move them.
import { startRound } from './rounds.js';

export function parseShot() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot) return null;
  return { shot, seed: Number(params.get('seed') || 1) };
}

function aimAt(actor, tx, tz) {
  actor.yaw = Math.atan2(-(tx - actor.x), -(tz - actor.z));
}

function placeBot(bot, x, z, yaw) {
  bot.x = x;
  bot.z = z;
  bot.yaw = yaw;
  bot.mesh.position.set(x, 0, z);
  bot.mesh.rotation.y = yaw;
}

export function applyShot(state, shot) {
  const player = state.player;
  if (shot === 'title') {
    // A scenic overlook of Mid at dusk, two bots in the middle distance. The title
    // overlay covers the centre; the map reads around it.
    placeBot(state.bots[0], -3, 4, Math.PI * 0.25);
    placeBot(state.bots[2], 6, -4, Math.PI * 0.8);
    state.stagingCamera = { x: 18, y: 5, z: 12, tx: -10, ty: 1.5, tz: -8, fov: 68 };
    return;
  }

  startRound(state);
  if (shot === 'combat') {
    state.round.number = 2;
    state.round.wins.elang = 1;
    player.weaponsOwned = ['pistol', 'rifle'];
    player.weapon = 'rifle';
    player.mags.rifle = 30;
    player.reserves.rifle = 90;
    player.money = 1200;
    player.x = 0;
    player.z = 6;
    player.yaw = 0;
    player.hp = 78;
    // Enemies flanking the Mid container, in view, plus an ally advancing ahead.
    placeBot(state.bots[2], -4, -1, Math.PI);
    placeBot(state.bots[3], 4, -1, Math.PI);
    placeBot(state.bots[4], -8, 2, Math.PI * 0.6);
    placeBot(state.bots[0], -3, 4, 0);
    state.phase = 'playing';
    state.round.timer = 82;
  } else if (shot === 'buy') {
    state.round.number = 2;
    player.weaponsOwned = ['pistol', 'smg'];
    player.weapon = 'smg';
    player.mags.smg = 30;
    player.reserves.smg = 120;
    player.money = 2800;
    player.x = 0;
    player.z = 26;
    player.yaw = 0;
    state.buyMenuOpen = true;
    state.phase = 'buy';
    state.round.buyTimer = 9;
  } else if (shot === 'objective') {
    state.round.number = 3;
    state.round.wins.elang = 2;
    state.round.wins.bayang = 1;
    player.weaponsOwned = ['pistol', 'rifle'];
    player.weapon = 'rifle';
    player.mags.rifle = 24;
    player.reserves.rifle = 60;
    player.money = 900;
    player.x = -14;
    player.z = -12;
    aimAt(player, -20, -16);
    // The bomb is planted at Site A; a defender faces away, working the defuse.
    const bomb = state.round.bomb;
    bomb.state = 'planted';
    bomb.site = 'A';
    bomb.x = -20;
    bomb.z = -16;
    bomb.timer = 28;
    bomb.carrier = null;
    bomb.defuseProgress = 0.4;
    if (state.bombMesh) {
      state.bombMesh.visible = true;
      state.bombMesh.position.set(-20, 0.15, -16);
    }
    placeBot(state.bots[2], -20, -15, 0);
    placeBot(state.bots[3], -16, -19, Math.PI * 0.5);
    placeBot(state.bots[0], -11, -11, 0);
    aimAt(state.bots[0], -20, -16);
    state.phase = 'playing';
    state.round.timer = 0;
  }
}
