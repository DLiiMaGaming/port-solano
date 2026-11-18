// PORT SOLANO — entities.js
// The moving things: vehicles (shared physics for the player, traffic and
// police), pedestrians with walk / flee / hostile behaviour, bullets,
// particles, skid marks and cash pickups. Crimes are not judged here —
// they are pushed onto state.events and the wanted system (police.js)
// decides who saw what.

import { TILE, T, VEHICLE_TYPES, MAX_PARTICLES, MAX_SKIDS } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
export function angleDiff(a, b) {
  // Signed turn from b to a, normalised to [-PI, PI]. Every caller passes
  // (targetAngle, currentAngle) and steers by the result, so this must be
  // a - b: with the subtraction reversed, traffic and police steered AWAY
  // from their targets (cars U-turned out of lanes, cruisers veered off
  // mid-pursuit) — found in the screenshot polish round, 2026-11-18.
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------- collision
// A circle is blocked by water tiles and by the city's solid AABBs
// (buildings and crates). moveCircle slides along obstacles axis by axis.
export function circleBlocked(city, x, y, r) {
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (city.tileAt(tx, ty) === T.WATER) return true;
  }
  for (const s of city.solids) {
    if (x + r > s.x && x - r < s.x + s.w && y + r > s.y && y - r < s.y + s.h) return true;
  }
  return x - r < 0 || y - r < 0 || x + r > city.tiles.length / 240 * TILE || y + r > 240 * TILE;
}

export function moveCircle(city, o, r, nx, ny) {
  let hitX = false, hitY = false;
  if (!circleBlocked(city, nx, o.y, r)) o.x = nx; else hitX = true;
  if (!circleBlocked(city, o.x, ny, r)) o.y = ny; else hitY = true;
  return { hitX, hitY };
}

// -------------------------------------------------------------- vehicles
let nextCarId = 1;
export function createVehicle(city, type, x, y, angle, opts = {}) {
  const def = VEHICLE_TYPES[type];
  return {
    id: nextCarId++, kind: opts.kind || 'parked', type, def,
    x, y, angle, vx: 0, vy: 0, speed: 0,
    hp: def.durability, maxHp: def.durability,
    color: opts.color || def.colors[Math.floor(Math.random() * def.colors.length)],
    lane: opts.lane || null, turnCd: Math.random() * 4,
    cruise: 0.45 + Math.random() * 0.25, panic: 0, blockedT: 0, honkT: 0,
    dead: false, smokeT: 0, marked: !!opts.marked, driverOut: false,
    sirenPhase: Math.random() * 6.28, skidL: null, skidR: null,
  };
}

export function carSpeed(car) { return Math.hypot(car.vx, car.vy); }

