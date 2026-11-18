// PORT SOLANO — render.js
// Everything the eye sees: the tiled city (roads with lane markings and
// crosswalks, animated water, beaches, docks), buildings with named
// roofs, props, skid marks, cars, pedestrians, bullets, particles,
// mission markers, and the day/night grade with streetlight glow.
// The camera culls hard: only the visible tile range and nearby entities
// are ever drawn.

import { TILE, T, PALETTE } from './config.js';

const hash2 = (x, y) => { let h = (x * 73856093) ^ (y * 19349663); h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };

export function drawWorld(ctx, state) {
  const cam = state.camera;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const shX = (Math.random() - 0.5) * state.shake, shY = (Math.random() - 0.5) * state.shake;
  state.shake = Math.max(0, state.shake - 0.6);

  ctx.fillStyle = PALETTE.waterDeep;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-Math.round(cam.x + shX), -Math.round(cam.y + shY));

  drawTiles(ctx, state, cam);
  drawSkids(ctx, state);
  drawPackages(ctx, state);
  drawPickups(ctx, state);
  drawProps(ctx, state, cam);
  drawMarkers(ctx, state);
  for (const car of state.cars) if (visible(cam, car.x, car.y, 90)) drawCar(ctx, state, car);
  for (const p of state.peds) if (visible(cam, p.x, p.y, 40)) drawPed(ctx, state, p);
  if (state.mode === 'play' || state.mode === 'pause') drawPlayer(ctx, state);
  drawBullets(ctx, state);
  drawParticles(ctx, state);
  drawFloaters(ctx, state);
  ctx.restore();

  drawNight(ctx, state, cam, W, H);
}

const visible = (cam, x, y, m) => x > cam.x - m && y > cam.y - m && x < cam.x + cam.w + m && y < cam.y + cam.h + m;

// ------------------------------------------------------------------ tiles
function drawTiles(ctx, state, cam) {
  const city = state.city, t = state.time;
  const tx0 = Math.max(0, Math.floor(cam.x / TILE)), tx1 = Math.min(239, Math.floor((cam.x + cam.w) / TILE));
  const ty0 = Math.max(0, Math.floor(cam.y / TILE)), ty1 = Math.min(239, Math.floor((cam.y + cam.h) / TILE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = city.tileAt(tx, ty);
      const x = tx * TILE, y = ty * TILE, v = hash2(tx, ty);
      switch (kind) {
        case T.GRASS: ctx.fillStyle = v > 0.5 ? PALETTE.grass : '#649551'; break;
        case T.PARK: ctx.fillStyle = v > 0.5 ? PALETTE.park : '#548548'; break;
        case T.SAND: ctx.fillStyle = v > 0.5 ? PALETTE.sand : '#dcc691'; break;
        case T.WATER: {
          const w = 0.5 + 0.5 * Math.sin(t * 1.4 + tx * 0.7 + ty * 1.1);
          ctx.fillStyle = w > 0.55 ? PALETTE.water : PALETTE.waterDeep; break;
        }
        case T.ROAD: ctx.fillStyle = PALETTE.road; break;
        case T.BRIDGE: ctx.fillStyle = PALETTE.bridge; break;
        case T.SIDEWALK: ctx.fillStyle = PALETTE.sidewalk; break;
        case T.PLAZA: ctx.fillStyle = (tx + ty) % 2 ? PALETTE.plaza : '#ad9c80'; break;
        case T.LOT: ctx.fillStyle = PALETTE.lot; break;
        case T.DOCK: ctx.fillStyle = PALETTE.dock; break;
        default: ctx.fillStyle = PALETTE.grass;
      }
      ctx.fillRect(x, y, TILE + 1, TILE + 1);

      if (kind === T.ROAD) drawRoadMarks(ctx, tx, ty, x, y);
      else if (kind === T.DOCK || kind === T.BRIDGE) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(x, y + TILE - 3, TILE, 3);
      } else if (kind === T.GRASS || kind === T.PARK) {
        if (v > 0.82) { ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(x + 6 + v * 14, y + 8 + v * 10, 7, 3); }
      } else if (kind === T.SAND) {
        if (v > 0.7) { ctx.fillStyle = 'rgba(120,90,40,0.25)'; ctx.fillRect(x + v * 20, y + v * 16, 3, 3); }
      } else if (kind === T.LOT) {
        if (tx % 3 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fillRect(x, y + 4, 2, TILE - 8); }
        // worn asphalt: oil stains and pale cracks, hashed per tile
        if (v > 0.78) { ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x + 4 + v * 16, y + 6 + v * 12, 8, 4); }
        else if (v < 0.12) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x + 6, y + 20, 14, 2); }
      }
    }
  }
}

