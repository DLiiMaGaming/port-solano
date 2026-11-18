// Story and side work. The story is nine missions around Marisol Vega, Darío and the
// crime boss El Pulpo, built from a small step runtime (go-to, shootout, timed run, boat
// leg, lose-the-law, sink-a-boat). Dialogue plays through state.dialogue; main.js renders
// it and calls failMission when the player dies or is arrested mid-mission. Side jobs —
// taxi fares, two checkpoint races, the courier run — live here too and are repeatable.

import { MONEY, T } from './config.js';
import { dist, createPed, createBoat, randomRoadNode } from './entities.js';

/** Walk a spawn point to open ground: a hostile inside a building could neither
 *  shoot nor be shot, and one whose collision circle overlaps a wall or crate
 *  is wedged in place forever — so test the whole circle, not just the tile. */
const _solidsScratch = [];
function openGround(state, x, y) {
  const blocked = (px, py) => {
    const t = state.city.tileAtPx(px, py);
    if (t === T.BUILDING || t === T.WATER) return true;
    const rects = state.city.querySolids(px, py, 48, _solidsScratch);
    for (const r of rects) {
      const cx = Math.max(r.x, Math.min(px, r.x + r.w));
      const cy = Math.max(r.y, Math.min(py, r.y + r.h));
      if ((cx - px) * (cx - px) + (cy - py) * (cy - py) < 15 * 15) return true;
    }
    return false;
  };
  if (!blocked(x, y)) return { x, y };
  for (let r = 24; r <= 190; r += 24) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!blocked(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

export function createStory() {
  return {
    index: 0, phase: 'idle', step: 0, stepT: 0,
    spawned: [], targetBoat: null, passenger: null,
    complete: false,
  };
}

export function createJobs() {
  return {
    taxi: { phase: 'idle', x: 0, y: 0, dx: 0, dy: 0, t: 0 },
    race: { active: false, which: null, cps: [], i: 0, t: 0, limit: 0 },
    courier: { active: false, x: 0, y: 0, t: 0, limit: 0, pay: 0 },
  };
}

const L = (who, text) => ({ who, text });

// Mission definitions are functions of the city's spots so every coordinate is real.
function missionDefs(city) {
  const s = city.spots;
  const P = (pt, dx = 0, dy = 0) => ({ x: pt.x + dx, y: pt.y + dy });
  return [
    {
      title: 'Bienvenido a Solano', giver: 'Marisol Vega', at: s.marisol, reward: 40,
      intro: [
        L('Marisol Vega', 'You must be Darío\'s cousin. He said you\'d come with nothing but a name.'),
        L('Marisol Vega', 'This is Solano. Beautiful, no? Everything here has an owner, and every owner pays somebody.'),
        L('You', 'I just need work.'),
        L('Marisol Vega', 'Then start by meeting Darío at his house — Casa de Darío, in Barrio Viejo. He is expecting you.'),
      ],
      outro: [L('Darío', 'So the family sends me a driver. Good. We will get along, you and I.')],
      steps: [
        { type: 'goto', ...P(s.safehouse), r: 60, label: 'Go to Casa de Darío' },
        { type: 'goto', ...P(s.gunshop), r: 60, label: 'Check the gun shop, Armas Solano' },
      ],
    },
    {
      title: 'El Recado', giver: 'Darío', at: s.safehouse, reward: 300,
      intro: [
        L('Darío', 'A package sits in the yard of Almacén Pulpo, by the docks. It was mine before it was his.'),
        L('Darío', 'Take it to my man at the Puerto docks. And primo — once you pick it up, the whole bay will know. Move fast.'),
      ],
      outro: [L('Darío', 'Clean work. Well — clean enough. The bay pays those who move.')],
      steps: [
        { type: 'goto', ...P(s.warehouse, 30, 60), r: 70, label: 'Pick up the package at Almacén Pulpo' },
        { type: 'timed', ...P(s.taxiStands[3], 20, 0), r: 64, seconds: 170, label: 'Deliver to the docks contact', onEnter: (state) => { state.wanted.heat = Math.max(state.wanted.heat, 74); } },
        { type: 'goto', ...P(s.safehouse), r: 64, label: 'Return to Casa de Darío' },
      ],
    },
    {
      title: 'Almacén Pulpo', giver: 'Darío', at: s.safehouse, reward: 450,
      intro: [
        L('Darío', 'El Pulpo keeps his books in that warehouse. Paper books, primo. Names, debts, police — everything.'),
        L('Darío', 'His boys will not hand them over. Take the yard, then take the books from the door.'),
      ],
      outro: [L('Darío', 'With these books, El Pulpo negotiates. Without them, he begs. You did that.')],
      steps: [
        { type: 'goto', ...P(s.warehouse, 0, 90), r: 80, label: 'Go to Almacén Pulpo' },
        { type: 'shootout', cx: s.warehouse.x, cy: s.warehouse.y + 60, n: 5, label: 'Clear the warehouse yard' },
        { type: 'goto', ...P(s.warehouse), r: 56, label: 'Take the books from the warehouse door' },
      ],
    },
    {
      title: 'Persecución', giver: 'Marisol Vega', at: s.marisol, reward: 500,
      intro: [
        L('Marisol Vega', 'A friend of mine is hiding in Centro with Pulpo\'s money in a bag. The police found him first.'),
        L('Marisol Vega', 'Pick him up, and when the sirens come — and they will come — lose them. Then bring him to me.'),
      ],
      outro: [L('Marisol Vega', 'He talks too much, but he pays well. So do I.')],
      steps: [
        { type: 'goto', ...P(s.courierSpots[0], 30, 20), r: 60, label: 'Pick up Marisol\'s friend in Centro' },
        { type: 'lose', label: 'Lose the police', onEnter: (state) => { state.wanted.heat = Math.max(state.wanted.heat, 74); } },
        { type: 'goto', ...P(s.marisol), r: 60, label: 'Bring him to Marisol' },
      ],
    },
    {
      title: 'Tapadera', giver: 'Marisol Vega', at: s.marisol, reward: 600,
      intro: [
        L('Marisol Vega', 'Tonight you are nobody. A taxi driver. My accountant needs to cross the city without being seen getting in.'),
        L('Marisol Vega', 'Find a Taxi Solano cab, pick him up at the hospital, drop him at the customs yard. Boring is good. Boring is alive.'),
      ],
      outro: [L('Marisol Vega', 'See? Nobody looks at a taxi. Remember that trick.')],
      steps: [
        { type: 'enterTaxi', label: 'Get into a Taxi Solano cab' },
        { type: 'goto', ...P(s.hospital, 16, 30), r: 62, label: 'Pick up the accountant at the hospital', needsTaxi: true },
        { type: 'goto', ...P(s.customs, 0, 40), r: 66, label: 'Drop him at Solano Customs', needsTaxi: true },
      ],
    },
    {
      title: 'La Redada', giver: 'Darío', at: s.safehouse, reward: 700,
      intro: [
        L('Darío', 'Pulpo moved his cash to a yard in Zona Industrial before the police raid he paid for could "find" it.'),
        L('Darío', 'We raid it first. Take his guards down, grab nothing — just burn his count. Then run, primo, run home.'),
      ],
      outro: [L('Darío', 'His money, his books, his pride. The Pulpo is running out of arms.')],
      steps: [
        { type: 'goto', ...P(s.customs, -40, 90), r: 80, label: 'Go to the industrial yard' },
        { type: 'shootout', cx: s.customs.x - 40, cy: s.customs.y + 90, n: 6, label: 'Raid the yard — clear the guards' },
        { type: 'timed', ...P(s.safehouse), r: 64, seconds: 130, label: 'Get back to Casa de Darío' },
      ],
    },
    {
      title: 'Marea Nocturna', giver: 'Marisol Vega', at: s.marisol, reward: 850,
      intro: [
        L('Marisol Vega', 'Some things only move at night, on water. A boat at the Puerto docks carries a quiet cargo tonight.'),
        L('Marisol Vega', 'Take it across the bay to Isla Brisa. My contact waits at the island dock. The sea asks no questions.'),
      ],
      outro: [L('Marisol Vega', 'The island sleeps safer tonight because of you. El Pulpo will not.')],
      steps: [
        { type: 'boatTo', x: s.islandDock.x - 60, y: s.islandDock.y - 40, r: 120, label: 'Sail the cargo to Isla Brisa' },
        { type: 'goto', ...P(s.islandDock, 30, 46), r: 60, label: 'Meet the contact at the island dock' },
      ],
      onStart: (state) => { state.tod = 21 * 60 + 40; },
    },
    {
      title: 'La Isla del Pulpo', giver: 'Darío', at: s.safehouse, reward: 1200,
      intro: [
        L('Darío', 'He ran to his island house like a rat to a hole. His crew is with him, and that red Cigarrera he loves so much.'),
        L('Darío', 'Clear his crew, primo. And sink the boat. A man like him should watch his escape burn.'),
      ],
      outro: [L('Darío', 'The island is ours. He has one hole left, and we know where it is.')],
      steps: [
        { type: 'boatTo', x: s.islandDock.x - 40, y: s.islandDock.y - 30, r: 130, label: 'Sail to Isla Brisa' },
        { type: 'shootout', cx: s.islandHouse.x, cy: s.islandHouse.y + 40, n: 6, label: 'Clear El Pulpo\'s island crew' },
        { type: 'sink', label: 'Sink El Pulpo\'s red Cigarrera' },
        { type: 'goto', ...P(s.islandHouse), r: 60, label: 'Search the island house' },
      ],
    },
    {
      title: 'El Último Amanecer', giver: 'Marisol Vega', at: s.marisol, reward: 1600,
      intro: [
        L('Marisol Vega', 'He came back to the warehouse with everyone he has left. All of it ends tonight, one way or another.'),
        L('You', 'Then let\'s end it our way.'),
        L('Marisol Vega', 'Clear Almacén Pulpo. Then come home to me, and we will watch the sun come up over a free bay.'),
      ],
      outro: [
        L('Marisol Vega', 'It is done. The bay is ours — yours, mine, Darío\'s.'),
        L('Marisol Vega', 'Solano will always have work for you. But tonight, primo... tonight we rest.'),
      ],
      steps: [
        { type: 'goto', ...P(s.warehouse, 0, 90), r: 80, label: 'Go to Almacén Pulpo one last time' },
        { type: 'shootout', cx: s.warehouse.x, cy: s.warehouse.y + 60, n: 7, hp: 62, label: 'End it — clear the warehouse' },
        { type: 'goto', ...P(s.marisol), r: 60, label: 'Return to Marisol' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Dialogue

export function startDialogue(state, lines, after) {
  state.dialogue = { lines, i: 0, t: 0, after };
}

export function updateDialogue(state, input, dt) {
  const d = state.dialogue;
  if (!d) return;
  d.t += dt;
  if ((input && (input.interact || input.confirm)) || d.t > 3.4) {
    d.i += 1;
    d.t = 0;
    if (d.i >= d.lines.length) {
      state.dialogue = null;
      if (d.after) d.after(state);
    }
  }
}

// ---------------------------------------------------------------------------
// Story runtime

function currentDef(state) {
  const defs = missionDefs(state.city);
  return defs[state.story.index] || null;
}

function spawnHostiles(state, step) {
  const rng = state.rng;
  for (let i = 0; i < step.n; i += 1) {
    const a = (i / step.n) * Math.PI * 2;
    const raw = {
      x: step.cx + Math.cos(a) * (60 + (i % 3) * 36),
      y: step.cy + Math.sin(a) * (60 + (i % 3) * 36),
    };
    const { x, y } = openGround(state, raw.x, raw.y);
    const ped = createPed(rng, x, y, 'hostile', {
      weapon: i % 3 === 2 ? 'smg' : 'pistol',
      hp: step.hp || 46,
    });
    state.peds.push(ped);
    state.story.spawned.push(ped);
  }
}

function enterStep(state, step) {
  state.story.stepT = step.seconds || 0;
  if (step.type === 'shootout') spawnHostiles(state, step);
  if (step.type === 'sink') {
    const spot = state.city.spots.boatSpots[4];
    const boat = createBoat('speedboat', spot.x + 60, spot.y - 30, 0.6, '#c23b2e', 'moored');
    state.boats.push(boat);
    state.story.targetBoat = boat;
    state.story.spawned.push(boat);
  }
  if (step.onEnter) step.onEnter(state);
}

function cleanupSpawned(state) {
  for (const e of state.story.spawned) {
    const list = e.kind === 'ped' ? state.peds : state.boats;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
  }
  state.story.spawned = [];
  state.story.targetBoat = null;
}

export function failMission(state) {
  const story = state.story;
  if (story.phase !== 'active' && story.phase !== 'intro') return;
  cleanupSpawned(state);
  story.phase = 'idle';
  story.step = 0;
  state.dialogue = null;
  state.flags.missionFailed = true;
  state.audio?.sfx('fail');
}

function completeMission(state) {
  const story = state.story;
  const def = currentDef(state);
  state.cash += def.reward;
  state.audio?.sfx('cash');
  state.audio?.sfx('win');
  cleanupSpawned(state);
  story.index += 1;
  story.step = 0;
  story.phase = 'idle';
  state.flags.missionDone = def.title;
  if (story.index >= 9) {
    story.complete = true;
    state.flags.storyComplete = true;
  }
}

function stepComplete(state, def, step) {
  const p = state.player;
  switch (step.type) {
    case 'goto': {
      if (step.needsTaxi && (!state.vehicle || state.vehicle.type !== 'taxi')) return false;
      return dist(p.x, p.y, step.x, step.y) < step.r;
    }
    case 'timed':
      return dist(p.x, p.y, step.x, step.y) < step.r;
    case 'boatTo':
      return state.vehicle && state.vehicle.kind === 'boat' && dist(p.x, p.y, step.x, step.y) < step.r;
    case 'enterTaxi':
      return state.vehicle && state.vehicle.type === 'taxi';
    case 'lose':
      return state.wanted.stars === 0;
    case 'shootout':
      return state.story.spawned.every((e) => e.kind !== 'ped' || e.dead);
    case 'sink':
      return state.story.targetBoat && state.story.targetBoat.dead;
    default:
      return false;
  }
}

export function updateStory(state, input, dt) {
  const story = state.story;
  const def = currentDef(state);
  if (!def) { state.marker = null; state.objectiveText = ''; return; }
  const p = state.player;

  if (story.phase === 'idle') {
    state.marker = { x: def.at.x, y: def.at.y, color: '#ffd23e' };
    state.objectiveText = `${def.giver}: ${def.title}`;
    if (!state.vehicle && !p.dead && dist(p.x, p.y, def.at.x, def.at.y) < 52) {
      story.phase = 'intro';
      if (def.onStart) def.onStart(state);
      startDialogue(state, def.intro, (s) => {
        s.story.phase = 'active';
        s.story.step = 0;
        if (def.steps[0]) enterStep(s, def.steps[0]);
      });
    }
    return;
  }
  if (story.phase === 'intro' || story.phase === 'outro') {
    state.marker = null;
    state.objectiveText = def.title;
    return;
  }
  // active
  const step = def.steps[story.step];
  if (!step) { completeMission(state); return; }
  state.objectiveText = step.label;
  if (step.type === 'timed') {
    story.stepT -= dt;
    state.objectiveText = `${step.label} — ${Math.max(0, Math.ceil(story.stepT))}s`;
    if (story.stepT <= 0) { failMission(state); return; }
  }
  if (step.type === 'shootout') {
    const alive = state.story.spawned.filter((e) => e.kind === 'ped' && !e.dead).length;
    state.objectiveText = `${step.label} (${alive} left)`;
    state.marker = { x: step.cx, y: step.cy, color: '#ff5347' };
  } else if (step.type === 'sink' && state.story.targetBoat) {
    state.marker = { x: state.story.targetBoat.x, y: state.story.targetBoat.y, color: '#ff5347' };
  } else if (step.type === 'lose' || step.type === 'enterTaxi') {
    state.marker = null;
  } else {
    state.marker = { x: step.x, y: step.y, color: '#ffd23e' };
  }
  if (stepComplete(state, def, step)) {
    state.audio?.sfx('checkpoint');
    story.step += 1;
    const next = def.steps[story.step];
    if (!next) {
      story.phase = 'outro';
      startDialogue(state, def.outro, (s) => completeMission(s));
    } else {
      enterStep(state, next);
    }
  }
}

// ---------------------------------------------------------------------------
// Side jobs: taxi fares, checkpoint races, courier runs. All repeatable. Each
// active job may claim state.marker/objectiveText after the story has had its
// say (an active job outranks the story's idle giver marker).

export function updateTaxi(state, dt) {
  const taxi = state.jobs.taxi;
  const driving = state.vehicle && state.vehicle.type === 'taxi' && !state.vehicle.dead;
  if (!driving) {
    if (taxi.phase !== 'idle') { taxi.phase = 'idle'; state.flags.taxiLost = true; }
    return;
  }
  const p = state.player;
  if (taxi.phase === 'idle') {
    taxi.t += dt;
    if (taxi.t > 2.5) {
      const node = randomRoadNode(state, 380, 980);
      if (node) {
        taxi.phase = 'pickup';
        taxi.x = node.x;
        taxi.y = node.y;
        taxi.t = 0;
      }
    }
    return;
  }
  if (taxi.phase === 'pickup') {
    state.marker = { x: taxi.x, y: taxi.y, color: '#ffa02e' };
    state.objectiveText = 'Taxi: pick up the passenger';
    if (dist(p.x, p.y, taxi.x, taxi.y) < 48 && Math.abs(state.vehicle.speed) < 30) {
      const node = randomRoadNode(state, 750, 1750);
      if (!node) { taxi.phase = 'idle'; return; }
      taxi.phase = 'dropoff';
      taxi.dx = node.x;
      taxi.dy = node.y;
      taxi.t = 0;
      taxi.fareDist = dist(taxi.x, taxi.y, node.x, node.y);
      state.audio?.sfx('pickup');
    }
    return;
  }
  // dropoff
  taxi.t += dt;
  state.marker = { x: taxi.dx, y: taxi.dy, color: '#ffa02e' };
  state.objectiveText = 'Taxi: drop off the passenger';
  if (dist(p.x, p.y, taxi.dx, taxi.dy) < 52 && Math.abs(state.vehicle.speed) < 30) {
    const base = MONEY.taxiFareBase + taxi.fareDist * MONEY.taxiFarePerMeter;
    const expected = taxi.fareDist / 7.5;
    const tip = taxi.t < expected ? Math.round(base * 0.35) : 0;
    const fare = Math.round(base) + tip;
    state.cash += fare;
    state.flags.taxiFare = fare;
    state.audio?.sfx('cash');
    taxi.phase = 'idle';
    taxi.t = 0;
  }
}

// --- Races -------------------------------------------------------------------

function tilePoint(tx, ty) { return { x: tx * 32 + 16, y: ty * 32 + 16 }; }

export const RACES = {
  harbour: {
    name: 'Harbour Run', prize: MONEY.racePrizeHarbour, limit: 125,
    start: (city) => city.spots.raceHarbour,
    cps: () => [tilePoint(142, 126), tilePoint(126, 158), tilePoint(110, 126), tilePoint(94, 142), tilePoint(126, 110), tilePoint(142, 94)],
  },
  isla: {
    name: 'Isla Loop', prize: MONEY.racePrizeIsla, limit: 150,
    start: (city) => city.spots.raceIsla,
    cps: () => [tilePoint(206, 114), tilePoint(222, 130), tilePoint(222, 162), tilePoint(206, 162), tilePoint(176, 128), tilePoint(206, 130)],
  },
};

export function startRace(state, which) {
  const def = RACES[which];
  if (!def || state.jobs.race.active) return false;
  state.jobs.race = { active: true, which, cps: def.cps(), i: 0, t: 0, limit: def.limit };
  state.audio?.sfx('checkpoint');
  return true;
}

export function updateRace(state, dt) {
  const race = state.jobs.race;
  if (!race.active) return;
  const def = RACES[race.which];
  race.t += dt;
  const cp = race.cps[race.i];
  if (!cp) { race.active = false; return; }
  state.marker = { x: cp.x, y: cp.y, color: '#3eff7a' };
  state.objectiveText = `${def.name}: checkpoint ${race.i + 1}/${race.cps.length} — ${Math.max(0, Math.ceil(race.limit - race.t))}s`;
  if (race.t > race.limit + 45) {
    race.active = false;
    state.flags.raceLost = def.name;
    state.audio?.sfx('fail');
    return;
  }
  if (state.vehicle && state.vehicle.kind === 'car' && dist(state.player.x, state.player.y, cp.x, cp.y) < 64) {
    race.i += 1;
    state.audio?.sfx('checkpoint');
    if (race.i >= race.cps.length) {
      race.active = false;
      if (race.t <= race.limit) {
        state.cash += def.prize;
        state.flags.raceWon = { name: def.name, prize: def.prize, t: race.t };
        state.audio?.sfx('win');
        state.audio?.sfx('cash');
      } else {
        state.flags.raceSlow = def.name;
        state.audio?.sfx('fail');
      }
    }
  }
}

// --- Courier -------------------------------------------------------------------

export function startCourier(state) {
  const courier = state.jobs.courier;
  if (courier.active) return false;
  const from = { x: state.player.x, y: state.player.y };
  const dests = state.city.spots.courierSpots
    .map((pt) => ({ pt, d: dist(from.x, from.y, pt.x, pt.y) }))
    .filter((e) => e.d > 700);
  if (dests.length === 0) return false;
  const chosen = state.rng.pickWeighted(dests.map((e) => [e, Math.max(1, e.d / 100)]));
  const limit = Math.round(Math.min(260, Math.max(55, chosen.d / 8.2)));
  courier.active = true;
  courier.x = chosen.pt.x;
  courier.y = chosen.pt.y;
  courier.t = 0;
  courier.limit = limit;
  courier.pay = MONEY.courierBase + Math.round(chosen.d * 0.02);
  state.audio?.sfx('pickup');
  return true;
}

export function updateCourier(state, dt) {
  const courier = state.jobs.courier;
  if (!courier.active) return;
  courier.t += dt;
  const left = courier.limit - courier.t;
  state.marker = { x: courier.x, y: courier.y, color: '#2ed3ff' };
  state.objectiveText = `Courier: deliver the package — ${Math.max(0, Math.ceil(left))}s`;
  if (left <= 0) {
    courier.active = false;
    state.flags.courierFailed = true;
    state.audio?.sfx('fail');
    return;
  }
  if (dist(state.player.x, state.player.y, courier.x, courier.y) < 50) {
    const bonus = Math.round(courier.pay * 0.5 * (left / courier.limit));
    const paid = courier.pay + bonus;
    state.cash += paid;
    state.flags.courierPaid = paid;
    state.audio?.sfx('cash');
    courier.active = false;
  }
}

/** Run every side job for this tick. Story runs first (main calls updateStory before this). */
export function updateJobs(state, dt) {
  updateTaxi(state, dt);
  updateRace(state, dt);
  updateCourier(state, dt);
}
