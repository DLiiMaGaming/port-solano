// PORT SOLANO — every tuning number, name and colour in one place.
// The world is a fixed 240x240 tile grid of 32 px tiles (7680x7680 px). The renderer shows a
// 1280x720 logical window of it and scales that to the screen, so no rule depends on display size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
export const MAX_FRAME = 0.25;

export const TILE = 32;
export const WORLD_TILES = 240;
export const WORLD_PX = WORLD_TILES * TILE;

/** Logical view size in world pixels. */
export const VIEW = { w: 1280, h: 720 };

/** Tile kinds stored in the city grid. */
export const T = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  ROAD: 3,
  SIDEWALK: 4,
  PLAZA: 5,
  BUILDING: 6,
  DOCK: 7,
  BRIDGE: 8,
  PARK: 9,
  FLOOR: 10,
};

/** District ids; the names are the ones shown on the HUD when the player crosses a border. */
export const DISTRICTS = [
  'Barrio Viejo',
  'Centro',
  'Zona Industrial',
  'Las Colinas',
  'La Playa',
  'El Puerto',
  'Isla Brisa',
];
export const D = { BARRIO: 0, CENTRO: 1, INDUSTRIAL: 2, COLINAS: 3, PLAYA: 4, PUERTO: 5, ISLA: 6 };

/** Ground colours per tile kind (day). Night and weather grades are applied over these. */
export const TILE_COLORS = {
  [T.WATER]: '#1d5f7a',
  [T.SAND]: '#d9bd7f',
  [T.GRASS]: '#5d8a48',
  [T.ROAD]: '#3a3f46',
  [T.SIDEWALK]: '#9aa0a3',
  [T.PLAZA]: '#b09a72',
  [T.BUILDING]: '#6b6f75',
  [T.DOCK]: '#8a6a44',
  [T.BRIDGE]: '#4c4438',
  [T.PARK]: '#4c7a3e',
  [T.FLOOR]: '#7d7a72',
};

/** Roof palettes per district: a building picks one entry by hash, so a district reads as itself. */
export const ROOF_PALETTES = {
  [D.BARRIO]: ['#a8542f', '#b96a35', '#96502e', '#c07a3a', '#8f4a2d'],
  [D.CENTRO]: ['#5d6d7e', '#6e7f8f', '#54626f', '#7a8a99', '#4f6070'],
  [D.INDUSTRIAL]: ['#707880', '#7d7468', '#5f6a72', '#877c6c', '#687078'],
  [D.COLINAS]: ['#8a5a3c', '#96684a', '#7d5136', '#a06c44', '#755232'],
  [D.PLAYA]: ['#c2b49a', '#bfae94', '#cabfa8', '#b5a78c', '#d0c2a4'],
  [D.PUERTO]: ['#5f707c', '#687a86', '#556670', '#71828e', '#4f606c'],
  [D.ISLA]: ['#a89a80', '#9c8f74', '#b3a58a', '#8f8268', '#afa086'],
};

export const PLAYER = {
  radius: 13,
  walkSpeed: 168,
  sprintSpeed: 262,
  hp: 100,
  /** Seconds of invulnerability after taking a hit from a single source tick. */
  swim: false,
};

