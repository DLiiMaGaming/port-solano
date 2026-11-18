// PORT SOLANO — game state, the fixed-step simulation, interactions, shops, saving, and
// (at the bottom, browser-only) the boot and HUD wiring. The simulation half is pure: it
// imports no DOM API and runs under Node for the headless harness, which drives
// createGame + stepGame with fabricated input objects.
//
// Flags contract: stepGame and the systems set one-shot notices on state.flags
// (missionDone, taxiFare, starUp, ...). The browser layer reads them after each frame
// and clears state.flags at the start of the next; the harness just reads them.

import {
  STEP, MAX_FRAME, CLOCK, MONEY, WEAPONS, WEAPON_ORDER, AMMO_PACK, ARMOR_PRICE,
  CAR_TYPES, BOAT_TYPES, CAR_COLORS, SAVE_KEY, DISTRICTS,
} from './config.js';
import { createRandom } from './random.js';
import { generateCity } from './citygen.js';
import {
  clamp, dist, createPlayer, createPed, createCar, createBoat, nearestVehicle,
  collideMove, isWalkableTile, updatePlayer, updatePlayerVehicle, updateTraffic,
  updatePeds, updateBullets, updateParticles, resolveVehicleCollisions,
  maintainTraffic, maintainPeds,
} from './entities.js';
import { createWanted, updateWanted, clearHeat } from './police.js';
import {
  createStory, createJobs, updateStory, updateJobs, updateDialogue, failMission,
  startRace, startCourier,
} from './missions.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { createMinimap } from './minimap.js';
import { stageShot } from './shots.js';

// ---------------------------------------------------------------------------
// State

export function createGame(seed, audio) {
  const city = generateCity(seed);
  const rng = createRandom((seed ^ 0x5eed) >>> 0);
  const state = {
    seed, city, rng,
    audio: audio || createAudio(),
    time: 0,
    tod: CLOCK.startMinute,
    player: createPlayer(city.spots.spawn.x, city.spots.spawn.y),
    cash: MONEY.startCash,
    armor: 0,
    weaponsOwned: { pistol: false, smg: false, shotgun: false, rifle: false },
    ammo: { pistol: 0, smg: 0, shotgun: 0, rifle: 0 },
    weapon: 'fists',
    cars: [], peds: [], boats: [], bullets: [], particles: [], skids: [], floaters: [],
    vehicle: null, ownCar: null, ownBoat: null,
    wanted: createWanted(),
    story: createStory(),
    jobs: createJobs(),
    crimes: [], flags: {},
    dialogue: null, menu: null, menuCar: null,
    marker: null, objectiveText: '',
    district: city.districtAtPx(city.spots.spawn.x, city.spots.spawn.y),
    weather: { rain: 0, left: 0, nextIn: rng.range(120, 240) },
    lastShot: null,
    over: null,
    packagesFound: 0,
    ambientT: 0, fixtureT: 0,
    fixtures: [],
  };
  for (const pc of city.parkedCars) {
    state.cars.push(createCar(pc.type, pc.x, pc.y, pc.angle, pc.color, 'parked'));
  }
  for (const bs of city.spots.boatSpots) {
    state.boats.push(createBoat(bs.type, bs.x, bs.y, bs.angle, '#e8e6df', 'moored'));
  }
  state.fixtures = [
    { spot: 'marisol', name: 'Marisol Vega', shirt: '#b03060', ped: null },
    { spot: 'safehouse', name: 'Darío', shirt: '#37474f', ped: null },
  ];
  maintainFixtures(state);
  for (let i = 0; i < 26; i += 1) { maintainTraffic(state); maintainPeds(state); }
  return state;
}

export function addFloater(state, x, y, text, color = '#ffd23e', size = 19) {
  state.floaters.push({ x, y, text, color, size, t: 0, maxLife: 2.2 });
}

// ---------------------------------------------------------------------------
// Interactions (the E key) and shops

function findShoreExit(state, boat) {
  for (let r = 20; r <= 64; r += 10) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const x = boat.x + Math.cos(a) * r;
      const y = boat.y + Math.sin(a) * r;
      if (isWalkableTile(state.city.tileAtPx(x, y))) return { x, y };
    }
  }
  return null;
}

