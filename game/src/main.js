// PORT SOLANO — main.js
// The conductor: owns the game state, the frame loop, the player (on foot
// and at the wheel), combat, shops, consequences (hospital, arrest), the
// HUD, saving, and the title / pause flow. The simulation itself lives in
// citygen.js (the city), entities.js (things that move), police.js (the
// law), missions.js (the story and side work) and render.js (the eye).

import {
  TILE, T, CITY_SEED, WEAPONS, WEAPON_ORDER, PRICES, SAVE_KEY,
  DAY_LENGTH, START_CLOCK, MAX_PEDS, MAX_TRAFFIC, WORLD_PX,
} from './config.js';
import { initInput, down, pressed, mouseDown, mousePos, postUpdate, input } from './input.js';
import { AudioEngine } from './audio.js';
import { generateCity } from './citygen.js';
import {
  createVehicle, createPed, createBoat, stepVehicle, stepBoat, trafficControl, collideCars,
  updatePeds, updateBoats, updateBullets, updateParticles, updatePickups, spawnBullet,
  spawnParticles, hurtPed, damageCar, damageBoat, moveCircle, circleBlocked, carSpeed,
} from './entities.js';
import { updateWanted, updatePolice } from './police.js';
import {
  createStory, currentMission, startMission, activateMission, rewardMission,
  failMission, updateMission, createTaxi, updateTaxi, createRace, startRace, startRace2, updateRace,
  createCourier, startCourier, updateCourier,
} from './missions.js';
import { drawWorld } from './render.js';
import { createMinimap } from './minimap.js';
import { setupShot, createShotDriver } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mmCtx = document.getElementById('minimap').getContext('2d');
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

// ------------------------------------------------------------------ state
function freshState() {
  const city = generateCity(CITY_SEED);
  const terminal = city.buildings.find((b) => b.name === 'Terminal de Buses');
  const state = {
    mode: 'title', time: 0, clock: START_CLOCK, darkness: 0, shake: 0, hurtT: 0,
    city, cars: [], boats: [], peds: [], bullets: [], particles: [], pickups: [], skids: [],
    floaters: [], events: [], lastThreat: null, heli: null,
    weather: { raining: false, wet: 0, nextT: 150 + Math.random() * 150, leftT: 0 },
    radioT: 0,
    player: {
      x: terminal.door.x, y: terminal.door.y + 36, angle: Math.PI / 2,
      hp: 100, maxHp: 100, armor: 0, cash: 25, weapon: 'fist', fireCd: 0,
      owned: { fist: true, pistol: false, smg: false, shotgun: false, rifle: false },
      ammo: { pistol: 0, smg: 0, shotgun: 0, rifle: 0 }, inCar: null, inBoat: null,
    },
    wanted: { heat: 0, stars: 0, bust: 0, unseenT: 0, seen: false, lastCrimeT: -99 },
    story: createStory(), mission: { marker: null, objective: '' },
    taxi: createTaxi(), race: createRace(), courier: createCourier(),
    packagesFound: new Set(),
    camera: { x: 0, y: 0, w: canvas.width, h: canvas.height },
    dialogue: null, banner: null, shopOpen: null, prompt: '',
    district: null, districtT: 0, startT: 0, shotMode: null, driver: null,
    audio: new AudioEngine(), minimap: null,
  };
  state.minimap = createMinimap(city);
  state.playerCar = () => state.player.inCar;
  state.damagePlayer = (amount) => damagePlayer(state, amount);
  state.onArrested = () => arrested(state);
  state.saveGame = () => saveGame(state);
  // the parked-car population of the city
  for (const s of city.parkedSpots) {
    if (city.tileAtPx(s.x, s.y) === T.WATER) continue;
    state.cars.push(createVehicle(city, s.type, s.x, s.y, s.angle, { kind: 'parked' }));
  }
  // the moored fleet: dinghies and speedboats at the docks and the island
  for (const s of city.boatSpots) state.boats.push(createBoat(city, s.type, s.x, s.y, s.angle));
  return state;
}

function damagePlayer(state, amount) {
  const p = state.player;
  if (state.mode !== 'play') return;
  let eff = (p.inCar || p.inBoat) ? amount * 0.3 : amount;
  if (p.armor > 0) { // the vest eats most of what gets through, until it is spent
    const absorbed = Math.min(p.armor, eff * 0.75);
    p.armor -= absorbed; eff -= absorbed;
  }
  p.hp -= eff;
  state.hurtT = Math.min(0.8, state.hurtT + 0.3);
  state.shake = Math.min(10, state.shake + 2);
  if (state.audio) state.audio.hit();
  if (p.hp <= 0) downed(state);
}

