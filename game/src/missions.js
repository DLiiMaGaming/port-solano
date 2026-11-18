// PORT SOLANO — missions.js
// The story campaign (an intro plus six chained missions for Marisol
// Vega's crew), the taxi-fare side job and the harbour street race.
// Missions are data plus a small state machine: intro dialogue → active
// objective → outro dialogue → reward. main.js renders the dialogue and
// calls updateMission every frame; markers are published on
// state.mission.marker for the world renderer and the minimap.

import { PRICES, WEAPONS } from './config.js';
import { createVehicle, createPed } from './entities.js';

// ------------------------------------------------------------- the story
export const MISSIONS = [
  {
    id: 'bienvenido', title: 'Bienvenido a Solano', giver: 'Marisol Vega', giverSpot: null,
    reward: 40,
    intro: [
      { who: 'Marisol Vega', text: '¿Sobrino? You made it. Port Solano is not much to look at from the bus terminal, I know.' },
      { who: 'Marisol Vega', text: 'Your cousin Dario has a room for you in Las Colinas — Casa de Dario. Take any car. Nobody here locks anything.' },
      { who: 'Tú', text: 'On my way, tía. This city better be worth the bus ride.' },
    ],
    objective: { type: 'goto', spot: 'darioHouse', label: 'Get to Casa de Dario in Las Colinas' },
    outro: [
      { who: 'Dario', text: '¡Primo! Look at you. Skinny, but we will fix that. Welcome home.' },
      { who: 'Dario', text: 'Rest up. Tomorrow Marisol has work — real work, the kind that pays in cash.' },
    ],
  },
  {
    id: 'coche', title: 'Un Coche para Vega', giver: 'Marisol Vega', giverSpot: 'darioHouse',
    reward: 300,
    intro: [
      { who: 'Marisol Vega', text: 'A collector in Barrio Viejo keeps a red Cargador Muscle I have already sold twice. Bring it to Solano Customs at the harbour.' },
      { who: 'Marisol Vega', text: 'Steal it quiet if you can. If the Patrulla sees you — run, and do not lead them to my door.' },
    ],
    objective: { type: 'steal', carAt: 'plaza', deliver: 'customsDock', label: 'Steal the marked Cargador and deliver it to Solano Customs' },
    outro: [
      { who: 'Marisol Vega', text: 'Beautiful. The buyer pays tonight; your cut is in your pocket already. You drive like family.' },
    ],
  },
  {
    id: 'entrega', title: 'Entrega Exprés', giver: 'Marisol Vega', giverSpot: 'harborWarehouse',
    reward: 350,
    intro: [
      { who: 'Marisol Vega', text: 'A crate at Almacén Brisa needs to reach the Hotel Mirador before the ice melts. Do not ask what is inside.' },
      { who: 'Marisol Vega', text: 'Fast, sobrino. The clock starts when the crate is in your car.' },
    ],
    objective: { type: 'timed', pickup: 'harborWarehouse', drop: 'hotel', time: 150, label: 'Rush the crate from Almacén Brisa to Hotel Mirador' },
    outro: [
      { who: 'Marisol Vega', text: 'Cold and on time. The hotel sends its thanks — and its money.' },
    ],
  },
  {
    id: 'ruido', title: 'Ruido en el Muelle', giver: 'Dario', giverSpot: 'darioHouse',
    reward: 500,
    intro: [
      { who: 'Dario', text: 'El Pulpo’s boys are squatting in his own warehouse yard, primo. They shot at our dock crew this morning.' },
      { who: 'Dario', text: 'Go to Almacén Pulpo and clear the yard. Take the pistola from Armas Solano if you have no iron. Aim well.' },
    ],
    objective: { type: 'shootout', spot: 'pulpoYard', hostiles: 5, label: 'Clear the yard at Almacén Pulpo' },
    outro: [
      { who: 'Dario', text: 'The whole harbour heard that. El Pulpo will answer — but tonight, the docks are ours.' },
    ],
  },
  {
    id: 'fuga', title: 'Fuga al Amanecer', giver: 'Dario', giverSpot: 'darioHouse',
    reward: 600,
    intro: [
      { who: 'Dario', text: 'I may have borrowed a truck from the industrial yard. And the Patrulla may have noticed. Pick me up, primo — rápido.' },
      { who: 'Dario', text: 'Get me home to Las Colinas. Lose them or outrun them, I do not care which.' },
    ],
    objective: { type: 'escape', pickup: 'industrialYard', drop: 'darioHouse', heat: 150, label: 'Pick up Dario at the industrial yard and get him home' },
    outro: [
      { who: 'Dario', text: 'Ay. My heart. You are wasted on honest work, you know that?' },
    ],
  },
  {
    id: 'carrera', title: 'La Carrera del Puerto', giver: 'Marisol Vega', giverSpot: 'customsDock',
    reward: 700,
    intro: [
      { who: 'Marisol Vega', text: 'Every runner in Solano thinks they own these avenues. Prove them wrong: hit every checkpoint, in order, before the clock dies.' },
      { who: 'Marisol Vega', text: 'The route is on your map. A fast car helps. A wrecked one does not.' },
    ],
    objective: { type: 'checkpoints', count: 6, time: 210, label: 'Run the checkpoint route across Port Solano' },
    outro: [
      { who: 'Marisol Vega', text: 'The harbour has a new legend. The entry money of twelve fools is now yours.' },
    ],
  },
  {
    id: 'ajuste', title: 'Ajuste de Cuentas', giver: 'Marisol Vega', giverSpot: 'darioHouse',
    reward: 1500,
    intro: [
      { who: 'Marisol Vega', text: 'El Pulpo ends tonight. His crew is at the warehouse yard with two cars loaded for the border.' },
      { who: 'Marisol Vega', text: 'Clear the yard, burn his cars, then come home. End this, sobrino — for all of us.' },
    ],
    objective: { type: 'finale', spot: 'pulpoYard', hostiles: 6, cars: 2, drop: 'darioHouse', label: 'Finish El Pulpo’s crew and wreck his cars' },
    outro: [
      { who: 'Marisol Vega', text: 'It is done. The docks, the avenues, the whole shining bay — Solano is ours now.' },
      { who: 'Dario', text: 'To family, primo. The city is yours to roam. Spend it well.' },
    ],
  },
];