export function interact(state) {
  const p = state.player;
  if (state.dialogue || state.over) return;
  if (state.menu) { state.menu = null; state.audio?.sfx('exit'); return; }

  if (state.vehicle) {
    const veh = state.vehicle;
    // At a race start, E means "race", not "get out".
    if (veh.kind === 'car' && !state.jobs.race.active) {
      if (dist(p.x, p.y, state.city.spots.raceHarbour.x, state.city.spots.raceHarbour.y) < 62) {
        if (startRace(state, 'harbour')) return;
      }
      if (dist(p.x, p.y, state.city.spots.raceIsla.x, state.city.spots.raceIsla.y) < 62) {
        if (startRace(state, 'isla')) return;
      }
    }
    if (veh.kind === 'boat') {
      const shore = findShoreExit(state, veh);
      if (!shore) {
        addFloater(state, p.x, p.y - 30, 'Too far from shore to step out', '#ff9a8a', 16);
        state.audio?.sfx('error');
        return;
      }
      p.x = shore.x;
      p.y = shore.y;
    } else {
      // Step out beside the car, on whichever side is free.
      const temp = { x: veh.x, y: veh.y };
      const side = Math.PI / 2;
      let placed = false;
      for (const s of [1, -1]) {
        temp.x = veh.x;
        temp.y = veh.y;
        const dx = Math.cos(veh.angle + side * s) * (veh.radius + 20);
        const dy = Math.sin(veh.angle + side * s) * (veh.radius + 20);
        if (!collideMove(state.city, temp, dx, dy, p.radius, 'land')) {
          p.x = temp.x;
          p.y = temp.y;
          placed = true;
          break;
        }
      }
      if (!placed) { p.x = veh.x + veh.radius + 22; p.y = veh.y; }
    }
    veh.driver = null;
    state.vehicle = null;
    state.audio?.sfx('exit');
    return;
  }

  // On foot, near something with a door?
  const spots = state.city.spots;
  if (dist(p.x, p.y, spots.gunshop.x, spots.gunshop.y) < 58) {
    state.menu = 'gun';
    state.audio?.sfx('enter');
    return;
  }
  if (dist(p.x, p.y, spots.customs.x, spots.customs.y) < 64) {
    let best = null;
    let bestD = 130;
    for (const car of state.cars) {
      if (car.dead) continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (best) {
      state.menu = 'customs';
      state.menuCar = best;
      state.audio?.sfx('enter');
      return;
    }
  }
  if (dist(p.x, p.y, spots.safehouse.x, spots.safehouse.y) < 58) {
    p.hp = 100;
    persistSave(state);
    addFloater(state, p.x, p.y - 34, 'Saved at Casa de Darío — wounds tended', '#7dff8a', 17);
    state.audio?.sfx('win');
    return;
  }
  for (const spot of spots.courierSpots) {
    if (dist(p.x, p.y, spot.x, spot.y) < 54) {
      if (startCourier(state)) {
        addFloater(state, p.x, p.y - 34, 'Package picked up — move!', '#2ed3ff', 17);
        return;
      }
    }
  }
  // Into the nearest vehicle.
  const veh = nearestVehicle(state, p.x, p.y, 64);
  if (veh) {
    veh.driver = p;
    state.vehicle = veh;
    p.x = veh.x;
    p.y = veh.y;
    if (veh.kind === 'car') {
      if (state.ownCar !== veh) state.crimes.push({ kind: 'theft', x: veh.x, y: veh.y });
      state.ownCar = veh;
      state.audio?.sfx('enter');
    } else {
      if (state.ownBoat !== veh) state.crimes.push({ kind: 'theft', x: veh.x, y: veh.y });
      state.ownBoat = veh;
      state.audio?.sfx('splash', { vol: 0.5 });
    }
  }
}

// --- Shop operations (also called by the harness) ---------------------------

export function buyWeapon(state, key) {
  const spec = WEAPONS[key];
  if (!spec || state.weaponsOwned[key]) return false;
  if (state.cash < spec.price) { state.audio?.sfx('error'); return false; }
  state.cash -= spec.price;
  state.weaponsOwned[key] = true;
  state.ammo[key] = (state.ammo[key] || 0) + AMMO_PACK;
  state.weapon = key;
  state.audio?.sfx('buy');
  return true;
}

export function buyAmmo(state, key) {
  const spec = WEAPONS[key];
  if (!spec || !state.weaponsOwned[key]) return false;
  if (state.cash < spec.ammoPrice) { state.audio?.sfx('error'); return false; }
  state.cash -= spec.ammoPrice;
  state.ammo[key] += AMMO_PACK;
  state.audio?.sfx('buy');
  return true;
}

export function buyArmor(state) {
  if (state.armor >= 100) return false;
  const cost = Math.max(40, Math.ceil(((100 - state.armor) / 100) * ARMOR_PRICE));
  if (state.cash < cost) { state.audio?.sfx('error'); return false; }
  state.cash -= cost;
  state.armor = 100;
  state.audio?.sfx('buy');
  return true;
}

export function repaintCar(state, car, color) {
  if (!car || state.cash < MONEY.repaintPrice) { state.audio?.sfx('error'); return false; }
  state.cash -= MONEY.repaintPrice;
  car.color = color;
  state.audio?.sfx('buy');
  return true;
}

export function repairCar(state, car) {
  if (!car) return false;
  const missing = car.maxHp - car.hp;
  if (missing <= 0) return false;
  const cost = Math.ceil(missing * MONEY.repairPerHp);
  if (state.cash < cost) { state.audio?.sfx('error'); return false; }
  state.cash -= cost;
  car.hp = car.maxHp;
  car.dead = false;
  state.audio?.sfx('buy');
  return true;
}

// ---------------------------------------------------------------------------
// Save / load

export function serializeSave(state) {
  const veh = state.vehicle;
  return {
    v: 1,
    cash: state.cash,
    armor: state.armor,
    weaponsOwned: state.weaponsOwned,
    ammo: state.ammo,
    weapon: state.weapon,
    storyIndex: state.story.index,
    storyComplete: state.story.complete,
    packages: state.city.packages.filter((pk) => pk.taken).map((pk) => pk.id),
    tod: state.tod,
    player: { x: state.player.x, y: state.player.y },
    vehicle: veh ? { kind: veh.kind, type: veh.type, color: veh.color, x: veh.x, y: veh.y, angle: veh.angle, hp: veh.hp } : null,
  };
}

export function applySave(state, data) {
  if (!data) return;
  state.cash = data.cash ?? state.cash;
  state.armor = data.armor ?? 0;
  Object.assign(state.weaponsOwned, data.weaponsOwned || {});
  Object.assign(state.ammo, data.ammo || {});
  state.weapon = data.weapon || 'fists';
  state.story.index = data.storyIndex || 0;
  state.story.complete = !!data.storyComplete;
  state.tod = data.tod ?? state.tod;
  for (const id of data.packages || []) {
    const pkg = state.city.packages[id];
    if (pkg && !pkg.taken) { pkg.taken = true; state.packagesFound += 1; }
  }
  if (data.player) { state.player.x = data.player.x; state.player.y = data.player.y; }
  if (data.vehicle) {
    const v = data.vehicle;
    const veh = v.kind === 'boat'
      ? createBoat(v.type, v.x, v.y, v.angle, v.color, 'moored')
      : createCar(v.type, v.x, v.y, v.angle, v.color, 'parked');
    veh.hp = v.hp;
    if (v.kind === 'boat') { state.boats.push(veh); state.ownBoat = veh; }
    else { state.cars.push(veh); state.ownCar = veh; }
    veh.driver = state.player;
    state.vehicle = veh;
    state.player.x = veh.x;
    state.player.y = veh.y;
  }
}

export function persistSave(state) {
  if (state.flags.noSave) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(serializeSave(state)));
  } catch { /* storage off: the visit is the save */ }
}