function drawRoadMarks(ctx, tx, ty, x, y) {
  const inX = (tx % 24) < 4, inY = (ty % 24) < 4;
  ctx.fillStyle = PALETTE.laneMark;
  // dashed centre lines down the middle of each avenue
  if (inY && !inX && (ty % 24) === 1 && tx % 2 === 0) ctx.fillRect(x + 3, y + TILE - 2, TILE - 6, 2);
  if (inX && !inY && (tx % 24) === 1 && ty % 2 === 0) ctx.fillRect(x + TILE - 2, y + 3, 2, TILE - 6);
  // crosswalk stripes where avenues cross
  if (inX && inY) {
    ctx.fillStyle = 'rgba(230,233,235,0.5)';
    const ox = tx % 24, oy = ty % 24;
    if (oy === 0 || oy === 3) for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * 8, y + 10, 4, 12);
    if (ox === 0 || ox === 3) for (let i = 0; i < 4; i++) ctx.fillRect(x + 10, y + 3 + i * 8, 12, 4);
  }
  // kerb edge where road meets the block
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  if ((tx % 24) === 0 && !inY) ctx.fillRect(x, y, 2, TILE);
  if ((ty % 24) === 0 && !inX) ctx.fillRect(x, y, TILE, 2);
}

// ------------------------------------------------------------------ props
function drawProps(ctx, state, cam) {
  const city = state.city;
  // buildings first (they tower over their own sidewalk ring)
  for (const b of city.buildings) {
    if (!visible(cam, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x + 4, b.y + 5, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    // rooftop clutter on the bigger roofs
    if (b.w > 200) {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      const n = Math.floor(hash2(b.x, b.y) * 3) + 1;
      for (let i = 0; i < n; i++) {
        const rx = b.x + 14 + hash2(b.x + i * 31, b.y) * (b.w - 60);
        const ry = b.y + 12 + hash2(b.x, b.y + i * 47) * (b.h - 50);
        ctx.fillRect(rx, ry, 26, 18);
      }
    }
    if (b.name) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(b.name, b.x + b.w / 2 + 1, b.y + b.h / 2 + 4);
      ctx.fillStyle = b.shop ? '#ffd23e' : 'rgba(255,255,255,0.88)';
      ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h / 2 + 3);
    }
    // the doorstep
    ctx.fillStyle = '#e8dcc3';
    ctx.fillRect(b.door.x - 9, b.door.y - 4, 18, 6);
  }
  for (const p of city.props) {
    if (!visible(cam, p.x, p.y, 60)) continue;
    drawProp(ctx, p, state.time);
  }
}

