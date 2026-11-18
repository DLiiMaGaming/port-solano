// PORT SOLANO — minimap.js
// Minimap renderer for the top-down city view.
// Exported shape (plain object, not a class):
//   const minimap = createMinimap(city);
//   minimap.canvas  // HTMLCanvasElement, 240x240, static city (1px/tile)
//   minimap.draw(ctx, state, x, y, size)
//     // draws backdrop, city, viewport rect, blips and the player
//     // arrow into the square (x, y, size, size) on the main context
// The static city is pre-rendered ONCE; draw() only scales that canvas
// and stamps small blips, so it stays allocation-light in the hot path.
import { TILE, WORLD_TILES, T } from './config.js';

const WORLD_PX = TILE * WORLD_TILES;
const PAD = 4; // px between the backdrop edge and the city image
// RGB per tile kind, in T order: grass, road, sidewalk, water, sand,
// bridge, park, lot, plaza, dock.
const TILE_RGB = [
  [93, 138, 74], [52, 56, 61], [138, 143, 147], [46, 109, 168],
  [227, 207, 158], [107, 113, 120], [66, 112, 52], [86, 91, 96],
  [198, 184, 158], [138, 107, 70],
];

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function dot(ctx, mx, my, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();
}
function diamond(ctx, mx, my, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(mx, my - r);
  ctx.lineTo(mx + r, my);
  ctx.lineTo(mx, my + r);
  ctx.lineTo(mx - r, my);
  ctx.closePath();
  ctx.fill();
}

export function createMinimap(city) {
  // ---- static pre-render: 1 pixel per tile -------------------------
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_TILES; canvas.height = WORLD_TILES;
  const g = canvas.getContext('2d');
  const img = g.createImageData(WORLD_TILES, WORLD_TILES);
  const data = img.data;
  const tiles = city.tiles;
  for (let i = 0; i < tiles.length; i++) {
    const rgb = TILE_RGB[tiles[i]] || TILE_RGB[T.GRASS];
    const o = i * 4;
    data[o] = rgb[0]; data[o + 1] = rgb[1];
    data[o + 2] = rgb[2]; data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Buildings: world px -> tile px, small light rects.
  g.fillStyle = '#d8d3c8';
  const inv = 1 / TILE;
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    g.fillRect(b.x * inv, b.y * inv,
      Math.max(1, b.w * inv), Math.max(1, b.h * inv));
  }
  // ---- per-frame draw ----------------------------------------------
  function draw(ctx, state, x, y, size) {
    const t = state.time || 0;
    // Backdrop + border.
    roundedRect(ctx, x, y, size, size, 10);
    ctx.fillStyle = 'rgba(10, 14, 18, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const ix = x + PAD, iy = y + PAD;
    const inner = size - PAD * 2;
    const scale = inner / WORLD_PX; // world px -> map px
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, inner, inner);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, ix, iy, inner, inner);
    // Viewport rectangle: what the camera currently shows.
    const cam = state.camera;
    if (cam) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ix + cam.x * scale, iy + cam.y * scale,
        cam.w * scale, cam.h * scale);
    }
    // Shops: coloured dots with a tiny letter (gun/customs/food).
    ctx.font = 'bold 6px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < city.shops.length; i++) {
      const s = city.shops[i];
      const mx = ix + s.x * scale, my = iy + s.y * scale;
      let fill = '#ff9f1c', letter = 'G'; // gun: orange
      if (s.type === 'customs') { fill = '#9b5de5'; letter = 'C'; }
      else if (s.type === 'food') { fill = '#ef6f9c'; letter = 'F'; }
      dot(ctx, mx, my, 4, fill);
      ctx.fillStyle = '#101418';
      ctx.fillText(letter, mx, my + 0.5);
    }
    // Fixed landmarks: safehouse white square, police blue dot,
    // hospital red cross on a white dot.
    if (city.safehouse) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ix + city.safehouse.x * scale - 3,
        iy + city.safehouse.y * scale - 3, 6, 6);
    }
    if (city.policeStation) {
      dot(ctx, ix + city.policeStation.x * scale,
        iy + city.policeStation.y * scale, 3.5, '#3a86ff');
    }
    if (city.hospital) {
      const hx = ix + city.hospital.x * scale;
      const hy = iy + city.hospital.y * scale;
      dot(ctx, hx, hy, 4.5, '#ffffff');
      ctx.fillStyle = '#e63946';
      ctx.fillRect(hx - 3, hy - 1, 6, 2);
      ctx.fillRect(hx - 1, hy - 3, 2, 6);
    }
    // Police blips: flash blue / red with time.
    const copFill = Math.floor(t * 4) % 2 === 0 ? '#3a86ff' : '#ff3b30';
    const cars = state.cars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.kind !== 'police' && c.kind !== 'cruiser') continue;
      dot(ctx, ix + c.x * scale, iy + c.y * scale, 3, copFill);
    }
    // Boats: moored hulls are pale dots; the patrol boat flashes like a
    // cruiser; the helicopter is a white dot with a wide, thin ring.
    const boats = state.boats || [];
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      if (b.dead) continue;
      if (b.kind === 'police') dot(ctx, ix + b.x * scale, iy + b.y * scale, 3, copFill);
      else dot(ctx, ix + b.x * scale, iy + b.y * scale, 2, 'rgba(220,242,251,0.8)');
    }
    if (state.heli) {
      const hx = ix + state.heli.x * scale, hy = iy + state.heli.y * scale;
      ctx.strokeStyle = 'rgba(255,244,190,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, Math.PI * 2); ctx.stroke();
      dot(ctx, hx, hy, 2.4, '#ffffff');
    }
    // Taxi: cyan pickup, green destination.
    if (state.taxi) {
      if (state.taxi.pickup) {
        diamond(ctx, ix + state.taxi.pickup.x * scale,
          iy + state.taxi.pickup.y * scale, 4.5, '#22d3ee');
      }
      if (state.taxi.dest) {
        diamond(ctx, ix + state.taxi.dest.x * scale,
          iy + state.taxi.dest.y * scale, 4.5, '#4ade80');
      }
    }
    // Race: next checkpoint in magenta.
    if (state.race) {
      const cp = state.race.checkpoints[state.race.next];
      if (cp) diamond(ctx, ix + cp.x * scale, iy + cp.y * scale, 5, '#ff2fd6');
    }
    // Courier: the delivery point burns orange.
    if (state.courier && state.courier.active && state.courier.dest) {
      diamond(ctx, ix + state.courier.dest.x * scale,
        iy + state.courier.dest.y * scale, 5, '#ff8c42');
    }
    // Mission marker: gold pulsing diamond on top of other blips.
    if (state.mission && state.mission.marker) {
      const r = 5 + Math.sin(t * 5) * 1.6;
      diamond(ctx, ix + state.mission.marker.x * scale,
        iy + state.mission.marker.y * scale, r, '#ffd23f');
    }
    // Player: white arrow rotated to the facing angle (kept updated
    // by the game whether on foot or in a car).
    const p = state.player;
    if (p) {
      ctx.save();
      ctx.translate(ix + p.x * scale, iy + p.y * scale);
      ctx.rotate(p.angle || 0);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#101418';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -3.6);
      ctx.lineTo(-1.6, 0);
      ctx.lineTo(-4, 3.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore(); // un-clip
  }
  return { canvas, draw };
}
