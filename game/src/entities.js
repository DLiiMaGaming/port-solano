// Entities: factories, physics and the per-frame updates for the player, pedestrians,
// traffic, boats, bullets and particles. Pure simulation — nothing here touches the DOM,
// and sound goes through state.audio (a stub in the headless harness), so the whole file
// runs under Node for testing.
//
// Crimes are not judged here: anything the law would care about is pushed onto
// state.crimes as {kind, x, y} and police.js consumes the queue each tick.

import { TILE, T, PLAYER, WEAPONS, CAR_TYPES, BOAT_TYPES, CAPS, ARMOR_ABSORB } from './config.js';

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

/** Wrap an angle to [-PI, PI). */
export function angleWrap(a) {
  while (a >= Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Signed shortest turn from `from` to `to`, in [-PI, PI). Positive = clockwise (y-down). */
export function angleDiff(from, to) {
  return angleWrap(to - from);
}

/** Turn `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

// ---------------------------------------------------------------------------
// Ground and collision

export function isWaterTile(t) { return t === T.WATER; }

/** Tiles a person can stand on (everything but water and building footprints). */
export function isWalkableTile(t) { return t !== T.WATER && t !== T.BUILDING; }

/** Top-speed multiplier for a car standing on this tile: asphalt is fast, sand is not. */
export function groundFactor(tile) {
  switch (tile) {
    case T.ROAD: case T.BRIDGE: return 1;
    case T.FLOOR: case T.PLAZA: return 0.82;
    case T.SIDEWALK: case T.DOCK: return 0.85;
    case T.GRASS: case T.PARK: return 0.55;
    case T.SAND: return 0.48;
    default: return 0.7;
  }
}

const solidScratch = [];

/** Does a circle at (x, y) with radius r touch a solid rect or a blocked tile? */
function circleBlocked(city, x, y, r, mode) {
  const solids = city.querySolids(x, y, r + 40, solidScratch);
  for (let i = 0; i < solids.length; i += 1) {
    const s = solids[i];
    const nx = clamp(x, s.x, s.x + s.w);
    const ny = clamp(y, s.y, s.y + s.h);
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy < r * r) return true;
  }
  const tx0 = Math.floor((x - r) / TILE);
  const tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE);
  const ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      const t = city.tileAt(tx, ty);
      const blocked = mode === 'water' ? t !== T.WATER : (t === T.WATER || t === T.BUILDING);
      if (!blocked) continue;
      const nx = clamp(x, tx * TILE, tx * TILE + TILE);
      const ny = clamp(y, ty * TILE, ty * TILE + TILE);
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/**
 * Move an entity by (dx, dy), sliding along whatever blocks it. `mode` is 'land' (blocked
 * by water, buildings and solid props) or 'water' (blocked by everything that is not
 * water). Returns true if the full move was not possible.
 */
export function collideMove(city, ent, dx, dy, r, mode) {
  let hit = false;
  if (dx !== 0) {
    if (circleBlocked(city, ent.x + dx, ent.y, r, mode)) { hit = true; } else ent.x += dx;
  }
  if (dy !== 0) {
    if (circleBlocked(city, ent.x, ent.y + dy, r, mode)) { hit = true; } else ent.y += dy;
  }
  ent.x = clamp(ent.x, r, city.w * TILE - r);
  ent.y = clamp(ent.y, r, city.h * TILE - r);
  return hit;
}

// ---------------------------------------------------------------------------
// Factories

let nextId = 1;

export function createPlayer(x, y) {
  return {
    id: nextId++, kind: 'player', x, y, angle: -Math.PI / 2,
    hp: PLAYER.hp, radius: PLAYER.radius,
    fireCd: 0, fireLatch: false, stepT: 0, walkPhase: 0, moving: false,
    dead: false,
  };
}

const CIV_SHIRTS = ['#c2b280', '#7a9cc2', '#c27a7a', '#7ac28a', '#b28ac2', '#e0d6c2', '#5f7a8c', '#c98f4e', '#8c5f6e', '#4e7a6e'];
const CIV_PANTS = ['#3a3f4a', '#5a4632', '#2e3a5a', '#6e6e6e', '#42352a'];

export function createPed(rng, x, y, role, opts = {}) {
  const hostile = role === 'hostile';
  const cop = role === 'cop';
  return {
    id: nextId++, kind: 'ped', x, y, angle: rng.range(0, Math.PI * 2),
    role,
    hp: opts.hp ?? (hostile ? 46 : cop ? 60 : 30),
    maxHp: opts.hp ?? (hostile ? 46 : cop ? 60 : 30),
    weapon: opts.weapon || (hostile ? 'pistol' : cop ? 'pistol' : 'fists'),
    shirt: opts.shirt || (cop ? '#274268' : hostile ? '#4a2326' : rng.pick(CIV_SHIRTS)),
    pants: opts.pants || (cop ? '#1d2432' : rng.pick(CIV_PANTS)),
    name: opts.name || null,
    radius: 12,
    state: 'wander', tx: x, ty: y, waitT: rng.range(0, 2),
    fireCd: rng.range(0.2, 0.9), walkPhase: rng.range(0, 6),
    fleeX: 0, fleeY: 0, fleeT: 0,
    dead: false, deathT: 0, inCar: null, beat: opts.beat || null, busting: false,
  };
}

export function createCar(type, x, y, angle, color, role) {
  const spec = CAR_TYPES[type];
  return {
    id: nextId++, kind: 'car', type, x, y, angle,
    speed: 0, steer: 0, color, role,
    w: spec.w, h: spec.h, hp: spec.hp, maxHp: spec.hp,
    driver: null, passenger: null,
    ai: null, dead: false, smokeT: 0, hornT: 0,
    radius: Math.round(spec.w * 0.36),
  };
}

export function createBoat(type, x, y, angle, color, role) {
  const spec = BOAT_TYPES[type];
  return {
    id: nextId++, kind: 'boat', type, x, y, angle,
    speed: 0, steer: 0, color, role,
    w: spec.w, h: spec.h, hp: spec.hp, maxHp: spec.hp,
    driver: null, wakeT: 0, dead: false,
    radius: Math.round(spec.w * 0.36),
  };
}

/** The nearest enterable vehicle (car with a free driver seat, or moored boat) to a point. */
export function nearestVehicle(state, x, y, r) {
  let best = null;
  let bestD = r;
  for (const list of [state.cars, state.boats]) {
    for (const v of list) {
      if (v.dead || v.driver) continue;
      if (v.kind === 'car' && (v.role === 'cop' || v.role === 'block')) continue;
      const d = dist(x, y, v.x, v.y);
      if (d < bestD) { bestD = d; best = v; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Particles and skids

export function addParticle(state, p) {
  if (state.particles.length >= CAPS.particles) state.particles.shift();
  state.particles.push(p);
}

export function burst(state, x, y, kind, n, baseAngle = 0, spread = Math.PI * 2) {
  const rng = state.rng;
  for (let i = 0; i < n; i += 1) {
    const a = baseAngle + rng.range(-spread / 2, spread / 2);
    const sp = kind === 'spark' ? rng.range(60, 260) : kind === 'splash' ? rng.range(30, 130) : rng.range(14, 70);
    addParticle(state, {
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0, maxLife: kind === 'smoke' ? rng.range(0.7, 1.5) : rng.range(0.25, 0.6),
      size: kind === 'smoke' ? rng.range(5, 10) : kind === 'splash' ? rng.range(2, 4) : rng.range(1.5, 3),
      kind,
      color: kind === 'blood' ? '#a02723' : kind === 'splash' ? '#bfe6f2' : kind === 'smoke' ? '#555a60' : kind === 'dust' ? '#c9b083' : '#ffd76a',
    });
  }
}

export function updateParticles(state, dt) {
  const list = state.particles;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.life += dt;
    if (p.life >= p.maxLife) { list.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= (1 - 1.8 * dt);
    p.vy *= (1 - 1.8 * dt);
    if (p.kind === 'smoke') { p.vy -= 26 * dt; p.size += 7 * dt; }
    if (p.kind === 'splash') p.vy += 300 * dt;
  }
  const skids = state.skids;
  for (let i = skids.length - 1; i >= 0; i -= 1) {
    skids[i].life -= dt;
    if (skids[i].life <= 0) skids.splice(i, 1);
  }
}

export function addSkid(state, x, y) {
  if (state.skids.length >= CAPS.skids) state.skids.shift();
  state.skids.push({ x, y, life: 5 });
}

// ---------------------------------------------------------------------------
// Damage

/** Hurt the player (or the vehicle he is driving, which soaks hits first). */
export function damagePlayer(state, dmg) {
  const p = state.player;
  if (p.dead) return;
  if (state.vehicle) { damageVehicle(state, state.vehicle, dmg, false); return; }
  let rest = dmg;
  if (state.armor > 0) {
    const absorbed = Math.min(state.armor, dmg * ARMOR_ABSORB);
    state.armor -= absorbed;
    rest = dmg - absorbed;
  }
  p.hp -= rest;
  state.audio?.sfx('hurt');
  if (p.hp <= 0) { p.hp = 0; p.dead = true; }
}

export function damagePed(state, ped, dmg, byPlayer) {
  if (ped.dead) return;
  ped.hp -= dmg;
  burst(state, ped.x, ped.y, 'blood', 3);
  if (ped.hp <= 0) {
    ped.dead = true;
    ped.deathT = 0;
    if (byPlayer) {
      state.crimes.push({ kind: ped.role === 'cop' ? 'copkill' : 'kill', x: ped.x, y: ped.y });
      if (ped.role === 'civ') state.flags.civKilled = true;
    }
  } else if (ped.role === 'civ') {
    ped.state = 'flee';
    ped.fleeT = 3;
    ped.fleeX = ped.x * 2 - state.player.x;
    ped.fleeY = ped.y * 2 - state.player.y;
  }
}

export function damageVehicle(state, veh, dmg, byPlayer) {
  if (veh.dead) return;
  veh.hp -= dmg;
  if (veh.hp <= 0) {
    veh.hp = 0;
    veh.dead = true;
    burst(state, veh.x, veh.y, 'smoke', 14);
    burst(state, veh.x, veh.y, 'spark', 10);
    state.audio?.sfx('crash', { vol: 0.9 });
    if (state.vehicle === veh) {
      // The player's ride burns around him: he bails out hurt but alive.
      state.vehicle = null;
      veh.driver = null;
      state.player.hp = Math.max(10, state.player.hp - 22);
      state.player.x = veh.x + veh.radius + 16;
      state.player.y = veh.y;
      if (veh.kind === 'boat') {
        // Swimming is not a thing: wash ashore at the nearest dry tile.
        let best = null;
        let bestD = Infinity;
        for (let r = 1; r <= 10 && !best; r += 1) {
          for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
              const tx = Math.floor(veh.x / TILE) + dx;
              const ty = Math.floor(veh.y / TILE) + dy;
              const t = state.city.tileAt(tx, ty);
              if (t !== T.WATER && t !== T.BUILDING) {
                const px = tx * TILE + TILE / 2;
                const py = ty * TILE + TILE / 2;
                const d = (px - veh.x) ** 2 + (py - veh.y) ** 2;
                if (d < bestD) { bestD = d; best = { x: px, y: py }; }
              }
            }
          }
        }
        if (best) { state.player.x = best.x; state.player.y = best.y; }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shooting

/**
 * Fire `actor`'s weapon toward `angle`. Actor is the player (uses state.weapon and
 * state.ammo) or a ped (ped.weapon, infinite ammo). Returns true if a shot went off.
 */
export function fireWeapon(state, actor, angle) {
  const isPlayer = actor === state.player;
  const key = isPlayer ? state.weapon : (actor.weapon || 'pistol');
  const spec = WEAPONS[key];
  if (!spec) return false;
  if (spec.melee) {
    // A swing: anything hostile-sized in a short arc takes the hit.
    const targets = state.peds;
    for (const ped of targets) {
      if (ped.dead) continue;
      const d = dist(actor.x, actor.y, ped.x, ped.y);
      if (d <= spec.range + ped.radius && Math.abs(angleDiff(angle, Math.atan2(ped.y - actor.y, ped.x - actor.x))) < 0.9) {
        if (isPlayer) damagePed(state, ped, spec.dmg, true);
        else if (ped === state.player) damagePlayer(state, spec.dmg);
      }
    }
    if (isPlayer) {
      for (const car of state.cars) {
        if (!car.dead && dist(actor.x, actor.y, car.x, car.y) < spec.range + car.radius) damageVehicle(state, car, spec.dmg / 2, true);
      }
    }
    state.audio?.sfx('punch', { vol: 0.5 });
    return true;
  }
  if (isPlayer) {
    if ((state.ammo[key] || 0) <= 0) { state.audio?.sfx('error', { vol: 0.3 }); return false; }
    state.ammo[key] -= 1;
  }
  if (state.bullets.length < CAPS.bullets) {
    for (let i = 0; i < spec.pellets; i += 1) {
      const a = angle + state.rng.range(-spec.spread, spec.spread);
      state.bullets.push({
        x: actor.x + Math.cos(angle) * 16, y: actor.y + Math.sin(angle) * 16,
        vx: Math.cos(a) * spec.speed, vy: Math.sin(a) * spec.speed,
        life: spec.range / spec.speed, dmg: spec.dmg,
        from: isPlayer ? 'player' : actor.role === 'cop' ? 'cop' : 'hostile',
        dead: false,
      });
    }
  }
  burst(state, actor.x + Math.cos(angle) * 20, actor.y + Math.sin(angle) * 20, 'spark', 2, angle, 0.7);
  state.audio?.sfx(`shot-${key}`, { vol: isPlayer ? 0.8 : 0.45 });
  if (isPlayer) state.crimes.push({ kind: 'shot', x: actor.x, y: actor.y });
  return true;
}

function bulletHitsSolid(state, b) {
  const t = state.city.tileAtPx(b.x, b.y);
  if (t === T.BUILDING) return true;
  const solids = state.city.querySolids(b.x, b.y, 4, solidScratch);
  for (const s of solids) {
    if (b.x >= s.x && b.x <= s.x + s.w && b.y >= s.y && b.y <= s.y + s.h) return true;
  }
  return false;
}

export function updateBullets(state, dt) {
  const list = state.bullets;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const b = list[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let kill = b.life <= 0;
    if (!kill && bulletHitsSolid(state, b)) {
      burst(state, b.x, b.y, 'spark', 2);
      kill = true;
    }
    if (!kill && b.from !== 'player') {
      // Enemy fire: hits the player's vehicle first, else the player.
      const target = state.vehicle || state.player;
      if (!state.player.dead && dist(b.x, b.y, target.x, target.y) < (target.radius || 13) + 3) {
        if (state.vehicle) damageVehicle(state, state.vehicle, b.dmg, false);
        else damagePlayer(state, b.dmg);
        kill = true;
      }
    }
    if (!kill && b.from === 'player') {
      for (const ped of state.peds) {
        if (ped.dead) continue;
        if (dist(b.x, b.y, ped.x, ped.y) < ped.radius + 3) { damagePed(state, ped, b.dmg, true); kill = true; break; }
      }
      if (!kill) {
        for (const veh of [...state.cars, ...state.boats]) {
          if (veh.dead || veh === state.vehicle) continue;
          if (dist(b.x, b.y, veh.x, veh.y) < veh.radius + 3) { damageVehicle(state, veh, b.dmg, true); kill = true; break; }
        }
      }
    }
    if (!kill && b.from === 'hostile') {
      for (const ped of state.peds) {
        if (ped.dead || ped.role === 'hostile') continue;
        if (dist(b.x, b.y, ped.x, ped.y) < ped.radius + 3) { damagePed(state, ped, b.dmg, false); kill = true; break; }
      }
    }
    if (kill) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Player on foot

export function updatePlayer(state, input, dt) {
  const p = state.player;
  if (p.dead || state.vehicle) return;
  p.fireCd -= dt;
  const mag = Math.hypot(input.mx, input.my);
  p.moving = mag > 0.12;
  if (p.moving) {
    const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const nx = input.mx / (mag > 1 ? mag : 1);
    const ny = input.my / (mag > 1 ? mag : 1);
    collideMove(state.city, p, nx * speed * dt, ny * speed * dt, p.radius, 'land');
    p.walkPhase += dt * (input.sprint ? 11 : 8);
    if (dist(input.aimX, input.aimY, p.x, p.y) > 26) {
      p.angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    } else {
      p.angle = Math.atan2(ny, nx);
    }
    p.stepT -= dt;
    if (p.stepT <= 0) { p.stepT = input.sprint ? 0.28 : 0.38; state.audio?.sfx('step', { vol: 0.12 }); }
  } else if (dist(input.aimX, input.aimY, p.x, p.y) > 26) {
    p.angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
  }
  // Weapon selection by number key.
  if (input.weaponSlot >= 1 && input.weaponSlot <= 5) {
    const key = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'][input.weaponSlot - 1];
    if (key === 'fists' || state.weaponsOwned[key]) state.weapon = key;
  }
  // Firing: automatics hold, semi-automatics need a fresh press.
  const spec = WEAPONS[state.weapon];
  const wantFire = input.fire && !state.dialogue && !state.menu;
  if (wantFire && p.fireCd <= 0) {
    if (spec.auto || !p.fireLatch) {
      if (fireWeapon(state, p, Math.atan2(input.aimY - p.y, input.aimX - p.x))) {
        p.fireCd = spec.rate;
        p.fireLatch = true;
      } else {
        p.fireCd = 0.22;
      }
    }
  }
  if (!input.fire) p.fireLatch = false;
}

// ---------------------------------------------------------------------------
// Driving (cars and boats share the arcade model; the ground decides the rules)

function driveVehicle(state, veh, input, dt, mode) {
  const isBoat = veh.kind === 'boat';
  const spec = isBoat ? BOAT_TYPES[veh.type] : CAR_TYPES[veh.type];
  const tile = state.city.tileAtPx(veh.x, veh.y);
  const factor = isBoat ? 1 : groundFactor(tile);
  const throttle = -input.my; // my is screen-down: up (W) gives my=-1 → forward
  const steerIn = input.mx;

  if (throttle > 0.1) {
    veh.speed += spec.accel * throttle * dt * (veh.speed < 0 ? 2.2 : 1);
  } else if (throttle < -0.1) {
    if (veh.speed > 12) veh.speed -= spec.accel * 1.7 * dt;
    else veh.speed += spec.accel * 0.55 * throttle * dt;
  }
  const topSpeed = spec.top * factor * (veh.dead ? 0 : 1);
  veh.speed = clamp(veh.speed, -spec.reverse, topSpeed);
  // Drag and rolling resistance.
  veh.speed -= veh.speed * (isBoat ? 0.55 : 0.35) * dt;
  if (Math.abs(veh.speed) < 2 && Math.abs(throttle) < 0.1) veh.speed = 0;

  const speedRatio = clamp(Math.abs(veh.speed) / 130, 0, 1);
  veh.steer = lerp(veh.steer || 0, steerIn, 1 - Math.pow(0.0001, dt));
  if (veh.speed !== 0) {
    const dirSign = veh.speed >= 0 ? 1 : -1;
    veh.angle += veh.steer * spec.grip * 0.42 * speedRatio * dirSign * dt * (input.handbrake ? 1.5 : 1);
  }
  const dx = Math.cos(veh.angle) * veh.speed * dt;
  const dy = Math.sin(veh.angle) * veh.speed * dt;
  const wasSpeed = Math.abs(veh.speed);
  const hit = collideMove(state.city, veh, dx, dy, veh.radius, mode);
  if (hit && wasSpeed > 120) {
    const impact = wasSpeed;
    damageVehicle(state, veh, impact * 0.045, false);
    state.audio?.sfx('crash', { vol: clamp(impact / 420, 0.2, 1) });
    burst(state, veh.x, veh.y, 'spark', 6);
    state.crimes.push({ kind: 'crash', x: veh.x, y: veh.y });
    veh.speed *= -0.18;
  } else if (hit) {
    veh.speed *= 0.4;
  }
  // Skid marks and dust/water feedback.
  if (!isBoat && Math.abs(veh.steer) > 0.55 && Math.abs(veh.speed) > 200) {
    addSkid(state, veh.x - Math.cos(veh.angle) * 14, veh.y - Math.sin(veh.angle) * 14);
  }
  if (!isBoat && factor < 0.7 && Math.abs(veh.speed) > 90) {
    burst(state, veh.x, veh.y, 'dust', 1);
  }
  if (isBoat) {
    veh.wakeT -= dt;
    if (Math.abs(veh.speed) > 30 && veh.wakeT <= 0) {
      veh.wakeT = 0.05;
      addParticle(state, {
        x: veh.x - Math.cos(veh.angle) * veh.w * 0.5, y: veh.y - Math.sin(veh.angle) * veh.w * 0.5,
        vx: -Math.cos(veh.angle) * 20, vy: -Math.sin(veh.angle) * 20,
        life: 0, maxLife: 0.8, size: 5, kind: 'splash', color: '#dff4fa',
      });
    }
  }
  // Running people over is a crime and a tragedy.
  if (Math.abs(veh.speed) > 60) {
    for (const ped of state.peds) {
      if (ped.dead || ped.inCar) continue;
      if (dist(veh.x, veh.y, ped.x, ped.y) < veh.radius + ped.radius - 2) {
        damagePed(state, ped, Math.abs(veh.speed) * 0.16, state.vehicle === veh);
        if (state.vehicle === veh) state.crimes.push({ kind: 'hitped', x: ped.x, y: ped.y });
        burst(state, ped.x, ped.y, 'blood', 5);
      }
    }
  }
  if (veh.dead) veh.speed = 0;
}

export function updatePlayerVehicle(state, input, dt) {
  const veh = state.vehicle;
  if (!veh) return;
  driveVehicle(state, veh, input, dt, veh.kind === 'boat' ? 'water' : 'land');
  state.player.x = veh.x;
  state.player.y = veh.y;
  state.player.angle = veh.angle;
  // Firing from the driver's seat (or the deck) is allowed, at a slower cadence.
  state.player.fireCd -= dt;
  const spec = WEAPONS[state.weapon];
  if (input.fire && state.player.fireCd <= 0 && !state.dialogue && !state.menu) {
    if (fireWeapon(state, state.player, Math.atan2(input.aimY - veh.y, input.aimX - veh.x))) {
      state.player.fireCd = spec.rate * 1.4;
    } else state.player.fireCd = 0.25;
  }
  if (input.weaponSlot >= 1 && input.weaponSlot <= 5) {
    const key = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'][input.weaponSlot - 1];
    if (key === 'fists' || state.weaponsOwned[key]) state.weapon = key;
  }
}

// ---------------------------------------------------------------------------
// Traffic: cars follow the avenue graph, node to node, keeping right.

let graphCache = null;

function roadGraph(city) {
  if (graphCache && graphCache.city === city) return graphCache.graph;
  const nodes = new Map();
  const key = (tx, ty) => `${tx},${ty}`;
  const xs = [...city.avenuesX, ...city.islandAvenuesX];
  const ys = [...city.avenuesY, ...city.islandAvenuesY];
  for (const tx of xs) {
    for (const ty of ys) {
      const t = city.tileAt(tx, ty);
      if (t === T.ROAD || t === T.BRIDGE) nodes.set(key(tx, ty), { tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, next: [] });
    }
  }
  const segmentClear = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 1; i < steps; i += 1) {
      const tx = Math.round(x0 + (x1 - x0) * (i / steps));
      const ty = Math.round(y0 + (y1 - y0) * (i / steps));
      const t = city.tileAt(tx, ty);
      if (t !== T.ROAD && t !== T.BRIDGE) return false;
    }
    return true;
  };
  for (const node of nodes.values()) {
    for (const other of nodes.values()) {
      if (other === node) continue;
      if (other.tx !== node.tx && other.ty !== node.ty) continue;
      // Only the nearest node in each of the four directions can be a neighbour.
      const dx = Math.sign(other.tx - node.tx);
      const dy = Math.sign(other.ty - node.ty);
      const distTiles = Math.abs(other.tx - node.tx) + Math.abs(other.ty - node.ty);
      const existing = node.next.find((n) => n.dx === dx && n.dy === dy);
      if (existing && existing.distTiles <= distTiles) continue;
      if (!segmentClear(node.tx, node.ty, other.tx, other.ty)) continue;
      const entry = { key: key(other.tx, other.ty), dx, dy, distTiles };
      if (existing) Object.assign(existing, entry);
      else node.next.push(entry);
    }
  }
  graphCache = { city, graph: nodes };
  return nodes;
}

export function randomRoadNode(state, minD, maxD) {
  const graph = roadGraph(state.city);
  const nodes = [...graph.values()];
  for (let i = 0; i < 10; i += 1) {
    const node = state.rng.pick(nodes);
    const d = dist(state.player.x, state.player.y, node.x, node.y);
    if (d >= minD && d <= maxD) return node;
  }
  return null;
}

function lanePoint(node, fromNode) {
  // Aim at the target node, offset to the right-hand lane of travel.
  const dx = Math.sign(node.tx - fromNode.tx);
  const dy = Math.sign(node.ty - fromNode.ty);
  return { x: node.x - dy * 17, y: node.y + dx * 17, dx, dy };
}

export function updateTrafficCar(state, car, dt) {
  const graph = roadGraph(state.city);
  if (!car.ai) {
    // Snap a fresh traffic car onto the graph.
    let best = null;
    let bestD = Infinity;
    for (const node of graph.values()) {
      const d = dist(car.x, car.y, node.x, node.y);
      if (d < bestD) { bestD = d; best = node; }
    }
    if (!best || best.next.length === 0) { car.dead = true; return; }
    const first = state.rng.pick(best.next);
    car.ai = { at: best, targetKey: first.key, prevKey: null };
  }
  const target = graph.get(car.ai.targetKey);
  if (!target) { car.ai = null; return; }
  const aim = lanePoint(target, car.ai.at);
  const toAim = Math.atan2(aim.y - car.y, aim.x - car.x);
  car.angle = turnToward(car.angle, toAim, 2.4 * dt);
  // Desired speed: cruise, slower for the turn-in, stopped by anything ahead.
  let want = 215;
  const aheadX = car.x + Math.cos(car.angle) * 58;
  const aheadY = car.y + Math.sin(car.angle) * 58;
  for (const other of state.cars) {
    if (other === car || other.dead) continue;
    if (dist(aheadX, aheadY, other.x, other.y) < other.radius + 16) { want = 0; break; }
  }
  if (want > 0 && state.vehicle && dist(aheadX, aheadY, state.vehicle.x, state.vehicle.y) < 44) want = 0;
  if (want > 0 && !state.vehicle && !state.player.dead && dist(aheadX, aheadY, state.player.x, state.player.y) < 34) want = 0;
  if (want > 0) {
    for (const ped of state.peds) {
      if (ped.dead || ped.inCar) continue;
      if (dist(aheadX, aheadY, ped.x, ped.y) < 30) { want = 0; break; }
    }
  }
  car.speed = lerp(car.speed, want, 1 - Math.pow(0.05, dt));
  const dx = Math.cos(car.angle) * car.speed * dt;
  const dy = Math.sin(car.angle) * car.speed * dt;
  const hit = collideMove(state.city, car, dx, dy, car.radius, 'land');
  if (hit) car.speed = Math.min(car.speed, 30);
  if (dist(car.x, car.y, target.x, target.y) < 30) {
    const options = target.next.filter((n) => n.key !== car.ai.prevKey);
    const chosen = options.length > 0 ? state.rng.pick(options) : target.next[0];
    if (!chosen) { car.speed = 0; return; }
    car.ai = { at: target, targetKey: chosen.key, prevKey: `${target.tx},${target.ty}` };
  }
}

export function updateTraffic(state, dt) {
  for (const car of state.cars) {
    if (car.role !== 'traffic' || car.dead) continue;
    if (car === state.vehicle) continue;
    updateTrafficCar(state, car, dt);
  }
}

/** Soft car-to-car and car-to-boat separation with a little crunch. */
export function resolveVehicleCollisions(state) {
  const vehs = [...state.cars, ...state.boats];
  for (let i = 0; i < vehs.length; i += 1) {
    for (let j = i + 1; j < vehs.length; j += 1) {
      const a = vehs[i];
      const b = vehs[j];
      if (a.dead || b.dead) continue;
      if (a.kind !== b.kind) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      const min = a.radius + b.radius - 4;
      if (d <= 0 || d >= min) continue;
      const push = (min - d) / 2;
      const nx = (b.x - a.x) / d;
      const ny = (b.y - a.y) / d;
      const aMovable = state.vehicle !== a;
      const bMovable = state.vehicle !== b;
      if (aMovable) { a.x -= nx * push; a.y -= ny * push; }
      if (bMovable) { b.x += nx * push; b.y += ny * push; }
      const closing = Math.abs(a.speed - b.speed);
      if (closing > 130) {
        damageVehicle(state, a, closing * 0.03, state.vehicle === b);
        damageVehicle(state, b, closing * 0.03, state.vehicle === a);
        state.audio?.sfx('crash', { vol: 0.5 });
        if (state.vehicle === a || state.vehicle === b) state.crimes.push({ kind: 'crash', x: a.x, y: a.y });
      }
      const avg = (a.speed + b.speed) / 2;
      if (aMovable) a.speed = avg * 0.7;
      if (bMovable) b.speed = avg * 0.7;
    }
  }
}

// ---------------------------------------------------------------------------
// Pedestrians

export function lineBlocked(state, x0, y0, x1, y1) {
  const steps = Math.ceil(dist(x0, y0, x1, y1) / 22);
  for (let i = 1; i < steps; i += 1) {
    const x = x0 + (x1 - x0) * (i / steps);
    const y = y0 + (y1 - y0) * (i / steps);
    if (state.city.tileAtPx(x, y) === T.BUILDING) return true;
  }
  return false;
}

function walkToward(state, ped, tx, ty, speed, dt) {
  const d = dist(ped.x, ped.y, tx, ty);
  if (d < 4) return true;
  const a = Math.atan2(ty - ped.y, tx - ped.x);
  ped.angle = turnToward(ped.angle, a, 8 * dt);
  collideMove(state.city, ped, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, ped.radius, 'land');
  ped.walkPhase += dt * (speed > 200 ? 12 : 8);
  return d < 16;
}

export function updatePeds(state, dt) {
  const p = state.player;
  for (let i = state.peds.length - 1; i >= 0; i -= 1) {
    const ped = state.peds[i];
    if (ped.dead) {
      ped.deathT += dt;
      if (ped.deathT > 30) state.peds.splice(i, 1);
      continue;
    }
    if (ped.inCar) continue;
    if (ped.role === 'cop') continue; // police.js walks the beat
    if (ped.role === 'contact') {
      if (dist(ped.x, ped.y, p.x, p.y) < 220) ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
      continue;
    }
    if (ped.role === 'hostile') {
      updateHostile(state, ped, dt);
      continue;
    }
    // Civilian life: flee danger, otherwise wander the pavements.
    if (state.lastShot && state.time - state.lastShot.t < 1.2 && dist(ped.x, ped.y, state.lastShot.x, state.lastShot.y) < 230) {
      ped.state = 'flee';
      ped.fleeT = Math.max(ped.fleeT, 2.2);
      ped.fleeX = ped.x * 2 - state.lastShot.x;
      ped.fleeY = ped.y * 2 - state.lastShot.y;
    }
    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      walkToward(state, ped, ped.fleeX, ped.fleeY, 238, dt);
      if (ped.fleeT <= 0) ped.state = 'wander';
      continue;
    }
    if (ped.waitT > 0) {
      ped.waitT -= dt;
      continue;
    }
    if (walkToward(state, ped, ped.tx, ped.ty, 92, dt)) {
      ped.waitT = state.rng.range(0.4, 3.2);
      for (let tries = 0; tries < 6; tries += 1) {
        const nx = ped.x + state.rng.range(-280, 280);
        const ny = ped.y + state.rng.range(-280, 280);
        if (isWalkableTile(state.city.tileAtPx(nx, ny))) { ped.tx = nx; ped.ty = ny; break; }
      }
    }
  }
}

function updateHostile(state, ped, dt) {
  const p = state.player;
  const target = state.vehicle || p;
  if (p.dead) return;
  const d = dist(ped.x, ped.y, target.x, target.y);
  const seen = d < 430 && !lineBlocked(state, ped.x, ped.y, target.x, target.y);
  ped.fireCd -= dt;
  if (!seen) {
    if (d < 620) walkToward(state, ped, target.x, target.y, 150, dt);
    return;
  }
  ped.angle = Math.atan2(target.y - ped.y, target.x - ped.x);
  if (d > 280) walkToward(state, ped, target.x, target.y, 168, dt);
  else if (d < 120) walkToward(state, ped, ped.x * 2 - target.x, ped.y * 2 - target.y, 150, dt);
  else {
    // Strafe slowly sideways while shooting.
    const side = Math.sin(state.time * 0.7 + ped.id) > 0 ? 1 : -1;
    collideMove(state.city, ped, Math.cos(ped.angle + Math.PI / 2) * side * 34 * dt, Math.sin(ped.angle + Math.PI / 2) * side * 34 * dt, ped.radius, 'land');
  }
  if (ped.fireCd <= 0 && d < 400) {
    const aim = Math.atan2(target.y - ped.y, target.x - ped.x) + state.rng.range(-0.06, 0.06);
    if (fireWeapon(state, ped, aim)) ped.fireCd = state.rng.range(0.55, 1.15);
    else ped.fireCd = 0.4;
  }
}

// ---------------------------------------------------------------------------
// Ambient population

const AMBIENT_TYPES = ['compact', 'compact', 'sedan', 'sedan', 'sedan', 'muscle', 'pickup', 'taxi'];

export function maintainTraffic(state) {
  const p = state.player;
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    const car = state.cars[i];
    if (car.role === 'traffic' && car !== state.vehicle && dist(p.x, p.y, car.x, car.y) > 1550) {
      state.cars.splice(i, 1);
    }
  }
  const live = state.cars.filter((c) => c.role === 'traffic' && !c.dead).length;
  if (live >= CAPS.traffic) return;
  const node = randomRoadNode(state, 580, 1180);
  if (!node) return;
  const type = state.rng.pick(AMBIENT_TYPES);
  const car = createCar(
    type, node.x, node.y, 0,
    type === 'taxi' ? '#f2b21b' : state.rng.pick(['#c23b2e', '#2e6fc2', '#e0a51f', '#3f9e4d', '#e8e6df', '#565b63', '#7a3f8c', '#c26a1b', '#2b2e33', '#87b5c9']),
    'traffic',
  );
  state.cars.push(car);
}

export function maintainPeds(state) {
  const p = state.player;
  for (let i = state.peds.length - 1; i >= 0; i -= 1) {
    const ped = state.peds[i];
    if (ped.role === 'civ' && dist(p.x, p.y, ped.x, ped.y) > 1050) state.peds.splice(i, 1);
  }
  const live = state.peds.filter((x) => x.role === 'civ' && !x.dead).length;
  if (live >= CAPS.peds) return;
  for (let tries = 0; tries < 6; tries += 1) {
    const a = state.rng.range(0, Math.PI * 2);
    const d = state.rng.range(360, 780);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const t = state.city.tileAtPx(x, y);
    if (!isWalkableTile(t) || t === T.ROAD) continue;
    state.peds.push(createPed(state.rng, x, y, 'civ'));
    return;
  }
}
