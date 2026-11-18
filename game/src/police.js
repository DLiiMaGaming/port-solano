// The law: a heat-based wanted model (crimes only count when witnessed), cruiser pursuit,
// foot patrols that chase and bust, a police boat for the water, a spotlight helicopter at
// five stars, and roadblocks. Consequences (arrest, fines) are applied by main.js when this
// module raises state.flags.busted; everything else lives here.

import { WANTED, CAR_TYPES, BOAT_TYPES, T } from './config.js';
import {
  clamp, dist, turnToward, collideMove, createCar, createBoat, createPed,
  fireWeapon, lineBlocked, randomRoadNode,
} from './entities.js';

export function createWanted() {
  return {
    heat: 0, stars: 0, seen: false, bust: 0,
    heli: null, policeBoat: null, blockT: 18, block: null,
    patrolSpawnT: 0,
  };
}

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 1; i <= 5; i += 1) if (heat >= WANTED.starHeat[i]) stars = i;
  return stars;
}

function anyWitness(state, x, y, copR, civR) {
  for (const ped of state.peds) {
    if (ped.dead) continue;
    const r = ped.role === 'cop' ? copR : civR;
    if (dist(x, y, ped.x, ped.y) < r) return true;
  }
  for (const car of state.cars) {
    if (car.role === 'cop' && !car.dead && dist(x, y, car.x, car.y) < copR) return true;
  }
  return false;
}

const CRIME_HEAT = {
  shot: () => WANTED.heatShot,
  kill: () => WANTED.heatKill,
  copkill: () => WANTED.heatCopKill,
  theft: () => WANTED.heatCarTheft,
  hitped: () => WANTED.heatHitPed,
  crash: () => WANTED.heatCrash,
};
const CRIME_RANGE = {
  shot: [380, 130], kill: [300, 150], copkill: [320, 160],
  theft: [120, 110], hitped: [190, 160], crash: [130, 120],
};

/** Consume state.crimes: witnessed crimes add heat. */
export function reportCrimes(state) {
  const w = state.wanted;
  for (const crime of state.crimes) {
    const gain = CRIME_HEAT[crime.kind];
    if (!gain) continue;
    const [copR, civR] = CRIME_RANGE[crime.kind] || [150, 120];
    if (w.stars > 0 || anyWitness(state, crime.x, crime.y, copR, civR)) {
      w.heat += gain();
    }
  }
  state.crimes.length = 0;
}

function copSeesPlayer(state) {
  const p = state.player;
  const target = state.vehicle || p;
  const check = (x, y, r) => dist(x, y, target.x, target.y) < r && !lineBlocked(state, x, y, target.x, target.y);
  for (const ped of state.peds) {
    if (!ped.dead && ped.role === 'cop' && check(ped.x, ped.y, 430)) return true;
  }
  for (const car of state.cars) {
    if (!car.dead && car.role === 'cop' && check(car.x, car.y, 460)) return true;
  }
  if (w0(state).policeBoat && !w0(state).policeBoat.dead && check(w0(state).policeBoat.x, w0(state).policeBoat.y, 460)) return true;
  if (w0(state).heli && check(w0(state).heli.x, w0(state).heli.y, 520)) return true;
  return false;
}
function w0(state) { return state.wanted; }

// ---------------------------------------------------------------------------
// Pursuit driving (shared shape for cruisers and the police boat)

function pursuitDrive(state, veh, dt, mode, topMul) {
  const spec = veh.kind === 'boat' ? BOAT_TYPES[veh.type] : CAR_TYPES[veh.type];
  const target = state.vehicle || state.player;
  // Aim a little ahead of the target's motion so pursuers cut corners like they mean it.
  const lead = clamp(dist(veh.x, veh.y, target.x, target.y) / 300, 0, 0.5);
  const tx = target.x + Math.cos(target.angle) * (target.speed || 0) * lead;
  const ty = target.y + Math.sin(target.angle) * (target.speed || 0) * lead;
  const want = Math.atan2(ty - veh.y, tx - veh.x);
  veh.angle = turnToward(veh.angle, want, spec.grip * 0.5 * dt);
  const aligned = Math.abs(Math.sin(want - veh.angle)) < 0.6;
  const d = dist(veh.x, veh.y, target.x, target.y);
  let throttle = aligned ? 1 : 0.45;
  if (d < 60) throttle = 0.25; // on top of the target: press, don't orbit
  veh.speed += spec.accel * throttle * dt;
  veh.speed -= veh.speed * 0.4 * dt;
  veh.speed = clamp(veh.speed, -spec.reverse, spec.top * topMul);
  const hit = collideMove(state.city, veh, Math.cos(veh.angle) * veh.speed * dt, Math.sin(veh.angle) * veh.speed * dt, veh.radius, mode);
  if (hit) veh.speed *= 0.35;
}