// -------------------------------------------------------------- save/load
function saveGame(state) {
  try {
    const p = state.player;
    const data = {
      v: 1, cash: p.cash, hp: p.hp, armor: p.armor, x: p.x, y: p.y, angle: p.angle, clock: state.clock,
      storyIndex: state.story.index, owned: p.owned, ammo: p.ammo, weapon: p.weapon,
      packages: [...state.packagesFound],
      car: p.inCar ? { type: p.inCar.type, x: p.inCar.x, y: p.inCar.y, angle: p.inCar.angle, hp: p.inCar.hp, color: p.inCar.color } : null,
      boat: p.inBoat ? { type: p.inBoat.type, x: p.inBoat.x, y: p.inBoat.y, angle: p.inBoat.angle, hp: p.inBoat.hp, color: p.inBoat.color } : null,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch { /* storage unavailable: the game simply does not persist */ }
}

function loadSave(state) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    const p = state.player;
    p.cash = d.cash; p.hp = d.hp; p.armor = d.armor || 0; p.x = d.x; p.y = d.y; p.angle = d.angle;
    // merge over the defaults so saves from before the rifle existed load clean
    p.owned = Object.assign({ fist: true, pistol: false, smg: false, shotgun: false, rifle: false }, d.owned);
    p.ammo = Object.assign({ pistol: 0, smg: 0, shotgun: 0, rifle: 0 }, d.ammo);
    p.weapon = d.weapon || 'fist';
    state.clock = d.clock ?? START_CLOCK;
    state.story.index = d.storyIndex || 0;
    state.packagesFound = new Set(d.packages || []);
    if (d.car) {
      const car = createVehicle(state.city, d.car.type, d.car.x, d.car.y, d.car.angle, { kind: 'parked', color: d.car.color });
      car.hp = d.car.hp;
      state.cars.push(car);
      p.inCar = car;
    }
    if (d.boat) {
      const boat = createBoat(state.city, d.boat.type, d.boat.x, d.boat.y, d.boat.angle, { color: d.boat.color });
      boat.hp = d.boat.hp;
      state.boats.push(boat);
      p.inBoat = boat;
      p.x = boat.x; p.y = boat.y;
    }
    return true;
  } catch { return false; }
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

// ------------------------------------------------------------- consequences
function clearHeat(state) {
  state.wanted.heat = 0; state.wanted.stars = 0; state.wanted.bust = 0;
  for (const c of state.cars) if (c.kind === 'police') c.leaving = true;
}

function downed(state) {
  const p = state.player;
  if (state.story.phase === 'active' || state.story.phase === 'intro') failMission(state);
  if (state.taxi.active) state.taxi.active = false;
  if (state.race.active) state.race.active = false;
  if (state.courier.active) state.courier.active = false;
  const fee = Math.min(p.cash, 25 + Math.floor(p.cash * 0.1));
  p.cash -= fee;
  p.inCar = null; p.inBoat = null; p.hp = p.maxHp;
  p.x = state.city.hospital.door.x; p.y = state.city.hospital.door.y + 30;
  clearHeat(state);
  state.mode = 'downed';
  $('endTitle').textContent = 'DOWNED';
  $('endSub').textContent = 'You wake up at Hospital San Solano. The bill comes to $' + fee + ' — the bay is still out there.';
  $('endcard').classList.remove('hidden');
  if (state.audio) state.audio.jingle(false);
}

function arrested(state) {
  const p = state.player;
  if (state.story.phase === 'active' || state.story.phase === 'intro') failMission(state);
  if (state.taxi.active) state.taxi.active = false;
  if (state.race.active) state.race.active = false;
  if (state.courier.active) state.courier.active = false;
  const fine = Math.min(p.cash, 100 + state.wanted.stars * 60);
  p.cash -= fine;
  p.inCar = null; p.inBoat = null; p.hp = Math.max(40, p.hp);
  p.x = state.city.policeStation.door.x; p.y = state.city.policeStation.door.y + 30;
  clearHeat(state);
  state.mode = 'arrested';
  $('endTitle').textContent = 'ARRESTED';
  $('endSub').textContent = 'La Patrulla takes $' + fine + ' and your afternoon. You walk out of Comisaría Central with a warning.';
  $('endcard').classList.remove('hidden');
  if (state.audio) state.audio.jingle(false);
}

// ------------------------------------------------------------ ambient life
function spawnAmbient(state, dt) {
  const p = state.player, city = state.city;
  // traffic: keep the avenues alive near the player
  const traffic = state.cars.filter((c) => c.kind === 'traffic' && c !== p.inCar);
  if (traffic.length < MAX_TRAFFIC) {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * 6.283, d = 560 + Math.random() * 320;
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      const t = city.tileAtPx(x, y);
      if (t !== T.ROAD && t !== T.BRIDGE) continue;
      const type = ['compact', 'sedan', 'sedan', 'muscle', 'pickup', 'taxi'][Math.floor(Math.random() * 6)];
      const car = createVehicle(city, type, x, y, Math.round(a / (Math.PI / 2)) * (Math.PI / 2), { kind: 'traffic' });
      state.cars.push(car);
      break;
    }
  }
  for (const c of traffic) if (dist2(c.x, c.y, p.x, p.y) > 1250 * 1250 && !c.marked) c.removeMe = true;
  // pedestrians near the player
  const walkers = state.peds.filter((pp) => !pp.hostile);
  if (walkers.length < MAX_PEDS) {
    for (let tries = 0; tries < 6; tries++) {
      const tx = Math.floor(p.x / TILE) + Math.floor((Math.random() - 0.5) * 34);
      const ty = Math.floor(p.y / TILE) + Math.floor((Math.random() - 0.5) * 34);
      const t = city.tileAt(tx, ty);
      if (![T.SIDEWALK, T.PLAZA, T.PARK, T.SAND, T.DOCK].includes(t)) continue;
      const x = tx * TILE + 16, y = ty * TILE + 16;
      if (dist2(x, y, p.x, p.y) < 330 * 330) continue;
      state.peds.push(createPed(x, y));
      break;
    }
  }
  // ambient walkers fade out with distance; beat officers are fixtures
  // of their posts and are never culled (police.js keeps the beats manned)
  for (const pp of walkers) if (!pp.cop && dist2(pp.x, pp.y, p.x, p.y) > 1000 * 1000) pp.removeMe = true;
  state.peds = state.peds.filter((pp) => !pp.removeMe);
  state.cars = state.cars.filter((c) => !c.removeMe);
}