// One physics step. ctrl = { throttle: -1..1, steer: -1..1, handbrake }.
export function stepVehicle(state, car, ctrl, dt) {
  const def = car.def;
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let vf = car.vx * fx + car.vy * fy;                    // forward speed
  let vlx = car.vx - vf * fx, vly = car.vy - vf * fy;    // lateral slide
  const tile = state.city.tileAtPx(car.x, car.y);
  const offroad = tile !== T.ROAD && tile !== T.BRIDGE && tile !== T.LOT && tile !== T.DOCK;
  const healthF = 0.5 + 0.5 * (car.hp / car.maxHp);
  const top = def.topSpeed * (offroad ? 0.55 : 1) * healthF;

  if (car.dead) ctrl = { throttle: 0, steer: 0, handbrake: true };
  if (ctrl.throttle > 0) {
    vf += def.accel * ctrl.throttle * dt * (vf < 0 ? 2.4 : 1);
  } else if (ctrl.throttle < 0) {
    vf -= def.accel * (vf > 5 ? 1.7 : 0.8) * dt;
  }
  vf -= vf * (offroad ? 1.1 : 0.45) * dt;                // rolling drag
  vf = clamp(vf, -def.reverse, Math.max(top, 0));
  if (!ctrl.throttle && Math.abs(vf) < 3) vf = 0;

  const steerAuthority = clamp(Math.abs(vf) / 70, 0, 1);
  car.angle += ctrl.steer * def.turn * steerAuthority * dt * (vf < 0 ? -1 : 1) * (ctrl.handbrake ? 1.3 : 1);

  const grip = ctrl.handbrake ? def.grip * 0.3 : def.grip;
  const keep = Math.exp(-grip * dt);
  vlx *= keep; vly *= keep;

  const nfx = Math.cos(car.angle), nfy = Math.sin(car.angle);
  car.vx = nfx * vf + vlx; car.vy = nfy * vf + vly;
  car.speed = vf;

  const nx = car.x + car.vx * dt, ny = car.y + car.vy * dt;
  const before = Math.hypot(car.vx, car.vy);
  const hit = moveCircle(state.city, car, def.h * 0.92, nx, ny);
  if (hit.hitX) car.vx = 0;
  if (hit.hitY) car.vy = 0;
  if ((hit.hitX || hit.hitY) && before > 130) {
    const impact = before * (car === state.playerCar() ? 0.55 : 0.8);
    damageCar(state, car, impact * 0.09, 'crash');
    spawnParticles(state, 'spark', car.x + nfx * def.w * 0.5, car.y + nfy * def.w * 0.5, 10);
    spawnParticles(state, 'smoke', car.x, car.y, 5);
    if (state.audio) state.audio.crash(clamp(before / 380, 0.2, 1));
    state.shake = Math.min(14, state.shake + before * 0.02);
    state.events.push({ kind: 'crash', x: car.x, y: car.y, byPlayer: car === state.playerCar() });
  }

  // drift: skid marks + tyre smoke from the rear wheels
  const latSpeed = Math.abs(car.vx * -nfy + car.vy * nfx);
  const drifting = (latSpeed > 55 && Math.abs(vf) > 60) || (ctrl.handbrake && Math.abs(vf) > 120);
  const rx = car.x - nfx * def.w * 0.32, ry = car.y - nfy * def.w * 0.32;
  const px = -nfy * def.h * 0.42, py = nfx * def.h * 0.42;
  if (drifting) {
    addSkid(state, car, 'skidL', rx + px, ry + py);
    addSkid(state, car, 'skidR', rx - px, ry - py);
    if (Math.random() < 0.5) spawnParticles(state, 'smoke', rx, ry, 1);
    if (state.audio && car === state.playerCar()) state.audio.skid();
  } else { car.skidL = null; car.skidR = null; }

  // damage smoke / fire
  if (car.hp < car.maxHp * 0.35 && !car.dead) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) { car.smokeT = 0.12; spawnParticles(state, 'smoke', car.x + nfx * 10, car.y + nfy * 10, 1); }
  }
  if (car.dead) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) { car.smokeT = 0.2; spawnParticles(state, 'fire', car.x, car.y, 1); }
  }
  car.turnCd -= dt;
  return car;
}

function addSkid(state, car, key, x, y) {
  const prev = car[key];
  if (prev && dist2(prev.x, prev.y, x, y) < 900) {
    state.skids.push({ x1: prev.x, y1: prev.y, x2: x, y2: y, life: 9 });
    if (state.skids.length > MAX_SKIDS) state.skids.shift();
  }
  car[key] = { x, y };
}

export function damageCar(state, car, amount, cause) {
  if (car.dead) return;
  car.hp -= amount;
  if (car.hp <= 0) {
    car.hp = 0; car.dead = true;
    spawnParticles(state, 'fire', car.x, car.y, 16);
    spawnParticles(state, 'smoke', car.x, car.y, 14);
    spawnParticles(state, 'spark', car.x, car.y, 12);
    if (state.audio) state.audio.crash(1);
    state.shake = Math.min(16, state.shake + 6);
    if (cause === 'bullet' && car.kind === 'police') {
      state.events.push({ kind: 'crime', crime: 'killCop', x: car.x, y: car.y, certain: true });
    }
  }
}