/** On-foot weapons. `slot` is the number key. Ammo -1 = infinite (fists). */
export const WEAPONS = {
  fists:   { slot: 1, name: 'Fists',   dmg: 16, rate: 0.34, range: 46,  speed: 0,    spread: 0,     pellets: 0, price: 0,    ammoPrice: 0,  auto: false, melee: true },
  pistol:  { slot: 2, name: 'Pistol',  dmg: 22, rate: 0.30, range: 430, speed: 980,  spread: 0.012, pellets: 1, price: 350,  ammoPrice: 20, auto: false },
  smg:     { slot: 3, name: 'SMG',     dmg: 13, rate: 0.085, range: 400, speed: 1020, spread: 0.045, pellets: 1, price: 800,  ammoPrice: 35, auto: true },
  shotgun: { slot: 4, name: 'Shotgun', dmg: 11, rate: 0.85, range: 250, speed: 880,  spread: 0.16,  pellets: 6, price: 650,  ammoPrice: 30, auto: false },
  rifle:   { slot: 5, name: 'Rifle',   dmg: 26, rate: 0.13, range: 660, speed: 1350, spread: 0.006, pellets: 1, price: 1400, ammoPrice: 45, auto: true },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
export const AMMO_PACK = 60;
export const ARMOR_PRICE = 450;
export const ARMOR_MAX = 100;
/** Share of incoming damage the armor pool absorbs while it lasts. */
export const ARMOR_ABSORB = 0.75;

/** Car types: size in px, performance in px/s and px/s^2, hit points, paint options. */
export const CAR_TYPES = {
  compact: { name: 'Brisa Compact', w: 44, h: 24, top: 342, accel: 300, reverse: 120, grip: 6.4, hp: 120, seats: true },
  sedan:   { name: 'Alder Sedan',   w: 50, h: 26, top: 392, accel: 320, reverse: 130, grip: 6.0, hp: 150, seats: true },
  muscle:  { name: 'Cargador Muscle', w: 54, h: 27, top: 486, accel: 430, reverse: 140, grip: 4.6, hp: 170, seats: true },
  pickup:  { name: 'Yunque Pickup', w: 54, h: 28, top: 372, accel: 300, reverse: 150, grip: 5.4, hp: 210, seats: true },
  taxi:    { name: 'Taxi Solano',   w: 50, h: 26, top: 398, accel: 330, reverse: 130, grip: 6.0, hp: 150, seats: true },
  cruiser: { name: 'Patrulla Cruiser', w: 52, h: 27, top: 452, accel: 400, reverse: 150, grip: 6.2, hp: 240, seats: true },
};
export const CAR_COLORS = ['#c23b2e', '#2e6fc2', '#e0a51f', '#3f9e4d', '#e8e6df', '#565b63', '#7a3f8c', '#c26a1b', '#2b2e33', '#87b5c9'];
export const TAXI_COLOR = '#f2b21b';
export const CRUISER_COLOR = '#e9edf2';

/** Boat types: only WATER (and nothing else) carries them. */
export const BOAT_TYPES = {
  dinghy:    { name: 'Lancha',    w: 40, h: 20, top: 238, accel: 190, reverse: 70, grip: 2.6, hp: 90 },
  speedboat: { name: 'Cigarrera', w: 54, h: 24, top: 428, accel: 330, reverse: 90, grip: 2.1, hp: 140 },
};
export const BOAT_COLORS = ['#e8e6df', '#c23b2e', '#2e6fc2', '#f2b21b', '#3f9e4d'];

/** Wanted model: heat points per star band, decay, and per-crime gains. */
export const WANTED = {
  starHeat: [0, 12, 34, 70, 120, 190],
  decayPerSec: 2.6,
  decayUnseenPerSec: 5.2,
  heatShot: 7,
  heatKill: 16,
  heatCopKill: 26,
  heatCarTheft: 6,
  heatHitPed: 10,
  heatCrash: 2,
  /** Max simultaneous pursuit cruisers by star level (index = stars). */
  cruisers: [0, 1, 2, 3, 4, 6],
  /** Seconds a witness must see the player before the crime registers. */
  witnessTime: 0.25,
  /** Bust meter fill per second with an officer in range, and its drain. */
  bustFill: 0.55,
  bustDrain: 0.8,
  bustRange: 120,
};

/** Ambient population caps (culled by distance every frame; these are hard ceilings). */
export const CAPS = {
  traffic: 26,
  peds: 44,
  particles: 420,
  bullets: 240,
  skids: 300,
};

/** In-game clock: minutes per real second, and the length of a full day in minutes. */
export const CLOCK = { minutesPerSecond: 2, dayMinutes: 1440, startMinute: 9 * 60 + 30 };

/** Economy anchors. */
export const MONEY = {
  startCash: 25,
  hospitalBill: 60,
  bustFine: 40,
  repaintPrice: 120,
  repairPerHp: 1.2,
  taxiFareBase: 18,
  taxiFarePerMeter: 0.055,
  courierBase: 25,
  racePrizeHarbour: 400,
  racePrizeIsla: 600,
};

export const SAVE_KEY = 'port-solano.save.v1';

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