// ----------------------------------------------------------------- player
function updatePlayer(state, dt) {
  const p = state.player, city = state.city;
  p.fireCd -= dt;
  const mp = mousePos();
  const aimWorld = { x: state.camera.x + mp.x, y: state.camera.y + mp.y };

  if (p.inBoat) {
    const boat = p.inBoat;
    const ctrl = {
      throttle: (down('KeyW', 'ArrowUp') ? 1 : 0) + (down('KeyS', 'ArrowDown') ? -1 : 0),
      steer: (down('KeyA', 'ArrowLeft') ? -1 : 0) + (down('KeyD', 'ArrowRight') ? 1 : 0),
    };
    stepBoat(state, boat, ctrl, dt);
    p.x = boat.x; p.y = boat.y; p.angle = boat.angle;
    if (boat.dead) {
      // the hull gives up under you: swim for the nearest shore, barely
      p.inBoat = null;
      const shore = findShoreSpot(state, boat) || city.spots.boatDock;
      p.x = shore.x; p.y = shore.y;
      damagePlayer(state, 16);
      state.floaters.push({ x: p.x, y: p.y - 26, text: 'You wash ashore, coughing bay water', life: 2.2, color: '#9fc6e8' });
      return;
    }
    if (mouseDown()) tryFire(state, aimWorld);
    return;
  }

  if (p.inCar) {
    const car = p.inCar;
    const ctrl = {
      throttle: (down('KeyW', 'ArrowUp') ? 1 : 0) + (down('KeyS', 'ArrowDown') ? -1 : 0),
      steer: (down('KeyA', 'ArrowLeft') ? -1 : 0) + (down('KeyD', 'ArrowRight') ? 1 : 0),
      handbrake: down('Space'),
    };
    stepVehicle(state, car, ctrl, dt);
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    if (mouseDown()) tryFire(state, aimWorld);
    return;
  }

  // on foot
  let mx = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
  let my = (down('KeyS', 'ArrowDown') ? 1 : 0) - (down('KeyW', 'ArrowUp') ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx /= len; my /= len;
    const speed = down('ShiftLeft', 'ShiftRight') ? 228 : 148;
    moveCircle(city, p, 11, p.x + mx * speed * dt, p.y + my * speed * dt);
  }
  p.angle = Math.atan2(aimWorld.y - p.y, aimWorld.x - p.x);
  if (mouseDown() || down('Space')) tryFire(state, aimWorld);
}

