// Every sound in Garis Senja is synthesized with WebAudio: no audio files, no
// network requests. The context starts on the first user gesture; every sound is a
// short envelope on a cached noise buffer or a single oscillator, through one master
// gain. Mute toggles the master gain, never the context.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 1);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.5;
}

export function isMuted() {
  return muted;
}

function noise(dur, filterType, freq, freqEnd, gain, when = 0) {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, t);
  if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(freq, freqEnd, dur, type, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function playShot(weaponKey) {
  if (!ctx) return;
  if (weaponKey === 'sniper') {
    noise(0.28, 'lowpass', 900, 120, 0.9);
    tone(140, 40, 0.25, 'sine', 0.7);
  } else if (weaponKey === 'rifle') {
    noise(0.16, 'lowpass', 1400, 200, 0.75);
    tone(120, 50, 0.14, 'sine', 0.5);
  } else if (weaponKey === 'smg') {
    noise(0.1, 'bandpass', 1800, 500, 0.6);
    tone(160, 70, 0.08, 'sine', 0.4);
  } else {
    noise(0.12, 'bandpass', 2200, 400, 0.65);
    tone(180, 60, 0.1, 'sine', 0.45);
  }
}

export function playDistantShot() {
  noise(0.12, 'lowpass', 500, 150, 0.25);
}

export function playReload() {
  noise(0.05, 'highpass', 2000, null, 0.3);
  tone(900, 500, 0.05, 'square', 0.12, 0.12);
  noise(0.05, 'highpass', 2000, null, 0.35, 0.3);
}

export function playStep(sprinting) {
  noise(0.07, 'lowpass', sprinting ? 500 : 350, 120, sprinting ? 0.22 : 0.13);
}

export function playExplosion() {
  noise(0.9, 'lowpass', 800, 40, 1.0);
  tone(90, 25, 0.8, 'sine', 0.9);
}

export function playBeep() {
  tone(880, null, 0.08, 'square', 0.22);
}

export function playHit(headshot) {
  tone(headshot ? 1600 : 1200, null, 0.05, 'sine', 0.3);
}

export function playEmpty() {
  tone(1400, 900, 0.04, 'square', 0.15);
}

export function playThrow() {
  noise(0.08, 'bandpass', 900, 300, 0.25);
}

export function playBuy() {
  tone(660, null, 0.07, 'sine', 0.25);
  tone(880, null, 0.09, 'sine', 0.25, 0.08);
}

export function playPlant() {
  tone(520, null, 0.1, 'square', 0.2);
  tone(520, null, 0.1, 'square', 0.2, 0.18);
}

export function playRoundWin() {
  tone(523, null, 0.14, 'triangle', 0.3);
  tone(659, null, 0.14, 'triangle', 0.3, 0.14);
  tone(784, null, 0.24, 'triangle', 0.3, 0.28);
}

export function playRoundLose() {
  tone(392, null, 0.16, 'triangle', 0.3);
  tone(330, null, 0.16, 'triangle', 0.3, 0.16);
  tone(262, null, 0.28, 'triangle', 0.3, 0.32);
}

export function playHurt() {
  noise(0.1, 'lowpass', 400, 100, 0.4);
  tone(110, 60, 0.12, 'sine', 0.35);
}
