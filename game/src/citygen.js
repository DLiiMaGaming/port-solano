// PORT SOLANO — citygen.js
// Builds the whole city from one fixed seed: a 240x240 tile grid with a
// regular road lattice (4-tile avenues every 24 tiles), six named
// districts, ~280 buildings, the harbour docks, the Playa beach, a bridge
// to a small island, parks, a plaza, and every special place the game
// needs (shops, safehouse, hospital, police station, mission spots,
// hidden packages, race checkpoints, taxi stands, parked-car spots).
//
// Tile rows/columns where (t % 24) < 4 are avenues; the 20x20 tile blocks
// between them hold the buildings. Traffic lanes ride the avenues: with
// right-hand traffic, eastbound uses band offset 2, westbound offset 1,
// southbound offset 1, northbound offset 2 (see lanesH / lanesV).

import { TILE, WORLD_TILES, T } from './config.js';
import { RNG } from './random.js';

const N = WORLD_TILES;
const BAND = 24;         // avenue spacing in tiles
const ROAD_W = 4;        // avenue width in tiles

const DISTRICT_TABLE = [
  // by: 0        1        2        3        4        5        6        7        8        9   (bx)
  ['old', 'old', 'old', 'down', 'down', 'down', 'down', 'ind', 'ind', 'ind'],
  ['old', 'old', 'old', 'down', 'down', 'down', 'down', 'ind', 'ind', 'ind'],
  ['old', 'old', 'old', 'down', 'down', 'down', 'down', 'ind', 'ind', 'ind'],
  ['sub', 'sub', 'sub', 'down', 'down', 'down', 'down', 'ind', 'ind', 'ind'],
  ['sub', 'sub', 'sub', 'down', 'down', 'down', 'down', 'sub', 'sub', 'sub'],
  ['sub', 'sub', 'sub', 'down', 'down', 'down', 'down', 'sub', 'sub', 'sub'],
  ['sub', 'sub', 'sub', 'down', 'down', 'down', 'harb', 'harb', 'harb', 'harb'],
  ['playa', 'playa', 'playa', 'playa', 'playa', 'harb', 'harb', 'harb', 'harb', 'harb'],
  ['playa', 'playa', 'playa', 'playa', 'playa', 'harb', 'harb', 'harb', 'harb', 'harb'],
  ['playa', 'playa', 'playa', 'playa', 'playa', 'harb', 'harb', 'harb', 'harb', 'harb'],
];
export const DISTRICT_INFO = {
  old:   { name: 'Barrio Viejo',    sub: 'Old Town' },
  down:  { name: 'Centro',         sub: 'Downtown' },
  ind:   { name: 'Zona Industrial', sub: 'Industrial Zone' },
  sub:   { name: 'Las Colinas',    sub: 'Suburbs' },
  playa: { name: 'La Playa',       sub: 'The Beach' },
  harb:  { name: 'El Puerto',      sub: 'Harbour District' },
};

const ROOFS = {
  old:   ['#b5654a', '#a85f46', '#c07a52', '#9c5a44', '#bb6e4e'],
  down:  ['#5b7a99', '#4f6d8c', '#68879f', '#546e87', '#61798f', '#48637e'],
  ind:   ['#7a7f85', '#6e7276', '#85898d', '#62676b', '#767c80'],
  sub:   ['#c98d5f', '#bf8455', '#d29a68', '#b57e50', '#cb9263'],
  playa: ['#e0b56a', '#d9ac5e', '#e6c078', '#d2a457'],
  harb:  ['#6b7f8c', '#5f7382', '#778b99', '#667c8a'],
};
const WALLS = {
  old: '#8a4a38', down: '#3c5269', ind: '#4c5054', sub: '#9a6c42',
  playa: '#b98f45', harb: '#47585f',
};
const NAMES = {
  down: ['Banco Solano', 'Torre Mirador', 'Hotel Mirador', 'Oficinas Brisa',
    'Galería Central', 'Torre Faro', 'Edificio Coral', 'Banco del Puerto',
    'Hotel Palma Real', 'Oficinas Vega', 'Torre Azul', 'Centro Comercial Sol'],
  old: ['Capilla San Solano', 'Mercado Viejo', 'Casa Herrera', 'Posada Antigua',
    'Taller Ramos', 'Panadería La Espiga', 'Casa del Reloj', 'Museo Solano'],
  ind: ['Fábrica Norte', 'Almacén Vega', 'Planta de Hielo', 'Depósito Ferro',
    'Fábrica de Redes', 'Taller Industrial', 'Almacén Gris', 'Planta Sur'],
  sub: ['Casa Flores', 'Casa Miranda', 'Villa Rosa', 'Casa Paredes',
    'Casa Luna', 'Villa Jazmín', 'Casa Robles', 'Casa Fuentes'],
  playa: ['Hotel Brisa Marina', 'Café Ola', 'Hotel Arena', 'Bar El Ancla',
    'Hotel Coral Playa', 'Café Delfín'],
  harb: ['Almacén Brisa', 'Almacén Pulpo', 'Depósito Muelle', 'Almacén Sal',
    'Lonja del Puerto', 'Almacén Ferro'],
};