// Traffic: follow the avenue lanes, turn at some intersections, stop for
// obstacles, panic at nearby violence. Returns the ctrl for stepVehicle.
export function trafficControl(state, car, dt) {
  const ctrl = { throttle: 0, steer: 0, handbrake: false };
  if (car.dead) return ctrl;
  const city = state.city;
  if (!car.lane) { assignLane(city, car); if (!car.lane) return ctrl; }
  const L = car.lane;

  // panic: gunfire or a crash close by empties the street
  if (car.panic > 0) car.panic -= dt;
  const threat = state.lastThreat;
  if (threat && state.time - threat.t < 2.5 && dist2(car.x, car.y, threat.x, threat.y) < 260 * 260) {
    car.panic = 1.6;
  }

  // maybe turn at an intersection
  if (car.turnCd <= 0) {
    for (const ix of city.intersections) {
      if (Math.abs(car.x - ix.x) < 26 && Math.abs(car.y - ix.y) < 26) {
        car.turnCd = 3 + Math.random() * 4;
        if (Math.random() < 0.42) turnAtIntersection(city, car, ix);
        break;
      }
    }
  }

  const ahead = car.panic > 0 ? 190 : 150;
  const tx = L.axis === 'x' ? car.x + L.dir * ahead : L.fixed;
  const ty = L.axis === 'x' ? L.fixed : car.y + L.dir * ahead;
  const want = Math.atan2(ty - car.y, tx - car.x);
  ctrl.steer = clamp(angleDiff(want, car.angle) * 2.4, -1, 1);

  // obstacle scan just ahead
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let blocked = false;
  const probe = (o, r) => {
    const px = car.x + fx * 58, py = car.y + fy * 58;
    return dist2(px, py, o.x, o.y) < (r + 20) * (r + 20);
  };
  for (const o of state.cars) {
    if (o !== car && probe(o, o.def.h)) { blocked = true; break; }
  }
  if (!blocked) for (const p of state.peds) {
    if (!p.dead && probe(p, 10)) { blocked = true; break; }
  }
  if (!blocked && !state.player.inCar && probe(state.player, 10)) blocked = true;

  const spd = carSpeed(car);
  if (blocked) {
    car.blockedT += dt;
    ctrl.throttle = spd > 25 ? -0.7 : 0;
    if (car.blockedT > 1.4 && state.audio && Math.random() < dt * 0.7) { state.audio.horn(); car.blockedT = 0.6; }
  } else {
    car.blockedT = 0;
    const target = car.panic > 0 ? 1 : car.cruise;
    ctrl.throttle = spd < car.def.topSpeed * target ? target : 0;
  }
  if (car.panic > 0) { // swerve away from the threat while fleeing
    const away = Math.atan2(car.y - threat.y, car.x - threat.x);
    ctrl.steer = clamp(angleDiff(away, car.angle) * 1.6, -1, 1);
  }
  return ctrl;
}

function assignLane(city, car) {
  const horiz = Math.abs(Math.cos(car.angle)) > Math.abs(Math.sin(car.angle));
  const lanes = horiz ? city.lanesH : city.lanesV;
  let best = null, bd = Infinity;
  for (const L of lanes) {
    const fixed = horiz ? L.fixed : L.fixed;
    const d = horiz ? Math.abs(car.y - fixed) : Math.abs(car.x - fixed);
    if (d < bd) { bd = d; best = { axis: horiz ? 'x' : 'y', fixed: L.fixed, dir: L.dir }; }
  }
  car.lane = best;
}

function turnAtIntersection(city, car, ix) {
  const L = car.lane;
  const newAxis = L.axis === 'x' ? 'y' : 'x';
  const dir = Math.random() < 0.5 ? 1 : -1;
  const lanes = newAxis === 'x' ? city.lanesH : city.lanesV;
  // the crossing avenue's band start, in tiles
  const bandCoord = newAxis === 'x' ? ix.y : ix.x;
  const bandStart = Math.floor(bandCoord / TILE / 24) * 24;
  for (const c of lanes) {
    const tile = Math.floor(c.fixed / TILE);
    if (Math.floor(tile / 24) === Math.floor(bandStart / 24) && tile % 24 >= bandStart % 24 && c.dir === dir) {
      car.lane = { axis: newAxis, fixed: c.fixed, dir };
      return;
    }
  }
  for (const c of lanes) if (c.dir === dir) { car.lane = { axis: newAxis, fixed: c.fixed, dir }; return; }
}

