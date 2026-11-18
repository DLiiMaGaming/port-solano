// Rendering only: game state in, pixels out. The world is painted in a 1280x720 logical
// window centred on the player, scaled to the canvas. Everything decorative is derived
// from hash2 of the tile/building coordinates, so a frame allocates nothing and the same
// place always looks the same. HUD, menus and dialogue are DOM (index.html + main.js);
// this module paints the world, its lighting and its weather.

import { TILE, T, VIEW, TILE_COLORS, WORLD_PX } from './config.js';
import { hash2 } from './random.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  let camX = 0;
  let camY = 0;

  // A reusable radial light sprite (lamp pools, headlights, the helicopter's spot).
  const lightSprite = document.createElement('canvas');
  lightSprite.width = 128;
  lightSprite.height = 128;
  {
    const g = lightSprite.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,140,0.85)');
    grad.addColorStop(0.5, 'rgba(255,190,110,0.28)');
    grad.addColorStop(1, 'rgba(255,180,100,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  let vignette = null;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    view.scale = Math.min(canvas.width / VIEW.w, canvas.height / VIEW.h);
    view.x = (canvas.width - VIEW.w * view.scale) / 2;
    view.y = (canvas.height - VIEW.h * view.scale) / 2;
    vignette = ctx.createRadialGradient(
      VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.42,
      VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.86,
    );
    vignette.addColorStop(0, 'rgba(10,8,20,0)');
    vignette.addColorStop(1, 'rgba(10,8,20,0.34)');
  }
  window.addEventListener('resize', resize);
  resize();

  /** Convert a client (CSS pixel) point to world coordinates. */
  function screenToWorld(clientX, clientY) {
    const ratio = canvas.width / window.innerWidth;
    const px = clientX * ratio;
    const py = clientY * ratio;
    return {
      x: camX + (px - view.x) / view.scale - VIEW.w / 2,
      y: camY + (py - view.y) / view.scale - VIEW.h / 2,
    };
  }

  /** Sunlight model: returns {darkness 0..1, warm 0..1} for a minute of the day. */
  function sunAt(tod) {
    const hour = tod / 60;
    if (hour >= 8 && hour < 17) return { darkness: 0, warm: 0 };
    if (hour >= 17 && hour < 19.5) { const t = (hour - 17) / 2.5; return { darkness: t * 0.85, warm: 1 - t * 0.4 }; }
    if (hour >= 19.5 || hour < 5) return { darkness: 1, warm: 0 };
    if (hour >= 5 && hour < 8) { const t = (hour - 5) / 3; return { darkness: (1 - t) * 0.9, warm: 0.7 }; }
    return { darkness: 0.4, warm: 0.2 };
  }

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- ground

  function drawGround(state, x0, y0, x1, y1) {
    const city = state.city;
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(city.w - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(city.h - 1, Math.floor(y1 / TILE));
    const t = state.time;
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = city.tileAt(tx, ty);
        const px = tx * TILE;
        const py = ty * TILE;
        ctx.fillStyle = TILE_COLORS[tile];
        ctx.fillRect(px, py, TILE + 1, TILE + 1);
        const h1 = hash2(tx, ty);
        if (tile === T.WATER) {
          // Animated sparkle + foam where the water meets land.
          if (hash2(tx + Math.floor(t * 1.6), ty) > 0.93) {
            ctx.fillStyle = 'rgba(210,240,250,0.5)';
            ctx.fillRect(px + 6 + h1 * 16, py + 8 + h1 * 12, 9, 2);
          }
          ctx.strokeStyle = 'rgba(230,248,252,0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (city.tileAt(tx, ty - 1) !== T.WATER) { ctx.moveTo(px, py + 2 + Math.sin(t * 2 + tx) * 1.2); ctx.lineTo(px + TILE, py + 2 + Math.sin(t * 2 + tx) * 1.2); }
          if (city.tileAt(tx, ty + 1) !== T.WATER) { ctx.moveTo(px, py + TILE - 2); ctx.lineTo(px + TILE, py + TILE - 2); }
          if (city.tileAt(tx - 1, ty) !== T.WATER) { ctx.moveTo(px + 2, py); ctx.lineTo(px + 2, py + TILE); }
          if (city.tileAt(tx + 1, ty) !== T.WATER) { ctx.moveTo(px + TILE - 2, py); ctx.lineTo(px + TILE - 2, py + TILE); }
          ctx.stroke();
        } else if (tile === T.ROAD || tile === T.BRIDGE) {
          // Speckle wear, the odd manhole, and zebra paint at true intersections.
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(px + h1 * 22, py + hash2(ty, tx) * 22, 3, 2);
          if (h1 > 0.86) {
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.arc(px + 10 + h1 * 10, py + 10 + h1 * 8, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
          const crossX = city.tileAt(tx - 1, ty) === T.ROAD && city.tileAt(tx + 1, ty) === T.ROAD;
          const crossY = city.tileAt(tx, ty - 1) === T.ROAD && city.tileAt(tx, ty + 1) === T.ROAD;
          if (tile === T.ROAD && crossX && crossY && (tx % 16 === 14 || tx % 16 === 2) && (ty % 16 === 14 || ty % 16 === 2)) {
            ctx.fillStyle = 'rgba(235,235,230,0.20)';
            for (let s = 0; s < 4; s += 1) {
              if (hash2(tx * 4 + s, ty) > 0.25) ctx.fillRect(px + 3 + s * 8, py + 2, 4, 6);
              if (hash2(tx, ty * 4 + s) > 0.25) ctx.fillRect(px + 2, py + 3 + s * 8, 6, 4);
            }
          }
          // Lane dashes down avenue centrelines.
          if (tx % 16 === 14 && city.tileAt(tx, ty + 1) === T.ROAD) {
            ctx.fillStyle = 'rgba(240,210,90,0.5)';
            ctx.fillRect(px + TILE / 2 - 1, py + TILE - 6, 2, 10);
          }
          if (ty % 16 === 14 && city.tileAt(tx + 1, ty) === T.ROAD) {
            ctx.fillStyle = 'rgba(240,210,90,0.5)';
            ctx.fillRect(px + TILE - 6, py + TILE / 2 - 1, 10, 2);
          }
        } else if (tile === T.GRASS || tile === T.PARK) {
          if (h1 > 0.6) {
            ctx.fillStyle = 'rgba(0,0,0,0.07)';
            ctx.fillRect(px + h1 * 20, py + hash2(tx * 3, ty) * 20, 7, 5);
          }
        } else if (tile === T.SIDEWALK || tile === T.PLAZA) {
          ctx.strokeStyle = 'rgba(0,0,0,0.10)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        } else if (tile === T.SAND) {
          if (h1 > 0.55) {
            ctx.fillStyle = 'rgba(120,90,40,0.13)';
            ctx.fillRect(px + h1 * 22, py + hash2(ty * 2, tx) * 22, 5, 3);
          }
        } else if (tile === T.DOCK) {
          ctx.strokeStyle = 'rgba(60,40,18,0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, py + TILE / 2);
          ctx.lineTo(px + TILE, py + TILE / 2);
          ctx.stroke();
        }
      }
    }
  }

  // ---------------------------------------------------------------- buildings & props

  function drawBuilding(state, b, darkness) {
    // Drop shadow, then the roof, a parapet line, rooftop clutter, and a shaded
    // south facade band whose windows light up after dark.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.strokeRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    // Rooftop clutter from the building's own hash: AC units, vents, a rare water tower.
    const units = 1 + Math.floor(hash2(b.id, 5) * 3);
    ctx.fillStyle = 'rgba(210,214,218,0.75)';
    for (let i = 0; i < units; i += 1) {
      const ux = b.x + 12 + hash2(b.id, 20 + i) * Math.max(8, b.w - 34);
      const uy = b.y + 12 + hash2(b.id, 40 + i) * Math.max(8, b.h - 34);
      ctx.fillRect(ux, uy, 13, 10);
      ctx.fillStyle = 'rgba(90,96,104,0.8)';
      ctx.beginPath();
      ctx.arc(ux + 6.5, uy + 5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(210,214,218,0.75)';
    }
    if (hash2(b.id, 77) > 0.9 && b.w > 110 && b.h > 110) {
      const wx = b.x + b.w * (0.3 + hash2(b.id, 78) * 0.4);
      const wy = b.y + b.h * 0.3;
      ctx.fillStyle = '#7a5c40';
      ctx.beginPath();
      ctx.arc(wx, wy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5d4430';
      ctx.beginPath();
      ctx.moveTo(wx - 15, wy - 4);
      ctx.lineTo(wx, wy - 18);
      ctx.lineTo(wx + 15, wy - 4);
      ctx.closePath();
      ctx.fill();
    }
    // South facade band with window dots (warm and lit at night).
    const band = Math.min(16, 6 + b.floors * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(b.x, b.y + b.h - band, b.w, band);
    const cols = Math.floor(b.w / 22);
    for (let i = 0; i < cols; i += 1) {
      const lit = hash2(b.id * 3 + i, 9) > 0.45;
      ctx.fillStyle = darkness > 0.35 && lit ? 'rgba(255,196,96,0.95)' : 'rgba(30,38,48,0.55)';
      ctx.fillRect(b.x + 8 + i * 22, b.y + b.h - band + 4, 9, band - 7);
    }
    // Shop awning at the door side for landmarks.
    if (b.shop) {
      ctx.fillStyle = '#b03a2e';
      const dx = b.door.x;
      const dy = b.door.y;
      if (Math.abs(dy - (b.y + b.h)) < 20) ctx.fillRect(b.x + b.w / 2 - 26, b.y + b.h - 2, 52, 8);
      else if (Math.abs(dy - b.y) < 20) ctx.fillRect(b.x + b.w / 2 - 26, b.y - 6, 52, 8);
      else if (Math.abs(dx - (b.x + b.w)) < 20) ctx.fillRect(b.x + b.w - 2, b.y + b.h / 2 - 26, 8, 52);
      else ctx.fillRect(b.x - 6, b.y + b.h / 2 - 26, 8, 52);
    }
  }

  function drawProp(state, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    switch (p.kind) {
      case 'lamp':
        ctx.fillStyle = '#3c4148';
        ctx.fillRect(-2, -2, 4, 4);
        ctx.fillStyle = '#ffd98c';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'palm': {
        ctx.strokeStyle = '#6e5136';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(3, -4);
        ctx.stroke();
        ctx.strokeStyle = '#3e7d3a';
        ctx.lineWidth = 2.4;
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2 + p.rot;
          ctx.beginPath();
          ctx.moveTo(3, -4);
          ctx.quadraticCurveTo(3 + Math.cos(a) * 10, -4 + Math.sin(a) * 10 - 3, 3 + Math.cos(a) * 17, -4 + Math.sin(a) * 17 + 4);
          ctx.stroke();
        }
        break;
      }
      case 'crate':
        ctx.rotate(p.rot);
        ctx.fillStyle = '#9a743f';
        ctx.fillRect(-11, -11, 22, 22);
        ctx.strokeStyle = 'rgba(60,40,14,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-11, -11, 22, 22);
        ctx.beginPath();
        ctx.moveTo(-11, -11);
        ctx.lineTo(11, 11);
        ctx.moveTo(11, -11);
        ctx.lineTo(-11, 11);
        ctx.stroke();
        break;
      case 'barrel':
        ctx.fillStyle = p.hue > 0.5 ? '#7a4a2e' : '#4a6a7a';
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();
        break;
      case 'dumpster':
        ctx.fillStyle = '#3f6146';
        ctx.fillRect(-15, -11, 30, 22);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-15, -11, 30, 6);
        break;
      case 'bench':
        ctx.rotate(p.rot);
        ctx.fillStyle = '#7a5c38';
        ctx.fillRect(-11, -4, 22, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(-11, -1, 22, 2);
        break;
      case 'stall':
        ctx.rotate(p.rot);
        ctx.fillStyle = p.hue > 0.5 ? '#c23b2e' : '#2e6fc2';
        ctx.fillRect(-15, -12, 30, 24);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (let i = 0; i < 3; i += 1) ctx.fillRect(-15 + i * 10, -12, 5, 24);
        break;
      case 'umbrella':
        ctx.fillStyle = ['#e05545', '#f2b21b', '#3f9ec2', '#e8e6df'][Math.floor(p.hue * 4) % 4];
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        break;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- entities

  function drawCar(state, car, darkness) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const w = car.w;
    const h = car.h;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rrect(-w / 2 + 3, -h / 2 + 5, w, h, 7);
    ctx.fill();
    // Wheels.
    ctx.fillStyle = '#15171a';
    const ww = 9;
    const wh = 5;
    ctx.fillRect(-w / 2 + 4, -h / 2 - 2, ww, wh);
    ctx.fillRect(w / 2 - ww - 4, -h / 2 - 2, ww, wh);
    ctx.fillRect(-w / 2 + 4, h / 2 - wh + 2, ww, wh);
    ctx.fillRect(w / 2 - ww - 4, h / 2 - wh + 2, ww, wh);
    // Body.
    ctx.fillStyle = car.dead ? '#33363b' : car.color;
    rrect(-w / 2, -h / 2, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (car.type === 'muscle' && !car.dead) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-w / 2 + 4, -3, w - 8, 6);
    }
    if (car.type === 'pickup' && !car.dead) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeRect(-w / 2 + 3, -h / 2 + 3, w * 0.34, h - 6);
    }
    if ((car.role === 'cop' || car.role === 'block') && !car.dead) {
      ctx.fillStyle = '#274268';
      ctx.fillRect(-w * 0.16, -h / 2 + 2, w * 0.3, h - 4);
    }
    // Glasshouse and roof.
    ctx.fillStyle = '#1b2634';
    rrect(-w * 0.08, -h / 2 + 4, w * 0.3, h - 8, 3);
    ctx.fill();
    ctx.fillStyle = car.dead ? '#3a3e44' : car.color;
    rrect(-w * 0.3, -h / 2 + 4.5, w * 0.2, h - 9, 3);
    ctx.fill();
    // Lights.
    ctx.fillStyle = darkness > 0.25 ? '#ffeeb8' : '#f5eeda';
    ctx.fillRect(w / 2 - 3, -h / 2 + 3, 3, 5);
    ctx.fillRect(w / 2 - 3, h / 2 - 8, 3, 5);
    ctx.fillStyle = '#c22e2e';
    ctx.fillRect(-w / 2, -h / 2 + 3, 3, 5);
    ctx.fillRect(-w / 2, h / 2 - 8, 3, 5);
    if (car.type === 'taxi' && !car.dead) {
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(-6, -4, 12, 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(-6, -4, 12, 8);
    }
    if ((car.role === 'cop' || car.role === 'block') && !car.dead) {
      const phase = Math.floor(state.time * 6) % 2 === 0;
      ctx.fillStyle = phase ? '#ff4040' : '#701414';
      ctx.fillRect(-7, -h / 2 + 2, 6, 5);
      ctx.fillStyle = phase ? '#1c46ff' : '#4090ff';
      ctx.fillRect(1, -h / 2 + 2, 6, 5);
      ctx.fillStyle = phase ? '#4090ff' : '#1c46ff';
      ctx.fillRect(-7, h / 2 - 7, 6, 5);
      ctx.fillStyle = phase ? '#701414' : '#ff4040';
      ctx.fillRect(1, h / 2 - 7, 6, 5);
    }
    ctx.restore();
    // Damage smoke, drawn unrotated.
    if (!car.dead && car.hp < car.maxHp * 0.35) {
      const wob = Math.sin(state.time * 7 + car.id) * 3;
      ctx.fillStyle = 'rgba(70,72,76,0.4)';
      ctx.beginPath();
      ctx.arc(car.x + wob, car.y - 8 - (state.time * 12 + car.id * 7) % 12, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (car.dead) {
      ctx.fillStyle = 'rgba(40,40,44,0.35)';
      ctx.beginPath();
      ctx.arc(car.x, car.y - 12 - (state.time * 9 + car.id * 5) % 16, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBoat(state, boat) {
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.angle);
    const w = boat.w;
    const h = boat.h;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(3, 5, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hull with a pointed bow.
    ctx.fillStyle = boat.dead ? '#3a3e44' : boat.color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 3);
    ctx.lineTo(w * 0.22, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w * 0.22, h / 2);
    ctx.lineTo(-w / 2, h / 2 - 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    ctx.fillStyle = '#22303e';
    if (boat.type === 'speedboat') ctx.fillRect(-w * 0.05, -h / 2 + 4, w * 0.24, h - 8);
    else ctx.fillRect(-w * 0.2, -h / 2 + 4, w * 0.3, h - 8);
    if (boat.role === 'police') {
      ctx.fillStyle = '#274268';
      ctx.fillRect(-w * 0.34, -3, w * 0.2, 6);
      const phase = Math.floor(state.time * 6) % 2 === 0;
      ctx.fillStyle = phase ? '#ff4040' : '#4090ff';
      ctx.fillRect(-4, -3, 6, 6);
    }
    ctx.restore();
  }

  function drawPed(state, ped) {
    if (ped.inCar) return;
    ctx.save();
    ctx.translate(ped.x, ped.y);
    if (ped.dead) {
      ctx.rotate(ped.angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(120,20,18,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ped.shirt;
      rrect(-13, -5, 26, 10, 5);
      ctx.fill();
      ctx.fillStyle = '#d9a066';
      ctx.beginPath();
      ctx.arc(15, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const bob = Math.sin(ped.walkPhase || 0) * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(ped.angle);
    // Legs (two small swinging blocks), body, head.
    ctx.fillStyle = ped.pants;
    ctx.fillRect(-3, -6 + bob, 7, 4);
    ctx.fillRect(-3, 2 - bob, 7, 4);
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.arc(0, 0, 8.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9a066';
    ctx.beginPath();
    ctx.arc(1.5, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    if (ped.role === 'cop') {
      ctx.fillStyle = '#1d2c47';
      ctx.beginPath();
      ctx.arc(1.5, 0, 5.4, Math.PI * 0.7, Math.PI * 1.9);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(-4, -1.4, 2.6, 2.6);
    }
    if (ped.role === 'contact') {
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(1.5, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayerFigure(state) {
    const p = state.player;
    if (state.vehicle || p.dead) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 11, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    const bob = p.moving ? Math.sin(p.walkPhase) * 1.8 : 0;
    ctx.fillStyle = '#2c3440';
    ctx.fillRect(-3, -6.4 + bob, 7.5, 4.4);
    ctx.fillRect(-3, 2 - bob, 7.5, 4.4);
    // The player's teal jacket and pale cap read at a glance.
    ctx.fillStyle = '#0f7d8c';
    ctx.beginPath();
    ctx.arc(0, 0, 9.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e2d2';
    ctx.beginPath();
    ctx.arc(1.5, 0, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f7d8c';
    ctx.beginPath();
    ctx.arc(1.5, 0, 5.5, Math.PI * 0.75, Math.PI * 1.85);
    ctx.fill();
    // Gun arm when armed.
    if (state.weapon !== 'fists') {
      ctx.fillStyle = '#22262c';
      ctx.fillRect(6, -1.6, state.weapon === 'rifle' ? 17 : 12, 3.2);
    }
    ctx.restore();
  }

  function drawHelicopter(state) {
    const heli = state.wanted.heli;
    if (!heli) return;
    // Ground shadow first (offset by altitude), then the aircraft.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(heli.x + 60, heli.y + 74, 34, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.rotate(heli.angle);
    ctx.fillStyle = '#2b3442';
    rrect(-24, -10, 48, 20, 9);
    ctx.fill();
    ctx.fillStyle = '#22303e';
    ctx.fillRect(-52, -3, 30, 6);
    ctx.fillRect(-54, -9, 5, 18);
    ctx.fillStyle = '#9fd8ef';
    rrect(8, -7, 14, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(-8, -10, 5, 20);
    ctx.restore();
    // Rotor disc.
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.rotate(state.time * 31);
    ctx.fillStyle = 'rgba(200,210,220,0.20)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 46, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const lifeT = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, lifeT);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.kind === 'smoke' ? 1 + p.life : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- frame

  function draw(state) {
    const focus = state.vehicle || state.player;
    camX = Math.max(VIEW.w / 2, Math.min(WORLD_PX - VIEW.w / 2, focus.x));
    camY = Math.max(VIEW.h / 2, Math.min(WORLD_PX - VIEW.h / 2, focus.y));
    const sun = sunAt(state.tod);
    const rain = state.weather ? state.weather.rain : 0;
    const darkness = Math.min(1, sun.darkness + rain * 0.25);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.save();
    ctx.translate(VIEW.w / 2 - camX, VIEW.h / 2 - camY);

    const x0 = camX - VIEW.w / 2 - 40;
    const y0 = camY - VIEW.h / 2 - 40;
    const x1 = camX + VIEW.w / 2 + 40;
    const y1 = camY + VIEW.h / 2 + 40;
    const inView = (e, pad = 90) => e.x >= x0 - pad && e.x <= x1 + pad && e.y >= y0 - pad && e.y <= y1 + pad;

    drawGround(state, x0, y0, x1, y1);

    // Skid marks under everything mobile.
    ctx.fillStyle = 'rgba(12,12,14,0.4)';
    for (const s of state.skids) {
      if (!inView(s, 10)) continue;
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }
    // Hidden packages glint.
    for (const pkg of state.city.packages) {
      if (pkg.taken || !inView(pkg, 20)) continue;
      const pulse = 0.6 + Math.sin(state.time * 4 + pkg.id) * 0.4;
      ctx.fillStyle = `rgba(255,210,62,${0.35 * pulse})`;
      ctx.beginPath();
      ctx.arc(pkg.x, pkg.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(pkg.x - 5, pkg.y - 5, 10, 10);
      ctx.fillStyle = '#8a6a10';
      ctx.fillRect(pkg.x - 5, pkg.y - 1, 10, 2);
    }
    for (const b of state.city.buildings) {
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      drawBuilding(state, b, darkness);
    }
    for (const p of state.city.props) {
      if (!inView(p, 30)) continue;
      drawProp(state, p);
    }
    for (const boat of state.boats) if (inView(boat)) drawBoat(state, boat);
    for (const car of state.cars) if (inView(car)) drawCar(state, car, darkness);
    for (const ped of state.peds) if (inView(ped, 40)) drawPed(state, ped);
    drawPlayerFigure(state);

    // Bullets as tracers.
    ctx.strokeStyle = 'rgba(255,230,150,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const b of state.bullets) {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    }
    ctx.stroke();

    drawParticles(state);
    drawHelicopter(state);

    // Objective beacon.
    if (state.marker) {
      const m = state.marker;
      const pulse = 0.55 + Math.sin(state.time * 5) * 0.25;
      ctx.fillStyle = m.color;
      ctx.globalAlpha = 0.16 * pulse + 0.08;
      ctx.fillRect(m.x - 5, m.y - 300, 10, 300);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 20 + Math.sin(state.time * 5) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.translate(m.x, m.y - 34 - Math.sin(state.time * 3) * 4);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = m.color;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    }

    ctx.restore();

    // ---- lighting pass (screen space) ----
    if (darkness > 0.04) {
      ctx.fillStyle = `rgba(9,13,36,${darkness * 0.6})`;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.globalCompositeOperation = 'lighter';
      const toScreen = (wx, wy) => ({ x: wx - camX + VIEW.w / 2, y: wy - camY + VIEW.h / 2 });
      // Lamp pools.
      for (const p of state.city.props) {
        if (p.kind !== 'lamp') continue;
        const s = toScreen(p.x, p.y);
        if (s.x < -70 || s.y < -70 || s.x > VIEW.w + 70 || s.y > VIEW.h + 70) continue;
        ctx.globalAlpha = darkness * 0.5;
        ctx.drawImage(lightSprite, s.x - 62, s.y - 62, 124, 124);
      }
      // Headlight cones for the player's vehicle and nearby traffic.
      const cone = (veh) => {
        const s = toScreen(veh.x, veh.y);
        if (s.x < -160 || s.y < -160 || s.x > VIEW.w + 160 || s.y > VIEW.h + 160) return;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(veh.angle);
        ctx.globalAlpha = darkness * 0.4;
        ctx.drawImage(lightSprite, 10, -52, 190, 104);
        ctx.restore();
      };
      for (const car of state.cars) if (!car.dead) cone(car);
      for (const boat of state.boats) if (!boat.dead) cone(boat);
      // The helicopter's spotlight pins the player.
      if (state.wanted.heli && !state.wanted.heli.leaving) {
        const s = toScreen(state.player.x, state.player.y);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(lightSprite, s.x - 110, s.y - 110, 220, 220);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Golden-hour warmth + rain grade.
    if (sun.warm > 0.03 && darkness < 0.9) {
      ctx.fillStyle = `rgba(255,146,60,${sun.warm * 0.10})`;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }
    if (rain > 0.03) {
      ctx.fillStyle = `rgba(70,90,110,${rain * 0.13})`;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.strokeStyle = `rgba(200,225,245,${0.34 * rain})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const drops = Math.floor(110 * rain);
      for (let i = 0; i < drops; i += 1) {
        const rx = (hash2(i, 7) * (VIEW.w + 240) + state.time * 130) % (VIEW.w + 240) - 120;
        const ry = (hash2(i, 13) * (VIEW.h + 240) + state.time * 940) % (VIEW.h + 240) - 120;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 3, ry + 14);
      }
      ctx.stroke();
    }

    // Floating texts (cash popups, notices) in world space would need the camera;
    // they are stored in screen-independent world coords, so draw them transformed.
    ctx.save();
    ctx.translate(VIEW.w / 2 - camX, VIEW.h / 2 - camY);
    ctx.textAlign = 'center';
    for (const f of state.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.maxLife);
      ctx.font = `700 ${f.size || 19}px system-ui, sans-serif`;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 34);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Landmark names when close.
    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    for (const b of state.city.buildings) {
      if (!b.shop) continue;
      const s = { x: b.x + b.w / 2 - camX + VIEW.w / 2, y: b.y - 8 - camY + VIEW.h / 2 };
      if (s.x < -80 || s.y < -20 || s.x > VIEW.w + 80 || s.y > VIEW.h + 20) continue;
      if (Math.hypot(b.x + b.w / 2 - focus.x, b.y + b.h / 2 - focus.y) > 560) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const wText = ctx.measureText(b.name).width;
      ctx.fillRect(s.x - wText / 2 - 6, s.y - 13, wText + 12, 17);
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(b.name, s.x, s.y);
    }

    // Vignette.
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  return { draw, screenToWorld };
}
