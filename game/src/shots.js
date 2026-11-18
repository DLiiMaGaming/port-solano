// Screenshot scenes behind ?shot=start|drive|chase|docks|boat. Each scene builds a real
// game state, poses the pieces honestly (traffic is placed in real lanes and given a
// settle phase to join the flow before the staged car pulls away; the pursuit cruisers
// and the patrol boat are driven by the real police AI from the first frame), then plays
// the real simulation forward with scripted input. Same seed, same frame, every time.

import { STEP, TILE } from './config.js';
import { createCar, createBoat, createPed, dist } from './entities.js';

function idleInput() {
  return {
    mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, sprint: false, handbrake: false,
    interact: false, confirm: false, pause: false, weaponSlot: 0,
    radioNext: false, radioPrev: false, mute: false,
  };
}

function enterVehicle(state, veh) {
  veh.driver = state.player;
  state.vehicle = veh;
  state.player.x = veh.x;
  state.player.y = veh.y;
}

/**
 * Point a freshly placed traffic car along its avenue: pre-seed the route the traffic
 * AI would build when the car joins the road graph (same shape, real target node), so
 * it drives off in its own lane. Left to itself the AI picks its first target at
 * random from the nearest junction — and a car staged "ahead, same lane" can U-turn
 * across the whole avenue and wedge on a parked car behind the camera.
 */
function routeAlong(car, atTx, atTy, targetKey, prevKey) {
  car.ai = {
    at: { tx: atTx, ty: atTy, x: atTx * TILE + TILE / 2, y: atTy * TILE + TILE / 2, next: [] },
    targetKey,
    prevKey,
  };
}

/**
 * A scripted driver for the staged scenes: full throttle up to `cap` px/s, coast above
 * it, and brake for a slower vehicle ahead in the same lane — the judgement a real
 * player would use, so the staged car flows with traffic instead of ploughing into it.
 */
function cruiseInput(cap) {
  const input = idleInput();
  return (s) => {
    const veh = s.vehicle;
    input.mx = 0;
    input.my = 0;
    if (!veh) return input;
    const fx = Math.cos(veh.angle);
    const fy = Math.sin(veh.angle);
    input.aimX = veh.x + fx * 220;
    input.aimY = veh.y + fy * 220;
    let obstacleGap = Infinity;
    let obstacleSpeed = 0;
    let brakeAt = 95;
    let coastAt = 190;
    for (const other of s.cars) {
      if (other === veh || other.dead) continue;
      const rx = other.x - veh.x;
      const ry = other.y - veh.y;
      const ahead = rx * fx + ry * fy;
      const side = Math.abs(rx * -fy + ry * fx);
      if (ahead > 0 && ahead < obstacleGap && side < 30) { obstacleGap = ahead; obstacleSpeed = other.speed; }
    }
    // A pedestrian in the lane band counts too, but only at the traffic AI's own
    // judgement distance: the script brakes for jaywalkers instead of running them
    // down (which also kept a stray wanted star out of the drive scene and a heat
    // spike out of the chase), yet a walker 150 px away is still just crossing —
    // braking for him from that far froze the drive scene behind a man strolling
    // along the lane.
    for (const ped of s.peds) {
      if (ped.dead || ped.inCar) continue;
      const rx = ped.x - veh.x;
      const ry = ped.y - veh.y;
      const ahead = rx * fx + ry * fy;
      const side = Math.abs(rx * -fy + ry * fx);
      if (ahead > 0 && ahead < obstacleGap && side < 24) { obstacleGap = ahead; obstacleSpeed = 0; brakeAt = 70; coastAt = 110; }
    }
    if (obstacleGap < coastAt && obstacleSpeed < veh.speed - 12) {
      // Closing on something slower: brake when close, otherwise just lift off.
      input.my = obstacleGap < brakeAt ? 0.55 : 0;
    } else if (veh.speed < cap) {
      input.my = -1;
    }
    return input;
  };
}