function drawProp(ctx, p, time) {
  ctx.save(); ctx.translate(p.x, p.y);
  switch (p.kind) {
    case 'lamp':
      ctx.fillStyle = '#3c4147'; ctx.fillRect(-2, -2, 4, 4);
      ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
      break;
    case 'palm': {
      ctx.strokeStyle = '#7a5c38'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3, -7); ctx.stroke();
      ctx.strokeStyle = '#3e8e4f'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.28 + 0.4;
        ctx.beginPath(); ctx.moveTo(3, -7); ctx.quadraticCurveTo(3 + Math.cos(a) * 12, -7 + Math.sin(a) * 8 - 4, 3 + Math.cos(a) * 19, -7 + Math.sin(a) * 12 + 3); ctx.stroke();
      }
      break;
    }
    case 'tree':
      ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-2, -3, 4, 7);
      ctx.fillStyle = '#3f7a37';
      ctx.beginPath(); ctx.arc(0, -8, 11, 0, 7); ctx.arc(-8, -3, 8, 0, 7); ctx.arc(8, -3, 8, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.arc(-4, -11, 5, 0, 7); ctx.fill();
      break;
    case 'crate':
      ctx.fillStyle = '#8a6b46'; ctx.fillRect(-13, -13, 26, 26);
      ctx.strokeStyle = '#5f4630'; ctx.lineWidth = 2; ctx.strokeRect(-13, -13, 26, 26);
      ctx.beginPath(); ctx.moveTo(-13, -13); ctx.lineTo(13, 13); ctx.moveTo(13, -13); ctx.lineTo(-13, 13); ctx.stroke();
      break;
    case 'hydrant':
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-3, -6, 6, 10);
      ctx.beginPath(); ctx.arc(0, -6, 3.4, 0, 7); ctx.fill();
      break;
    case 'bench':
      ctx.fillStyle = '#6e5136'; ctx.fillRect(-11, -3, 22, 4); ctx.fillRect(-11, 3, 22, 3);
      break;
    case 'fountain': {
      ctx.fillStyle = '#7ec3ee'; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill();
      ctx.fillStyle = '#a8d8f8'; ctx.beginPath(); ctx.arc(0, 0, 12 + Math.sin(time * 2.4) * 2, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8f4fc'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      break;
    }
    case 'crane':
      ctx.strokeStyle = '#c96a2e'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -34); ctx.lineTo(44, -30); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(36, -30); ctx.lineTo(36, -12); ctx.stroke();
      ctx.fillStyle = '#8a6b46'; ctx.fillRect(28, -12, 16, 12);
      break;
    case 'foodstand':
      ctx.fillStyle = '#e8e3d8'; ctx.fillRect(-16, -8, 32, 18);
      ctx.fillStyle = '#c94f42';
      for (let i = 0; i < 4; i++) ctx.fillRect(-16 + i * 8, -14, 8, 7);
      ctx.fillStyle = '#7a4a2c'; ctx.fillRect(-16, 10, 32, 4);
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- markers
function drawBeam(ctx, x, y, color, time, label) {
  const bob = Math.sin(time * 3.2) * 5;
  const grad = ctx.createLinearGradient(x, y - 190, x, y);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.30;
  ctx.fillRect(x - 7, y - 190, 14, 190);
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(x, y - 34 + bob); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color; ctx.fillRect(-8, -8, 16, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
  if (label) {
    ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(label, x + 1, y - 52 + bob);
    ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - 53 + bob);
  }
}

function drawMarkers(ctx, state) {
  const t = state.time, cam = state.camera;
  if (state.mission.marker && visible(cam, state.mission.marker.x, state.mission.marker.y, 200)) {
    const isGiver = state.story.phase === 'idle';
    drawBeam(ctx, state.mission.marker.x, state.mission.marker.y, isGiver ? '#ffd23e' : '#ffb02e', t, isGiver ? '!' : 'OBJETIVO');
  }
  if (state.taxi.active) {
    const m = state.taxi.phase === 'pickup' ? state.taxi.pickup : state.taxi.dest;
    if (m && visible(cam, m.x, m.y, 200)) drawBeam(ctx, m.x, m.y, state.taxi.phase === 'pickup' ? '#39c2d7' : '#57e389', t, state.taxi.phase === 'pickup' ? 'FARE' : 'DESTINO');
  }
  if (state.race.active) {
    const cp = state.race.checkpoints[state.race.next];
    if (cp && visible(cam, cp.x, cp.y, 200)) drawBeam(ctx, cp.x, cp.y, '#e34fd0', t, 'META ' + (state.race.next + 1));
  }
  // the street race start line invites any driver
  if (!state.race.active && state.player.inCar && visible(cam, state.city.raceStart.x, state.city.raceStart.y, 200)) {
    drawBeam(ctx, state.city.raceStart.x, state.city.raceStart.y, '#e34fd0', t, 'CARRERA');
  }
  // checkpoint rings for the mission route
  if (state.story.phase === 'active' && state.story.checkpoints && state.mission.marker) {
    const cp = state.mission.marker;
    ctx.strokeStyle = 'rgba(255,176,46,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 30 + Math.sin(t * 4) * 4, 0, 7); ctx.stroke();
  }
}

// ------------------------------------------------------- skids & pickups
function drawSkids(ctx, state) {
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const s of state.skids) {
    ctx.strokeStyle = `rgba(20,20,22,${Math.min(0.5, s.life * 0.06)})`;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
  }
}

function drawPackages(ctx, state) {
  const t = state.time;
  for (const pk of state.city.packages) {
    if (state.packagesFound.has(pk.id)) continue;
    if (!visible(state.camera, pk.x, pk.y, 60)) continue;
    ctx.save(); ctx.translate(pk.x, pk.y - 4 + Math.sin(t * 2.6 + pk.id) * 3); ctx.rotate(t * 1.8 + pk.id);
    ctx.fillStyle = '#ffd23e'; ctx.fillRect(-6, -6, 12, 12);
    ctx.fillStyle = '#fff3b0'; ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }
}

