// PORT SOLANO — input.js
// Keyboard and mouse state for the game. `keys` holds what is down right
// now, `justPressed` holds what went down this frame (main.js clears it at
// the end of every frame via postUpdate). Mouse position is in canvas
// pixels; the game converts it to world space through the camera.

export const input = {
  keys: new Set(),
  justPressed: new Set(),
  mouse: { x: 0, y: 0, down: false, rdown: false },
  // The screenshot scenes drive the game through this stand-in instead of
  // real devices; when it is set, the readers below consult it first.
  scripted: null,
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) input.justPressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.mouse.down = false; });

  const track = (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    input.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
  };
  canvas.addEventListener('mousemove', track);
  canvas.addEventListener('mousedown', (e) => {
    track(e);
    if (e.button === 0) input.mouse.down = true;
    if (e.button === 2) input.mouse.rdown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouse.down = false;
    if (e.button === 2) input.mouse.rdown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function down(...codes) {
  if (input.scripted) return codes.some((c) => input.scripted.keys.has(c));
  return codes.some((c) => input.keys.has(c));
}

export function pressed(...codes) {
  if (input.scripted) return codes.some((c) => input.scripted.justPressed.has(c));
  return codes.some((c) => input.justPressed.has(c));
}

export function mouseDown() {
  return input.scripted ? input.scripted.mouse.down : input.mouse.down;
}

export function mousePos() {
  return input.scripted ? input.scripted.mouse : input.mouse;
}

export function postUpdate() {
  input.justPressed.clear();
  if (input.scripted) input.scripted.justPressed.clear();
}
