// Keyboard, mouse and pointer-lock input. The simulation reads actions from here;
// edges (pressed this frame) are cleared once per frame by endFrame(), called from
// the main loop after the simulation steps. Pointer lock is requested by the UI
// (click to play) and released by the browser on Escape; the game pauses when the
// lock is lost while playing.
const down = new Set();
const pressed = new Set();
let mouseDX = 0;
let mouseDY = 0;
let mouseLeft = false;
let mouseRight = false;
let locked = false;
let onLockChange = null;

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'KeyR', 'KeyB', 'KeyF',
  'KeyG', 'KeyM', 'KeyP', 'KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
]);

export function initInput(canvas, lockChange) {
  onLockChange = lockChange;
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });
  window.addEventListener('blur', () => {
    down.clear();
    mouseLeft = false;
    mouseRight = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) mouseLeft = true;
    if (e.button === 2) mouseRight = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseLeft = false;
    if (e.button === 2) mouseRight = false;
  });
  document.addEventListener('contextmenu', (e) => {
    if (locked) e.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      mouseLeft = false;
      mouseRight = false;
    }
    if (onLockChange) onLockChange(locked);
  });
}

export function requestLock(canvas) {
  if (!locked) canvas.requestPointerLock();
}

export function isLocked() {
  return locked;
}

export function consumeMouse() {
  const dx = mouseDX;
  const dy = mouseDY;
  mouseDX = 0;
  mouseDY = 0;
  return { dx, dy };
}

export function moveAxes() {
  let x = 0;
  let z = 0;
  if (down.has('KeyW') || down.has('ArrowUp')) z -= 1;
  if (down.has('KeyS') || down.has('ArrowDown')) z += 1;
  if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
  if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
  return { x, z };
}

export function isSprinting() {
  return down.has('ShiftLeft') || down.has('ShiftRight');
}

export function isCrouching() {
  return down.has('KeyC') || down.has('ControlLeft');
}

export function isFiring() {
  return mouseLeft;
}

export function isAiming() {
  return mouseRight;
}

export function isInteracting() {
  return down.has('KeyF');
}

export function wasPressed(code) {
  return pressed.has(code);
}

export function endFrame() {
  pressed.clear();
}
