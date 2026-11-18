// PORT SOLANO — police.js
// The wanted system and the Patrulla. Crimes arrive as events (from
// entities.js and main.js); heat only rises when a pedestrian or an
// officer plausibly saw the act. Heat decays while nobody is watching.
// Police cruisers spawn off-screen, chase and ram; from three stars they
// shoot, at five they park roadblocks across your line of travel. Stay
// close to a stopped player long enough and the bust meter fills.

import { TILE, T, CRIME_HEAT, STAR_THRESHOLDS, POLICE_COUNT, HEAT_DECAY, BUST_TIME, WEAPONS } from './config.js';
import { createVehicle, stepVehicle, angleDiff, carSpeed, spawnBullet, circleBlocked } from './entities.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

export function starsForHeat(heat) {
  let s = 0;
  for (let i = 1; i < STAR_THRESHOLDS.length; i++) if (heat >= STAR_THRESHOLDS[i]) s = i;
  return s;
}

function witnessed(state, x, y) {
  for (const p of state.peds) {
    if (!p.dead && !p.hostile && dist2(p.x, p.y, x, y) < 200 * 200) return true;
  }
  for (const c of state.cars) {
    if (c.kind === 'police' && !c.dead && dist2(c.x, c.y, x, y) < 470 * 470) return true;
  }
  return false;
}

export function reportCrime(state, crime, x, y, certain = false) {
  if (state.wanted.stars >= 5 && crime === 'hitCar') return; // already maxed noise
  if (!certain && !witnessed(state, x, y)) return;
  state.wanted.heat += CRIME_HEAT[crime] || 10;
  state.wanted.lastCrimeT = state.time;
}

// ------------------------------------------------------------- the wanted
export function updateWanted(state, dt) {
  const w = state.wanted, player = state.player;
  // judge the queued events
  for (const ev of state.events) {
    if (ev.kind === 'crime') reportCrime(state, ev.crime, ev.x, ev.y, !!ev.certain);
    else if (ev.kind === 'crash' && ev.byPlayer) reportCrime(state, 'hitCar', ev.x, ev.y);
  }
  state.events.length = 0;

  // who can see the player right now?
  let seen = false;
  for (const c of state.cars) {
    if (c.kind === 'police' && !c.dead && dist2(c.x, c.y, player.x, player.y) < 540 * 540) { seen = true; break; }
  }
  if (!seen) for (const p of state.peds) {
    if (!p.dead && dist2(p.x, p.y, player.x, player.y) < 150 * 150) { seen = true; break; }
  }
  w.seen = seen;
  if (seen) w.unseenT = 0; else w.unseenT += dt;
  if (w.unseenT > 4 && w.heat > 0) w.heat = Math.max(0, w.heat - HEAT_DECAY * dt);
  w.stars = starsForHeat(w.heat);

  // the bust meter: a cruiser sitting on top of a slow or on-foot player
  const playerCar = state.playerCar();
  const playerSlow = !player.inCar || carSpeed(playerCar) < 26;
  let nearCop = false;
  if (w.stars > 0 && playerSlow) {
    for (const c of state.cars) {
      if (c.kind === 'police' && !c.dead && dist2(c.x, c.y, player.x, player.y) < 52 * 52) { nearCop = true; break; }
    }
  }
  if (nearCop) w.bust = Math.min(1, w.bust + dt / BUST_TIME);
  else w.bust = Math.max(0, w.bust - dt / (BUST_TIME * 1.6));
  if (w.bust >= 1 && state.onArrested) state.onArrested();
}

