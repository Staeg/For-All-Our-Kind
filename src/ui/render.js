// Canvas drawing for the strategic map and the battle viewer. Reads game state only.
import { MAP_SIZE, TOWER_OFFSET, ARENA_RADIUS, SPAWN_DEPTH } from '../sim/data.js';
import { NODE_POS, CENTRE, LANES, laneNodes, posAt } from '../sim/map.js';
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
function towerSpots(pi) {
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

  for (const p of game.players) {
    for (const t of towerSpots(p.index)) drawTower(ctx, p.factionId, t.x, t.y, 30, !p.alive);
  }
  for (const p of game.players) {
    const n = NODE_POS[p.index];
    drawBase(ctx, p.factionId, n.x, n.y, 64, !p.alive);
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
    if (a.units.length > 6 || a.state === 'siege') {
      label(ctx, pos.x, pos.y - 18, a.state === 'siege' ? `${a.units.length} sieging` : `${a.units.length}`, game.players[a.owner].faction.colors.main);
    }
  }

  // Tower shots: a bolt from the tower top down onto the sieging army.
  for (const s of game.towerShots) {
    const age = t - s.t;
    if (age > 0.5) continue;
    const col = game.players[s.owner].faction.colors.accent;
    ctx.globalAlpha = 1 - age * 2;
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 34);
    ctx.lineTo(s.x + 4, s.y - 18);
    ctx.lineTo(s.x - 3, s.y - 10);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    if (s.hit) {
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8 + age * 20, 0, Math.PI * 2);
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
    ctx.fillText('No battle in progress. Click a battle on the map to watch it.', W / 2, H / 2);
    return;
  }
  const R = ARENA_RADIUS + 1.5;
  // Camera follows the fighting: frame all units, never tighter than 7 diameters.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const u of battle.units) {
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
