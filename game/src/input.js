// input.js — keyboard + mouse + pointer lock. Reports keys only; it never
// decides what a key means (buy vs switch is the caller's rule, §4.3).
export function createInput(canvas) {
  const keys = {};
  const input = {
    keys, firing: false, locked: false, aiming: false, wheel: 0,
    lookDX: 0, lookDY: 0,
    pressed: {}, // keys pressed since last consume (edge-triggered)
    onLockChange: null, onClick: null,
  };
  const code = (e) => e.code;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!keys[code(e)]) input.pressed[code(e)] = true;
    keys[code(e)] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE', 'KeyM', 'KeyZ',
         'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'ShiftLeft', 'ShiftRight',
         'Space'].includes(code(e))) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[code(e)] = false; });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    input.firing = false;
    input.aiming = false;
    input.wheel = 0;
  });
  // Right mouse = aim down sights (held). The browser context menu must
  // never appear when the player right-clicks to aim.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      if (!input.locked) { canvas.requestPointerLock(); if (input.onClick) input.onClick(); }
      else input.firing = true;
    } else if (e.button === 2) {
      if (!input.locked) { canvas.requestPointerLock(); if (input.onClick) input.onClick(); }
      else input.aiming = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  // Mouse wheel cycles weapons (consumed by the caller, which resets it).
  canvas.addEventListener('wheel', (e) => {
    if (input.locked) input.wheel += e.deltaY;
  }, { passive: true });
  window.addEventListener('mousemove', (e) => {
    if (input.locked) { input.lookDX += e.movementX; input.lookDY += e.movementY; }
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.onLockChange) input.onLockChange(input.locked);
  });
  input.takeLook = () => {
    const dx = input.lookDX, dy = input.lookDY;
    input.lookDX = 0; input.lookDY = 0;
    return { dx, dy };
  };
  input.wasPressed = (c) => {
    if (input.pressed[c]) { input.pressed[c] = false; return true; }
    return false;
  };
  input.clearPressed = () => { for (const k of Object.keys(input.pressed)) input.pressed[k] = false; };
  return input;
}
