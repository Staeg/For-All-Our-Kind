// Canvas drawing for the strategic map and the battle viewer. Reads game state only.
import {
  MAP_SIZE, TOWER_OFFSET, ARENA_RADIUS, SPAWN_DEPTH, SPAWN_WIDTH, PLAYER_HP, FIRE_SPEED,
} from '../sim/data.js';
import { NODE_POS, CENTRE, LANES, laneNodes, posAt, routeFromNodes } from '../sim/map.js';
import { TOWER_RANGE } from '../sim/battle.js';
import { ensureSlots } from '../sim/formation.js';
import { drawUnit, drawBase, drawTower } from './art.js';

const ROAD = '#c9b48a';
const ROAD_EDGE = '#a48f66';

let terrain = null;

function bakeTerrain(px) {
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const c = cv.getContext('2d');
  const k = px / MAP_SIZE;
  const g = c.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75);
  g.addColorStop(0, '#7f9a5c');
  g.addColorStop(1, '#5f7748');
  c.fillStyle = g;
  c.fillRect(0, 0, px, px);
  // Deterministic tufts and pebbles.
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const x = rnd() * px;
    const y = rnd() * px;
    c.fillStyle = rnd() < 0.7 ? 'rgba(40,70,30,0.25)' : 'rgba(200,190,150,0.25)';
    c.beginPath();
    c.arc(x, y, (1 + rnd() * 3) * k * 2, 0, Math.PI * 2);
    c.fill();
  }
  // Roads: perimeter plus both diagonals.
  const roads = [[0, 1], [1, 2], [2, 3], [3, 0], [0, CENTRE], [1, CENTRE], [2, CENTRE], [3, CENTRE]];
  for (const [w, col] of [[34, ROAD_EDGE], [28, ROAD]]) {
    c.strokeStyle = col;
    c.lineWidth = w * k;
    c.lineCap = 'round';
    for (const [a, b] of roads) {
      c.beginPath();
      c.moveTo(NODE_POS[a].x * k, NODE_POS[a].y * k);
      c.lineTo(NODE_POS[b].x * k, NODE_POS[b].y * k);
      c.stroke();
    }
  }
  c.fillStyle = ROAD_EDGE;
  c.beginPath();
  c.arc(NODE_POS[CENTRE].x * k, NODE_POS[CENTRE].y * k, 46 * k, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#d6c398';
  c.beginPath();
  c.arc(NODE_POS[CENTRE].x * k, NODE_POS[CENTRE].y * k, 40 * k, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120,100,60,0.5)';
  c.lineWidth = 2 * k;
  c.beginPath();
  c.arc(NODE_POS[CENTRE].x * k, NODE_POS[CENTRE].y * k, 26 * k, 0, Math.PI * 2);
  c.stroke();
  return cv;
}

// Where each player's three towers stand, regardless of who is still alive.
export function towerSpots(pi) {
  const all = [true, true, true, true];
  return LANES.map((lane) => {
    const nodes = laneNodes(pi, lane, all);
    const a = NODE_POS[nodes[0]];
    const b = NODE_POS[nodes[1]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + ((b.x - a.x) / len) * TOWER_OFFSET, y: a.y + ((b.y - a.y) / len) * TOWER_OFFSET };
  });
}

