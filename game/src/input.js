// PORT SOLANO — input.js
// Keyboard, mouse and gamepad state for the game. `keys` holds what is
// down right now, `justPressed` holds what went down this frame (main.js
// clears it at the end of every frame via postUpdate). Mouse position is
// in canvas pixels; the game converts it to world space through the
// camera.
//
// A connected gamepad feeds the SAME state through pollGamepad (called
// from postUpdate, once per frame): its buttons are translated into the
// keyboard's key codes and its left stick into the movement keys, so
// down()/pressed() answer for either device and the game code never
// learns which one spoke. The right stick drives a virtual mouse cursor
// for aiming, and the right trigger fires like the mouse button.

export const input = {
  keys: new Set(),
  justPressed: new Set(),
  mouse: { x: 0, y: 0, down: false, rdown: false },
  // The screenshot scenes drive the game through this stand-in instead of
  // real devices; when it is set, the readers below consult it first.
  scripted: null,
  // Gamepad state, refreshed by pollGamepad at the end of every frame.
  // keys/justPressed speak the keyboard's code language (see the button
  // map below); move/aim are the dead-zoned sticks; mouse is the virtual
  // cursor the right stick pushes around the canvas.
  pad: {
    connected: false,
    id: '',
    keys: new Set(),
    justPressed: new Set(),
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    trigger: false,
    // Set the first time the right stick is pushed; from then on
    // mousePos() reports the pad cursor until the real mouse moves.
    aimEngaged: false,
  },
};

let canvasRef = null;

// Standard-mapping button index → the keyboard code it stands in for.
// The set mirrors what the game already binds: E interacts and confirms,
// Esc pauses, the digits select weapon slots, R and the brackets run
// the radio, M mutes, Space is the handbrake (and on-foot fire).
const PAD_BUTTON_CODES = {
  0: 'KeyE',         // A / cross — interact, confirm dialogue
  1: 'Escape',       // B / circle — back out, pause
  2: 'KeyM',         // X / square — mute toggle
  3: 'KeyR',         // Y / triangle — radio, next station
  4: 'BracketLeft',  // LB — radio, previous station
  5: 'Space',        // RB — handbrake / on-foot fire
  9: 'Escape',       // start — pause
  12: 'Digit1',      // d-pad up — weapon slot 1
  13: 'Digit2',      // d-pad right — weapon slot 2
  14: 'Digit3',      // d-pad down — weapon slot 3
  15: 'Digit4',      // d-pad left — weapon slot 4
};
const PAD_TRIGGER_INDEX = 7; // RT — held down, it fires like the mouse
const STICK_DEADZONE = 0.18;
const STICK_PUSH = 0.4;      // stick deflection that counts as a held key
const CURSOR_SPEED = 15;     // virtual-cursor pixels per frame at full tilt

export function initInput(canvas) {
  canvasRef = canvas;
  input.pad.mouse.x = canvas.width / 2;
  input.pad.mouse.y = canvas.height / 2;

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
    input.pad.aimEngaged = false; // a real mouse move hands aiming back
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

  window.addEventListener('gamepadconnected', (e) => {
    input.pad.connected = true;
    input.pad.id = e.gamepad ? e.gamepad.id : '';
  });
  window.addEventListener('gamepaddisconnected', () => clearPad());
}

function clearPad() {
  const pad = input.pad;
  pad.connected = false;
  pad.id = '';
  pad.keys = new Set();
  pad.justPressed = new Set();
  pad.move.x = 0; pad.move.y = 0;
  pad.aim.x = 0; pad.aim.y = 0;
  pad.trigger = false;
  pad.aimEngaged = false;
}

// The codes in `now` that were not in `prev` — this poll's fresh presses.
function newlyDown(prev, now) {
  const fresh = new Set();
  for (const code of now) if (!prev.has(code)) fresh.add(code);
  return fresh;
}