function drawPickups(ctx, state) {
  for (const pk of state.pickups) {
    const bob = Math.sin(pk.phase) * 3;
    ctx.save(); ctx.translate(pk.x, pk.y + bob);
    ctx.fillStyle = '#2f9e5f'; ctx.fillRect(-8, -5, 16, 10);
    ctx.fillStyle = '#57e389'; ctx.fillRect(-8, -5, 16, 3);
    ctx.fillStyle = '#eafff2'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('$', 0, 3);
    ctx.restore();
  }
}

// ------------------------------------------------------------------- cars
export function drawCar(ctx, state, car) {
  const def = car.def;
  ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-def.w / 2 + 3, -def.h / 2 + 4, def.w, def.h);
  // wheels
  ctx.fillStyle = '#15161a';
  const ww = 7, wh = 4.4, wx = def.w / 2 - 9, wy = def.h / 2 - 1;
  ctx.fillRect(wx - ww / 2, -wy - wh / 2, ww, wh); ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);
  ctx.fillRect(-wx - ww / 2, -wy - wh / 2, ww, wh); ctx.fillRect(-wx - ww / 2, wy - wh / 2, ww, wh);
  // body
  ctx.fillStyle = car.dead ? '#3a3a3e' : car.color;
  roundRect(ctx, -def.w / 2, -def.h / 2, def.w, def.h, 5); ctx.fill();
  if (car.kind === 'police' && !car.dead) {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-def.w * 0.08, -def.h / 2, def.w * 0.3, def.h);
    // light bar, flashing
    const phase = Math.floor(state.time * 4 + car.sirenPhase) % 2;
    ctx.fillStyle = phase ? '#ff4040' : '#4060ff';
    ctx.fillRect(-4, -def.h / 2 + 2, 8, 4);
    ctx.fillStyle = phase ? '#4060ff' : '#ff4040';
    ctx.fillRect(-4, def.h / 2 - 6, 8, 4);
  }
  if (car.type === 'taxi' && !car.dead) {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-3, -def.h / 2 + 1.5, 6, 3); ctx.fillRect(-3, def.h / 2 - 4.5, 6, 3);
    ctx.fillStyle = '#fff'; ctx.fillRect(-6, -4, 12, 8);
    ctx.fillStyle = '#20242a'; ctx.font = '700 6px system-ui'; ctx.textAlign = 'center'; ctx.fillText('TAXI', 0, 2);
  }
  // cabin & glass
  ctx.fillStyle = 'rgba(16,24,34,0.85)';
  roundRect(ctx, -def.w * 0.16, -def.h * 0.36, def.w * 0.34, def.h * 0.72, 3); ctx.fill();
  ctx.fillStyle = 'rgba(140,190,230,0.5)';
  ctx.fillRect(def.w * 0.13, -def.h * 0.32, 3.4, def.h * 0.64);
  ctx.fillRect(-def.w * 0.24, -def.h * 0.32, 3, def.h * 0.64);
  // headlights
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(def.w / 2 - 2, -def.h / 2 + 2, 2.4, 3.4); ctx.fillRect(def.w / 2 - 2, def.h / 2 - 5.4, 2.4, 3.4);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(-def.w / 2 - 0.4, -def.h / 2 + 2, 2, 3.4); ctx.fillRect(-def.w / 2 - 0.4, def.h / 2 - 5.4, 2, 3.4);
  if (car.marked) {
    ctx.strokeStyle = `rgba(255,210,62,${0.65 + Math.sin(state.time * 5) * 0.3})`;
    ctx.lineWidth = 2; roundRect(ctx, -def.w / 2 - 3, -def.h / 2 - 3, def.w + 6, def.h + 6, 7); ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------- peds
function drawPed(ctx, state, p) {
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(1, 3, 8, 4.6, 0, 0, 7); ctx.fill();
  if (p.dead) {
    ctx.globalAlpha = Math.min(1, p.fadeT / 6);
    ctx.rotate(p.angle + 1.57);
    ctx.fillStyle = '#5a5148'; ctx.fillRect(-4, -9, 8, 18);
    ctx.fillStyle = '#c9a186'; ctx.beginPath(); ctx.arc(0, -11, 4, 0, 7); ctx.fill();
    ctx.restore(); return;
  }
  if (p.downT > 0) {
    ctx.rotate(p.angle + 1.57);
    ctx.fillStyle = p.shirt; ctx.fillRect(-4, -9, 8, 18);
    ctx.fillStyle = '#e8b98f'; ctx.beginPath(); ctx.arc(0, -11, 4, 0, 7); ctx.fill();
    ctx.restore(); return;
  }
  ctx.rotate(p.angle);
  ctx.fillStyle = p.pants; ctx.fillRect(-3.4, -6, 3, 7); ctx.fillRect(-3.4, 1, 3, 7);
  ctx.fillStyle = p.shirt; ctx.beginPath(); ctx.arc(0, 0, 6.6, 0, 7); ctx.fill();
  if (p.hostile) { ctx.fillStyle = '#8c1f28'; ctx.beginPath(); ctx.arc(0, 0, 6.6, 3.4, 6); ctx.fill(); }
  ctx.fillStyle = '#e8b98f'; ctx.beginPath(); ctx.arc(1.6, 0, 4.1, 0, 7); ctx.fill();
  if (p.weapon) { ctx.fillStyle = '#22252a'; ctx.fillRect(4, -1.4, 9, 2.8); }
  ctx.restore();
  // hostile health ticks
  if (p.hostile && p.hp < p.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - 12, p.y - 18, 24, 3.4);
    ctx.fillStyle = '#e34f4f'; ctx.fillRect(p.x - 12, p.y - 18, 24 * (p.hp / p.maxHp), 3.4);
  }
}

