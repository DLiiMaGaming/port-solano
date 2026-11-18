// PORT SOLANO — shots.js
// Deterministic scenes behind the screenshots in screenshots/. Each one
// poses the real game — real city, real traffic, real police — and drives
// it through the scripted input stand-in (input.js), so a screenshot is a
// genuine render of this code, never a mock-up.
//
//   ?shot=start  the title screen over the bay at golden hour
//   ?shot=drive  morning traffic in Centro, player at the wheel
//   ?shot=chase  a three-star pursuit on the harbour avenues
//   ?shot=docks  the Almacén Pulpo shootout, staged on foot

import { WEAPONS } from './config.js';
import { createVehicle, createPed } from './entities.js';

export const SHOT_NAMES = ['start', 'drive', 'chase', 'docks'];

export function setupShot(state, name) {
  const city = state.city;
  state.shotMode = name;
  if (name === 'start') {
    state.clock = 18.6; // golden hour over the bay
    state.camera.x = city.spots.island.x - state.camera.w / 2;
    state.camera.y = 218 * 32 - state.camera.h / 2;
    return;
  }
  if (name === 'drive') {
    state.clock = 10.4;
    const car = createVehicle(city, 'sedan', 3780, (3 * 24 + 2) * 32 + 16, 0, { kind: 'traffic' });
    state.cars.push(car);
    enterCar(state, car);
    // a living avenue: a queue of traffic ahead, oncoming cars in the
    // westbound lane, a taxi, and a car crossing the avenue just ahead —
    // enough of them staged on lane centres that the frame is busy from
    // the first second, before ambient spawns even join in
    const laneW = (3 * 24 + 1) * 32 + 16; // westbound lane centre
    const ahead = createVehicle(city, 'compact', 4150, car.y, 0, { kind: 'traffic' });
    const ahead2 = createVehicle(city, 'pickup', 4480, car.y, 0, { kind: 'traffic' });
    const ahead3 = createVehicle(city, 'sedan', 4340, car.y, 0, { kind: 'traffic' });
    const taxi = createVehicle(city, 'taxi', 4300, laneW, Math.PI, { kind: 'traffic' });
    const oncoming = createVehicle(city, 'compact', 3930, laneW, Math.PI, { kind: 'traffic' });
    const crossing = createVehicle(city, 'compact', (5 * 24 + 1) * 32 + 16, 2050, Math.PI / 2, { kind: 'traffic' });
    for (const c of [ahead, ahead2, ahead3, taxi, oncoming, crossing]) { state.cars.push(c); }
    return;
  }
  if (name === 'chase') {
    state.clock = 18.2;
    const laneW = (7 * 24 + 1) * 32 + 16; // westbound lane centre
    const laneE = (7 * 24 + 2) * 32 + 16; // eastbound lane centre
    const car = createVehicle(city, 'muscle', (8 * 24 + 2) * 32, laneW, Math.PI, { kind: 'traffic', color: '#9d0208' });
    car.vx = -180;
    car.hp = car.maxHp = 400; // posed tough, like the docks scene: the
    // pack rams and shoots from 3 stars, and the flight must still be
    // alive — not a smoking wreck — when the shutter falls
    state.cars.push(car);
    enterCar(state, car);
    state.wanted.heat = 140; // three stars
    // The pursuit starts already on top of him, on lane centres so the
    // Patrulla AI holds formation instead of scattering: one cruiser
    // alongside in the eastbound lane, two more on his tail — and the
    // police system still tops the pack up to the 3-star count.
    const staged = [
      [car.x + 120, laneE, -185], // alongside, next lane
      [car.x + 285, laneW, -190], // on his tail, his lane
      [car.x + 365, laneE, -195], // on his tail, next lane
    ];
    for (const [cx, cy, cvx] of staged) {
      const cop = createVehicle(city, 'cruiser', cx, cy, Math.PI, { kind: 'police' });
      cop.vx = cvx;
      state.cars.push(cop);
    }
    const civ = createVehicle(city, 'sedan', car.x - 760, laneW, Math.PI, { kind: 'traffic' });
    state.cars.push(civ);
    return;
  }
  if (name === 'docks') {
    state.clock = 9.1;
    const at = city.spots.pulpoYard;
    state.player.x = at.x - 150; state.player.y = at.y + 66;
    state.player.angle = 0.3;
    state.player.weapon = 'pistol';
    state.player.ammo.pistol = 48;
    state.player.owned.pistol = true;
    state.player.maxHp = 400; state.player.hp = 400; // survive the whole shoot
    for (let i = 0; i < 3; i++) {
      const ped = createPed(at.x + 60 + i * 62, at.y - 30 + (i % 2) * 74,
        { hostile: true, weapon: WEAPONS.pistol, hp: 55 });
      state.peds.push(ped);
    }
    const truck = createVehicle(city, 'pickup', at.x + 30, at.y + 120, 0.5, { kind: 'parked' });
    state.cars.push(truck);
    state.banner = { title: 'Ruido en el Muelle', sub: 'Clear the yard at Almacén Pulpo', t: 999 };
    // Pose the real mission, not just its banner: with 'Ruido en el
    // Muelle' active and the staged crew registered as its hostiles,
    // publishMarker keeps the HUD tracker on the same objective line
    // ('Clear the yard at Almacén Pulpo') instead of mission 1's.
    state.story.index = 3; // MISSIONS[3] = 'Ruido en el Muelle'
    state.story.phase = 'active';
    state.story.hostiles = state.peds.filter((p) => p.hostile);
    return;
  }
}

function enterCar(state, car) {
  state.player.inCar = car;
  state.player.x = car.x; state.player.y = car.y;
  state.player.angle = car.angle;
}

// A tiny driver that holds keys and aims the mouse for the posed scenes.
export function createShotDriver(state, name) {
  const driver = {
    input: { keys: new Set(), justPressed: new Set(), mouse: { x: 640, y: 340, down: false } },
    update(t) {
      const keys = driver.input.keys;
      keys.clear();
      if (name === 'drive' || name === 'chase') {
        keys.add('KeyW');
        if (name === 'drive') {
          const weave = Math.sin(t * 0.7) > 0.55 ? 'KeyA' : (Math.sin(t * 0.7) < -0.55 ? 'KeyD' : null);
          if (weave) keys.add(weave);
        }
        // The chase holds a straight line down the avenue. Any sustained
        // steering swings the fleeing car off the road and into the
        // blocks, where the pack pins it against the kerb and shoots it
        // dead before the shutter falls — the flight has to stay a
        // flight: full throttle west, the Patrulla doing the moving.
        driver.input.mouse.x = 700; driver.input.mouse.y = 330;
      } else if (name === 'docks') {
        // aim at the nearest living hostile and fire in bursts
        let best = null, bd = Infinity;
        for (const p of state.peds) {
          if (!p.hostile || p.dead) continue;
          const d = (p.x - state.player.x) ** 2 + (p.y - state.player.y) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          driver.input.mouse.x = best.x - state.camera.x;
          driver.input.mouse.y = best.y - state.camera.y;
          driver.input.mouse.down = (t % 1.4) < 0.5;
        }
      }
    },
  };
  return driver;
}
