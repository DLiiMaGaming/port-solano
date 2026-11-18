// PORT SOLANO — config.js
// Every tuning number for the game lives here: world geometry, the vehicle
// and weapon tables, shop prices, wanted-level tuning and the colour
// palette. Nothing in this file touches the DOM or the canvas.

export const TILE = 32;                 // pixels per city tile
export const WORLD_TILES = 240;         // the city is 240 x 240 tiles
export const WORLD_PX = TILE * WORLD_TILES;
export const CITY_SEED = 20261124;      // fixed seed: the city never changes

// Tile kinds stored in the city grid (citygen.js).
export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, WATER: 3, SAND: 4,
  BRIDGE: 5, PARK: 6, LOT: 7, PLAZA: 8, DOCK: 9,
};

// Tiles a car or a person may never enter (buildings are AABBs on top).
export const SOLID_TILES = new Set([T.WATER]);

// ---------------------------------------------------------------- vehicles
// w/h are the drawn footprint in pixels; speeds are px/second.
export const VEHICLE_TYPES = {
  compact: { name: 'Perro Compact', w: 34, h: 18, topSpeed: 265, reverse: 90,
    accel: 300, grip: 6.2, turn: 3.1, durability: 70,
    colors: ['#c94f42', '#4a7fc9', '#57a773', '#d9a441', '#8d99ae', '#e07a5f'] },
  sedan: { name: 'Alder Sedan', w: 38, h: 19, topSpeed: 300, reverse: 95,
    accel: 320, grip: 6.6, turn: 2.9, durability: 90,
    colors: ['#3d405b', '#81b29a', '#f2cc8f', '#606c38', '#283618', '#bc6c25'] },
  muscle: { name: 'Cargador Muscle', w: 40, h: 20, topSpeed: 360, reverse: 100,
    accel: 430, grip: 5.2, turn: 2.7, durability: 100,
    colors: ['#9d0208', '#370617', '#faa307', '#03071e', '#6a040f', '#e85d04'] },
  pickup: { name: 'Bravo Pickup', w: 42, h: 21, topSpeed: 280, reverse: 105,
    accel: 300, grip: 5.8, turn: 2.5, durability: 130,
    colors: ['#606c38', '#dda15e', '#283618', '#fefae0', '#7f5539', '#9c6644'] },
  taxi: { name: 'Solano Taxi', w: 38, h: 19, topSpeed: 295, reverse: 95,
    accel: 330, grip: 6.4, turn: 2.9, durability: 95,
    colors: ['#f4b41a'] },
  cruiser: { name: 'Patrulla Cruiser', w: 39, h: 19, topSpeed: 345, reverse: 100,
    accel: 390, grip: 6.8, turn: 3.2, durability: 120,
    colors: ['#eef2f5'] },
};
export const VEHICLE_KEYS = Object.keys(VEHICLE_TYPES);

// ----------------------------------------------------------------- weapons
// damage per pellet, cooldown seconds between shots, bullet speed/range.
export const WEAPONS = {
  fist:    { name: 'Fists',   damage: 16, cooldown: 0.34, range: 30,  speed: 0,
             spread: 0, pellets: 1, auto: false, melee: true },
  pistol:  { name: 'Pistola 9mm', damage: 26, cooldown: 0.26, range: 460, speed: 780,
             spread: 0.02, pellets: 1, auto: false, ammoKey: 'pistol' },
  smg:     { name: 'Metralleta', damage: 15, cooldown: 0.085, range: 400, speed: 820,
             spread: 0.07, pellets: 1, auto: true, ammoKey: 'smg' },
  shotgun: { name: 'Escopeta', damage: 13, cooldown: 0.85, range: 240, speed: 700,
             spread: 0.16, pellets: 6, auto: false, ammoKey: 'shotgun' },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

// -------------------------------------------------------------------- shop
export const PRICES = {
  pistol: 200, smg: 850, shotgun: 600,
  ammoPistol: 25, ammoSmg: 45, ammoShotgun: 35,   // per pack
  ammoPack: { pistol: 24, smg: 60, shotgun: 12 }, // rounds per pack
  food: 15, healAmount: 55,
  repaint: 150, repairPerPoint: 2,
  packageReward: 100, racePrize: 400,
};

// ------------------------------------------------------------------ wanted
// Heat points per witnessed crime and the star thresholds they map to.
export const CRIME_HEAT = {
  theft: 26, hitAndRun: 34, hitCar: 10, gunfire: 18,
  hitCop: 55, killPed: 48, killCop: 90, explosion: 40,
};
export const STAR_THRESHOLDS = [0, 20, 60, 110, 170, 240]; // index = stars
export const POLICE_COUNT = [0, 2, 3, 4, 6, 8];            // cruisers by stars
export const HEAT_DECAY = 7;          // heat/second while nobody sees you
export const BUST_TIME = 2.4;         // seconds of close contact to be busted

// ------------------------------------------------------------------- world
export const DAY_LENGTH = 240;        // real seconds per full in-game day
export const START_CLOCK = 10.2;      // new games begin at 10:12 in the day
export const MAX_PEDS = 42;
export const MAX_TRAFFIC = 14;
export const MAX_PARTICLES = 420;
export const MAX_SKIDS = 500;
export const SAVE_KEY = 'port-solano-save-v1';

// ----------------------------------------------------------------- palette
export const PALETTE = {
  grass: '#5d8a4a', park: '#4c7a3f', sand: '#e3cf9e', water: '#2e6da8',
  waterDeep: '#256294', road: '#3a3f44', roadEdge: '#2f3337',
  sidewalk: '#9aa0a3', plaza: '#b8a88e', lot: '#565b60', dock: '#8a6b46',
  bridge: '#6b7178', crosswalk: '#cfd3d6', laneMark: '#d8c95c',
  night: '#0b1030',
};