// Car vs car and car vs ped collisions for the active set.
export function collideCars(state, dt) {
  const cars = state.cars;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const rr = a.def.h + b.def.h + 6;
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 > rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (rr - d) / 2;
      const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      const aWas = { x: a.x, y: a.y }, bWas = { x: b.x, y: b.y };
      moveCircle(state.city, a, a.def.h * 0.92, a.x - ux * push, a.y - uy * push);
      moveCircle(state.city, b, b.def.h * 0.92, b.x + ux * push, b.y + uy * push);
      const rel = Math.abs((a.vx - b.vx) * ux + (a.vy - b.vy) * uy);
      const swap = 0.35;
      const avn = a.vx * ux + a.vy * uy, bvn = b.vx * ux + b.vy * uy;
      a.vx += ux * (bvn - avn) * swap; a.vy += uy * (bvn - avn) * swap;
      b.vx += ux * (avn - bvn) * swap; b.vy += uy * (avn - bvn) * swap;
      if (rel > 120) {
        damageCar(state, a, rel * 0.05, 'crash');
        damageCar(state, b, rel * 0.05, 'crash');
        spawnParticles(state, 'spark', (a.x + b.x) / 2, (a.y + b.y) / 2, 8);
        if (state.audio) state.audio.crash(clamp(rel / 340, 0.2, 0.9));
        const playerInvolved = a === state.playerCar() || b === state.playerCar();
        if (playerInvolved) {
          state.shake = Math.min(14, state.shake + rel * 0.02);
          const other = a === state.playerCar() ? b : a;
          state.events.push({ kind: 'crime', crime: other.kind === 'police' ? 'hitCop' : 'hitCar', x: other.x, y: other.y });
          state.events.push({ kind: 'crash', x: other.x, y: other.y, byPlayer: true });
        }
      }
      void aWas; void bWas;
    }
  }
  // cars running over pedestrians
  for (const car of cars) {
    const spd = carSpeed(car);
    if (spd < 45) continue;
    for (const p of state.peds) {
      if (p.dead || p.downT > 0) continue;
      if (dist2(car.x, car.y, p.x, p.y) < (car.def.h + 12) * (car.def.h + 12)) {
        hurtPed(state, p, spd * 0.35, Math.atan2(p.y - car.y, p.x - car.x), car === state.playerCar());
        if (car === state.playerCar()) {
          state.events.push({ kind: 'crime', crime: 'hitAndRun', x: p.x, y: p.y });
          state.shake = Math.min(12, state.shake + 3);
        }
      }
    }
  }
}

// ------------------------------------------------------------ pedestrians
const SHIRTS = ['#d1603d', '#3d6ed1', '#3dd17a', '#d1c53d', '#a03dd1', '#e8e3d8', '#3dd1c5', '#d13d7a'];
const PANTS = ['#2e3440', '#4a3b2a', '#31435c', '#5c3131', '#22332a'];
let nextPedId = 1;
export function createPed(x, y, opts = {}) {
  return {
    id: nextPedId++, x, y, angle: Math.random() * 6.28,
    hp: opts.hp || 40, maxHp: opts.hp || 40,
    state: 'walk', target: null, waitT: Math.random() * 2,
    hostile: !!opts.hostile, weapon: opts.weapon || null, fireT: Math.random(),
    downT: 0, dead: false, fadeT: 0, fleeFrom: null, fleeT: 0,
    shirt: opts.shirt || SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
    pants: PANTS[Math.floor(Math.random() * PANTS.length)],
    name: opts.name || null, cashDrop: opts.cashDrop ?? (5 + Math.floor(Math.random() * 22)),
  };
}

export function hurtPed(state, ped, amount, fromAngle, byPlayer) {
  if (ped.dead) return;
  ped.hp -= amount;
  spawnParticles(state, 'hitpuff', ped.x, ped.y, 5);
  if (state.audio && byPlayer) state.audio.hit();
  if (ped.hp <= 0) {
    ped.dead = true; ped.fadeT = 25;
    dropCash(state, ped.x, ped.y, ped.cashDrop);
    if (byPlayer) {
      state.events.push({ kind: 'crime', crime: ped.hostile ? 'gunfire' : 'killPed', x: ped.x, y: ped.y });
    }
  } else {
    ped.downT = Math.max(ped.downT, 1.6);
    ped.fleeFrom = { x: ped.x - Math.cos(fromAngle) * 100, y: ped.y - Math.sin(fromAngle) * 100 };
    ped.fleeT = 3;
  }
}