export function loadSaveData() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Fixtures: the two story contacts are permanent residents of their spots.

function maintainFixtures(state) {
  for (const f of state.fixtures) {
    if (f.ped && !f.ped.dead && state.peds.includes(f.ped)) continue;
    const spot = state.city.spots[f.spot];
    f.ped = createPed(state.rng, spot.x + 14, spot.y + 8, 'contact', { name: f.name, shirt: f.shirt });
    state.peds.push(f.ped);
  }
}

// ---------------------------------------------------------------------------
// The step

function beginOver(state, kind) {
  if (state.story.phase === 'active' || state.story.phase === 'intro') failMission(state);
  state.over = { kind, t: 2.4, bill: 0 };
  state.audio?.sfx(kind === 'busted' ? 'busted' : 'downed');
}

function finishOver(state) {
  const p = state.player;
  const over = state.over;
  state.over = null;
  clearHeat(state);
  state.vehicle = null;
  if (over.kind === 'busted') {
    over.bill = Math.min(state.cash, MONEY.bustFine);
    state.cash -= over.bill;
    p.x = state.city.spots.police.x + 10;
    p.y = state.city.spots.police.y + 26;
    state.flags.arrested = over.bill;
  } else {
    over.bill = Math.min(state.cash, MONEY.hospitalBill);
    state.cash -= over.bill;
    p.hp = 100;
    p.dead = false;
    p.x = state.city.spots.hospital.x + 10;
    p.y = state.city.spots.hospital.y + 26;
    state.flags.hospitalBill = over.bill;
  }
  state.armor = 0;
}

