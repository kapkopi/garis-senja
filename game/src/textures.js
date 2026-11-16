// Procedural textures: every surface in the map is painted on a canvas at load, so
// the game ships no image files and makes no network requests. All variation comes
// from fixed seeds, so the map looks the same on every load and in every screenshot.
import * as THREE from 'three';
import { makeRng, range } from './rng.js';

function canvasTexture(size, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(g, size, rand, count, alpha, light, dark) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rand() < 0.5 ? light : dark;
    g.globalAlpha = alpha * rand();
    const s = 1 + Math.floor(rand() * 3);
    g.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), s, s);
  }
  g.globalAlpha = 1;
}

function concrete() {
  return canvasTexture(256, (g, size) => {
    const rand = makeRng(11);
    g.fillStyle = '#757b84';
    g.fillRect(0, 0, size, size);
    speckle(g, size, rand, 2600, 0.25, '#8a9099', '#5d636c');
    g.strokeStyle = 'rgba(40,44,50,0.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    g.beginPath();
    g.moveTo(size / 2, 0);
    g.lineTo(size / 2, size);
    g.stroke();
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(50,54,60,0.12)';
      g.beginPath();
      g.ellipse(rand() * size, rand() * size, range(rand, 20, 60), range(rand, 12, 30), rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, 2, 2);
}

function metal(base, rib, streak) {
  return canvasTexture(256, (g, size) => {
    const rand = makeRng(23);
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      g.fillStyle = rib;
      g.fillRect(x, 0, 3, size);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 3, 0, 2, size);
    }
    speckle(g, size, rand, 900, 0.2, 'rgba(255,255,255,0.5)', streak);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = streak;
      g.globalAlpha = 0.15 + rand() * 0.2;
      const x = rand() * size;
      g.fillRect(x, rand() * size * 0.4, 2 + rand() * 4, range(rand, 40, 140));
    }
    g.globalAlpha = 1;
  }, 1, 1);
}

function wood() {
  return canvasTexture(256, (g, size) => {
    const rand = makeRng(37);
    g.fillStyle = '#7a5c3e';
    g.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) {
      g.fillStyle = `rgba(0,0,0,${0.12 + rand() * 0.1})`;
      g.fillRect(0, y, size, 2);
      g.fillStyle = `rgba(255,235,200,${0.05 + rand() * 0.06})`;
      g.fillRect(0, y + 2, size, 3);
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = 'rgba(60,40,20,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        const yy = y + 6 + rand() * 22;
        g.moveTo(0, yy);
        g.bezierCurveTo(size * 0.3, yy + rand() * 4 - 2, size * 0.7, yy + rand() * 4 - 2, size, yy);
        g.stroke();
      }
    }
    speckle(g, size, rand, 500, 0.15, '#8f6f4d', '#5f472e');
  }, 1, 1);
}

function hazard() {
  return canvasTexture(128, (g, size) => {
    g.fillStyle = '#c9a227';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#20242a';
    for (let x = -size; x < size * 2; x += 32) {
      g.beginPath();
      g.moveTo(x, size);
      g.lineTo(x + 16, size);
      g.lineTo(x + 16 + size, 0);
      g.lineTo(x + size, 0);
      g.closePath();
      g.fill();
    }
  }, 2, 1);
}

function ground() {
  return canvasTexture(256, (g, size) => {
    const rand = makeRng(53);
    g.fillStyle = '#4a5058';
    g.fillRect(0, 0, size, size);
    speckle(g, size, rand, 3200, 0.3, '#5a616b', '#3a3f45');
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = 'rgba(20,22,26,0.5)';
      g.lineWidth = 1 + rand();
      g.beginPath();
      let x = rand() * size;
      let y = rand() * size;
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += range(rand, -30, 30);
        y += range(rand, -30, 30);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(180,170,150,0.05)';
      g.fillRect(rand() * size, rand() * size, range(rand, 30, 80), range(rand, 20, 50));
    }
  }, 8, 8);
}

// A soft radial glow on a canvas: one helper for muzzle flashes, lamp glows and
// blast sprites, so no module paints its own copy. Stops are [offset, color].
export function makeGlowTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let cached = null;

export function getTextures() {
  if (cached) return cached;
  cached = {
    concrete: concrete(),
    metalRed: metal('#a34a3a', '#8f3e31', 'rgba(60,20,12,0.6)'),
    metalTeal: metal('#3a7d7c', '#2f6a69', 'rgba(10,30,30,0.6)'),
    metalYellow: metal('#c9a227', '#a8891f', 'rgba(60,45,10,0.6)'),
    wood: wood(),
    hazard: hazard(),
    ground: ground(),
  };
  return cached;
}
