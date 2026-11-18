// Input: keyboard + mouse and a standard gamepad, merged into one per-frame sample the
// simulation consumes. Held state (movement, fire, sprint) is read live; one-shot presses
// (interact, pause, weapon slots, radio, mute) are queued as edges and delivered exactly
// once by poll(), so a press between frames is never lost or doubled.
//
// The sample shape (also what the headless harness fabricates):
//   { mx, my }        movement axes in screen space, -1..1 (W/up is my=-1)
//   { aimX, aimY }    world-space aim point
//   fire, sprint, handbrake           held
//   interact, confirm, pause          pressed this frame
//   weaponSlot        0, or 1..5 when a number key / d-pad direction was pressed
//   radioNext, radioPrev, mute        pressed this frame

const MOVE_KEYS = {
  left: new Set(['ArrowLeft', 'KeyA']),
  right: new Set(['ArrowRight', 'KeyD']),
  up: new Set(['ArrowUp', 'KeyW']),
  down: new Set(['ArrowDown', 'KeyS']),
};
const GAME_CODES = new Set([
  ...MOVE_KEYS.left, ...MOVE_KEYS.right, ...MOVE_KEYS.up, ...MOVE_KEYS.down,
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyP', 'Escape', 'KeyM', 'KeyR',
  'BracketLeft', 'BracketRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Enter',
]);

function zeroInput() {
  return {
    mx: 0, my: 0, aimX: 0, aimY: 0,
    fire: false, sprint: false, handbrake: false,
    interact: false, confirm: false, pause: false,
    weaponSlot: 0, radioNext: false, radioPrev: false, mute: false,
  };
}

export function createInput(canvas) {
  if (typeof window === 'undefined' || !canvas) {
    return { poll: () => zeroInput(), setTransform() {}, dispose() {} };
  }

  const held = new Set();
  let edges = zeroInput();
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let transform = null; // (clientX, clientY) -> {x, y} world
  let padPrev = [];
  let padAim = null; // {dx, dy} unit-ish from the right stick

  function onKeyDown(event) {
    if (!GAME_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    held.add(event.code);
    if (event.code === 'KeyE') edges.interact = true;
    else if (event.code === 'Space' || event.code === 'Enter') edges.confirm = true;
    else if (event.code === 'KeyP' || event.code === 'Escape') edges.pause = true;
    else if (event.code === 'KeyM') edges.mute = true;
    else if (event.code === 'KeyR' || event.code === 'BracketRight') edges.radioNext = true;
    else if (event.code === 'BracketLeft') edges.radioPrev = true;
    else if (event.code.startsWith('Digit')) edges.weaponSlot = Number(event.code.slice(5));
  }
  function onKeyUp(event) {
    held.delete(event.code);
  }
  function onBlur() {
    held.clear();
    mouseDown = false;
  }
  function onPointerMove(event) {
    mouseX = event.clientX;
    mouseY = event.clientY;
    padAim = null; // a moving mouse takes the aim back from the stick
  }
  function onPointerDown(event) {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (event.button === 0) {
      mouseDown = true;
      edges.confirm = true;
    }
  }
  function onPointerUp(event) {
    if (event.button === 0) mouseDown = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);

  function pollPad(sample) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const candidate of pads) if (candidate && candidate.connected) { pad = candidate; break; }
    if (!pad) { padPrev = []; return; }
    const dead = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    const lx = dead(pad.axes[0] || 0);
    const ly = dead(pad.axes[1] || 0);
    if (lx !== 0 || ly !== 0) { sample.mx = lx; sample.my = ly; }
    const rx = dead(pad.axes[2] || 0);
    const ry = dead(pad.axes[3] || 0);
    if (rx !== 0 || ry !== 0) padAim = { dx: rx, dy: ry };
    const pressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const edge = (i) => pressed(i) && !padPrev[i];
    if (pressed(7)) sample.fire = true; // RT
    if (pressed(5)) sample.handbrake = true; // RB
    if (pressed(0)) sample.sprint = true; // A held = sprint on foot
    if (edge(0)) { sample.interact = true; sample.confirm = true; }
    if (edge(1) || edge(9)) sample.pause = true; // B / start
    if (edge(3)) sample.radioNext = true; // Y
    if (edge(4)) sample.radioPrev = true; // LB
    if (edge(2)) sample.mute = true; // X
    if (edge(12)) sample.weaponSlot = 1;
    if (edge(15)) sample.weaponSlot = 2;
    if (edge(13)) sample.weaponSlot = 3;
    if (edge(14)) sample.weaponSlot = 4;
    padPrev = pad.buttons.map((b) => !!b.pressed);
  }

  return {
    setTransform(fn) { transform = fn; },
    poll(player) {
      const sample = zeroInput();
      sample.mx = (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0);
      sample.my = (held.has('ArrowDown') || held.has('KeyS') ? 1 : 0) - (held.has('ArrowUp') || held.has('KeyW') ? 1 : 0);
      sample.sprint = held.has('ShiftLeft') || held.has('ShiftRight');
      sample.handbrake = held.has('Space');
      sample.fire = mouseDown;
      // Merge the queued edges exactly once.
      sample.interact = edges.interact;
      sample.confirm = edges.confirm || edges.interact;
      sample.pause = edges.pause;
      sample.weaponSlot = edges.weaponSlot;
      sample.radioNext = edges.radioNext;
      sample.radioPrev = edges.radioPrev;
      sample.mute = edges.mute;
      edges = zeroInput();
      pollPad(sample);
      // Aim: gamepad right stick wins while it is held; otherwise the mouse.
      if (padAim && player) {
        sample.aimX = player.x + padAim.dx * 230;
        sample.aimY = player.y + padAim.dy * 230;
      } else if (transform) {
        const world = transform(mouseX, mouseY);
        sample.aimX = world.x;
        sample.aimY = world.y;
      } else if (player) {
        sample.aimX = player.x + 100;
        sample.aimY = player.y;
      }
      return sample;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    },
  };
}
