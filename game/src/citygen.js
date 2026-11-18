// City generation: one deterministic build from a seed. Same seed, same city, on every
// machine — the generator draws only from createRandom streams derived from the seed and
// never from Math.random, and decoration that needs no stream uses hash2.
//
// Layout (tile coordinates, world is 240x240): a mainland with a bay carved into its east
// coast (El Puerto's docks sit on that shore), and Isla Brisa east across the water, joined
// by a causeway bridge. Avenues run on a 16-tile grid, 3 tiles of asphalt with a sidewalk
// tile each side; the blocks between them carry the buildings, yards and plazas.

import { TILE, WORLD_TILES, T, D, ROOF_PALETTES } from './config.js';
import { createRandom, hash2 } from './random.js';

const W = WORLD_TILES;
const AVENUES_X = [30, 46, 62, 78, 94, 110, 126, 142];
const AVENUES_Y = [30, 46, 62, 78, 94, 110, 126, 142, 158, 174, 190, 206, 222];
const ISLAND_AX = [206, 222];
const ISLAND_AY = [114, 130, 146, 162];
const BAY = { x: 152, y0: 88, y1: 164 };
const ISLAND = { x0: 196, x1: 232, y0: 104, y1: 168 };
const CAUSEWAY = { y0: 127, y1: 130 };

const NAME_A = ['Torre', 'Edificio', 'Hotel', 'Casa', 'Banco', 'Mercado', 'Palacio', 'Residencial', 'Clínica', 'Oficinas', 'Almacén', 'Teatro', 'Café', 'Bar', 'Taller', 'Farmacia', 'Escuela', 'Galería', 'Pensión', 'Mirador'];
const NAME_B = ['Solano', 'del Mar', 'Mirador', 'Central', 'Imperial', 'Azahar', 'La Bahía', 'San Rafael', 'Las Palmas', 'El Faro', 'Brisa', 'Los Almendros', 'Vista Alegre', 'Del Puerto', 'Santa Clara', 'El Carmen', 'Nueva', 'La Perla', 'Del Sol', 'Marina'];
const INDUSTRIAL_B = ['Logística', 'Naval', 'Pesquera', 'de Conservas', 'Metalúrgica', 'del Muelle', 'Frigorífica', 'Textil', 'de Cargas', 'Portuaria'];

function inRect(tx, ty, r) {
  return tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1;
}

/** Land shape before any dressing: mainland, bay carve-out, island. */
function landAt(tx, ty) {
  if (tx >= ISLAND.x0 && tx <= ISLAND.x1 && ty >= ISLAND.y0 && ty <= ISLAND.y1) return true;
  if (tx < 10 || tx > 178 || ty < 10 || ty > 230) return false;
  if (tx >= BAY.x && ty >= BAY.y0 && ty <= BAY.y1) return false;
  return true;
}

/** District of a tile, by region. Water tiles still report the nearest district for ambience. */
function districtTile(tx, ty) {
  if (tx >= ISLAND.x0 - 6 && ty >= ISLAND.y0 - 8 && ty <= ISLAND.y1 + 8) return D.ISLA;
  if (tx >= 116 && ty >= 58 && ty <= 176) return D.PUERTO;
  if (tx >= 64 && tx < 116 && ty >= 58 && ty < 148) return D.CENTRO;
  if (tx < 52 && ty >= 82 && ty < 172) return D.PLAYA;
  if (ty < 86) return D.COLINAS;
  if (ty >= 146 && tx < 86) return D.BARRIO;
  if (ty >= 146) return D.INDUSTRIAL;
  return D.CENTRO;
}