function tryFire(state, aimWorld) {
  const p = state.player;
  if (p.fireCd > 0 || state.dialogue || state.shopOpen) return;
  const def = WEAPONS[p.weapon];
  const angle = Math.atan2(aimWorld.y - p.y, aimWorld.x - p.x);
  if (def.melee) {
    p.fireCd = def.cooldown;
    if (state.audio) state.audio.punch();
    spawnParticles(state, 'muzzle', p.x + Math.cos(angle) * 16, p.y + Math.sin(angle) * 16, 1);
    let hitSomething = false;
    for (const ped of state.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - p.x, ped.y - p.y);
      if (d < 36 && Math.abs(angleDelta(angle, Math.atan2(ped.y - p.y, ped.x - p.x))) < 1.1) {
        hurtPed(state, ped, def.damage, angle, true);
        hitSomething = true;
      }
    }
    for (const car of state.cars) {
      if (car === p.inCar) continue;
      if (Math.hypot(car.x - p.x, car.y - p.y) < car.def.h + 26) {
        damageCar(state, car, 5, 'melee');
        spawnParticles(state, 'spark', car.x, car.y, 3);
        hitSomething = true;
        if (car.kind === 'police') state.events.push({ kind: 'crime', crime: 'hitCop', x: car.x, y: car.y });
      }
    }
    for (const boat of state.boats) {
      if (boat === p.inBoat) continue;
      if (Math.hypot(boat.x - p.x, boat.y - p.y) < boat.def.h + 26) {
        damageBoat(state, boat, 5, 'melee');
        spawnParticles(state, 'splash', boat.x, boat.y, 3);
        hitSomething = true;
        if (boat.kind === 'police') state.events.push({ kind: 'crime', crime: 'hitCop', x: boat.x, y: boat.y });
      }
    }
    if (hitSomething && state.audio) state.audio.hit();
    return;
  }
  const key = def.ammoKey;
  if (p.ammo[key] <= 0) {
    p.fireCd = 0.3;
    if (state.audio) state.audio.uiClick();
    state.floaters.push({ x: p.x, y: p.y - 24, text: 'Sin balas — visita Armas Solano', life: 1.4, color: '#e34f4f' });
    return;
  }
  p.fireCd = def.cooldown;
  p.ammo[key]--;
  for (let i = 0; i < def.pellets; i++) {
    const a = angle + (Math.random() - 0.5) * 2 * def.spread;
    spawnBullet(state, p.x + Math.cos(angle) * 14, p.y + Math.sin(angle) * 14, a, def, false);
  }
  if (state.audio) state.audio.shot(p.weapon);
  state.lastThreat = { x: p.x, y: p.y, t: state.time };
  state.events.push({ kind: 'crime', crime: 'gunfire', x: p.x, y: p.y });
  state.shake = Math.min(8, state.shake + (p.weapon === 'shotgun' ? 2.4 : 0.7));
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------ interactions
function nearestCar(state, r) {
  const p = state.player;
  let best = null, bd = r * r;
  for (const c of state.cars) {
    const d = dist2(c.x, c.y, p.x, p.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function enterCar(state, car) {
  const p = state.player;
  if (car.kind === 'traffic') {
    // the driver bails out and runs
    const driver = createPed(car.x + 14, car.y + 10);
    driver.fleeFrom = { x: p.x, y: p.y }; driver.fleeT = 3.2;
    state.peds.push(driver);
    state.events.push({ kind: 'crime', crime: 'theft', x: car.x, y: car.y });
    car.stolen = true;
  } else if (car.kind === 'police') {
    state.events.push({ kind: 'crime', crime: 'theft', x: car.x, y: car.y, certain: true });
    car.kind = 'parked'; car.stolen = true;
  } else if (car.marked) {
    state.events.push({ kind: 'crime', crime: 'theft', x: car.x, y: car.y });
  }
  p.inCar = car;
  if (state.audio) state.audio.door();
}

function exitCar(state) {
  const p = state.player, car = p.inCar;
  if (!car) return;
  if (carSpeed(car) > 65) {
    state.floaters.push({ x: p.x, y: p.y - 26, text: 'Too fast to jump out!', life: 1.2, color: '#e34f4f' });
    return;
  }
  const side = car.angle + Math.PI / 2;
  const nx = car.x + Math.cos(side) * (car.def.h + 16);
  const ny = car.y + Math.sin(side) * (car.def.h + 16);
  if (!moveCircle(state.city, p, 11, nx, ny).hitX) { p.x = nx; p.y = ny; }
  if (car.stolen && car.kind === 'traffic') car.kind = 'parked';
  p.inCar = null;
  if (state.audio) state.audio.door();
}

// The nearest steppable shore point around a boat, or null: a ring of
// probes at growing radii, the first dry, unblocked spot wins.
function findShoreSpot(state, boat) {
  const city = state.city;
  for (const r of [boat.def.w * 0.5 + 15, 62, 92, 132]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const nx = boat.x + Math.cos(a) * r, ny = boat.y + Math.sin(a) * r;
      if (city.tileAtPx(nx, ny) === T.WATER) continue;
      if (!circleBlocked(city, nx, ny, 11)) return { x: nx, y: ny };
    }
  }
  return null;
}

function nearestBoat(state, r) {
  const p = state.player;
  let best = null, bd = r * r;
  for (const b of state.boats) {
    if (b.dead) continue;
    const d = dist2(b.x, b.y, p.x, p.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function enterBoat(state, boat) {
  const p = state.player;
  p.inBoat = boat;
  p.x = boat.x; p.y = boat.y; p.angle = boat.angle;
  if (state.audio) state.audio.door();
}

function exitBoat(state) {
  const p = state.player, boat = p.inBoat;
  if (!boat) return;
  if (Math.abs(boat.speed) > 60) {
    state.floaters.push({ x: p.x, y: p.y - 26, text: 'Too fast to step out!', life: 1.2, color: '#e34f4f' });
    return;
  }
  const shore = findShoreSpot(state, boat);
  if (!shore) {
    state.floaters.push({ x: p.x, y: p.y - 26, text: 'No shore within reach', life: 1.2, color: '#e34f4f' });
    return;
  }
  p.x = shore.x; p.y = shore.y;
  p.inBoat = null;
  if (state.audio) state.audio.door();
}

function scanInteractions(state) {
  const p = state.player, city = state.city;
  state.prompt = '';
  if (state.dialogue || state.shopOpen || state.mode !== 'play') return;

  if (p.inBoat) {
    if (findShoreSpot(state, p.inBoat)) {
      state.prompt = 'Step ashore';
      if (pressed('KeyE')) exitBoat(state);
    } else state.prompt = p.inBoat.def.name + ' — reach a shore to step out';
    return;
  }

  if (p.inCar) {
    const car = p.inCar;
    for (const s of city.shops) {
      if (s.type === 'customs' && dist2(s.door.x, s.door.y, p.x, p.y) < 110 * 110) {
        state.prompt = 'Solano Customs — repaint & repair';
        if (pressed('KeyE')) openShop(state, s);
        return;
      }
    }
    if (!state.race.active && dist2(city.raceStart.x, city.raceStart.y, p.x, p.y) < 84 * 84) {
      state.prompt = 'Start the Harbour Run — $' + PRICES.racePrize + ' prize';
      if (pressed('KeyE')) startRace(state);
      return;
    }
    if (!state.race.active && dist2(city.race2Start.x, city.race2Start.y, p.x, p.y) < 84 * 84) {
      state.prompt = 'Start the Isla Loop — $' + PRICES.race2Prize + ' prize';
      if (pressed('KeyE')) startRace2(state);
      return;
    }
    state.prompt = 'Exit ' + car.def.name;
    if (pressed('KeyE')) exitCar(state);
    return;
  }

  const boat = nearestBoat(state, 62);
  if (boat) {
    state.prompt = 'Board the ' + boat.def.name;
    if (pressed('KeyE')) enterBoat(state, boat);
    return;
  }
  const car = nearestCar(state, 54);
  if (car) {
    state.prompt = 'Enter ' + car.def.name;
    if (pressed('KeyE')) enterCar(state, car);
    return;
  }
  for (const s of city.shops) {
    if (s.type === 'customs') continue;
    if (dist2(s.door.x, s.door.y, p.x, p.y) < 58 * 58) {
      state.prompt = s.name;
      if (pressed('KeyE')) openShop(state, s);
      return;
    }
  }
  if (!state.courier.active) {
    for (const s of city.courierSpots) {
      if (dist2(s.x, s.y, p.x, p.y) < 52 * 52) {
        state.prompt = 'Courier — pick up a package';
        if (pressed('KeyE')) startCourier(state, s);
        return;
      }
    }
  }
  if (dist2(city.safehouse.door.x, city.safehouse.door.y, p.x, p.y) < 58 * 58) {
    state.prompt = 'Casa de Dario — save & rest';
    if (pressed('KeyE')) {
      p.hp = p.maxHp;
      state.saveGame();
      state.floaters.push({ x: p.x, y: p.y - 26, text: 'Guardado — game saved', life: 1.8, color: '#57e389' });
      if (state.audio) state.audio.heal();
    }
  }
}

// ------------------------------------------------------------------- shop
function openShop(state, shop) {
  state.shopOpen = shop;
  const p = state.player;
  const items = [];
  if (shop.type === 'gun') {
    for (const w of ['pistol', 'smg', 'shotgun', 'rifle']) {
      const def = WEAPONS[w];
      if (!p.owned[w]) items.push({ label: def.name, price: PRICES[w], act: () => { p.owned[w] = true; p.weapon = w; p.ammo[def.ammoKey] += 12; } });
      items.push({
        label: 'Balas — ' + def.name + ' x' + PRICES.ammoPack[def.ammoKey], price: PRICES['ammo' + cap(def.ammoKey)],
        act: () => { p.ammo[def.ammoKey] += PRICES.ammoPack[def.ammoKey]; },
      });
    }
    if (p.armor < PRICES.armorMax) items.push({ label: 'Chaleco antibalas — body armour', price: PRICES.armor, act: () => { p.armor = PRICES.armorMax; } });
    else items.push({ label: 'Chaleco antibalas — already wearing one', price: 0, disabled: true, act: () => {} });
  } else if (shop.type === 'food') {
    items.push({ label: 'Comida — restores ' + PRICES.healAmount + ' health', price: PRICES.food, act: () => { p.hp = Math.min(p.maxHp, p.hp + PRICES.healAmount); if (state.audio) state.audio.heal(); } });
  } else if (shop.type === 'customs') {
    const car = p.inCar;
    if (car) {
      items.push({
        label: 'Repaint — new colour, Patrulla loses you', price: PRICES.repaint,
        act: () => { car.color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); clearHeat(state); },
      });
      const missing = Math.ceil(car.maxHp - car.hp);
      if (missing > 0) items.push({ label: 'Repair — ' + missing + ' points', price: missing * PRICES.repairPerPoint, act: () => { car.hp = car.maxHp; } });
      else items.push({ label: 'Repair — bodywork is perfect', price: 0, disabled: true, act: () => {} });
    }
  }
  renderShop(state, shop, items);
  state.shopItems = items;
  if (state.audio) state.audio.uiClick();
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function renderShop(state, shop, items) {
  $('shopTitle').textContent = shop.name;
  $('shopCash').textContent = 'Your cash: $' + state.player.cash;
  const box = $('shopItems');
  box.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'shopItem';
    b.disabled = !!it.disabled || state.player.cash < it.price;
    b.innerHTML = '<span>' + it.label + '</span><span class="price">$' + it.price + '</span>';
    b.addEventListener('click', () => {
      if (state.player.cash < it.price) return;
      state.player.cash -= it.price;
      it.act();
      if (state.audio) state.audio.cash();
      openShop(state, shop); // re-render with the new balance
    });
    box.appendChild(b);
  }
  $('shop').classList.remove('hidden');
}

function closeShop(state) {
  state.shopOpen = null;
  $('shop').classList.add('hidden');
}

// -------------------------------------------------------------------- HUD
let lastStars = -1;
function updateHUD(state) {
  const p = state.player;
  $('cash').textContent = '$' + p.cash;
  const hh = Math.floor(state.clock), mm = Math.floor((state.clock - hh) * 60);
  $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (p.inCar ? ' · ' + p.inCar.def.name : (p.inBoat ? ' · ' + p.inBoat.def.name : ''));
  $('packages').textContent = '📦 ' + state.packagesFound.size + ' / ' + state.city.packages.length + ' paquetes';
  if (state.wanted.stars !== lastStars) {
    lastStars = state.wanted.stars;
    $('stars').innerHTML = [1, 2, 3, 4, 5].map((i) => '<span class="' + (i <= lastStars ? 'on' : '') + '">★</span>').join('');
  }
  $('districtTag').textContent = state.district ? state.district.name : '';
  $('healthbar').style.width = clamp((p.hp / p.maxHp) * 100, 0, 100) + '%';
  $('armorbar').style.width = clamp((p.armor / PRICES.armorMax) * 100, 0, 100) + '%';
  $('radio').textContent = (state.radioT > 0 || p.inCar || p.inBoat) ? '📻 ' + state.audio.stationName() : '';
  const def = WEAPONS[p.weapon];
  $('weapon').innerHTML = def.name + (def.ammoKey ? ' · <span>' + p.ammo[def.ammoKey] + ' balas</span>' : '');
  $('hurt').style.opacity = state.hurtT.toFixed(2);

  // objective line: race, taxi and courier outrank the story
  let obj = '';
  if (state.race.active) obj = '🏁 ' + state.race.name + ' — checkpoint ' + (state.race.next + 1) + '/' + state.race.checkpoints.length + ' · ' + Math.ceil(state.race.timeLeft) + 's';
  else if (state.taxi.active) obj = state.taxi.phase === 'pickup' ? '🚕 Pick up the fare' : '🚕 Drive to ' + (state.taxi.dest ? state.taxi.dest.name : '');
  else if (state.courier.active) obj = '📦 Deliver to ' + state.courier.destName + ' · ⏱ ' + Math.max(0, Math.ceil(state.courier.timeLeft)) + 's';
  else if (state.story.phase === 'active') {
    obj = '◆ ' + state.mission.objective;
    const m = currentMission(state.story);
    if (m && (m.objective.type === 'checkpoints' || (m.objective.type === 'timed' && state.story.step === 1))) {
      obj += ' · ⏱ ' + Math.max(0, Math.ceil(state.story.timer)) + 's';
    }
  } else if (state.mission.objective) obj = state.mission.objective;
  $('objective').textContent = obj;
  $('prompt').innerHTML = state.prompt ? '<b>E</b>' + state.prompt : '';

  if (state.banner) {
    $('bannerTitle').textContent = state.banner.title;
    $('bannerSub').textContent = state.banner.sub || '';
    $('banner').classList.add('show');
  } else $('banner').classList.remove('show');

  if (state.districtT > 0 && state.district) {
    $('districtName').textContent = state.district.name;
    $('districtSub').textContent = state.district.sub;
    $('district').classList.add('show');
  } else $('district').classList.remove('show');

  state.minimap.draw(mmCtx, state, 0, 0, 184);
}

// --------------------------------------------------------------- dialogue
function showDialogue(state) {
  const d = state.dialogue;
  if (!d) { $('dialogue').classList.add('hidden'); return; }
  const line = d.lines[d.idx];
  $('dlgWho').textContent = line.who;
  $('dlgText').textContent = line.text;
  $('dialogue').classList.remove('hidden');
}

function advanceDialogue(state) {
  const d = state.dialogue;
  if (!d) return;
  d.idx++;
  if (state.audio) state.audio.uiClick();
  if (d.idx >= d.lines.length) {
    state.dialogue = null;
    $('dialogue').classList.add('hidden');
    if (d.onDone === 'mission-start') activateMission(state);
    else if (d.onDone === 'mission-reward') rewardMission(state);
  } else showDialogue(state);
}

// ------------------------------------------------------------------- loop
let state = freshState();
let lastTs = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  step(dt);
  drawWorld(ctx, state);
  if (state.mode !== 'title') updateHUD(state);
}

function step(dt) {
  const p = state.player;
  if (state.driver) { state.driver.update(state.time); }
  if (pressed('KeyM')) {
    const muted = state.audio.toggleMute();
    state.floaters.push({ x: p.x, y: p.y - 26, text: muted ? 'Silencio' : 'Sonido', life: 1, color: '#fff' });
  }

  if (state.mode === 'title') {
    state.time += dt;
    if (!state.shotMode) {
      // a slow drift over the bay while the title is up
      state.camera.x = state.city.spots.island.x - state.camera.w / 2 + Math.sin(state.time * 0.05) * 160;
      state.camera.y = 222 * TILE - state.camera.h / 2 + Math.cos(state.time * 0.04) * 40;
    }
    state.darkness = darknessFor(state.clock);
    postUpdate();
    return;
  }
  if (state.mode === 'downed' || state.mode === 'arrested') { postUpdate(); return; }
  if (pressed('Escape', 'KeyP') && state.mode === 'play' && !state.shopOpen && !state.dialogue) {
    state.mode = 'pause';
    $('pause').classList.remove('hidden');
    postUpdate();
    return;
  }
  if (state.mode === 'pause') { postUpdate(); return; }

  // ---- play mode
  state.time += dt;
  state.clock = (state.clock + (dt * 24) / DAY_LENGTH) % 24;
  updateWeather(state, dt);
  state.darkness = Math.min(0.66, darknessFor(state.clock) + state.weather.wet * 0.1);
  state.hurtT = Math.max(0, state.hurtT - dt * 1.6);
  if (state.banner) { state.banner.t -= dt; if (state.banner.t <= 0) state.banner = null; }
  if (state.districtT > 0) state.districtT -= dt;

  // dialogue and shops freeze the world
  if (state.dialogue) {
    showDialogue(state);
    if (pressed('KeyE', 'Space') || state.uiClick) { state.uiClick = false; advanceDialogue(state); }
    postUpdate();
    return;
  }
  if (state.shopOpen) {
    if (pressed('KeyE', 'Escape')) closeShop(state);
    postUpdate();
    return;
  }

  state.startT += dt;
  state.uiClick = false; // clicks only advance dialogue; never leak into play
  // the intro call comes seconds after a new game begins
  if (state.story.index === 0 && state.story.phase === 'idle' && state.startT > 0.9 && !state.story.kickedOff) {
    state.story.kickedOff = true;
    startMission(state);
    showDialogue(state);
  }

  updatePlayer(state, dt);
  // traffic thinks for itself; parked and mission cars just settle
  for (const car of state.cars) {
    if (car === p.inCar || car.kind === 'police') continue;
    if (car.kind === 'traffic') stepVehicle(state, car, trafficControl(state, car, dt), dt);
    else stepVehicle(state, car, { throttle: 0, steer: 0, handbrake: true }, dt);
  }
  collideCars(state, dt);
  spawnAmbient(state, dt);
  updatePeds(state, dt);
  updateBoats(state, dt);
  updateBullets(state, dt);
  updateParticles(state, dt);
  updatePickups(state, dt);
  updateWanted(state, dt);
  updatePolice(state, dt);
  updateMission(state, dt);
  updateTaxi(state, dt);
  updateRace(state, dt);
  updateCourier(state, dt);
  collectPackages(state);
  scanInteractions(state);

  // weapon keys
  for (let i = 0; i < WEAPON_ORDER.length; i++) {
    if (pressed('Digit' + (i + 1)) && p.owned[WEAPON_ORDER[i]]) {
      p.weapon = WEAPON_ORDER[i];
      if (state.audio) state.audio.uiClick();
    }
  }

  // radio: R or ] tunes up a station, [ tunes down; the name flashes
  if (pressed('KeyR', 'BracketRight')) { state.audio.nextStation(); state.radioT = 2.6; }
  if (pressed('BracketLeft')) { state.audio.prevStation(); state.radioT = 2.6; }
  if (state.radioT > 0) state.radioT -= dt;

  // floaters rise and fade
  for (const f of state.floaters) { f.y -= 26 * dt; f.life -= dt; }
  state.floaters = state.floaters.filter((f) => f.life > 0);

  // camera follows, a touch of lead at speed
  const pv = p.inCar || p.inBoat;
  const lead = pv ? 0.22 : 0;
  const tx = clamp(p.x + (pv ? pv.vx * lead : 0) - state.camera.w / 2, 0, WORLD_PX - state.camera.w);
  const ty = clamp(p.y + (pv ? pv.vy * lead : 0) - state.camera.h / 2, 0, WORLD_PX - state.camera.h);
  state.camera.x += (tx - state.camera.x) * Math.min(1, dt * 7);
  state.camera.y += (ty - state.camera.y) * Math.min(1, dt * 7);

  // district flash on crossing a border
  const d = state.city.districtAt(p.x, p.y);
  if (!state.district || state.district.id !== d.id) {
    if (state.district && state.startT > 2) state.districtT = 2.6;
    state.district = d;
  }

  // audio: engine, siren, rain, music state
  const inCar = p.inCar;
  let nearestCop = Infinity;
  for (const c of state.cars) if (c.kind === 'police' && !c.dead) nearestCop = Math.min(nearestCop, Math.hypot(c.x - p.x, c.y - p.y));
  state.audio.update(dt, {
    engine: inCar ? clamp(carSpeed(inCar) / inCar.def.topSpeed, 0, 1)
      : (p.inBoat ? clamp(Math.abs(p.inBoat.speed) / p.inBoat.def.topSpeed, 0, 1) : null),
    siren: nearestCop < 720,
    sirenDist: nearestCop === Infinity ? 0 : clamp(1 - nearestCop / 720, 0, 1),
    rain: state.weather.wet,
  });

  postUpdate();
}

function collectPackages(state) {
  const p = state.player;
  for (const pk of state.city.packages) {
    if (state.packagesFound.has(pk.id)) continue;
    if (dist2(pk.x, pk.y, p.x, p.y) < 32 * 32) {
      state.packagesFound.add(pk.id);
      p.cash += PRICES.packageReward;
      spawnParticles(state, 'cash', pk.x, pk.y, 10);
      if (state.audio) state.audio.pickup();
      state.floaters.push({ x: pk.x, y: pk.y - 20, text: '¡Paquete! +$' + PRICES.packageReward + ' (' + state.packagesFound.size + '/20)', life: 1.8, color: '#ffd23e' });
      if (state.packagesFound.size === 20) {
        p.cash += 500;
        state.banner = { title: '¡Todos los paquetes!', sub: 'All 20 hidden packages — bonus $500', t: 4 };
      }
    }
  }
}

function darknessFor(clock) {
  const sun = Math.sin(((clock - 6) / 12) * Math.PI);
  return clamp(0.58 - sun * 0.75, 0, 0.58);
}

// --------------------------------------------------------------- weather
// The bay has moods: every few minutes a rain band rolls in off the
// water for a minute or so. Purely atmospheric — streaks and sheen in
// render.js, a noise wash in audio.js, a darker sky here — but the
// streets feel different wet.
function updateWeather(state, dt) {
  const w = state.weather;
  if (w.raining) {
    w.leftT -= dt;
    w.wet = Math.min(1, w.wet + dt / 6);
    if (w.leftT <= 0) { w.raining = false; w.nextT = 150 + Math.random() * 180; }
  } else {
    w.wet = Math.max(0, w.wet - dt / 10);
    w.nextT -= dt;
    if (w.nextT <= 0) {
      w.raining = true;
      w.leftT = 45 + Math.random() * 45;
      state.floaters.push({ x: state.player.x, y: state.player.y - 30, text: '🌧 Lluvia sobre la bahía…', life: 2.4, color: '#9fc6e8' });
    }
  }
}

// -------------------------------------------------------------------- boot
function startGame(withSave) {
  state = freshState();
  if (withSave) loadSave(state);
  state.mode = 'play';
  state.startT = 0;
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('pause').classList.add('hidden');
  $('endcard').classList.add('hidden');
  state.audio.unlock();
}

function boot() {
  initInput(canvas);
  $('btnContinue').disabled = !hasSave();
  $('btnNew').addEventListener('click', () => startGame(false));
  $('btnContinue').addEventListener('click', () => startGame(true));
  $('btnResume').addEventListener('click', () => { state.mode = 'play'; $('pause').classList.add('hidden'); });
  $('btnRestart').addEventListener('click', () => startGame(false));
  $('btnEndOk').addEventListener('click', () => { state.mode = 'play'; $('endcard').classList.add('hidden'); });
  canvas.addEventListener('mousedown', () => { state.audio.unlock(); state.uiClick = true; });
  window.addEventListener('keydown', () => state.audio.unlock(), { once: true });
  // pause overlay can also be left with Esc
  window.addEventListener('keydown', (e) => {
    if ((e.code === 'Escape' || e.code === 'KeyP') && state.mode === 'pause') {
      state.mode = 'play';
      $('pause').classList.add('hidden');
    }
  });

  // screenshot scenes: ?shot=drive etc. pose the real game
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot) {
    state.mode = shot === 'start' ? 'title' : 'play';
    if (shot !== 'start') { $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); }
    setupShot(state, shot);
    state.driver = createShotDriver(state, shot);
    input.scripted = state.driver.input;
    state.startT = 99; // no intro call during a shoot
    if (shot !== 'start') state.story.kickedOff = true;
  }
  requestAnimationFrame(frame);
}

boot();
