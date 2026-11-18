// minimap.js — top-down minimap renderer for Port Solano.
// Pre-renders the whole city once (1px per tile) to an offscreen canvas,
// then each frame blits the visible window and draws a handful of blips.
// North-up always, no text, no per-frame re-render of the base map.

import { T } from './config.js';

// ---------------------------------------------------------------------------
// Base-map palette: [r, g, b] per tile type, indexed by the T enum value.
// ---------------------------------------------------------------------------
const PALETTE = [];
PALETTE[T.WATER]    = [22, 68, 122];   // deep blue
PALETTE[T.SAND]     = [232, 215, 168]; // pale sand
PALETTE[T.GRASS]    = [84, 158, 74];   // green
PALETTE[T.ROAD]     = [56, 56, 62];    // dark grey
PALETTE[T.SIDEWALK] = [184, 184, 184]; // light grey
PALETTE[T.PLAZA]    = [169, 159, 145]; // warm grey
PALETTE[T.BUILDING] = [62, 70, 84];    // dark slate block
PALETTE[T.DOCK]     = [139, 90, 43];   // brown
PALETTE[T.BRIDGE]   = [122, 106, 90];  // grey-brown
PALETTE[T.PARK]     = [46, 120, 52];   // darker green
PALETTE[T.FLOOR]    = [138, 138, 138]; // grey
const FALLBACK_RGB = [255, 0, 255];    // unknown tile: loud magenta (bug bait)

// Blip colours (constants, so draw() never builds colour strings per frame).
const COL_COP = '#2f7bff';
const COL_COP_FLASH = '#ff3b30';
const COL_HOSTILE = '#ff3b30';
const COL_CONTACT = '#ffd21f';
const COL_TAXI = '#ff8c1a';
const COL_PLAYER_FILL = '#ffffff';
const COL_OUTLINE = 'rgba(0,0,0,0.65)';
const COL_DARKEN = 'rgba(0,0,0,0.16)';

const VIEW_TILES = 96;   // visible window: ~96 tiles across (3072 world px)
const EDGE_MARGIN = 6;   // px inset used when a blip is clamped to the edge

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

/**
 * createMinimap(canvas, city) -> { draw(state) }
 * city = { w, h, tile, tiles: Uint8Array(w*h) }  (index = ty*w + tx)
 * Safe in non-DOM environments: returns a no-op stub instead of throwing.
 */