// ------------------------------------------------------------ state machine
export function createStory() {
  return { index: 0, phase: 'idle', step: 0, timer: 0, hostiles: [], targetCar: null, extraCars: [], checkIdx: 0, checkpoints: [] };
}

export function currentMission(story) { return MISSIONS[story.index] || null; }

export function startMission(state) {
  const m = currentMission(state.story);
  if (!m) return;
  state.story.phase = 'intro';
  state.dialogue = { lines: m.intro, idx: 0, onDone: 'mission-start' };
  state.banner = { title: m.title, sub: 'Story mission', t: 3.2 };
  if (state.audio) state.audio.uiClick();
}

// Called by main.js when the intro dialogue closes.
export function activateMission(state) {
  const s = state.story, m = currentMission(s);
  if (!m) return;
  s.phase = 'active'; s.step = 0; s.hostiles = []; s.extraCars = []; s.targetCar = null;
  const o = m.objective, city = state.city;
  if (o.type === 'steal') {
    const at = city.spots[o.carAt];
    const car = createVehicle(city, 'muscle', at.x + 90, at.y + 120, 0.4, { kind: 'mission', marked: true, color: '#9d0208' });
    state.cars.push(car); s.targetCar = car;
  }
  if (o.type === 'shootout' || o.type === 'finale') {
    const at = city.spots[o.spot];
    for (let i = 0; i < o.hostiles; i++) {
      const a = (i / o.hostiles) * 6.28;
      const ped = createPed(at.x + Math.cos(a) * (60 + (i % 3) * 36), at.y + Math.sin(a) * (60 + (i % 3) * 36),
        { hostile: true, weapon: WEAPONS.pistol, hp: 55, cashDrop: 18 + i * 4 });
      state.peds.push(ped); s.hostiles.push(ped);
    }
    if (o.type === 'finale') {
      for (let i = 0; i < (o.cars || 0); i++) {
        const car = createVehicle(city, i ? 'muscle' : 'pickup', at.x - 70 + i * 90, at.y - 90, 0.2, { kind: 'mission', marked: true });
        state.cars.push(car); s.extraCars.push(car);
      }
    }
  }
  if (o.type === 'checkpoints') {
    s.checkpoints = city.raceCheckpoints.slice(0, o.count);
    s.checkIdx = 0; s.timer = o.time;
  }
  if (o.type === 'timed') s.timer = 0; // the clock starts at the pickup
  publishMarker(state);
}