function updateWeather(state, dt) {
  const w = state.weather;
  if (w.left > 0) {
    w.left -= dt;
    w.rain = Math.min(1, w.rain + dt * 0.12);
  } else {
    w.rain = Math.max(0, w.rain - dt * 0.1);
    w.nextIn -= dt;
    if (w.nextIn <= 0) {
      w.left = state.rng.range(45, 90);
      w.nextIn = state.rng.range(150, 330);
      addFloater(state, state.player.x, state.player.y - 44, '🌧 Lluvia sobre la bahía…', '#bcd8ea', 16);
    }
  }
}

function updateAudioEnv(state, dt) {
  const audio = state.audio;
  if (!audio || !audio.update) return;
  let siren = 0;
  for (const car of state.cars) {
    if (car.role !== 'cop' || car.dead) continue;
    const d = dist(state.player.x, state.player.y, car.x, car.y);
    siren = Math.max(siren, clamp(1 - d / 720, 0, 1));
  }
  if (state.wanted.heli) siren = Math.max(siren, 0.35);
  if (state.wanted.policeBoat && !state.wanted.policeBoat.dead) siren = Math.max(siren, 0.3);
  const veh = state.vehicle;
  let load = 0;
  if (veh) {
    const spec = veh.kind === 'boat' ? BOAT_TYPES[veh.type] : CAR_TYPES[veh.type];
    load = clamp(Math.abs(veh.speed) / spec.top, 0, 1);
  }
  audio.update(dt, {
    inVehicle: !!veh,
    engineLoad: load,
    engineRpm: load,
    siren,
    raining: state.weather.rain > 0.35,
    radioAudible: !!veh,
  });
}