function stageStart(state) {
  state.tod = 18 * 60 + 12; // golden hour over the bay
  const spot = state.city.spots.marisol;
  state.player.x = spot.x + 30;
  state.player.y = spot.y + 10;
  state.player.angle = 0.4;
  const sedan = createCar('sedan', spot.x + 90, spot.y + 66, 0.2, '#2e6fc2', 'parked');
  state.cars.push(sedan);
  return { seconds: 2.5, input: () => idleInput(), screen: 'title' };
}

function stageDrive(state) {
  state.tod = 10 * 60 + 30;
  // Eastbound on the avenue at ty 94 through Centro. The avenue choice is load-bearing
  // twice over: this lane carries no parked cars at all (on ty 126 a parked taxi stops
  // the whole lane and the old staging rear-ended the queue at full speed), and the
  // camera's 720 px window over ty 94 contains none of the traffic graph's dead-end
  // phantom nodes (the mainland-X × island-Y crossings at ty 114/130/146/162, where
  // ambient spawns are marked dead on arrival and sit in frame as stacked wrecks).
  const car = createCar('sedan', 1700, 94 * 32 + 33, 0, '#c23b2e', 'traffic');
  state.cars.push(car);
  enterVehicle(state, car);
  // Neighbours in the correct lanes and headings: one behind in the same lane, one
  // ahead, one coming the other way. A settle phase (below) lets them join the traffic
  // graph's flow before the staged car pulls away, so nobody is mid-U-turn in frame.
  const behind = createCar('compact', 1545, 94 * 32 + 33, 0, '#565b63', 'traffic');
  routeAlong(behind, 46, 94, '62,94', '46,94');
  state.cars.push(behind);
  const ahead = createCar('sedan', 2020, 94 * 32 + 33, 0, '#87b5c9', 'traffic');
  routeAlong(ahead, 62, 94, '78,94', '62,94');
  state.cars.push(ahead);
  const oncoming = createCar('sedan', 2400, 94 * 32 - 1, Math.PI, '#2e6fc2', 'traffic');
  routeAlong(oncoming, 78, 94, '62,94', '78,94');
  state.cars.push(oncoming);
  for (let i = 0; i < 5; i += 1) {
    const ped = createPed(state.rng, (54 + i * 5) * 32, 92 * 32 + 16, 'civ');
    state.peds.push(ped);
  }
  for (let i = 0; i < 2; i += 1) {
    const ped = createPed(state.rng, (60 + i * 6) * 32, 96 * 32 + 16, 'civ');
    state.peds.push(ped);
  }
  const SETTLE = 5.5;
  const cruise = cruiseInput(208); // a shade under traffic's own 215 cruise
  return {
    seconds: SETTLE + 2.8,
    input: (s, t) => (t < SETTLE ? idleInput() : cruise(s)),
    screen: 'play',
  };
}

function stageChase(state) {
  state.tod = 18 * 60 + 37; // dusk
  // Westbound on the avenue at ty 142 out of El Puerto: the lane is free of parked cars
  // for the whole run, and heading west puts 640 px of frame behind the car for the
  // pursuit to fill. (The old staging ran south down tx 142 with a scripted swerve that
  // steered the car into the Almacén Pulpo wall, and one staged cruiser spawned in a
  // dumpster pocket off the avenue and never moved.)
  // The start sits far enough west that the whole formation is on dry land — the
  // avenue ends at the bay shore (x ~4864), and a cruiser staged past it spawns in
  // the shallows and never moves.
  const car = createCar('muscle', 4280, 142 * 32 - 1, Math.PI, '#2b2e33', 'traffic');
  car.hp = car.maxHp;
  state.cars.push(car);
  enterVehicle(state, car);
  // Exactly three stars: hot enough for cruiser gunfire, and the wanted model then
  // wants exactly the three staged cruisers — no fourth spawns ahead of the player
  // and drives into the chase head-on.
  state.wanted.heat = 100;
  // A cruiser formation on the tail, single file on open road, driven by the real
  // pursuit AI. Single file matters: a cruiser staged in the next lane converged
  // diagonally into its partner's path and the two rear-ended each other and stopped.
  // The staggered fireCd spreads their gunfire over the run instead of a single
  // volley that leaves the staged car barely alive at the capture moment.
  const formation = [[160, 1.9], [310, 2.4], [450, 3.1]];
  for (const [back, fireCd] of formation) {
    const cop = createCar('cruiser', car.x + back, car.y, Math.PI, '#e9edf2', 'cop');
    cop.fireCd = fireCd;
    state.cars.push(cop);
  }
  // The muscle car is faster than a cruiser flat out, so the script caps it at 330:
  // the pursuit closes up and presses on the tail instead of falling out of frame.
  const cruise = cruiseInput(330);
  return {
    seconds: 3.3,
    input: (s) => cruise(s),
    screen: 'play',
  };
}