export function generateCity(seed) {
  const rng = new RNG(seed);
  const tiles = new Uint8Array(N * N);
  const buildings = [];
  const solids = [];
  const props = [];
  const lamps = [];
  const shops = [];
  const packages = [];
  const parkedSpots = [];

  const idx = (tx, ty) => ty * N + tx;
  const inB = (tx, ty) => tx >= 0 && ty >= 0 && tx < N && ty < N;
  const set = (tx, ty, v) => { if (inB(tx, ty)) tiles[idx(tx, ty)] = v; };
  const get = (tx, ty) => (inB(tx, ty) ? tiles[idx(tx, ty)] : T.WATER);
  const districtOfBlock = (bx, by) => DISTRICT_TABLE[by][bx];

  // ---- base terrain: grass everywhere, avenues carved as road ----------
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const onRoad = (tx % BAND) < ROAD_W || (ty % BAND) < ROAD_W;
      tiles[idx(tx, ty)] = onRoad ? T.ROAD : T.GRASS;
    }
  }
  // ---- the bay: water along the south, beach and docks in front of it --
  for (let tx = 0; tx < N; tx++) {
    for (let ty = 230; ty < N; ty++) set(tx, ty, T.WATER);
    for (let ty = 224; ty < 230; ty++) {
      const bx = Math.min(9, Math.floor(tx / BAND));
      const d = districtOfBlock(bx, 9);
      if (d === 'playa') set(tx, ty, T.SAND);
      else if (d === 'harb') set(tx, ty, T.DOCK);
    }
  }
  // ---- Isla Brisa: a small island in the bay, reached by one bridge ----
  for (let ty = 233; ty < N; ty++) {
    for (let tx = 90; tx < 150; tx++) {
      if ((tx % BAND) < ROAD_W) continue; // the avenues run onto the island
      set(tx, ty, ty >= 238 ? T.SAND : T.GRASS);
    }
  }
  for (let ty = 216; ty < N; ty++) {           // the causeway avenue (band 96)
    for (let tx = 96; tx < 100; tx++) {
      if (get(tx, ty) === T.WATER) set(tx, ty, T.BRIDGE);
    }
  }

  // ---- per-block construction ------------------------------------------
  const addBuilding = (bx, by, ox, oy, w, h, opts = {}) => {
    const x = (bx * BAND + 4 + ox) * TILE, y = (by * BAND + 4 + oy) * TILE;
    const d = districtOfBlock(bx, by);
    const b = {
      x, y, w: w * TILE, h: h * TILE,
      name: opts.name || null,
      shop: opts.shop || null,
      color: opts.color || rng.pick(ROOFS[d]),
      wall: WALLS[d],
      district: d,
      door: { x: x + (w * TILE) / 2, y: y + h * TILE + 14 },
    };
    buildings.push(b); solids.push(b);
    return b;
  };
  const ringSidewalk = (bx, by) => {
    const x0 = bx * BAND + 4, y0 = by * BAND + 4;
    for (let i = 0; i < 20; i++) {
      set(x0 + i, y0, T.SIDEWALK); set(x0 + i, y0 + 19, T.SIDEWALK);
      set(x0, y0 + i, T.SIDEWALK); set(x0 + 19, y0 + i, T.SIDEWALK);
    }
  };
  const fillBlock = (bx, by, v) => {
    const x0 = bx * BAND + 4, y0 = by * BAND + 4;
    for (let ty = 0; ty < 20; ty++) for (let tx = 0; tx < 20; tx++) set(x0 + tx, y0 + ty, v);
  };
  const usedNames = new Set();
  const flavorName = (d) => {
    const list = NAMES[d].filter((n) => !usedNames.has(n));
    if (!list.length) return null;
    const n = rng.pick(list); usedNames.add(n); return n;
  };

  let hospital, policeStation, safehouseB, hotelB, terminalB;
  let customsA, customsB, gunShopB, pulpoB, brisaB;
  const spots = {};

  for (let by = 0; by < 10; by++) {
    for (let bx = 0; bx < 10; bx++) {
      const d = districtOfBlock(bx, by);
      const key = bx + ',' + by;
      ringSidewalk(bx, by);

      if (key === '1,1') {                       // Plaza Mayor, Barrio Viejo
        fillBlock(bx, by, T.PLAZA);
        const cx = (bx * BAND + 14) * TILE, cy = (by * BAND + 14) * TILE;
        props.push({ kind: 'fountain', x: cx, y: cy });
        for (let i = 0; i < 6; i++) props.push({ kind: 'bench', x: cx + rng.range(-140, 140), y: cy + rng.range(-140, 140) });
        for (let i = 0; i < 8; i++) props.push({ kind: 'tree', x: (bx * BAND + rng.int(6, 21)) * TILE, y: (by * BAND + rng.int(6, 21)) * TILE });
        spots.plaza = { x: cx, y: cy + 90 };
        continue;
      }
      if (key === '2,5' || key === '6,5') {      // parks
        fillBlock(bx, by, T.PARK);
        for (let i = 0; i < 16; i++) props.push({ kind: 'tree', x: (bx * BAND + rng.int(6, 21)) * TILE, y: (by * BAND + rng.int(6, 21)) * TILE });
        for (let i = 0; i < 4; i++) props.push({ kind: 'bench', x: (bx * BAND + rng.int(7, 20)) * TILE, y: (by * BAND + rng.int(7, 20)) * TILE });
        spots[key === '2,5' ? 'parkWest' : 'parkEast'] = { x: (bx * BAND + 14) * TILE, y: (by * BAND + 14) * TILE };
        continue;
      }
      if (key === '8,0') {                       // open industrial lot
        fillBlock(bx, by, T.LOT);
        for (let i = 0; i < 10; i++) {
          const c = { kind: 'crate', x: (bx * BAND + rng.int(6, 20)) * TILE, y: (by * BAND + rng.int(6, 20)) * TILE, w: 26, h: 26 };
          props.push(c); solids.push({ x: c.x - 13, y: c.y - 13, w: 26, h: 26 });
        }
        spots.industrialYard = { x: (bx * BAND + 14) * TILE, y: (by * BAND + 14) * TILE };
        continue;
      }
      if (d === 'playa' && by === 9) {           // the beach itself (dry rows only)
        const x0 = bx * BAND + 4, y0 = by * BAND + 4;
        for (let ty = 0; ty < 10; ty++) for (let tx = 0; tx < 20; tx++) set(x0 + tx, y0 + ty, T.SAND);
        for (let i = 0; i < 7; i++) props.push({ kind: 'palm', x: (bx * BAND + rng.int(5, 22)) * TILE, y: (by * BAND + rng.int(5, 12)) * TILE });
        continue;
      }
      if (d === 'harb' && by === 9) {            // dock front: one warehouse
        addBuilding(bx, by, 2, 1, 16, 7, { name: flavorName('harb') });
        for (let i = 0; i < 8; i++) {
          const c = { kind: 'crate', x: (bx * BAND + rng.int(5, 21)) * TILE, y: (by * BAND + rng.int(11, 13)) * TILE, w: 26, h: 26 };
          props.push(c); solids.push({ x: c.x - 13, y: c.y - 13, w: 26, h: 26 });
        }
        props.push({ kind: 'crane', x: (bx * BAND + 10) * TILE, y: (by * BAND + 12) * TILE });
        continue;
      }

      // ordinary blocks, per district (skipped where a special building
      // takes the block, so roofs never stack on the same plot)
      const SPECIAL_BLOCKS = new Set(['4,2', '3,1', '5,3', '5,2', '6,3', '1,4', '8,1', '7,8', '8,8', '6,8']);
      if (SPECIAL_BLOCKS.has(key)) {
        // the special building below stands alone on this block
      } else if (d === 'down' || d === 'old') {
        const offs = [[1, 1], [11, 1], [1, 11], [11, 11]];
        for (const [ox, oy] of offs) {
          const named = rng.chance(0.3) ? flavorName(d) : null;
          addBuilding(bx, by, ox, oy, 8, 8, { name: named });
        }
      } else if (d === 'ind' || d === 'harb') {
        addBuilding(bx, by, 1, 1, 18, 8, { name: rng.chance(0.5) ? flavorName(d) : null });
        addBuilding(bx, by, 1, 11, 18, 8, { name: rng.chance(0.4) ? flavorName(d) : null });
        for (let i = 0; i < 4; i++) props.push({ kind: 'crate', x: (bx * BAND + rng.int(6, 20)) * TILE, y: (by * BAND + rng.int(10, 12)) * TILE });
      } else if (d === 'sub') {
        const offs = [[1, 2], [8, 2], [14, 2], [1, 12], [8, 12], [14, 12]];
        for (const [ox, oy] of offs) addBuilding(bx, by, ox, oy, 5, 4, { name: rng.chance(0.22) ? flavorName('sub') : null });
        for (let i = 0; i < 3; i++) props.push({ kind: 'tree', x: (bx * BAND + rng.int(6, 21)) * TILE, y: (by * BAND + rng.int(6, 21)) * TILE });
      } else if (d === 'playa') {
        const offs = [[1, 2], [11, 2], [6, 11]];
        for (const [ox, oy] of offs) addBuilding(bx, by, ox, oy, 8, 6, { name: rng.chance(0.45) ? flavorName('playa') : null });
        for (let i = 0; i < 3; i++) props.push({ kind: 'palm', x: (bx * BAND + rng.int(6, 21)) * TILE, y: (by * BAND + rng.int(6, 21)) * TILE });
      }

      // special buildings override one plot of their block
      if (key === '4,2') gunShopB = addBuilding(bx, by, 11, 1, 8, 8, { name: 'Armas Solano', shop: 'gun', color: '#7a4a8c' });
      if (key === '3,1') hospital = addBuilding(bx, by, 1, 1, 18, 8, { name: 'Hospital San Solano', color: '#dfe6ea' });
      if (key === '5,3') policeStation = addBuilding(bx, by, 1, 1, 18, 8, { name: 'Comisaría Central', color: '#33506e' });
      if (key === '5,2') hotelB = addBuilding(bx, by, 11, 1, 8, 8, { name: 'Hotel Mirador', color: '#8c6d3f' });
      if (key === '6,3') terminalB = addBuilding(bx, by, 1, 11, 18, 8, { name: 'Terminal de Buses', color: '#5f7382' });
      if (key === '1,4') safehouseB = addBuilding(bx, by, 1, 2, 5, 4, { name: 'Casa de Dario', color: '#a85751' });
      if (key === '8,1') customsA = addBuilding(bx, by, 1, 11, 18, 8, { name: 'Solano Customs', shop: 'customs', color: '#6a4a8c' });
      if (key === '7,8') customsB = addBuilding(bx, by, 1, 1, 18, 8, { name: 'Solano Customs — Muelle', shop: 'customs', color: '#6a4a8c' });
      if (key === '8,8') {
        pulpoB = addBuilding(bx, by, 1, 1, 18, 8, { name: 'Almacén Pulpo', color: '#54423a' });
        // El Pulpo's yard: the asphalt apron south of the warehouse, keyed
        // to the building plot. Fixed offsets and no rng draws, so every
        // other block of the seeded city stays exactly as it was.
        const ytx = Math.floor(pulpoB.x / TILE), yty = Math.floor((pulpoB.y + pulpoB.h) / TILE);
        const yw = Math.floor(pulpoB.w / TILE);
        for (let ty = yty; ty < yty + 10; ty++) for (let tx = ytx; tx < ytx + yw; tx++) set(tx, ty, T.LOT);
        for (const [ox, oy] of [[168, 26], [200, 26], [184, 58], [-192, 126], [-160, 126], [-72, 6]]) {
          const c = { kind: 'crate', x: pulpoB.door.x + ox, y: pulpoB.door.y + 40 + oy, w: 26, h: 26 };
          props.push(c); solids.push({ x: c.x - 13, y: c.y - 13, w: 26, h: 26 });
        }
      }
      if (key === '6,8') brisaB = addBuilding(bx, by, 1, 1, 18, 8, { name: 'Almacén Brisa', color: '#5f7382' });
    }
  }

  // ---- shops -------------------------------------------------------------
  const shopFromBuilding = (b, type) => shops.push({ type, name: b.name, x: b.x + b.w / 2, y: b.y + b.h / 2, door: b.door });
  shopFromBuilding(gunShopB, 'gun');
  shopFromBuilding(customsA, 'customs');
  shopFromBuilding(customsB, 'customs');
  const foodSpots = [
    ['Tacos El Faro', spots.plaza.x - 120, spots.plaza.y - 40],
    ['Mariscos La Ola', (2 * BAND + 12) * TILE, (9 * BAND + 10) * TILE],
    ['Dulces Sol', (6 * BAND + 14) * TILE, (5 * BAND + 6) * TILE],
    ['Café Puerto', (7 * BAND + 12) * TILE, (9 * BAND + 12) * TILE],
    ['Antojitos Centro', (5 * BAND + 8) * TILE, (5 * BAND + 20) * TILE],
  ];
  for (const [name, x, y] of foodSpots) {
    props.push({ kind: 'foodstand', x, y });
    shops.push({ type: 'food', name, x, y, door: { x, y: y + 26 } });
  }

  // ---- streetlights along the avenues ------------------------------------
  // One lamp every 12 tiles on each side of every avenue; the lamps array
  // is what the renderer lights up after dark.
  for (let b = 0; b < 10; b++) {
    const s = b * BAND;
    for (let t = 8; t < N - 4; t += 12) {
      lamps.push({ x: s * TILE - 8, y: t * TILE });            // vertical avenue, west side
      lamps.push({ x: (s + ROAD_W) * TILE + 8, y: t * TILE }); // vertical avenue, east side
      lamps.push({ x: t * TILE, y: s * TILE - 8 });            // horizontal avenue, north side
      lamps.push({ x: t * TILE, y: (s + ROAD_W) * TILE + 8 }); // horizontal avenue, south side
    }
  }
  for (const l of lamps) props.push({ kind: 'lamp', x: l.x, y: l.y });
  // scattered hydrants on sidewalks
  for (let i = 0; i < 46; i++) {
    const bx = rng.int(0, 9), by = rng.int(0, 9);
    props.push({ kind: 'hydrant', x: (bx * BAND + rng.pick([4, 23])) * TILE + 16, y: (by * BAND + rng.int(5, 22)) * TILE });
  }

  // ---- traffic lanes & intersections --------------------------------------
  const lanesH = [], lanesV = [], intersections = [];
  for (let b = 0; b < 10; b++) {
    const start = b * BAND;
    lanesH.push({ fixed: (start + 2) * TILE + TILE / 2, dir: 1 });
    lanesH.push({ fixed: (start + 1) * TILE + TILE / 2, dir: -1 });
    lanesV.push({ fixed: (start + 1) * TILE + TILE / 2, dir: 1 });
    lanesV.push({ fixed: (start + 2) * TILE + TILE / 2, dir: -1 });
  }
  for (let by = 0; by < 10; by++) for (let bx = 0; bx < 10; bx++) {
    intersections.push({ x: (bx * BAND + 2) * TILE, y: (by * BAND + 2) * TILE });
  }

  // ---- parked cars ---------------------------------------------------------
  const carTypes = ['compact', 'sedan', 'muscle', 'pickup', 'taxi'];
  for (let i = 0; i < 52; i++) {
    const horiz = rng.chance(0.5);
    const band = rng.int(0, 9) * BAND;
    const along = rng.int(6, 232);
    if (horiz) parkedSpots.push({ x: along * TILE + 16, y: (band + (rng.chance(0.5) ? 0 : 3)) * TILE + 16, angle: rng.chance(0.5) ? 0 : Math.PI, type: rng.pick(carTypes) });
    else parkedSpots.push({ x: (band + (rng.chance(0.5) ? 0 : 3)) * TILE + 16, y: along * TILE + 16, angle: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, type: rng.pick(carTypes) });
  }
  // taxis wait at the stands
  const taxiStands = [
    { x: hotelB.door.x, y: hotelB.door.y + 30 },
    { x: hospital.door.x, y: hospital.door.y + 30 },
    { x: terminalB.door.x, y: terminalB.door.y - 30 },
    { x: (3 * BAND + 12) * TILE, y: (9 * BAND + 8) * TILE },
    { x: spots.plaza.x + 140, y: spots.plaza.y + 60 },
  ];

  // ---- hidden packages ------------------------------------------------------
  const pkgTiles = [
    [14, 14], [70, 130], [158, 130], [100, 30], [206, 46], [222, 222], [30, 222],
    [238, 120], [120, 238], [10, 10], [46, 190], [100, 100], [190, 190], [60, 60],
    [150, 236], [98, 110], [30, 110], [210, 110], [120, 60], [180, 30],
  ];
  pkgTiles.forEach(([tx, ty], i) => packages.push({ id: i, x: tx * TILE + 16, y: ty * TILE + 16 }));

  // ---- mission & activity spots ----------------------------------------------
  spots.darioHouse = { x: safehouseB.door.x, y: safehouseB.door.y };
  spots.customsDock = { x: customsB.door.x, y: customsB.door.y };
  spots.harborWarehouse = { x: brisaB.door.x, y: brisaB.door.y };
  spots.pulpoYard = { x: pulpoB.door.x, y: pulpoB.door.y + 40 };
  spots.hotel = { x: hotelB.door.x, y: hotelB.door.y };
  spots.gunShop = { x: gunShopB.door.x, y: gunShopB.door.y };
  spots.island = { x: 120 * TILE, y: 235 * TILE };
  const raceStart = { x: (8 * BAND + 2) * TILE, y: (8 * BAND + 2) * TILE };
  const raceCheckpoints = [[2, 1], [5, 2], [8, 4], [6, 7], [3, 8], [1, 5], [4, 3], [7, 1]]
    .map(([bx, by]) => ({ x: (bx * BAND + 2) * TILE, y: (by * BAND + 2) * TILE }));

  // ---- harbour boats, courier stops & the Isla Brisa race -----------------
  // Fixed-coordinate additions placed AFTER all seeded generation above:
  // they take no draws from the `rng` stream, so the city built so far is
  // byte-identical to before for a given seed.
  const boatSpots = [
    { x: 4992, y: 7408, angle: 0, type: 'dinghy' },          // El Puerto front, bx6
    { x: 5760, y: 7408, angle: Math.PI, type: 'speedboat' }, // bx7
    { x: 6528, y: 7408, angle: 0, type: 'dinghy' },          // bx8
    { x: 7296, y: 7408, angle: Math.PI, type: 'speedboat' }, // bx9
    { x: 3360, y: 7440, angle: Math.PI, type: 'dinghy' },    // Isla Brisa north shore
    { x: 4320, y: 7440, angle: 0, type: 'speedboat' },       // Isla Brisa north shore
    { x: 1920, y: 7408, angle: 0, type: 'dinghy' },          // La Playa front
  ];
  spots.boatDock = { x: 4992, y: 229 * TILE + 16 };   // dock tile in front of the first harbour boat
  spots.islandDock = { x: 4320, y: 233 * TILE + 16 }; // island grass at the north shore
  const courierSpots = [
    { name: 'Terminal de Buses', x: terminalB.door.x, y: terminalB.door.y + 10 },
    { name: 'Hotel Mirador', x: hotelB.door.x, y: hotelB.door.y + 10 },
    { name: 'Plaza Mayor', x: spots.plaza.x, y: spots.plaza.y },
    { name: 'Almacén Brisa', x: brisaB.door.x, y: brisaB.door.y + 10 },
    { name: 'Comisaría Central', x: policeStation.door.x, y: policeStation.door.y + 10 },
    { name: 'La Playa', x: taxiStands[3].x, y: taxiStands[3].y },
  ];
  const race2Start = { x: (7 * BAND + 2) * TILE, y: (8 * BAND + 2) * TILE };
  const islaCheckpoints = [
    { x: 3904, y: 6208 }, // harbour avenue
    { x: 3136, y: 6976 }, // causeway north
    { x: 3104, y: 7584 }, // island SW (causeway bridge)
    // (3872, 7584) as first specified lands on WATER: the island avenue
    // band tx 120-123 is never carved (only the tx 96-99 causeway becomes
    // BRIDGE), so this uses the nearest SAND tile instead, (118, 238).
    { x: 3776, y: 7616 }, // island SE (south-row sand)
    { x: 3872, y: 6976 }, // NE avenue
    { x: 5440, y: 6208 }, // finish at race2Start
  ];

  // ---- visual-density props (decorative, NON-solid) ------------------------
  // A separate pass with its OWN rng (seed ^ 0x9e3779b9): it only appends to
  // `props`, never touches `solids`, and cannot perturb the main rng stream.
  const rng2 = new RNG(seed ^ 0x9e3779b9);
  const doorPts = [];
  for (const b of buildings) doorPts.push(b.door);
  for (const s of shops) doorPts.push(s.door);
  const nearDoor = (x, y) => doorPts.some((d) => Math.hypot(d.x - x, d.y - y) < 40);
  const usedPropTiles = new Set();
  const scatterProps = (kind, cap, isCandidate, withHue) => {
    const candidates = [];
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        if (isCandidate(get(tx, ty), tx, ty)) candidates.push([tx, ty]);
      }
    }
    // Shuffle with rng2 so capped props spread over the whole map instead
    // of clustering in the first rows the scan reaches.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = rng2.int(0, i);
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    let placed = 0;
    for (const [tx, ty] of candidates) {
      if (placed >= cap) break;
      const key = tx + ',' + ty;
      if (usedPropTiles.has(key)) continue;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      if (nearDoor(cx, cy)) continue;
      if (!rng2.chance(0.65)) continue;
      const prop = { kind, x: cx + rng2.range(-6, 6), y: cy + rng2.range(-6, 6) };
      if (withHue) prop.hue = rng2.int(0, 3);
      props.push(prop);
      usedPropTiles.add(key);
      placed++;
    }
  };
  const blockDistrict = (tx, ty) => districtOfBlock(
    Math.min(9, Math.floor(tx / BAND)), Math.min(9, Math.floor(ty / BAND)));
  scatterProps('umbrella', 14, (t) => t === T.SAND, true);
  scatterProps('towel', 16, (t) => t === T.SAND, false);
  scatterProps('stall', 6, (t, tx, ty) => t === T.SIDEWALK && blockDistrict(tx, ty) === 'playa', false);
  scatterProps('dumpster', 22, (t, tx, ty) => t === T.SIDEWALK && (blockDistrict(tx, ty) === 'down' || blockDistrict(tx, ty) === 'ind'), false);
  scatterProps('barrel', 20, (t) => t === T.DOCK, true);
  scatterProps('bench', 14, (t) => t === T.PARK || t === T.PLAZA, false);

  const city = {
    seed, tiles, buildings, solids, props, lamps, shops, packages, parkedSpots,
    lanesH, lanesV, intersections, taxiStands, spots, raceStart, raceCheckpoints,
    boatSpots, courierSpots, race2Start, islaCheckpoints,
    safehouse: { x: safehouseB.x + safehouseB.w / 2, y: safehouseB.y + safehouseB.h / 2, door: safehouseB.door },
    hospital: { x: hospital.x + hospital.w / 2, y: hospital.y + hospital.h / 2, door: hospital.door },
    policeStation: { x: policeStation.x + policeStation.w / 2, y: policeStation.y + policeStation.h / 2, door: policeStation.door },
    playerStart: { x: safehouseB.door.x, y: safehouseB.door.y + 44, angle: Math.PI / 2 },
    tileAt(tx, ty) { return get(tx, ty); },
    tileAtPx(x, y) { return get(Math.floor(x / TILE), Math.floor(y / TILE)); },
    districtAt(x, y) {
      const bx = Math.max(0, Math.min(9, Math.floor(x / TILE / BAND)));
      const by = Math.max(0, Math.min(9, Math.floor(y / TILE / BAND)));
      if (y > 232 * TILE) return { id: 'isla', name: 'Isla Brisa', sub: 'The Island' };
      const id = DISTRICT_TABLE[by][bx];
      return { id, ...DISTRICT_INFO[id] };
    },
  };
  return city;
}