export function stepGame(state, input, dt) {
  state.time += dt;
  state.tod = (state.tod + CLOCK.minutesPerSecond * dt) % CLOCK.dayMinutes;

  // Floaters always drift, whatever else is frozen.
  for (let i = state.floaters.length - 1; i >= 0; i -= 1) {
    state.floaters[i].t += dt;
    if (state.floaters[i].t > state.floaters[i].maxLife) state.floaters.splice(i, 1);
  }

  if (state.over) {
    state.over.t -= dt;
    updateParticles(state, dt);
    if (state.over.t <= 0) finishOver(state);
    return;
  }
  if (state.dialogue) {
    updateDialogue(state, input, dt);
    updateParticles(state, dt);
    return;
  }
  if (state.menu) {
    if (input.interact || input.pause) state.menu = null;
    return;
  }

  if (input.interact) interact(state);
  if (state.menu) return; // an interaction just opened a shop
  if (input.mute) state.audio?.toggleMute();
  if (input.radioNext || input.radioPrev) {
    const audio = state.audio;
    if (audio && state.vehicle) {
      const next = (audio.stationIndex() + (input.radioNext ? 1 : 2)) % 3;
      const name = audio.setStation(next);
      addFloater(state, state.player.x, state.player.y - 40, `📻 ${name}`, '#ffe9b0', 17);
      audio.sfx('radio');
    }
  }
  if (input.fire && state.weapon !== 'fists') {
    state.lastShot = { x: state.player.x, y: state.player.y, t: state.time };
  }

  if (state.vehicle) updatePlayerVehicle(state, input, dt);
  else updatePlayer(state, input, dt);

  updateTraffic(state, dt);
  updatePeds(state, dt);
  updateWanted(state, dt);
  resolveVehicleCollisions(state);
  updateBullets(state, dt);
  updateParticles(state, dt);
  updateStory(state, input, dt);
  updateJobs(state, dt);
  updateWeather(state, dt);

  state.ambientT -= dt;
  if (state.ambientT <= 0) {
    state.ambientT = 0.45;
    maintainTraffic(state);
    maintainPeds(state);
  }
  state.fixtureT -= dt;
  if (state.fixtureT <= 0) {
    state.fixtureT = 1.5;
    maintainFixtures(state);
  }

  // Hidden packages.
  if (!state.vehicle) {
    for (const pkg of state.city.packages) {
      if (pkg.taken) continue;
      if (dist(state.player.x, state.player.y, pkg.x, pkg.y) < 30) {
        pkg.taken = true;
        state.packagesFound += 1;
        state.cash += 25;
        addFloater(state, pkg.x, pkg.y - 20, `+$25 — package ${state.packagesFound}/20`, '#ffd23e', 17);
        state.audio?.sfx('pickup');
      }
    }
  }

  // Job and story notices become floaters.
  const f = state.flags;
  if (f.taxiFare) addFloater(state, state.player.x, state.player.y - 36, `Taxi fare +$${f.taxiFare}`, '#7dff8a');
  if (f.courierPaid) addFloater(state, state.player.x, state.player.y - 36, `Courier +$${f.courierPaid}`, '#7dff8a');
  if (f.raceWon) addFloater(state, state.player.x, state.player.y - 36, `${f.raceWon.name} — +$${f.raceWon.prize}`, '#7dff8a');
  if (f.missionDone) persistSave(state);

  // District crossings.
  const dNow = state.city.districtAtPx(state.player.x, state.player.y);
  if (dNow !== state.district) {
    state.district = dNow;
    addFloater(state, state.player.x, state.player.y - 52, DISTRICTS[dNow], '#ffffff', 22);
  }

  // Death and arrest land last, so a mission fails exactly once.
  if (state.player.dead) beginOver(state, 'downed');
  else if (state.flags.busted) beginOver(state, 'busted');

  updateAudioEnv(state, dt);
}