export function publishMarker(state) {
  const s = state.story, m = currentMission(s);
  const city = state.city;
  let marker = null;
  if (s.phase === 'idle' && m && m.giverSpot) marker = city.spots[m.giverSpot];
  else if (s.phase === 'idle' && m && !m.giverSpot) marker = city.spots[m.objective.spot || 'darioHouse'];
  else if (s.phase === 'active' && m) {
    const o = m.objective;
    if (o.type === 'goto') marker = city.spots[o.spot];
    else if (o.type === 'steal') marker = s.step === 0 && s.targetCar ? s.targetCar : city.spots[o.deliver];
    else if (o.type === 'timed') marker = city.spots[s.step === 0 ? o.pickup : o.drop];
    else if (o.type === 'shootout') marker = city.spots[o.spot];
    else if (o.type === 'escape') marker = city.spots[s.step === 0 ? o.pickup : o.drop];
    else if (o.type === 'checkpoints') marker = s.checkpoints[s.checkIdx] || null;
    else if (o.type === 'finale') marker = s.step === 0 ? city.spots[o.spot] : city.spots[o.drop];
  }
  state.mission.marker = marker;
  state.mission.objective = s.phase === 'active' && m ? m.objective.label : (m && s.phase === 'idle' ? 'Find ' + m.giver + ' — ' + m.title : '');
}

function completeObjective(state) {
  const s = state.story, m = currentMission(s);
  s.phase = 'outro';
  state.dialogue = { lines: m.outro, idx: 0, onDone: 'mission-reward' };
  state.mission.marker = null;
}

// Called by main.js when the outro dialogue closes.
export function rewardMission(state) {
  const s = state.story, m = currentMission(s);
  if (!m) return;
  let reward = m.reward;
  if (m.objective.type === 'timed' && s.timer > 0) reward += Math.floor(s.timer * 0.8); // speed tip
  state.player.cash += reward;
  state.floaters.push({ x: state.player.x, y: state.player.y - 30, text: '+$' + reward, life: 1.8, color: '#ffd23e' });
  if (state.audio) { state.audio.jingle(true); state.audio.cash(); }
  state.banner = { title: 'Mission complete', sub: m.title + '  ·  $' + reward, t: 3.4 };
  s.index++; s.phase = 'idle'; s.hostiles = []; s.targetCar = null; s.extraCars = [];
  if (!currentMission(s)) state.banner = { title: 'Story complete', sub: 'Port Solano is yours — free roam', t: 4.5 };
  state.saveGame();
  publishMarker(state);
}

// Death or arrest mid-mission: clear the stage, keep the mission available.
export function failMission(state) {
  const s = state.story;
  if (s.phase !== 'active' && s.phase !== 'intro') return;
  for (const p of s.hostiles) p.removeMe = true;
  state.peds = state.peds.filter((p) => !p.removeMe);
  if (s.targetCar && !s.targetCar.dead) s.targetCar.removeMe = true;
  for (const c of s.extraCars) if (!c.dead) c.removeMe = true;
  state.cars = state.cars.filter((c) => !c.removeMe);
  s.phase = 'idle'; s.hostiles = []; s.targetCar = null; s.extraCars = [];
  state.banner = { title: 'Mission failed', sub: 'Return to the marker to try again', t: 3 };
  publishMarker(state);
}