function updateCruisers(state, dt) {
  const w = state.wanted;
  for (const car of state.cars) {
    if (car.role !== 'cop' || car.dead) continue;
    car.fireCd = (car.fireCd || 0) - dt;
    pursuitDrive(state, car, dt, 'land', 1.02);
    // From three stars the passenger leans out and shoots.
    if (w.stars >= 3 && car.fireCd <= 0) {
      const target = state.vehicle || state.player;
      const d = dist(car.x, car.y, target.x, target.y);
      if (d > 130 && d < 370 && !lineBlocked(state, car.x, car.y, target.x, target.y)) {
        const aim = Math.atan2(target.y - car.y, target.x - car.x) + state.rng.range(-0.05, 0.05);
        if (fireWeapon(state, car, aim)) car.fireCd = state.rng.range(0.5, 1.0);
        else car.fireCd = 0.3;
      } else car.fireCd = 0.2;
    }
  }
}

function maintainCruisers(state, dt) {
  const w = state.wanted;
  const live = state.cars.filter((c) => c.role === 'cop' && !c.dead);
  const want = WANTED.cruisers[w.stars] || 0;
  // Retire far-away cruisers when the heat is off or the player has long escaped.
  for (let i = state.cars.length - 1; i >= 0; i -= 1) {
    const car = state.cars[i];
    if (car.role === 'cop' && dist(state.player.x, state.player.y, car.x, car.y) > 1700) state.cars.splice(i, 1);
  }
  if (live.length >= want) return;
  const node = randomRoadNode(state, 640, 860);
  if (!node) return;
  const car = createCar('cruiser', node.x, node.y, 0, '#e9edf2', 'cop');
  car.fireCd = 1;
  state.cars.push(car);
}

// ---------------------------------------------------------------------------
// Police boat and helicopter

function findWaterPoint(state, minD, maxD) {
  for (let i = 0; i < 14; i += 1) {
    const a = state.rng.range(0, Math.PI * 2);
    const d = state.rng.range(minD, maxD);
    const x = state.player.x + Math.cos(a) * d;
    const y = state.player.y + Math.sin(a) * d;
    if (state.city.tileAtPx(x, y) === T.WATER) return { x, y };
  }
  return null;
}

function updatePoliceBoat(state, dt) {
  const w = state.wanted;
  const onWater = state.vehicle && state.vehicle.kind === 'boat';
  if (w.stars >= 3 && onWater) {
    if (!w.policeBoat || w.policeBoat.dead) {
      const spot = findWaterPoint(state, 520, 720);
      if (spot) {
        w.policeBoat = createBoat('speedboat', spot.x, spot.y, 0, '#274268', 'police');
        w.policeBoat.fireCd = 1;
        state.boats.push(w.policeBoat);
      }
    }
  }
  const boat = w.policeBoat;
  if (!boat) return;
  if (boat.dead) { w.policeBoat = null; return; }
  if (!onWater || w.stars < 3) {
    // Stand down: motor away and despawn out of sight.
    boat.angle = turnToward(boat.angle, Math.atan2(boat.y - state.player.y, boat.x - state.player.x), 1.6 * dt);
    boat.speed = Math.min(boat.speed + 200 * dt, 300);
    boat.x += Math.cos(boat.angle) * boat.speed * dt;
    boat.y += Math.sin(boat.angle) * boat.speed * dt;
    if (dist(boat.x, boat.y, state.player.x, state.player.y) > 1000) {
      state.boats.splice(state.boats.indexOf(boat), 1);
      w.policeBoat = null;
    }
    return;
  }
  boat.fireCd = (boat.fireCd || 0) - dt;
  pursuitDrive(state, boat, dt, 'water', 1.0);
  if (boat.fireCd <= 0) {
    const target = state.vehicle;
    const d = dist(boat.x, boat.y, target.x, target.y);
    if (d > 120 && d < 380) {
      const aim = Math.atan2(target.y - boat.y, target.x - boat.x) + state.rng.range(-0.05, 0.05);
      if (fireWeapon(state, boat, aim)) boat.fireCd = state.rng.range(0.5, 1.0);
      else boat.fireCd = 0.3;
    } else boat.fireCd = 0.2;
  }
}