// ---------------------------------------------------------------------------
// Browser boot and HUD wiring. Everything above this line is DOM-free.

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const shotName = params.get('shot');
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const gameSeed = Number.isInteger(seedParam) ? seedParam : 20261124;

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const els = {
    cash: $('cash'), clock: $('clock'), district: $('district'), stars: $('stars'),
    hpFill: $('hp-fill'), armorFill: $('armor-fill'), weapon: $('weapon'),
    packages: $('packages'), objective: $('objective'), radio: $('radio'),
    bustWrap: $('bust-wrap'), bustFill: $('bust-fill'),
    dialogue: $('dialogue'), dlgWho: $('dlg-who'), dlgText: $('dlg-text'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    title: $('title'), pause: $('pause'), over: $('over'),
    overTitle: $('over-title'), overSub: $('over-sub'),
    shop: $('shop'), shopTitle: $('shop-title'), shopItems: $('shop-items'), shopCash: $('shop-cash'),
    status: $('status'),
    btnNew: $('btn-new'), btnContinue: $('btn-continue'),
  };

  let game = createGame(gameSeed);
  const renderer = createRenderer(canvas);
  const minimap = createMinimap($('minimap'), game.city);
  const input = createInput(canvas);
  input.setTransform((cx, cy) => renderer.screenToWorld(cx, cy));

  let mode = shotName ? 'shot' : 'title';
  let bannerTimer = 0;
  let builtMenu = null;
  let wasOver = false;

  function announce(message) { els.status.textContent = message; }

  function showBanner(title, sub = '', ms = 3400) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
    els.banner.classList.add('show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => els.banner.classList.remove('show'), ms);
    announce(title + (sub ? `. ${sub}` : ''));
  }

  function startNew() {
    clearSave();
    game = createGame(gameSeed);
    mode = 'play';
    els.title.classList.add('hidden');
    showBanner('PORT SOLANO', 'Find Marisol Vega — she waits by the Playa promenade.');
  }

  function startContinue() {
    const data = loadSaveData();
    game = createGame(gameSeed);
    if (data) applySave(game, data);
    mode = 'play';
    els.title.classList.add('hidden');
    showBanner('Welcome back', 'Your story in Solano continues.');
  }

  els.btnNew.addEventListener('click', () => { game.audio?.unlock(); startNew(); });
  els.btnContinue.addEventListener('click', () => { game.audio?.unlock(); startContinue(); });
  if (!loadSaveData()) els.btnContinue.disabled = true;
  $('shop-close').addEventListener('click', () => { game.menu = null; });
  canvas.addEventListener('pointerdown', () => game.audio?.unlock(), { once: true });
  window.addEventListener('keydown', () => game.audio?.unlock(), { once: true });

  // --- Shop DOM -------------------------------------------------------------
  function buildShop() {
    builtMenu = game.menu;
    els.shopItems.innerHTML = '';
    els.shopCash.textContent = `$${game.cash}`;
    const row = (label, detail, price, enabled, onBuy) => {
      const div = document.createElement('div');
      div.className = 'shop-row';
      const left = document.createElement('div');
      left.innerHTML = `<strong></strong><span></span>`;
      left.querySelector('strong').textContent = label;
      left.querySelector('span').textContent = detail;
      const btn = document.createElement('button');
      btn.textContent = price;
      btn.disabled = !enabled;
      btn.addEventListener('click', () => { onBuy(); buildShop(); syncHud(); });
      div.append(left, btn);
      els.shopItems.append(div);
    };
    if (game.menu === 'gun') {
      els.shopTitle.textContent = 'Armas Solano';
      for (const key of WEAPON_ORDER) {
        if (key === 'fists') continue;
        const spec = WEAPONS[key];
        if (!game.weaponsOwned[key]) {
          row(spec.name, `New — includes ${AMMO_PACK} rounds`, `$${spec.price}`, game.cash >= spec.price, () => buyWeapon(game, key));
        } else {
          row(`${spec.name} ammo`, `You carry ${game.ammo[key]} rounds`, `$${spec.ammoPrice}`, game.cash >= spec.ammoPrice, () => buyAmmo(game, key));
        }
      }
      row('Chaleco antibalas', game.armor >= 100 ? 'Armor is full' : `Body armor — now ${Math.round(game.armor)}%`, `$${Math.max(40, Math.ceil(((100 - game.armor) / 100) * ARMOR_PRICE))}`, game.armor < 100 && game.cash >= 40, () => buyArmor(game));
    } else if (game.menu === 'customs' && game.menuCar) {
      const car = game.menuCar;
      els.shopTitle.textContent = 'Solano Customs';
      const missing = Math.ceil(car.maxHp - car.hp);
      row('Repair', missing > 0 ? `${missing} points of damage` : 'No damage', missing > 0 ? `$${Math.ceil(missing * MONEY.repairPerHp)}` : '—', missing > 0, () => repairCar(game, car));
      for (const color of CAR_COLORS) {
        row('Repaint', 'Fresh paint, no questions', `$${MONEY.repaintPrice}`, game.cash >= MONEY.repaintPrice && car.color !== color, () => repaintCar(game, car, color));
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = color;
        els.shopItems.lastChild.querySelector('strong').prepend(swatch);
      }
    }
  }

  // --- HUD sync ---------------------------------------------------------------
  const hudCache = new Map();
  function setText(el, key, value) {
    if (hudCache.get(key) !== value) { hudCache.set(key, value); el.textContent = value; }
  }
  function syncHud() {
    setText(els.cash, 'cash', `$${game.cash}`);
    const hh = Math.floor(game.tod / 60);
    const mm = Math.floor(game.tod % 60);
    setText(els.clock, 'clock', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${DISTRICTS[game.district]}`);
    const stars = game.wanted.stars;
    setText(els.stars, 'stars', '★'.repeat(stars) + '☆'.repeat(5 - stars));
    els.stars.classList.toggle('hot', stars > 0);
    els.hpFill.style.width = `${Math.max(0, game.player.hp)}%`;
    els.armorFill.style.width = `${Math.max(0, game.armor)}%`;
    const spec = WEAPONS[game.weapon];
    setText(els.weapon, 'weapon', game.weapon === 'fists' ? 'Fists' : `${spec.name} · ${game.ammo[game.weapon]}`);
    setText(els.packages, 'packages', `📦 ${game.packagesFound} / 20 paquetes`);
    setText(els.objective, 'objective', game.objectiveText || '');
    if (game.vehicle) {
      els.radio.classList.remove('hidden');
      setText(els.radio, 'radio', `📻 ${game.audio.stationName()} — [R] cambia`);
    } else {
      els.radio.classList.add('hidden');
    }
    const bust = game.wanted.bust;
    els.bustWrap.classList.toggle('hidden', bust <= 0.02);
    if (bust > 0.02) els.bustFill.style.width = `${Math.round(bust * 100)}%`;
    if (game.dialogue) {
      const line = game.dialogue.lines[game.dialogue.i];
      els.dialogue.classList.remove('hidden');
      if (line) {
        setText(els.dlgWho, 'who', line.who);
        setText(els.dlgText, 'text', line.text);
      }
    } else {
      els.dialogue.classList.add('hidden');
    }
    // Overlays.
    els.shop.classList.toggle('hidden', !game.menu);
    if (game.menu && builtMenu !== game.menu) buildShop();
    if (!game.menu) builtMenu = null;
    if (game.over && !wasOver) {
      wasOver = true;
      const busted = game.over.kind === 'busted';
      els.overTitle.textContent = busted ? 'ARRESTED' : 'DOWNED';
      const bill = Math.min(game.cash, busted ? MONEY.bustFine : MONEY.hospitalBill);
      els.overSub.textContent = busted
        ? `The Comisaría Central keeps $${bill} for its trouble. Your record is clean — for now.`
        : `You wake up at Hospital San Solano. The bill comes to $${bill} — the bay is still out there.`;
      els.over.classList.remove('hidden');
      announce(els.overTitle.textContent);
    } else if (!game.over && wasOver) {
      wasOver = false;
      els.over.classList.add('hidden');
    }
    els.pause.classList.toggle('hidden', mode !== 'paused');
  }

  function handleFlags() {
    const f = game.flags;
    if (f.missionFailed) showBanner('MISSION FAILED', 'Return to the marker to try again.');
    if (f.missionDone) showBanner('MISSION COMPLETE', f.missionDone);
    if (f.storyComplete) showBanner('LA HISTORIA TERMINA', 'El Pulpo is finished. Solano is yours — the bay stays open.', 6000);
    if (f.raceWon) showBanner(f.raceWon.name.toUpperCase(), `Finished in ${f.raceWon.t.toFixed(1)}s — $${f.raceWon.prize} prize.`);
    if (f.raceSlow) showBanner('TOO SLOW', `${f.raceSlow} pays only inside the time. Run it again.`);
    if (f.raceLost) showBanner('RACE ABANDONED', `${f.raceLost} — the checkpoints went cold.`);
    if (f.courierFailed) showBanner('DELIVERY FAILED', 'The package is late. The spots pay again tomorrow.');
    if (f.taxiLost) showBanner('FARE LOST', 'No cab, no fare. The next passenger is already waiting.');
  }

  // --- Shot mode ---------------------------------------------------------------
  if (shotName) {
    const scene = stageShot(game, shotName, stepGame);
    game.flags = {};
    syncHud();
    els.title.classList.toggle('hidden', scene.screen !== 'title');
    let painted = 0;
    const paint = () => {
      renderer.draw(game);
      minimap.draw(game);
      painted += 1;
      if (painted < 2) requestAnimationFrame(paint);
      else window.__shotReady = true;
    };
    requestAnimationFrame(paint);
  } else {
    // --- The live loop ---------------------------------------------------------
    els.title.classList.remove('hidden');
    let accumulator = 0;
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      accumulator += Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      game.flags = {};
      if (mode === 'play') {
        let sample = input.poll(game.player);
        if (sample.pause && !game.menu && !game.dialogue) {
          mode = 'paused';
          accumulator = 0;
        } else {
          while (accumulator >= STEP && mode === 'play') {
            stepGame(game, sample, STEP);
            accumulator -= STEP;
            sample = {
              ...sample,
              interact: false, confirm: false, pause: false, weaponSlot: 0,
              radioNext: false, radioPrev: false, mute: false,
            };
          }
        }
      } else {
        accumulator = 0;
        if (mode === 'paused') {
          const sample = input.poll(game.player);
          if (sample.pause || sample.confirm) mode = 'play';
        }
      }
      handleFlags();
      renderer.draw(game);
      minimap.draw(game);
      syncHud();
    };
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && mode === 'play') mode = 'paused';
    });
  }
}