const WALKABLE = new Set([T.SIDEWALK, T.PLAZA, T.PARK, T.SAND, T.DOCK, T.LOT, T.BRIDGE, T.GRASS]);
export function updatePeds(state, dt) {
  const city = state.city, player = state.player;
  for (const p of state.peds) {
    if (p.dead) { p.fadeT -= dt; continue; }
    if (p.downT > 0) { p.downT -= dt; continue; }
    let moveA = null, speed = 0;

    if (p.hostile) {
      const d = Math.hypot(player.x - p.x, player.y - p.y);
      const targetD = player.inCar ? 210 : 165;
      if (d > targetD + 40) { moveA = Math.atan2(player.y - p.y, player.x - p.x); speed = 120; }
      else if (d < targetD - 60) { moveA = Math.atan2(p.y - player.y, p.x - player.x); speed = 95; }
      else { moveA = Math.atan2(player.y - p.y, player.x - p.x) + Math.PI / 2; speed = 42; }
      p.angle = angleLerp(p.angle, Math.atan2(player.y - p.y, player.x - p.x), dt * 8);
      p.fireT -= dt;
      if (d < 400 && p.fireT <= 0 && p.weapon) {
        p.fireT = 0.55 + Math.random() * 0.5;
        const aim = Math.atan2(player.y - p.y, player.x - p.x) + (Math.random() - 0.5) * 0.13;
        spawnBullet(state, p.x, p.y, aim, p.weapon, true);
        if (state.audio && d < 500) state.audio.shot('pistol');
      }
    } else if (p.fleeT > 0 && p.fleeFrom) {
      p.fleeT -= dt;
      moveA = Math.atan2(p.y - p.fleeFrom.y, p.x - p.fleeFrom.x);
      speed = 168;
      p.angle = angleLerp(p.angle, moveA, dt * 10);
    } else {
      // stroll: pick walkable targets nearby, amble between them
      if (!p.target || Math.hypot(p.target.x - p.x, p.target.y - p.y) < 12) {
        p.waitT -= dt;
        if (p.waitT <= 0) {
          p.waitT = Math.random() * 2.5;
          for (let tries = 0; tries < 8; tries++) {
            const tx = Math.floor(p.x / TILE) + Math.floor((Math.random() - 0.5) * 16);
            const ty = Math.floor(p.y / TILE) + Math.floor((Math.random() - 0.5) * 16);
            if (WALKABLE.has(city.tileAt(tx, ty))) { p.target = { x: tx * TILE + 16, y: ty * TILE + 16 }; break; }
          }
        }
      }
      if (p.target && p.waitT <= 0) {
        moveA = Math.atan2(p.target.y - p.y, p.target.x - p.x);
        speed = 52;
        p.angle = angleLerp(p.angle, moveA, dt * 6);
      }
    }
    if (moveA !== null && speed > 0) {
      moveCircle(city, p, 9, p.x + Math.cos(moveA) * speed * dt, p.y + Math.sin(moveA) * speed * dt);
    }
    // threat reaction: nearby gunfire or a crash sends walkers running
    const threat = state.lastThreat;
    if (!p.hostile && threat && state.time - threat.t < 0.4 && dist2(p.x, p.y, threat.x, threat.y) < 240 * 240) {
      p.fleeFrom = { x: threat.x, y: threat.y }; p.fleeT = 2 + Math.random() * 2;
    }
  }
  state.peds = state.peds.filter((p) => !p.dead || p.fadeT > 0);
}

// --------------------------------------------------------------- bullets
export function spawnBullet(state, x, y, angle, weaponDef, hostile) {
  state.bullets.push({
    x, y, vx: Math.cos(angle) * weaponDef.speed, vy: Math.sin(angle) * weaponDef.speed,
    life: weaponDef.range / weaponDef.speed, damage: weaponDef.damage, hostile, dead: false,
  });
  spawnParticles(state, 'muzzle', x + Math.cos(angle) * 14, y + Math.sin(angle) * 14, 2);
}