function deadAxis(v) {
  return Math.abs(v) < STICK_DEADZONE ? 0 : v;
}

// Read the first connected gamepad into input.pad. Runs once per frame
// from postUpdate, so the state the game reads during a frame is the
// poll taken at the end of the previous one — the same one-frame rhythm
// the keyboard's justPressed clearing already follows. Harmless where
// the Gamepad API does not exist (headless runs, older browsers).
export function pollGamepad() {
  const pad = input.pad;
  const nav = globalThis.navigator;
  if (!nav || typeof nav.getGamepads !== 'function') {
    if (pad.connected) clearPad();
    return;
  }
  let gp = null;
  for (const candidate of nav.getGamepads()) {
    if (candidate && candidate.connected) { gp = candidate; break; }
  }
  if (!gp) {
    if (pad.connected) clearPad();
    return;
  }
  pad.connected = true;
  pad.id = gp.id || '';

  const axes = gp.axes || [];
  pad.move.x = deadAxis(axes[0] || 0);
  pad.move.y = deadAxis(axes[1] || 0);
  pad.aim.x = deadAxis(axes[2] || 0);
  pad.aim.y = deadAxis(axes[3] || 0);

  const buttons = gp.buttons || [];
  const nowDown = new Set();
  for (const [index, code] of Object.entries(PAD_BUTTON_CODES)) {
    const b = buttons[Number(index)];
    if (b && (b.pressed || b.value > 0.4)) nowDown.add(code);
  }
  pad.justPressed = newlyDown(pad.keys, nowDown);
  pad.keys = nowDown;
  const trigger = buttons[PAD_TRIGGER_INDEX];
  pad.trigger = !!(trigger && (trigger.pressed || trigger.value > 0.25));

  // The right stick pushes the virtual cursor; once it has aimed,
  // mousePos() reports the cursor until the real mouse moves again.
  if (pad.aim.x !== 0 || pad.aim.y !== 0) {
    pad.aimEngaged = true;
    const w = canvasRef ? canvasRef.width : 1280;
    const h = canvasRef ? canvasRef.height : 720;
    pad.mouse.x = Math.min(w, Math.max(0, pad.mouse.x + pad.aim.x * CURSOR_SPEED));
    pad.mouse.y = Math.min(h, Math.max(0, pad.mouse.y + pad.aim.y * CURSOR_SPEED));
  }
}

// Does the gamepad currently hold this code — as a mapped button, or as
// the left stick pushed the way the movement keys would mean?
function padHolds(code) {
  const pad = input.pad;
  if (pad.keys.has(code)) return true;
  const m = pad.move;
  if (m.y < -STICK_PUSH && (code === 'KeyW' || code === 'ArrowUp')) return true;
  if (m.y > STICK_PUSH && (code === 'KeyS' || code === 'ArrowDown')) return true;
  if (m.x < -STICK_PUSH && (code === 'KeyA' || code === 'ArrowLeft')) return true;
  if (m.x > STICK_PUSH && (code === 'KeyD' || code === 'ArrowRight')) return true;
  return false;
}

export function down(...codes) {
  if (input.scripted) return codes.some((c) => input.scripted.keys.has(c));
  return codes.some((c) => input.keys.has(c)) || codes.some((c) => padHolds(c));
}

export function pressed(...codes) {
  if (input.scripted) return codes.some((c) => input.scripted.justPressed.has(c));
  return codes.some((c) => input.justPressed.has(c)) || codes.some((c) => input.pad.justPressed.has(c));
}

export function mouseDown() {
  if (input.scripted) return input.scripted.mouse.down;
  return input.mouse.down || input.pad.trigger;
}

export function mousePos() {
  if (input.scripted) return input.scripted.mouse;
  return input.pad.aimEngaged ? input.pad.mouse : input.mouse;
}

export function postUpdate() {
  input.justPressed.clear();
  if (input.scripted) input.scripted.justPressed.clear();
  pollGamepad();
}