function updateHelicopter(state, dt) {
  const w = state.wanted;
  if (w.stars >= 5 && !w.heli) {
    w.heli = {
      x: state.player.x + 500, y: state.player.y - 400, angle: 0,
      fireCd: 2, leaving: false, t: 0,
    };
  }
  const heli = w.heli;
  if (!heli) return;
  heli.t += dt;
  if (w.stars < 5) heli.leaving = true;
  if (heli.leaving) {
    heli.x += 260 * dt;
    heli.y -= 200 * dt;
    if (dist(heli.x, heli.y, state.player.x, state.player.y) > 1200) w.heli = null;
    return;
  }
  // Orbit the player at a trailing offset; the spotlight (rendered from heli.x/y)
  // pins the player, which is why `seen` holds while it is up.
  const orbit = state.time * 0.25;
  const tx = state.player.x + Math.cos(orbit) * 130;
  const ty = state.player.y + Math.sin(orbit) * 130;
  heli.x += (tx - heli.x) * Math.min(1, 1.6 * dt);
  heli.y += (ty - heli.y) * Math.min(1, 1.6 * dt);
  heli.angle = Math.atan2(state.player.y - heli.y, state.player.x - heli.x);
  heli.fireCd -= dt;
  if (heli.fireCd <= 0) {
    const target = state.vehicle || state.player;
    const d = dist(heli.x, heli.y, target.x, target.y);
    if (d < 430) {
      const aim = Math.atan2(target.y - heli.y, target.x - heli.x) + state.rng.range(-0.07, 0.07);
      // The heli fires through a virtual gunner: reuse fireWeapon with a ped-shaped actor.
      if (!heli.gunner) heli.gunner = { x: heli.x, y: heli.y, role: 'cop', weapon: 'smg', radius: 14 };
      heli.gunner.x = heli.x;
      heli.gunner.y = heli.y;
      if (fireWeapon(state, heli.gunner, aim)) heli.fireCd = state.rng.range(0.7, 1.3);
      else heli.fireCd = 0.4;
    } else heli.fireCd = 0.3;
  }
}

// ---------------------------------------------------------------------------
// Roadblocks (five stars): two cruisers parked across the avenue ahead.

function updateRoadblocks(state, dt) {
  const w = state.wanted;
  w.blockT -= dt;
  if (w.block && (w.stars < 5 || dist(state.player.x, state.player.y, w.block.x, w.block.y) > 1300)) {
    for (const car of w.block.cars) {
      const i = state.cars.indexOf(car);
      if (i >= 0) state.cars.splice(i, 1);
    }
    w.block = null;
  }
  if (w.stars < 5 || w.block || w.blockT > 0) return;
  if (!state.vehicle || state.vehicle.kind !== 'car') return;
  // The intersection ahead of the player's heading.
  const aheadX = state.player.x + Math.cos(state.player.angle) * 560;
  const aheadY = state.player.y + Math.sin(state.player.angle) * 560;
  const graph = state.city;
  let best = null;
  let bestD = Infinity;
  for (const tx of [...graph.avenuesX, ...graph.islandAvenuesX]) {
    for (const ty of [...graph.avenuesY, ...graph.islandAvenuesY]) {
      const x = tx * 32 + 16;
      const y = ty * 32 + 16;
      const d = dist(aheadX, aheadY, x, y);
      if (d < bestD && graph.tileAt(tx, ty) === T.ROAD) { bestD = d; best = { x, y, tx, ty }; }
    }
  }
  if (!best || bestD > 300) return;
  const across = state.player.angle + Math.PI / 2;
  const c1 = createCar('cruiser', best.x - Math.cos(across) * 26, best.y - Math.sin(across) * 26, across, '#e9edf2', 'block');
  const c2 = createCar('cruiser', best.x + Math.cos(across) * 26, best.y + Math.sin(across) * 26, across + Math.PI, '#e9edf2', 'block');
  c1.speed = 0;
  c2.speed = 0;
  state.cars.push(c1, c2);
  w.block = { x: best.x, y: best.y, cars: [c1, c2] };
  w.blockT = 30;
}

// ---------------------------------------------------------------------------
// Foot patrols: five officers on beats who chase and bust.

const BEAT_SPOTS = ['police', 'marisol', 'hospital', 'customs', 'safehouse'];

export function maintainPatrols(state, dt) {
  const w = state.wanted;
  w.patrolSpawnT -= dt;
  const live = state.peds.filter((p) => p.role === 'cop' && !p.dead);
  if (live.length >= 5 || w.patrolSpawnT > 0) return;
  w.patrolSpawnT = 4;
  const spotName = BEAT_SPOTS[live.length % BEAT_SPOTS.length];
  const spot = state.city.spots[spotName] || state.city.spots.police;
  // Respawn near the HQ if the beat is far away, else at the beat itself.
  const at = dist(spot.x, spot.y, state.player.x, state.player.y) < 700 ? spot : state.city.spots.police;
  const cop = createPed(state.rng, at.x + state.rng.range(-30, 30), at.y + state.rng.range(-30, 30), 'cop', { beat: { x: spot.x, y: spot.y } });
  state.peds.push(cop);
}