const near = (a, b, r) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy < r * r; };

export function updateMission(state, dt) {
  const s = state.story, m = currentMission(s);
  publishMarker(state);
  if (!m) return;
  const player = state.player, city = state.city;

  // walking into the giver marker starts the next chapter
  if (s.phase === 'idle' && state.mode === 'play' && !state.dialogue) {
    const g = m.giverSpot ? city.spots[m.giverSpot] : null;
    if (g && near(player, g, 52)) startMission(state);
  }
  if (s.phase !== 'active') return;
  const o = m.objective;

  if (o.type === 'goto') {
    if (near(player, city.spots[o.spot], 62)) completeObjective(state);
  } else if (o.type === 'steal') {
    if (s.targetCar && s.targetCar.dead) { failMission(state); return; }
    if (s.step === 0 && player.inCar && player.inCar === s.targetCar) {
      s.step = 1;
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Deliver it to Solano Customs', life: 2, color: '#ffd23e' });
    } else if (s.step === 1 && s.targetCar && near(s.targetCar, city.spots[o.deliver], 78) && s.targetCar.speed !== undefined && Math.abs(s.targetCar.vx) + Math.abs(s.targetCar.vy) < 30) {
      completeObjective(state);
    }
  } else if (o.type === 'timed') {
    if (s.step === 0 && player.inCar && near(player, city.spots[o.pickup], 58)) {
      s.step = 1; s.timer = o.time;
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'The crate is loaded — GO!', life: 2, color: '#ffd23e' });
      if (state.audio) state.audio.pickup();
    } else if (s.step === 1) {
      s.timer -= dt;
      if (s.timer <= 0) { failMission(state); return; }
      if (near(player, city.spots[o.drop], 62)) completeObjective(state);
    }
  } else if (o.type === 'shootout') {
    if (s.hostiles.every((p) => p.dead)) completeObjective(state);
  } else if (o.type === 'escape') {
    if (s.step === 0 && player.inCar && near(player, city.spots[o.pickup], 58)) {
      s.step = 1;
      state.wanted.heat = Math.max(state.wanted.heat, o.heat);
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Dario is in — DRIVE!', life: 2, color: '#ffd23e' });
      if (state.audio) state.audio.door();
    } else if (s.step === 1 && near(player, city.spots[o.drop], 66)) completeObjective(state);
  } else if (o.type === 'checkpoints') {
    s.timer -= dt;
    if (s.timer <= 0) { failMission(state); return; }
    const cp = s.checkpoints[s.checkIdx];
    if (cp && near(player, cp, 84)) {
      s.checkIdx++;
      if (state.audio) state.audio.pickup();
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Checkpoint ' + s.checkIdx + '/' + s.checkpoints.length, life: 1.4, color: '#7ec3ee' });
      if (s.checkIdx >= s.checkpoints.length) completeObjective(state);
    }
  } else if (o.type === 'finale') {
    if (s.step === 0 && s.hostiles.every((p) => p.dead) && s.extraCars.every((c) => c.dead)) {
      s.step = 1;
      state.wanted.heat = Math.max(state.wanted.heat, 120);
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Now get home!', life: 2, color: '#ffd23e' });
    } else if (s.step === 1 && near(player, city.spots[o.drop], 66)) completeObjective(state);
  }
}

// ------------------------------------------------------------------- taxi
export function createTaxi() { return { active: false, phase: 'pickup', pickup: null, dest: null, ped: null, fare: 0, waitT: 3 }; }