// --------------------------------------------------------------- the hunt
let spawnCd = 0;
export function updatePolice(state, dt) {
  const w = state.wanted, player = state.player;
  const cops = state.cars.filter((c) => c.kind === 'police');
  const desired = POLICE_COUNT[w.stars];
  spawnCd -= dt;

  if (w.stars > 0 && cops.length < desired && spawnCd <= 0) {
    spawnCd = 1.1;
    spawnCop(state, w.stars >= 5 && cops.length % 2 === 1);
  }
  // surplus cruisers peel off and leave the area
  if (cops.length > desired) {
    let far = null, fd = -1;
    for (const c of cops) { const d = dist2(c.x, c.y, player.x, player.y); if (d > fd) { fd = d; far = c; } }
    if (far) far.leaving = true;
  }

  const playerCar = state.playerCar();
  for (const cop of cops) {
    if (cop.dead) { cop.wreckT = (cop.wreckT || 0) + dt; continue; }
    if (cop.leaving) {
      const away = Math.atan2(cop.y - player.y, cop.x - player.x);
      const ctrl = { throttle: 0.7, steer: clamp(angleDiff(away, cop.angle) * 2, -1, 1), handbrake: false };
      stepVehicle(state, cop, ctrl, dt);
      if (dist2(cop.x, cop.y, player.x, player.y) > 1250 * 1250) cop.removeMe = true;
      continue;
    }
    if (cop.roadblock) { stepVehicle(state, cop, { throttle: 0, steer: 0, handbrake: true }, dt); }
    else {
      // pursuit: lead the target, ram when close
      let tx = player.x, ty = player.y;
      if (player.inCar && playerCar) { tx += playerCar.vx * 0.35; ty += playerCar.vy * 0.35; }
      const d = Math.hypot(tx - cop.x, ty - cop.y);
      const want = Math.atan2(ty - cop.y, tx - cop.x);
      const ctrl = { throttle: 1, steer: clamp(angleDiff(want, cop.angle) * 2.6, -1, 1), handbrake: false };
      if (!player.inCar && d < 58) ctrl.throttle = carSpeed(cop) > 20 ? -0.8 : 0; // pull up beside a runner
      if (player.inCar && d < 44) ctrl.throttle = 0.55;
      // don't pile into the cruiser ahead
      for (const o of state.cars) {
        if (o === cop) continue;
        const px = cop.x + Math.cos(cop.angle) * 52, py = cop.y + Math.sin(cop.angle) * 52;
        if (dist2(px, py, o.x, o.y) < 34 * 34) { ctrl.throttle = Math.min(ctrl.throttle, 0); break; }
      }
      stepVehicle(state, cop, ctrl, dt);
    }
    // shooting from three stars up
    if (w.stars >= 3) {
      cop.fireT = (cop.fireT || 1) - dt;
      const d = Math.hypot(player.x - cop.x, player.y - cop.y);
      if (cop.fireT <= 0 && d < 390 && d > 30) {
        cop.fireT = 0.65 + Math.random() * 0.6;
        const aim = Math.atan2(player.y - cop.y, player.x - cop.x) + (Math.random() - 0.5) * 0.1;
        spawnBullet(state, cop.x, cop.y, aim, WEAPONS.pistol, true);
        if (state.audio && d < 520) state.audio.shot('pistol');
      }
    }
  }
  state.cars = state.cars.filter((c) => !c.removeMe && !(c.kind === 'police' && c.dead && (c.wreckT || 0) > 30));
}

function spawnCop(state, roadblock) {
  const player = state.player, city = state.city;
  for (let tries = 0; tries < 14; tries++) {
    let x, y, angle;
    if (roadblock) {
      const pc = state.playerCar();
      const dirA = player.inCar && pc ? Math.atan2(pc.vy, pc.vx) : player.angle;
      x = player.x + Math.cos(dirA) * 520; y = player.y + Math.sin(dirA) * 520;
      angle = dirA + Math.PI / 2;
    } else {
      const a = Math.random() * 6.283, d = 660 + Math.random() * 220;
      x = player.x + Math.cos(a) * d; y = player.y + Math.sin(a) * d;
      angle = Math.atan2(player.y - y, player.x - x);
    }
    const t = city.tileAtPx(x, y);
    if (t !== T.ROAD && t !== T.BRIDGE && t !== T.LOT) continue;
    if (circleBlocked(city, x, y, 20)) continue;
    const cop = createVehicle(city, 'cruiser', x, y, angle, { kind: 'police' });
    cop.roadblock = !!roadblock;
    state.cars.push(cop);
    return;
  }
}