export function updateBullets(state, dt) {
  const city = state.city, player = state.player;
  for (const b of state.bullets) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    if (city.tileAtPx(nx, ny) === T.WATER || circleBlocked(city, nx, ny, 2)) {
      spawnParticles(state, 'spark', nx, ny, 3);
      b.dead = true; continue;
    }
    b.x = nx; b.y = ny;
    if (b.hostile) {
      const target = player.inCar ? state.playerCar() : player;
      const r = player.inCar ? target.def.h + 8 : 12;
      if (target && dist2(b.x, b.y, target.x, target.y) < r * r) {
        b.dead = true;
        if (player.inCar) damageCar(state, target, b.damage * 0.4, 'bullet');
        state.damagePlayer(b.damage, Math.atan2(b.vy, b.vx));
      }
    } else {
      let consumed = false;
      for (const p of state.peds) {
        if (p.dead) continue;
        if (dist2(b.x, b.y, p.x, p.y) < 13 * 13) {
          hurtPed(state, p, b.damage, Math.atan2(b.vy, b.vx), true);
          b.dead = true; consumed = true; break;
        }
      }
      if (!consumed) for (const car of state.cars) {
        if (car === state.playerCar()) continue;
        if (dist2(b.x, b.y, car.x, car.y) < (car.def.h + 7) * (car.def.h + 7)) {
          damageCar(state, car, b.damage, 'bullet');
          spawnParticles(state, 'spark', b.x, b.y, 4);
          if (car.kind === 'police') state.events.push({ kind: 'crime', crime: 'hitCop', x: car.x, y: car.y });
          b.dead = true; break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter((b) => !b.dead);
}

// -------------------------------------------------- particles & pickups
const PARTICLE_STYLE = {
  spark:   { color: '#ffd23e', size: 2.4, life: 0.35, grav: 300, speed: 190 },
  smoke:   { color: '#8b8f94', size: 5.5, life: 1.15, grav: -36, speed: 34 },
  fire:    { color: '#ff7b2e', size: 4.6, life: 0.55, grav: -60, speed: 46 },
  muzzle:  { color: '#ffca7a', size: 3.2, life: 0.07, grav: 0, speed: 26 },
  cash:    { color: '#57e389', size: 2.6, life: 0.6, grav: 60, speed: 90 },
  hitpuff: { color: '#c94f42', size: 3.4, life: 0.4, grav: 120, speed: 80 },
  splash:  { color: '#7ec3ee', size: 3, life: 0.5, grav: 260, speed: 120 },
};
export function spawnParticles(state, kind, x, y, n, spread = 1) {
  const st = PARTICLE_STYLE[kind] || PARTICLE_STYLE.spark;
  for (let i = 0; i < n; i++) {
    if (state.particles.length >= MAX_PARTICLES) state.particles.shift();
    const a = Math.random() * 6.283, sp = st.speed * (0.3 + Math.random() * 0.7) * spread;
    state.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 12,
      life: st.life * (0.6 + Math.random() * 0.7), maxLife: st.life,
      size: st.size * (0.7 + Math.random() * 0.6), color: st.color, grav: st.grav, kind,
    });
  }
}
export function updateParticles(state, dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.grav * dt; p.vx *= (1 - 1.6 * dt); p.vy *= (1 - 0.4 * dt);
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const s of state.skids) s.life -= dt;
  state.skids = state.skids.filter((s) => s.life > 0);
}

export function dropCash(state, x, y, amount) {
  if (amount <= 0) return;
  state.pickups.push({ kind: 'cash', x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16, amount, phase: Math.random() * 6.28 });
  spawnParticles(state, 'cash', x, y, 5);
}
export function updatePickups(state, dt) {
  const player = state.player;
  const r = player.inCar ? 40 : 26;
  for (const pk of state.pickups) {
    pk.phase += dt * 4;
    if (dist2(pk.x, pk.y, player.x, player.y) < r * r) {
      pk.taken = true;
      if (pk.kind === 'cash') {
        player.cash += pk.amount;
        if (state.audio) state.audio.cash();
        state.floaters.push({ x: pk.x, y: pk.y - 14, text: '+$' + pk.amount, life: 1.1, color: '#57e389' });
      }
    }
  }
  state.pickups = state.pickups.filter((pk) => !pk.taken);
}