function stageDocks(state) {
  state.tod = 13 * 60;
  const yard = state.city.spots.warehouse;
  state.player.x = yard.x - 60;
  state.player.y = yard.y + 130;
  state.weaponsOwned.smg = true;
  state.ammo.smg = 240;
  state.weapon = 'smg';
  state.armor = 100; // posed tough, like the chase scene's car: the frame must survive its own shootout
  const points = [[90, 60], [150, 110], [40, 170], [190, 40]];
  for (const [ox, oy] of points) {
    const ped = createPed(state.rng, yard.x + ox, yard.y + oy, 'hostile', { weapon: 'pistol' });
    state.peds.push(ped);
  }
  const input = idleInput();
  return {
    seconds: 2.6,
    input: (s) => {
      let best = null;
      let bestD = Infinity;
      for (const ped of s.peds) {
        if (ped.dead || ped.role !== 'hostile') continue;
        const d = dist(s.player.x, s.player.y, ped.x, ped.y);
        if (d < bestD) { bestD = d; best = ped; }
      }
      if (best) {
        input.aimX = best.x;
        input.aimY = best.y;
        input.fire = bestD < 380;
        input.mx = 0.2;
      }
      return input;
    },
    screen: 'play',
  };
}

function stageBoat(state) {
  state.tod = 18 * 60 + 27; // golden hour on the water
  const spot = state.city.spots.boatSpots[1];
  // Board at the Puerto pier berth, then run NORTH along the waterfront: open bay ahead,
  // the docks and city shore to port, wake streaming astern. (The old course pointed
  // south-east and turned starboard — straight into the causeway deck, which is solid
  // to boats, and wedged there at walking pace inside two seconds.)
  const boat = createBoat('speedboat', spot.x + 90, spot.y, -Math.PI / 2, '#c23b2e', 'moored');
  boat.hp = boat.maxHp;
  state.boats.push(boat);
  enterVehicle(state, boat);
  state.wanted.heat = 74; // three stars: the patrol is out
  // Staged in-basin astern of the player, already pointing the same way, and driven by
  // the real police-boat AI. Same hull, same top speed: the gap holds and it stays in
  // frame instead of ramming across the player's bow and tangling with the berth.
  const patrol = createBoat('speedboat', spot.x + 180, spot.y + 280, -Math.PI / 2, '#274268', 'police');
  patrol.fireCd = 1.8;
  state.boats.push(patrol);
  state.wanted.policeBoat = patrol;
  const input = idleInput();
  input.my = -1;
  return {
    seconds: 2.3,
    input: (s) => {
      input.aimX = s.player.x;
      input.aimY = s.player.y - 200;
      return input;
    },
    screen: 'play',
  };
}

const SCENES = {
  start: stageStart,
  drive: stageDrive,
  chase: stageChase,
  docks: stageDocks,
  boat: stageBoat,
};

/**
 * Pose `state` as the named scene and play it forward. `stepGame` is passed in by
 * main.js (the two modules would otherwise import each other). Returns the screen
 * the page should show over the frame.
 */
export function stageShot(state, name, stepGame) {
  const stage = SCENES[name] || stageStart;
  state.story.index = 9; // no story marker/beacon in the frame
  state.flags.noSave = true;
  const scene = stage(state);
  const steps = Math.round(scene.seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    stepGame(state, scene.input(state, i * STEP), STEP);
    state.flags = {};
  }
  return { screen: scene.screen };
}
