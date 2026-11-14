// input.js — keyboard + mouse + pointer lock. Reports keys only; it never
// decides what a key means (buy vs switch is the caller's rule, §4.3).
export function createInput(canvas) {
  const keys = {};
  const input = {
    keys, firing: false, locked: false,
    lookDX: 0, lookDY: 0,
    pressed: {}, // keys pressed since last consume (edge-triggered)
    onLockChange: null, onClick: null,
  };
  const code = (e) => e.code;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!keys[code(e)]) input.pressed[code(e)] = true;
    keys[code(e)] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE', 'KeyM', 'KeyC',
         'Digit1', 'Digit2', 'Digit3', 'Digit4', 'ShiftLeft', 'ControlLeft',
         'Space'].includes(code(e))) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[code(e)] = false; });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    input.firing = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      if (!input.locked) { canvas.requestPointerLock(); if (input.onClick) input.onClick(); }
      else input.firing = true;
    }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.firing = false; });
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