function drawPlayer(ctx, state) {
  const p = state.player;
  if (p.inCar) {
    // the bust ring closes around the car
    if (state.wanted.bust > 0.02) {
      ctx.strokeStyle = 'rgba(64,110,255,0.9)'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + state.wanted.bust * 6.283); ctx.stroke();
    }
    return;
  }
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(1, 3, 9, 5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, 10.6, 0, 7); ctx.stroke();
  ctx.rotate(p.angle);
  ctx.fillStyle = '#22303c'; ctx.fillRect(-3.4, -6, 3, 7); ctx.fillRect(-3.4, 1, 3, 7);
  ctx.fillStyle = '#12808a'; ctx.beginPath(); ctx.arc(0, 0, 6.8, 0, 7); ctx.fill();
  ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(0, 0, 6.8, 5.6, 6.9); ctx.fill(); // cap brim hint
  ctx.fillStyle = '#e8b98f'; ctx.beginPath(); ctx.arc(1.6, 0, 4.2, 0, 7); ctx.fill();
  if (p.weapon !== 'fist') { ctx.fillStyle = '#22252a'; ctx.fillRect(4, -1.5, 10, 3); }
  ctx.restore();
  if (state.wanted.bust > 0.02) {
    ctx.strokeStyle = 'rgba(64,110,255,0.9)'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + state.wanted.bust * 6.283); ctx.stroke();
  }
}

// ------------------------------------------------------- bullets & pieces
function drawBullets(ctx, state) {
  ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const b of state.bullets) {
    ctx.moveTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function drawParticles(ctx, state) {
  for (const p of state.particles) {
    const f = p.life / p.maxLife;
    ctx.globalAlpha = Math.min(1, f * 1.6);
    ctx.fillStyle = p.color;
    const s = p.size * (p.kind === 'smoke' ? (1.6 - f * 0.6) : 1);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx, state) {
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const f of state.floaters) {
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ night
function drawNight(ctx, state, cam, W, H) {
  const dark = state.darkness;
  if (dark <= 0.01) return;
  ctx.fillStyle = `rgba(10,14,44,${dark})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
  ctx.globalCompositeOperation = 'lighter';
  // streetlight pools — tight pools around each lamp head, not fog banks
  for (const l of state.city.lamps) {
    if (!visible(cam, l.x, l.y, 90)) continue;
    const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 28);
    g.addColorStop(0, 'rgba(255,196,92,0.17)');
    g.addColorStop(1, 'rgba(255,196,92,0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x - 28, l.y - 28, 56, 56);
  }
  // headlights of nearby cars
  for (const car of state.cars) {
    if (car.dead || !visible(cam, car.x, car.y, 200)) continue;
    const fx = car.x + Math.cos(car.angle) * (car.def.w / 2 + 26);
    const fy = car.y + Math.sin(car.angle) * (car.def.w / 2 + 26);
    const g = ctx.createRadialGradient(fx, fy, 2, fx, fy, 36);
    g.addColorStop(0, 'rgba(255,236,170,0.12)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(fx - 36, fy - 36, 72, 72);
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}