export function updatePatrols(state, dt) {
  const w = state.wanted;
  const p = state.player;
  for (const cop of state.peds) {
    if (cop.role !== 'cop' || cop.dead || cop.inCar) continue;
    cop.fireCd -= dt;
    const d = dist(cop.x, cop.y, p.x, p.y);
    const seesPlayer = d < 330 && !lineBlocked(state, cop.x, cop.y, p.x, p.y);
    if (w.stars > 0 && !state.vehicle && seesPlayer) {
      // Chase on foot; the bust meter itself is filled in updateWanted.
      cop.busting = d < WANTED.bustRange;
      if (d > 26) {
        const a = Math.atan2(p.y - cop.y, p.x - cop.x);
        cop.angle = turnToward(cop.angle, a, 9 * dt);
        collideMove(state.city, cop, Math.cos(a) * 224 * dt, Math.sin(a) * 224 * dt, cop.radius, 'land');
        cop.walkPhase += dt * 11;
      }
    } else if (w.stars >= 3 && state.vehicle && seesPlayer && d > 140 && d < 380) {
      // Too dangerous to chase a car: shoot at it instead.
      cop.angle = Math.atan2(p.y - cop.y, p.x - cop.x);
      if (cop.fireCd <= 0) {
        const aim = cop.angle + state.rng.range(-0.05, 0.05);
        if (fireWeapon(state, cop, aim)) cop.fireCd = state.rng.range(0.6, 1.1);
        else cop.fireCd = 0.35;
      }
    } else {
      cop.busting = false;
      // Walk the beat: a slow loop around the anchor point.
      const beat = cop.beat || state.city.spots.police;
      if (cop.waitT > 0) { cop.waitT -= dt; continue; }
      const arrived = (() => {
        const dd = dist(cop.x, cop.y, cop.tx, cop.ty);
        if (dd < 12) return true;
        const a = Math.atan2(cop.ty - cop.y, cop.tx - cop.x);
        cop.angle = turnToward(cop.angle, a, 7 * dt);
        collideMove(state.city, cop, Math.cos(a) * 74 * dt, Math.sin(a) * 74 * dt, cop.radius, 'land');
        cop.walkPhase += dt * 7;
        return false;
      })();
      if (arrived) {
        cop.waitT = state.rng.range(1, 4);
        cop.tx = beat.x + state.rng.range(-95, 95);
        cop.ty = beat.y + state.rng.range(-95, 95);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The wanted tick

export function updateWanted(state, dt) {
  const w = state.wanted;
  reportCrimes(state);
  w.seen = !state.player.dead && copSeesPlayer(state);
  if (!w.seen && w.stars > 0) {
    w.heat = Math.max(0, w.heat - WANTED.decayUnseenPerSec * dt);
  } else if (w.seen) {
    w.heat = Math.max(0, w.heat - WANTED.decayPerSec * dt * 0.25);
  }
  const before = w.stars;
  w.stars = starsForHeat(w.heat);
  if (w.stars > before) state.flags.starUp = w.stars;
  if (w.stars === 0 && before > 0) state.flags.cleared = true;

  // Bust: an officer close to an on-foot player fills the meter.
  let busting = false;
  if (!state.vehicle && !state.player.dead && w.stars > 0) {
    for (const cop of state.peds) {
      if (cop.role === 'cop' && !cop.dead && dist(cop.x, cop.y, state.player.x, state.player.y) < WANTED.bustRange
        && !lineBlocked(state, cop.x, cop.y, state.player.x, state.player.y)) {
        busting = true;
        break;
      }
    }
  }
  if (busting) {
    w.bust = Math.min(1, w.bust + WANTED.bustFill * dt);
    if (w.bust >= 1 && !state.player.dead) {
      state.flags.busted = true;
      w.bust = 0;
    }
  } else {
    w.bust = Math.max(0, w.bust - WANTED.bustDrain * dt);
  }

  maintainCruisers(state, dt);
  updateCruisers(state, dt);
  maintainPatrols(state, dt);
  updatePatrols(state, dt);
  updatePoliceBoat(state, dt);
  updateHelicopter(state, dt);
  updateRoadblocks(state, dt);
}

/** Clear all heat (arrest, hospital, or a clean escape past zero). */
export function clearHeat(state) {
  state.wanted.heat = 0;
  state.wanted.stars = 0;
  state.wanted.bust = 0;
}