const DEST_NAMES = ['Hotel Mirador', 'Hospital San Solano', 'Terminal de Buses', 'Plaza Mayor', 'Almacén Brisa', 'La Playa', 'Solano Customs'];
export function updateTaxi(state, dt) {
  const t = state.taxi, player = state.player, city = state.city;
  const inTaxi = player.inCar && player.inCar.type === 'taxi';
  if (!t.active) {
    if (inTaxi && state.mode === 'play') {
      t.waitT -= dt;
      if (t.waitT <= 0) {
        // a fare hails from the nearest stand or a nearby sidewalk
        let best = null, bd = Infinity;
        for (const s of city.taxiStands) { const d = (s.x - player.x) ** 2 + (s.y - player.y) ** 2; if (d < bd) { bd = d; best = s; } }
        t.pickup = { x: best.x + 12, y: best.y };
        t.ped = null; t.active = true; t.phase = 'pickup';
        state.floaters.push({ x: player.x, y: player.y - 30, text: 'Fare waiting — follow the cyan marker', life: 2.2, color: '#7ec3ee' });
      }
    } else t.waitT = 3;
    return;
  }
  if (!inTaxi) { // stepped out mid-fare: the passenger waits, then gives up
    t.giveUpT = (t.giveUpT || 12) - dt;
    if (t.giveUpT <= 0) { t.active = false; t.giveUpT = 12; state.floaters.push({ x: player.x, y: player.y - 24, text: 'Fare lost', life: 1.6, color: '#c94f42' }); }
    return;
  }
  t.giveUpT = 12;
  if (t.phase === 'pickup') {
    if (near(player, t.pickup, 46) && Math.abs(player.inCar.vx) + Math.abs(player.inCar.vy) < 22) {
      const spots = [city.spots.hotel, city.spots.darioHouse, city.spots.plaza, city.spots.island, city.hospital.door, city.policeStation.door];
      const d = spots[Math.floor(Math.random() * spots.length)];
      t.dest = { x: d.x, y: d.y, name: DEST_NAMES[Math.floor(Math.random() * DEST_NAMES.length)] };
      t.fare = 16 + Math.floor(Math.hypot(t.dest.x - t.pickup.x, t.dest.y - t.pickup.y) * 0.016);
      t.phase = 'dropoff'; t.time = 0;
      if (state.audio) state.audio.door();
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Take them to ' + t.dest.name + ' — $' + t.fare, life: 2.4, color: '#7ec3ee' });
    }
  } else {
    t.time += dt;
    if (near(player, t.dest, 52) && Math.abs(player.inCar.vx) + Math.abs(player.inCar.vy) < 22) {
      const tip = t.time < 60 ? Math.floor(t.fare * 0.35) : 0;
      const total = t.fare + tip;
      player.cash += total;
      state.floaters.push({ x: player.x, y: player.y - 26, text: 'Fare $' + t.fare + (tip ? ' + tip $' + tip : ''), life: 2, color: '#57e389' });
      if (state.audio) { state.audio.cash(); state.audio.jingle(true); }
      t.active = false; t.waitT = 6;
    }
  }
}

// ------------------------------------------------------------------- race
export function createRace() { return { active: false, checkpoints: [], next: 0, timeLeft: 0 }; }

export function startRace(state) {
  const r = state.race;
  r.checkpoints = state.city.raceCheckpoints;
  r.next = 0; r.timeLeft = 175; r.active = true;
  state.banner = { title: 'Harbour Run', sub: 'Hit every checkpoint before the clock dies', t: 3 };
  if (state.audio) state.audio.jingle(false);
}

export function updateRace(state, dt) {
  const r = state.race;
  if (!r.active) return;
  r.timeLeft -= dt;
  if (r.timeLeft <= 0) {
    r.active = false;
    state.banner = { title: 'Out of time', sub: 'The Harbour Run resets at the harbour marker', t: 3 };
    if (state.audio) state.audio.jingle(false);
    return;
  }
  const cp = r.checkpoints[r.next];
  if (cp && state.player.inCar && near(state.player, cp, 88)) {
    r.next++;
    if (state.audio) state.audio.pickup();
    if (r.next >= r.checkpoints.length) {
      r.active = false;
      state.player.cash += PRICES.racePrize;
      state.banner = { title: 'Harbour Run complete!', sub: '+$' + PRICES.racePrize + ' — the harbour bows to you', t: 3.6 };
      if (state.audio) { state.audio.jingle(true); state.audio.cash(); }
    }
  }
}