export function drawMap(ctx, game, view) {
  const px = ctx.canvas.width;
  const k = px / MAP_SIZE;
  if (!terrain || terrain.width !== px) terrain = bakeTerrain(px);
  ctx.drawImage(terrain, 0, 0);
  ctx.save();
  ctx.scale(k, k);

  // Eliminated players' buildings are gone entirely.
  for (const p of game.players) {
    if (!p.alive) continue;
    for (const t of towerSpots(p.index)) drawTower(ctx, p.factionId, t.x, t.y, 30, false);
  }
  for (const p of game.players) {
    if (!p.alive) continue;
    const n = NODE_POS[p.index];
    drawBase(ctx, p.factionId, n.x, n.y, 64, false);
    // Health bar under the castle.
    const w = 84;
    const y = n.y + 50;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(n.x - w / 2 - 2, y - 2, w + 4, 11);
    ctx.fillStyle = '#d94141';
    ctx.fillRect(n.x - w / 2, y, w * Math.max(0, p.hp / PLAYER_HP), 7);
    if (p.index === view.human) {
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 2;
      ctx.strokeRect(n.x - w / 2 - 2, y - 2, w + 4, 11);
    }
  }

  // Marching and sieging armies: a little column of troops per dot.
  const t = game.time;
  for (const a of game.armies) {
    if (a.state === 'battle') continue;
    const pos = posAt(a.route, a.s);
    const fid = game.players[a.owner].factionId;
    const faceLeft = pos.dx < -0.01;
    const shown = a.units.slice(0, 6);
    for (let i = shown.length - 1; i >= 0; i--) {
      const row = Math.floor(i / 2);
      const side = (i % 2 ? 1 : -1) * 6;
      const back = row * 11;
      const bob = a.state === 'march' ? Math.sin(t * 9 + i * 1.7) * 1.5 : 0;
      const x = pos.x - pos.dx * back - pos.dy * side;
      const y = pos.y - pos.dy * back + pos.dx * side + bob;
      drawUnit(ctx, fid, shown[i].def.id, x, y, 20, faceLeft);
    }
    if (a.units.length > 6) label(ctx, pos.x, pos.y - 18, `${a.units.length}`, game.players[a.owner].faction.colors.main);
  }

  // Fire waves from eliminated players' corners.
  for (const f of game.fires) {
    const reach = Math.min(f.d, f.len);
    // Full strength while rolling, then gone within a third of a second.
    const fade = Math.max(0, Math.min(1, 1 - (t - f.start - f.len / FIRE_SPEED) / 0.35));
    for (let d = 0; d < reach; d += 14) {
      const flick = Math.sin(t * 20 + d * 0.7) * 0.5 + 0.5;
      const front = reach - d < 60 ? 1.4 : 1;
      ctx.globalAlpha = fade * (0.55 + flick * 0.35);
      ctx.fillStyle = flick > 0.5 ? '#ff7a1a' : '#ffcc33';
      ctx.beginPath();
      ctx.arc(f.ax + f.ux * d + f.uy * (flick - 0.5) * 10, f.ay + f.uy * d - f.ux * (flick - 0.5) * 10, (11 + flick * 7) * front, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Battles: pulsing ring split into each side's colour, with crossed swords.
  for (const b of game.battles) {
    const owners = [...b.owners()];
    const r = 20 + Math.sin(t * 6) * 2;
    owners.forEach((o, i) => {
      ctx.strokeStyle = game.players[o].faction.colors.main;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, (i / owners.length) * Math.PI * 2 + t, ((i + 1) / owners.length) * Math.PI * 2 + t);
      ctx.stroke();
    });
    if (view.selectedBattle === b.id) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    swords(ctx, b.x, b.y);
    label(ctx, b.x, b.y + 32, `${b.units.length}`, '#fff');
  }
  ctx.restore();
}

function swords(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  for (const s of [1, -1]) {
    ctx.save();
    ctx.scale(s, 1);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-5, 6);
    ctx.lineTo(5, 6);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function label(ctx, x, y, text, color) {
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function battleAt(game, mx, my) {
  let best = null;
  let bestD = 40;
  for (const b of game.battles) {
    const d = Math.hypot(b.x - mx, b.y - my);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

// ---- battle viewer ------------------------------------------------------------

export function drawBattle(ctx, game, battle) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = '#3f4a33';
  ctx.fillRect(0, 0, W, H);
  if (!battle) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("No battle yet", W / 2, H / 2);
    return;
  }
  const R = ARENA_RADIUS + 1.5;
  // Camera follows the fighting: frame all units, never tighter than 7 diameters.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const pts = battle.tower ? [...battle.units, battle.tower] : battle.units;
  for (const u of pts) {
    x0 = Math.min(x0, u.x);
    x1 = Math.max(x1, u.x);
    y0 = Math.min(y0, u.y);
    y1 = Math.max(y1, u.y);
  }
  const aspect = W / H;
  const want = {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    half: Math.min(R, Math.max(7, (y1 - y0) / 2 + 2, (x1 - x0) / 2 / aspect + 2)),
  };
  const cam = battle.cam || (battle.cam = { ...want });
  cam.x += (want.x - cam.x) * 0.08;
  cam.y += (want.y - cam.y) * 0.08;
  cam.half += (want.half - cam.half) * 0.08;
  const k = H / (2 * cam.half);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(k, k);
  ctx.translate(-cam.x, -cam.y);

  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, R);
  g.addColorStop(0, '#9b8a62');
  g.addColorStop(0.85, '#7d7050');
  g.addColorStop(1, '#5b5a3c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS - SPAWN_DEPTH, 0, Math.PI * 2);
  ctx.stroke();

  const tw = battle.tower;
  if (tw) {
    const owner = game.players[tw.owner];
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.arc(tw.x, tw.y, tw.r + TOWER_RANGE, 0, Math.PI * 2);
    ctx.stroke();
    drawTower(ctx, owner.factionId, tw.x, tw.y - 0.6, tw.r * 2.6, false);
    const frac = Math.max(0, owner.hp / PLAYER_HP);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(tw.x - 1.6, tw.y - 3, 3.2, 0.3);
    ctx.fillStyle = '#d94141';
    ctx.fillRect(tw.x - 1.6, tw.y - 3, 3.2 * frac, 0.3);
    if (tw.atk && battle.time - tw.atk.time < 0.35) {
      const age = battle.time - tw.atk.time;
      ctx.strokeStyle = owner.faction.colors.accent;
      ctx.globalAlpha = 1 - age / 0.35;
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.moveTo(tw.x, tw.y - 2.2);
      ctx.lineTo((tw.x + tw.atk.tx) / 2 + 0.6, (tw.y - 2.2 + tw.atk.ty) / 2 - 0.6);
      ctx.lineTo(tw.atk.tx, tw.atk.ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (tw.atk.hit) burst(ctx, tw.atk.tx, tw.atk.ty, age);
    }
  }

  const units = [...battle.units].sort((a, b) => a.y - b.y);
  for (const u of units) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 0.42, 0.45, 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const u of units) {
    const fid = game.players[u.owner].factionId;
    drawUnit(ctx, fid, u.def.id, u.x, u.y, 1.35, u.fx < 0);
    const frac = u.src.hp / u.stats.hp;
    if (frac < 0.999) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(u.x - 0.45, u.y - 0.78, 0.9, 0.13);
      ctx.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#e8c33a' : '#e0453b';
      ctx.fillRect(u.x - 0.45, u.y - 0.78, 0.9 * frac, 0.13);
    }
  }

  // Attack effects for the last few frames after each swing or shot.
  for (const u of battle.units) {
    if (!u.atk) continue;
    const age = battle.time - u.atk.time;
    if (age > 0.25) continue;
    const accent = game.players[u.owner].faction.colors.accent;
    if (u.stats.rng > 0) {
      const p = Math.min(1, age / 0.18);
      const x = u.x + (u.atk.tx - u.x) * p;
      const y = u.y + (u.atk.ty - u.y) * p;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x, y, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(x - (u.atk.tx - u.x) * 0.08, y - (u.atk.ty - u.y) * 0.08);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (p >= 1 && u.atk.hit) burst(ctx, u.atk.tx, u.atk.ty, age);
    } else {
      ctx.strokeStyle = u.atk.hit ? '#fff6d0' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.1;
      const ang = Math.atan2(u.atk.ty - u.y, u.atk.tx - u.x);
      ctx.beginPath();
      ctx.arc(u.x, u.y, 0.75, ang - 0.9 + age * 6, ang - 0.2 + age * 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function burst(ctx, x, y, age) {
  ctx.fillStyle = `rgba(255,210,80,${Math.max(0, 0.8 - age * 3)})`;
  ctx.beginPath();
  ctx.arc(x, y, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

// ---- formation editor ---------------------------------------------------------

// The direction a lane's army is travelling at the lane's median fight.
export function laneDirection(game, pi, lane) {
  const nodes = laneNodes(pi, lane, game.alive());
  if (!nodes) return null;
  const route = routeFromNodes(nodes);
  const p = posAt(route, route.length / 2);
  return { x: p.dx, y: p.dy };
}

// Screen <-> arena transform for the editor. The view keeps map orientation, so
// the formation appears rotated exactly as it will arrive at the lane's centre.
export function formationFrame(ctx, dir) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const k = Math.min(H, W) / 24;
  const off = ARENA_RADIUS - 4; // leaves room for the tower behind the zone
  const c = { x: -dir.x * off, y: -dir.y * off };
  return {
    k,
    c,
    toArena: (sx, sy) => ({ x: c.x + (sx - W / 2) / k, y: c.y + (sy - H / 2) / k }),
  };
}

export function slotToArena(slot, dir) {
  const from = ARENA_RADIUS - slot.depth;
  return { x: -dir.x * from - dir.y * slot.lat, y: -dir.y * from + dir.x * slot.lat };
}

export function arenaToSlot(q, dir) {
  return { lat: -q.x * dir.y + q.y * dir.x, depth: ARENA_RADIUS + q.x * dir.x + q.y * dir.y };
}

// towerFight: true while a battle is raging at this lane's tower.
export function drawFormation(ctx, game, pi, lane, drag, towerFight) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const dir = laneDirection(game, pi, lane);
  ctx.fillStyle = '#3f4a33';
  ctx.fillRect(0, 0, W, H);
  if (!dir) return;
  const p = game.players[pi];
  const slots = ensureSlots(p, lane);
  const fr = formationFrame(ctx, dir);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(fr.k, fr.k);
  ctx.translate(-fr.c.x, -fr.c.y);

  ctx.fillStyle = '#8c7c57';
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS + 1.5, 0, Math.PI * 2);
  ctx.fill();

  // The player's quarter of the field, rotated to the lane's direction.
  const corners = [[-SPAWN_WIDTH / 2, 0], [SPAWN_WIDTH / 2, 0], [SPAWN_WIDTH / 2, SPAWN_DEPTH], [-SPAWN_WIDTH / 2, SPAWN_DEPTH]]
    .map(([lat, depth]) => slotToArena({ lat, depth }, dir));
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = p.faction.colors.main;
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  corners.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([0.3, 0.3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let d = 2; d < SPAWN_DEPTH; d += 2) {
    const a = slotToArena({ lat: -SPAWN_WIDTH / 2, depth: d }, dir);
    const b = slotToArena({ lat: SPAWN_WIDTH / 2, depth: d }, dir);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // This lane's tower, standing behind the deployment zone.
  const tq = slotToArena({ lat: 0, depth: -2.4 }, dir);
  if (towerFight) {
    ctx.fillStyle = `rgba(230,60,40,${0.25 + 0.15 * Math.sin(game.time * 8)})`;
    ctx.beginPath();
    ctx.arc(tq.x, tq.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  drawTower(ctx, p.factionId, tq.x, tq.y, 3.2, false);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(tq.x - 1.6, tq.y + 1.9, 3.2, 0.32);
  ctx.fillStyle = '#d94141';
  ctx.fillRect(tq.x - 1.6, tq.y + 1.9, 3.2 * Math.max(0, p.hp / PLAYER_HP), 0.32);

  // Arrow toward the enemy.
  const tip = slotToArena({ lat: 0, depth: SPAWN_DEPTH + 2.6 }, dir);
  const tail = slotToArena({ lat: 0, depth: SPAWN_DEPTH + 0.6 }, dir);
  ctx.strokeStyle = '#ffe2a0';
  ctx.fillStyle = '#ffe2a0';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x + dir.x * 0.6, tip.y + dir.y * 0.6);
  ctx.lineTo(tip.x - dir.y * 0.5, tip.y + dir.x * 0.5);
  ctx.lineTo(tip.x + dir.y * 0.5, tip.y - dir.x * 0.5);
  ctx.closePath();
  ctx.fill();

  for (const { u, i, slot } of formationUnits(p, lane, slots)) {
    const dragging = drag && drag.type === u.id && drag.i === i;
    const q = dragging ? drag.pos : slotToArena(slot, dir);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(q.x, q.y + 0.42, 0.45, 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    if (dragging) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawUnit(ctx, p.factionId, u.id, q.x, q.y, 1.35, dir.x < -0.01);
  }
  ctx.restore();
}

export function formationUnits(p, lane, slots) {
  const out = [];
  for (const u of p.faction.units) {
    const n = p.roster[lane][u.id] || 0;
    for (let i = 0; i < n; i++) out.push({ u, i, slot: slots[u.id][i] });
  }
  return out;
}