export function createMinimap(canvas, city) {
  if (!canvas || typeof document === 'undefined' || !city || !city.tiles) {
    return { draw() {} };
  }

  let ctx = null;
  let base = null;
  try {
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return { draw() {} };
    base = prerenderCity(city);
    if (!base) return { draw() {} };
  } catch (err) {
    return { draw() {} };
  }

  const tileSize = city.tile || 32;
  const worldW = city.w * tileSize;
  const worldH = city.h * tileSize;
  const viewPx = VIEW_TILES * tileSize; // square window, world px across

  // --- blip helper (closure over ctx; writes into shared scratch vars) -----
  // Draws a filled dot for a world position. Returns nothing.
  let _mx = 0; // scratch: last converted map x
  let _my = 0; // scratch: last converted map y
  let _clamped = false;

  function drawDot(x, y, viewL, viewT, scale, size, W, H, color) {
    toMap(x, y, viewL, viewT, scale, W, H);
    const r = _clamped ? size * 0.66 : size;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(_mx, _my, r, 0, 6.283185307179586);
    ctx.fill();
    ctx.strokeStyle = COL_OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Convert world px -> minimap px, clamping to the canvas edge when the
  // position lies outside the shown window. Sets _mx/_my/_clamped.
  function toMap(x, y, viewL, viewT, scale, W, H) {
    let mx = (x - viewL) * scale;
    let my = (y - viewT) * scale;
    _clamped = false;
    if (mx < EDGE_MARGIN) { mx = EDGE_MARGIN; _clamped = true; }
    else if (mx > W - EDGE_MARGIN) { mx = W - EDGE_MARGIN; _clamped = true; }
    if (my < EDGE_MARGIN) { my = EDGE_MARGIN; _clamped = true; }
    else if (my > H - EDGE_MARGIN) { my = H - EDGE_MARGIN; _clamped = true; }
    _mx = mx;
    _my = my;
  }

  function draw(state) {
    if (!state || !state.player) return;
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;

    // Focus: the vehicle while driving, otherwise the player on foot.
    const focus = state.vehicle || state.player;
    const fx = focus.x;
    const fy = focus.y;

    // Window origin (world px), clamped so the window never leaves the
    // world; the focus is centred unless the world edge prevents it.
    const viewL = viewPx >= worldW ? 0 : clamp(fx - viewPx * 0.5, 0, worldW - viewPx);
    const viewT = viewPx >= worldH ? 0 : clamp(fy - viewPx * 0.5, 0, worldH - viewPx);
    const scale = W / viewPx;
    const now = nowMs();

    // --- base map: one cached blit + slight darkening ----------------------
    ctx.drawImage(
      base,
      viewL / tileSize, viewT / tileSize, VIEW_TILES, VIEW_TILES,
      0, 0, W, H
    );
    ctx.fillStyle = COL_DARKEN;
    ctx.fillRect(0, 0, W, H);

    const dotR = Math.max(2, W * 0.014); // ~3px on a 216px minimap
    const wantedStars = (state.wanted && state.wanted.stars) || 0;
    const copColor = wantedStars > 0
      ? (Math.floor(now / 350) % 2 === 0 ? COL_COP : COL_COP_FLASH)
      : COL_COP;

    // --- cars: only cops and taxis are shown (traffic/player cars = noise) --
    const cars = state.cars;
    if (cars) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || c.dead) continue;
        if (c.role === 'cop') {
          drawDot(c.x, c.y, viewL, viewT, scale, dotR, W, H, copColor);
        } else if (c.role === 'taxi') {
          drawDot(c.x, c.y, viewL, viewT, scale, dotR, W, H, COL_TAXI);
        }
      }
    }

    // --- peds: cops, hostiles, contacts (civilians are not shown) -----------
    // Boats get no blips at all (too noisy), per spec.
    const peds = state.peds;
    if (peds) {
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead) continue;
        if (p.role === 'cop') {
          drawDot(p.x, p.y, viewL, viewT, scale, dotR, W, H, copColor);
        } else if (p.role === 'hostile') {
          drawDot(p.x, p.y, viewL, viewT, scale, dotR, W, H, COL_HOSTILE);
        } else if (p.role === 'contact') {
          drawDot(p.x, p.y, viewL, viewT, scale, dotR, W, H, COL_CONTACT);
        }
      }
    }

    // --- objective marker: pulsing diamond, clamped so it can guide you ----
    const marker = state.marker;
    if (marker) {
      toMap(marker.x, marker.y, viewL, viewT, scale, W, H);
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      let s = 5 + 2.5 * pulse;
      if (_clamped) s *= 0.75;
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.moveTo(_mx, _my - s);
      ctx.lineTo(_mx + s, _my);
      ctx.lineTo(_mx, _my + s);
      ctx.lineTo(_mx - s, _my);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COL_OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // --- player: white triangle, rotated to facing, always on top ----------
    toMap(fx, fy, viewL, viewT, scale, W, H);
    const angle = focus.angle || 0;
    const s = Math.max(6, W * 0.032); // ~7px on a 216px minimap
    ctx.save();
    ctx.translate(_mx, _my);
    ctx.rotate(angle);
    // Triangle points along +x, matching a (cos angle, sin angle) heading.
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.72, s * 0.58);
    ctx.lineTo(-s * 0.72, -s * 0.58);
    ctx.closePath();
    ctx.fillStyle = COL_PLAYER_FILL;
    ctx.fill();
    ctx.strokeStyle = COL_OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  return { draw };
}

// ---------------------------------------------------------------------------
// One-time city pre-render: 1px per tile into an offscreen canvas.
// ---------------------------------------------------------------------------
function prerenderCity(city) {
  const w = city.w;
  const h = city.h;
  const tiles = city.tiles;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return null;

  if (octx.createImageData) {
    const img = octx.createImageData(w, h);
    const data = img.data;
    const count = w * h;
    for (let i = 0; i < count; i++) {
      const rgb = PALETTE[tiles[i]] || FALLBACK_RGB;
      const o = i * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
  } else {
    // Fallback for exotic 2d implementations without ImageData.
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const rgb = PALETTE[tiles[ty * w + tx]] || FALLBACK_RGB;
        octx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
        octx.fillRect(tx, ty, 1, 1);
      }
    }
  }
  return off;
}

export default createMinimap;