export function generateCity(seed) {
  const tiles = new Uint8Array(W * W);
  const districtMap = new Uint8Array(W * W);
  const idx = (tx, ty) => ty * W + tx;
  const inWorld = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < W;

  // --- Land and shore -------------------------------------------------------
  for (let ty = 0; ty < W; ty += 1) {
    for (let tx = 0; tx < W; tx += 1) {
      districtMap[idx(tx, ty)] = districtTile(tx, ty);
      if (!landAt(tx, ty)) { tiles[idx(tx, ty)] = T.WATER; continue; }
      tiles[idx(tx, ty)] = T.GRASS;
    }
  }
  // Sand on any land tile next to water (the beaches), before roads override it.
  for (let ty = 0; ty < W; ty += 1) {
    for (let tx = 0; tx < W; tx += 1) {
      if (tiles[idx(tx, ty)] !== T.GRASS) continue;
      let shore = false;
      for (let dy = -1; dy <= 1 && !shore; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (inWorld(tx + dx, ty + dy) && tiles[idx(tx + dx, ty + dy)] === T.WATER) { shore = true; break; }
        }
      }
      if (shore) tiles[idx(tx, ty)] = T.SAND;
    }
  }

  // --- Avenues ---------------------------------------------------------------
  const carveAvenueX = (c, x0, x1) => {
    for (let ty = x0; ty <= x1; ty += 1) {
      for (let d = -2; d <= 2; d += 1) {
        const tx = c + d;
        if (!inWorld(tx, ty) || !landAt(tx, ty)) continue;
        tiles[idx(tx, ty)] = d >= -1 && d <= 1 ? T.ROAD : T.SIDEWALK;
      }
    }
  };
  const carveAvenueY = (c, y0, y1) => {
    for (let tx = y0; tx <= y1; tx += 1) {
      for (let d = -2; d <= 2; d += 1) {
        const ty = c + d;
        if (!inWorld(tx, ty) || !landAt(tx, ty)) continue;
        tiles[idx(tx, ty)] = d >= -1 && d <= 1 ? T.ROAD : T.SIDEWALK;
      }
    }
  };
  for (const c of AVENUES_X) carveAvenueX(c, 12, 228);
  for (const c of AVENUES_Y) carveAvenueY(c, 12, 176);
  for (const c of ISLAND_AX) carveAvenueX(c, ISLAND.y0 + 2, ISLAND.y1 - 2);
  for (const c of ISLAND_AY) carveAvenueY(c, ISLAND.x0 + 2, ISLAND.x1 - 2);

  // Causeway bridge: deck tiles over the bay and the open water to the island.
  for (let tx = BAY.x; tx < ISLAND.x0; tx += 1) {
    for (let ty = CAUSEWAY.y0; ty <= CAUSEWAY.y1; ty += 1) {
      tiles[idx(tx, ty)] = T.BRIDGE;
      districtMap[idx(tx, ty)] = tx >= ISLAND.x0 - 8 ? D.ISLA : D.PUERTO;
    }
  }
  // Mainland end of the causeway ties into the avenue grid at ty 126's row band.
  for (let tx = 144; tx < BAY.x; tx += 1) {
    for (let ty = CAUSEWAY.y0; ty <= CAUSEWAY.y1; ty += 1) {
      if (landAt(tx, ty)) tiles[idx(tx, ty)] = T.ROAD;
    }
  }

  // --- El Puerto piers --------------------------------------------------------
  const pierRows = [100, 116, 140, 156];
  for (const py of pierRows) {
    for (let tx = BAY.x; tx <= BAY.x + 7; tx += 1) {
      tiles[idx(tx, py)] = T.DOCK;
      tiles[idx(tx, py + 1)] = T.DOCK;
    }
  }

  // --- Blocks ------------------------------------------------------------------
  // Bands of buildable tiles between avenue sidewalks, per axis.
  function bands(avenues, lo, hi) {
    const out = [];
    let start = lo;
    const edges = [...avenues].sort((a, b) => a - b);
    for (const c of edges) {
      if (c - 3 > start) out.push([start, c - 3]);
      start = c + 3;
    }
    if (hi >= start) out.push([start, hi]);
    return out.filter(([a, b]) => b - a >= 3);
  }
  const bandsX = bands(AVENUES_X, 13, 175);
  const bandsY = bands(AVENUES_Y, 13, 227);
  const islandBandsX = bands(ISLAND_AX, ISLAND.x0 + 2, ISLAND.x1 - 2);
  const islandBandsY = bands(ISLAND_AY, ISLAND.y0 + 2, ISLAND.y1 - 2);

  const blocks = [];
  function collectBlocks(bx, by, island) {
    for (const [x0, x1] of bx) {
      for (const [y0, y1] of by) {
        // Subdivide wide bands (e.g. east of the last avenue) into block-sized pieces.
        for (let sx = x0; sx <= x1; sx += 13) {
          for (let sy = y0; sy <= y1; sy += 13) {
            const ex = Math.min(x1, sx + 12);
            const ey = Math.min(y1, sy + 12);
            if (ex - sx < 3 || ey - sy < 3) continue;
            const cx = Math.floor((sx + ex) / 2);
            const cy = Math.floor((sy + ey) / 2);
            if (!landAt(cx, cy)) continue;
            if (tiles[idx(cx, cy)] === T.WATER) continue;
            blocks.push({ x0: sx, y0: sy, x1: ex, y1: ey, cx, cy, island, district: districtMap[idx(cx, cy)], use: 'buildings' });
          }
        }
      }
    }
  }
  collectBlocks(bandsX, bandsY, false);
  collectBlocks(islandBandsX, islandBandsY, true);

  // A few blocks become plazas and parks instead of buildings.
  const rngLayout = createRandom(seed ^ 0x1a2b3c);
  for (const b of blocks) {
    if (b.island) continue;
    if (b.district === D.COLINAS && rngLayout.chance(0.45)) b.use = 'park';
    else if (b.district === D.CENTRO && rngLayout.chance(0.14)) b.use = 'plaza';
    else if (b.district === D.BARRIO && rngLayout.chance(0.12)) b.use = 'plaza';
    else if (b.district === D.PLAYA && rngLayout.chance(0.2)) b.use = 'plaza';
    else if (rngLayout.chance(0.06)) b.use = 'yard';
  }
  function paintBlock(b, tile) {
    for (let ty = b.y0; ty <= b.y1; ty += 1) {
      for (let tx = b.x0; tx <= b.x1; tx += 1) {
        if (landAt(tx, ty)) tiles[idx(tx, ty)] = tile;
      }
    }
  }
  for (const b of blocks) {
    if (b.use === 'park') paintBlock(b, T.PARK);
    else if (b.use === 'plaza') paintBlock(b, T.PLAZA);
    else if (b.use === 'yard') paintBlock(b, T.FLOOR);
  }

  // Reserve the block nearest a target point for a functional location.
  function reserveBlock(tx, ty, tag) {
    let best = null;
    let bestDist = Infinity;
    for (const b of blocks) {
      if (b.use !== 'buildings' && b.use !== 'yard') continue;
      const d = (b.cx - tx) * (b.cx - tx) + (b.cy - ty) * (b.cy - ty);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    if (best) { best.use = 'special'; best.tag = tag; }
    return best;
  }
  const blockHospital = reserveBlock(86, 70, 'hospital');
  const blockPolice = reserveBlock(102, 102, 'police');
  const blockGun = reserveBlock(118, 86, 'gunshop');
  const blockCustoms = reserveBlock(118, 166, 'customs');
  const blockSafehouse = reserveBlock(54, 166, 'safehouse');
  const blockWarehouse = reserveBlock(134, 150, 'warehouse');
  const blockIslandHouse = reserveBlock(224, 122, 'islandHouse');

  // --- Buildings ---------------------------------------------------------------
  const buildings = [];
  const rngBuild = createRandom(seed ^ 0x4d5e6f);
  let nameCounter = 0;

  function buildingName(district) {
    nameCounter += 1;
    const a = NAME_A[(nameCounter * 7 + district * 3) % NAME_A.length];
    if (district === D.INDUSTRIAL) return `${a} ${INDUSTRIAL_B[(nameCounter * 5) % INDUSTRIAL_B.length]}`;
    const b = NAME_B[(nameCounter * 11 + district) % NAME_B.length];
    return `${a} ${b}`;
  }

  function addBuilding(tx0, ty0, tx1, ty1, district, forcedName) {
    // Never build on water: a plot that reaches the shore is skipped whole.
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (!inWorld(tx, ty) || tiles[idx(tx, ty)] === T.WATER) return null;
      }
    }
    const x = tx0 * TILE;
    const y = ty0 * TILE;
    const w = (tx1 - tx0 + 1) * TILE;
    const h = (ty1 - ty0 + 1) * TILE;
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) tiles[idx(tx, ty)] = T.BUILDING;
    }
    const palette = ROOF_PALETTES[district] || ROOF_PALETTES[D.CENTRO];
    const roof = palette[Math.floor(hash2(tx0, ty0) * palette.length)];
    const floors = 2 + Math.floor(hash2(tx1, ty1) * 6);
    // Door: midpoint of the side whose outward neighbour is closest to a road tile.
    const sides = [
      { x: x + w / 2, y: y + h + 14, nx: 0, ny: 1 },
      { x: x + w / 2, y: y - 14, nx: 0, ny: -1 },
      { x: x + w + 14, y: y + h / 2, nx: 1, ny: 0 },
      { x: x - 14, y: y + h / 2, nx: -1, ny: 0 },
    ];
    let door = sides[0];
    let doorScore = Infinity;
    for (const s of sides) {
      for (let step = 1; step <= 8; step += 1) {
        const ttx = Math.floor((s.x + s.nx * step * 16) / TILE);
        const tty = Math.floor((s.y + s.ny * step * 16) / TILE);
        if (!inWorld(ttx, tty)) break;
        const t = tiles[idx(ttx, tty)];
        if (t === T.ROAD || t === T.SIDEWALK || t === T.PLAZA || t === T.BRIDGE) {
          if (step < doorScore) { doorScore = step; door = s; }
          break;
        }
        if (t === T.BUILDING) break;
      }
    }
    const building = {
      id: buildings.length,
      x, y, w, h, district,
      name: forcedName || buildingName(district),
      roof, floors,
      door: { x: door.x, y: door.y },
      shop: null,
    };
    buildings.push(building);
    return building;
  }

  function fillBlock(b) {
    // Subdivide the block interior (1 tile margin) into plots of 3-5 tiles with 1-tile gaps.
    const x0 = b.x0 + 1;
    const y0 = b.y0 + 1;
    const x1 = b.x1 - 1;
    const y1 = b.y1 - 1;
    let y = y0;
    while (y <= y1 - 2) {
      const ph = Math.min(rngBuild.int(3, 5), y1 - y + 1);
      let x = x0;
      while (x <= x1 - 2) {
        const pw = Math.min(rngBuild.int(3, 5), x1 - x + 1);
        if (pw >= 3 && ph >= 3 && rngBuild.chance(0.92)) {
          addBuilding(x, y, x + pw - 1, y + ph - 1, b.district);
        }
        x += pw + 1;
      }
      y += ph + 1;
    }
  }

  function specialBuilding(b, name, shop) {
    // One landmark building centred in its block, with its yard painted as floor/plaza.
    paintBlock(b, b.tag === 'warehouse' || b.tag === 'customs' ? T.FLOOR : T.PLAZA);
    const bw = Math.min(b.x1 - b.x0 - 3, 7);
    const bh = Math.min(b.y1 - b.y0 - 3, 6);
    const tx0 = b.cx - Math.floor(bw / 2);
    const ty0 = b.cy - Math.floor(bh / 2);
    const building = addBuilding(tx0, ty0, tx0 + bw, ty0 + bh, b.district, name);
    if (building) building.shop = shop;
    return building;
  }

  const landmarks = {};
  if (blockHospital) landmarks.hospital = specialBuilding(blockHospital, 'Hospital San Solano', 'hospital');
  if (blockPolice) landmarks.police = specialBuilding(blockPolice, 'Comisaría Central', 'police');
  if (blockGun) landmarks.gunshop = specialBuilding(blockGun, 'Armas Solano', 'gunshop');
  if (blockCustoms) landmarks.customs = specialBuilding(blockCustoms, 'Solano Customs', 'customs');
  if (blockSafehouse) landmarks.safehouse = specialBuilding(blockSafehouse, 'Casa de Darío', 'safehouse');
  if (blockWarehouse) landmarks.warehouse = specialBuilding(blockWarehouse, 'Almacén Pulpo', 'warehouse');
  if (blockIslandHouse) landmarks.islandHouse = specialBuilding(blockIslandHouse, 'Casa del Pulpo', 'islandHouse');

  for (const b of blocks) {
    if (b.use === 'buildings') fillBlock(b);
  }

  // --- Props -------------------------------------------------------------------
  // Decorative and (for crates/dumpsters/barrels) solid street furniture, scattered by rule
  // from its own stream so it never perturbs the building draws.
  const props = [];
  const rngProps = createRandom(seed ^ 0x70721);
  const propAt = (tx, ty, kind, solid) => {
    props.push({
      x: tx * TILE + TILE / 2 + rngProps.range(-6, 6),
      y: ty * TILE + TILE / 2 + rngProps.range(-6, 6),
      kind, solid: !!solid, rot: rngProps.range(0, Math.PI * 2), hue: rngProps.next(),
    });
  };
  const tileIs = (tx, ty, kind) => inWorld(tx, ty) && tiles[idx(tx, ty)] === kind;

  // Lamps: along avenue sidewalks, alternating sides, plus the causeway.
  for (let ty = 14; ty <= 228; ty += 6) {
    const side = (ty / 6) % 2 === 0 ? -2 : 2;
    for (const c of AVENUES_X) {
      if (tileIs(c + side, ty, T.SIDEWALK)) propAt(c + side, ty, 'lamp', false);
    }
  }
  for (let tx = BAY.x + 2; tx < ISLAND.x0; tx += 5) {
    propAt(tx, CAUSEWAY.y0, 'lamp', false);
    propAt(tx, CAUSEWAY.y1, 'lamp', false);
  }
  // Palms and umbrellas on the sand; benches on plazas and parks; stalls on market plazas.
  for (let ty = 0; ty < W; ty += 1) {
    for (let tx = 0; tx < W; tx += 1) {
      const t = tiles[idx(tx, ty)];
      const d = districtMap[idx(tx, ty)];
      if (t === T.SAND && rngProps.chance(0.11)) propAt(tx, ty, 'palm', false);
      else if (t === T.SAND && rngProps.chance(0.10)) propAt(tx, ty, 'umbrella', false);
      else if (t === T.PLAZA && rngProps.chance(0.07)) propAt(tx, ty, 'bench', false);
      else if (t === T.PLAZA && (d === D.BARRIO || d === D.PLAYA) && rngProps.chance(0.06)) propAt(tx, ty, 'stall', true);
      else if (t === T.PARK && rngProps.chance(0.10)) propAt(tx, ty, 'palm', false);
      else if (t === T.PARK && rngProps.chance(0.06)) propAt(tx, ty, 'bench', false);
    }
  }
  // Crates and barrels around the docks, the warehouse and industrial yards.
  for (let ty = 0; ty < W; ty += 1) {
    for (let tx = 0; tx < W; tx += 1) {
      const t = tiles[idx(tx, ty)];
      const d = districtMap[idx(tx, ty)];
      if (t === T.DOCK && rngProps.chance(0.30)) propAt(tx, ty, 'crate', true);
      else if (t === T.DOCK && rngProps.chance(0.12)) propAt(tx, ty, 'barrel', true);
      else if (t === T.FLOOR && (d === D.INDUSTRIAL || d === D.PUERTO) && rngProps.chance(0.12)) propAt(tx, ty, 'crate', true);
      else if (t === T.FLOOR && d === D.INDUSTRIAL && rngProps.chance(0.05)) propAt(tx, ty, 'barrel', true);
    }
  }
  // Dumpsters in the alleys: grass/floor tiles right behind buildings.
  for (const b of buildings) {
    if (rngProps.chance(0.4)) {
      const tx = Math.floor((b.x + b.w + 20) / TILE);
      const ty = Math.floor((b.y + b.h / 2) / TILE);
      if (inWorld(tx, ty) && tiles[idx(tx, ty)] !== T.BUILDING && tiles[idx(tx, ty)] !== T.WATER && tiles[idx(tx, ty)] !== T.ROAD) {
        props.push({ x: b.x + b.w + 20, y: b.y + b.h / 2, kind: 'dumpster', solid: true, rot: 0, hue: rngProps.next() });
      }
    }
  }

  // --- Parked cars ---------------------------------------------------------------
  const parkedCars = [];
  const rngPark = createRandom(seed ^ 0x9a11);
  const CAR_TYPE_KEYS = ['compact', 'sedan', 'muscle', 'pickup', 'taxi'];
  const CAR_PAINTS = ['#c23b2e', '#2e6fc2', '#e0a51f', '#3f9e4d', '#e8e6df', '#565b63', '#7a3f8c', '#c26a1b', '#2b2e33', '#87b5c9'];
  for (let i = 0; i < 900 && parkedCars.length < 56; i += 1) {
    const vertical = rngPark.chance(0.5);
    const avenue = vertical ? rngPark.pick([...AVENUES_X, ...ISLAND_AX]) : rngPark.pick([...AVENUES_Y, ...ISLAND_AY]);
    const along = rngPark.int(16, 224);
    const lane = rngPark.pick([-1, 1]);
    const tx = vertical ? avenue + lane : along;
    const ty = vertical ? along : avenue + lane;
    if (!tileIs(tx, ty, T.ROAD) && !tileIs(tx, ty, T.BRIDGE)) continue;
    const type = rngPark.pick(CAR_TYPE_KEYS);
    parkedCars.push({
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      angle: vertical ? (lane > 0 ? Math.PI / 2 : -Math.PI / 2) : (lane > 0 ? 0 : Math.PI),
      type,
      color: type === 'taxi' ? '#f2b21b' : rngPark.pick(CAR_PAINTS),
    });
  }

  // --- Hidden packages --------------------------------------------------------------
  const packageCandidates = [];
  for (const b of buildings) {
    packageCandidates.push({ x: b.x + 14, y: b.y + 14 });
    packageCandidates.push({ x: b.x + b.w - 14, y: b.y + b.h - 14 });
  }
  for (const p of props) if (p.kind === 'crate') packageCandidates.push({ x: p.x, y: p.y - 10 });
  rngProps.shuffle(packageCandidates);
  const packages = packageCandidates.slice(0, 20).map((p, i) => ({ id: i, x: p.x, y: p.y, taken: false }));

  // --- Functional spots --------------------------------------------------------------
  function nearestTilePoint(tx, ty, kinds) {
    for (let r = 0; r <= 14; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const x = tx + dx;
          const y = ty + dy;
          if (inWorld(x, y) && kinds.includes(tiles[idx(x, y)])) {
            return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
          }
        }
      }
    }
    return { x: tx * TILE, y: ty * TILE };
  }
  const doorOf = (b) => (b ? { x: b.door.x, y: b.door.y } : { x: 0, y: 0 });
  const spots = {
    spawn: landmarks.safehouse ? { x: landmarks.safehouse.door.x, y: landmarks.safehouse.door.y + 26 } : { x: 54 * TILE, y: 170 * TILE },
    hospital: doorOf(landmarks.hospital),
    police: doorOf(landmarks.police),
    gunshop: doorOf(landmarks.gunshop),
    customs: doorOf(landmarks.customs),
    safehouse: doorOf(landmarks.safehouse),
    warehouse: doorOf(landmarks.warehouse),
    islandHouse: doorOf(landmarks.islandHouse),
    marisol: nearestTilePoint(30, 122, [T.PLAZA, T.SIDEWALK, T.SAND]),
    islandDock: { x: (ISLAND.x0 + 4) * TILE, y: (ISLAND.y0 - 2) * TILE },
    taxiStands: [
      nearestTilePoint(92, 74, [T.SIDEWALK, T.PLAZA]),
      nearestTilePoint(34, 130, [T.SIDEWALK, T.PLAZA]),
      nearestTilePoint(58, 162, [T.SIDEWALK, T.PLAZA]),
      nearestTilePoint(140, 120, [T.SIDEWALK, T.DOCK]),
    ],
    raceHarbour: { x: 142 * TILE + 16, y: 100 * TILE + 16 },
    raceIsla: { x: (ISLAND.x0 + 6) * TILE, y: 129 * TILE },
    courierSpots: [
      nearestTilePoint(86, 102, [T.PLAZA, T.SIDEWALK]),
      nearestTilePoint(84, 72, [T.PLAZA, T.SIDEWALK]),
      nearestTilePoint(32, 128, [T.PLAZA, T.SIDEWALK]),
      nearestTilePoint(56, 168, [T.PLAZA, T.SIDEWALK]),
      nearestTilePoint(146, 148, [T.DOCK, T.FLOOR, T.SIDEWALK]),
      nearestTilePoint(214, 138, [T.PLAZA, T.SIDEWALK]),
    ],
    boatSpots: [
      { x: (BAY.x + 9) * TILE, y: 101 * TILE, type: 'dinghy', angle: 0 },
      { x: (BAY.x + 9) * TILE, y: 117 * TILE, type: 'speedboat', angle: 0 },
      { x: (BAY.x + 9) * TILE, y: 141 * TILE, type: 'dinghy', angle: 0 },
      { x: (BAY.x + 9) * TILE, y: 157 * TILE, type: 'speedboat', angle: 0 },
      { x: (ISLAND.x0 + 3) * TILE, y: (ISLAND.y0 - 3) * TILE, type: 'speedboat', angle: Math.PI / 2 },
      { x: (ISLAND.x0 + 10) * TILE, y: (ISLAND.y0 - 3) * TILE, type: 'dinghy', angle: Math.PI / 2 },
      { x: 6 * TILE, y: 128 * TILE, type: 'dinghy', angle: Math.PI },
    ],
  };

  // --- Solids index ---------------------------------------------------------------------
  const CELL = 128;
  const gridW = Math.ceil((W * TILE) / CELL);
  const solidGrid = new Map();
  const solidRects = [];
  function addSolid(x, y, w, h) {
    const rect = { x, y, w, h };
    solidRects.push(rect);
    const cx0 = Math.max(0, Math.floor(x / CELL));
    const cy0 = Math.max(0, Math.floor(y / CELL));
    const cx1 = Math.min(gridW - 1, Math.floor((x + w) / CELL));
    const cy1 = Math.min(gridW - 1, Math.floor((y + h) / CELL));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = cy * gridW + cx;
        if (!solidGrid.has(key)) solidGrid.set(key, []);
        solidGrid.get(key).push(rect);
      }
    }
  }
  for (const b of buildings) addSolid(b.x, b.y, b.w, b.h);
  for (const p of props) {
    if (!p.solid) continue;
    const s = p.kind === 'dumpster' ? 30 : p.kind === 'crate' ? 24 : 18;
    addSolid(p.x - s / 2, p.y - s / 2, s, s);
  }

  function querySolids(x, y, r, out) {
    out.length = 0;
    const cx0 = Math.max(0, Math.floor((x - r) / CELL));
    const cy0 = Math.max(0, Math.floor((y - r) / CELL));
    const cx1 = Math.min(gridW - 1, Math.floor((x + r) / CELL));
    const cy1 = Math.min(gridW - 1, Math.floor((y + r) / CELL));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const cell = solidGrid.get(cy * gridW + cx);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i += 1) {
          if (!out.includes(cell[i])) out.push(cell[i]);
        }
      }
    }
    return out;
  }

  // --- Public face ----------------------------------------------------------------------
  const city = {
    seed,
    w: W,
    h: W,
    tile: TILE,
    tiles,
    districtMap,
    buildings,
    props,
    packages,
    parkedCars,
    spots,
    landmarks,
    avenuesX: AVENUES_X,
    avenuesY: AVENUES_Y,
    islandAvenuesX: ISLAND_AX,
    islandAvenuesY: ISLAND_AY,
    querySolids,
    tileAt(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= W) return T.WATER;
      return tiles[ty * W + tx];
    },
    tileAtPx(x, y) {
      return city.tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
    },
    districtAtPx(x, y) {
      const tx = Math.min(W - 1, Math.max(0, Math.floor(x / TILE)));
      const ty = Math.min(W - 1, Math.max(0, Math.floor(y / TILE)));
      return districtMap[ty * W + tx];
    },
    isRoadPx(x, y) {
      const t = city.tileAtPx(x, y);
      return t === T.ROAD || t === T.BRIDGE;
    },
  };
  return city;
}
