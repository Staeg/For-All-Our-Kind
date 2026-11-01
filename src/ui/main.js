// Browser entry point: start screen, real-time loop around the deterministic sim,
// the unit bar / info panel, the deploy screen and the battle view.
import {
  FACTIONS, TICK_HZ, UNIT_COST, UPGRADE_COST, STAT_KEYS, effectiveStats, MAP_SIZE,
} from '../sim/data.js';
import { Game } from '../sim/game.js';
import { SimpleAI } from '../sim/ai.js';
import { LANES, laneNodes, routeFromNodes, posAt } from '../sim/map.js';
import { nearestFree, clampSlot, ensureSlots, placeNewest } from '../sim/formation.js';
import { spriteDataUrl, upgradeIcon, STAT_ICON, STAT_LABEL } from './art.js';
import {
  drawMap, drawBattle, battleAt, towerSpots, drawFormation, formationFrame, laneDirection,
  slotToArena, arenaToSlot, formationUnits,
} from './render.js';

const $ = (id) => document.getElementById(id);
const HUMAN_SEAT = 3; // bottom-left

let chosen = null;
let game = null;
let ais = [];
let human = null; // seat index, or null when watching
let speed = 1;
let acc = 0;
let last = 0;
// deployLane: lane shown on the deploy screen. drag: a unit being moved there.
// hover/locked: unit type shown in the info panel. buyDrag: an icon being dragged.
const view = {
  selectedBattle: null, pinned: false, deployLane: 'mid', drag: null,
  hover: null, locked: null, hoverUpgrade: false, buyDrag: null, human: null,
};
let logSeen = 0;
let barKey = '';
let infoKey = '';

// ---- shared bits ----------------------------------------------------------------

function fmtStat(k, v) {
  if (k === 'spd') return v.toFixed(2).replace(/0$/, '');
  if (k === 'rng' && v === 0) return 'melee';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function statsHtml(def, upgraded) {
  const s = effectiveStats(def, upgraded);
  const base = def.stats;
  return STAT_KEYS.filter((k) => k === 'hp' || k === 'dmg' || k === 'spd' || k === 'rng' || s[k] !== 0)
    .map((k) => `<span class="stat${s[k] !== base[k] ? ' up' : ''}" title="${STAT_LABEL[k]}">${STAT_ICON[k]}${fmtStat(k, s[k])}</span>`)
    .join('');
}

function modsText(mods) {
  return Object.entries(mods).map(([k, v]) => {
    if (k === 'regen') return `+${v} HP/s regen in battle`;
    if (k === 'splash') return `${Math.round(v * 100)}% of each hit splashes onto enemies touching the target`;
    return `+${+v.toFixed(2)} ${STAT_LABEL[k]}`;
  }).join(', ');
}

// ---- start screen -------------------------------------------------------------

function buildStart() {
  const wrap = $('faction-cards');
  wrap.innerHTML = '';
  for (const f of FACTIONS) {
    const card = document.createElement('div');
    card.className = 'fcard';
    card.style.borderTopColor = f.colors.main;
    card.innerHTML = `<h3 style="color:${f.colors.main}">${f.name}</h3><p>${f.blurb}</p>`
      + f.units.map((u) => `<div class="urow"><img src="${spriteDataUrl(f.id, u.id)}" alt="">`
        + `<div><div class="nm">${u.name} <small>(${u.role})</small></div><div class="stats">${statsHtml(u, false)}</div>`
        + `<div class="bl">${u.blurb}</div></div></div>`).join('');
    card.onclick = () => {
      chosen = f.id;
      for (const c of wrap.children) c.classList.remove('sel');
      card.classList.add('sel');
      $('start-btn').disabled = false;
      $('start-btn').textContent = `Play as ${f.name}`;
    };
    wrap.appendChild(card);
  }
  $('start-btn').onclick = () => start(chosen);
  $('watch-btn').onclick = () => start(null);
}

// ---- game setup ---------------------------------------------------------------

function start(factionId) {
  const seed = (Date.now() % 1e9) | 0;
  const others = FACTIONS.map((f) => f.id).filter((id) => id !== factionId);
  for (let i = others.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [others[i], others[k]] = [others[k], others[i]];
  }
  let seats = others;
  human = null;
  if (factionId) {
    seats = [...others];
    seats.splice(HUMAN_SEAT, 0, factionId);
    human = HUMAN_SEAT;
  }
  game = new Game({ factions: seats, seed });
  ais = seats.map((_, i) => (i === human ? null : new SimpleAI(game, i, seed + i * 101)));
  Object.assign(view, {
    selectedBattle: null, pinned: false, deployLane: 'mid', drag: null,
    hover: null, locked: null, hoverUpgrade: false, buyDrag: null, human,
  });
  logSeen = 0;
  barKey = '';
  infoKey = '';
  $('log').innerHTML = '';
  $('overlay').classList.add('hidden');
  $('start').classList.add('hidden');
  $('game').classList.remove('hidden');
  const watching = human === null;
  $('views').classList.toggle('solo', watching);
  $('deploy-wrap').classList.toggle('hidden', watching);
  $('shop').classList.toggle('hidden', watching);
  $('gold').classList.toggle('hidden', watching);
  setSpeed(1);
  resize();
  last = performance.now();
  acc = 0;
}

function setSpeed(s) {
  speed = s;
  for (const b of document.querySelectorAll('#controls button')) {
    b.classList.toggle('on', Number(b.dataset.speed) === s);
  }
}

// ---- lanes ----------------------------------------------------------------------

function laneTarget(lane) {
  const nodes = laneNodes(human, lane, game.alive());
  return nodes ? game.players[nodes[nodes.length - 1]] : null;
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
function laneArrow(lane) {
  const nodes = laneNodes(human, lane, game.alive());
  if (!nodes) return '';
  const p = posAt(routeFromNodes(nodes), 1);
  const a = Math.round(Math.atan2(p.dy, p.dx) / (Math.PI / 4));
  return ARROWS[(a + 8) % 8];
}

function renderLaneTabs() {
  const key = LANES.map((l) => `${l}${laneTarget(l)?.index}`).join() + view.deployLane;
  if (renderLaneTabs.key === key) return;
  renderLaneTabs.key = key;
  $('lane-tabs').innerHTML = LANES.map((l) => {
    const t = laneTarget(l);
    if (!t) return '';
    return `<button data-lane="${l}" class="${view.deployLane === l ? 'on' : ''}" title="Lane toward ${t.faction.name}">`
      + `${laneArrow(l)}<span class="dot" style="background:${t.faction.colors.main}"></span></button>`;
  }).join('');
}
$('lane-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) view.deployLane = b.dataset.lane;
});

// The battle being fought at one of the human's towers, if any.
function towerBattle(lane) {
  const spot = towerSpots(human)[LANES.indexOf(lane)];
  return game.battles.find((b) => b.tower && b.tower.owner === human
    && Math.hypot(b.x - spot.x, b.y - spot.y) < 40) || null;
}

// ---- unit bar and info panel ------------------------------------------------------

function renderBar() {
  const p = game.players[human];
  const key = p.faction.units.map((u) => `${game.typeCount(human, u.id)}${p.upgrades.has(u.id)}`).join()
    + (p.gold >= UNIT_COST) + view.locked;
  if (key === barKey) return;
  barKey = key;
  $('unit-bar').innerHTML = p.faction.units.map((u) => `<div class="uicon${view.locked === u.id ? ' locked' : ''}`
    + `${p.gold < UNIT_COST ? ' poor' : ''}" data-unit="${u.id}">`
    + `<img src="${spriteDataUrl(p.factionId, u.id)}" alt="">`
    + (p.upgrades.has(u.id) ? `<span class="up">${upgradeIcon(p.factionId, u.upgrade)}</span>` : '')
    + `<span class="n">${game.typeCount(human, u.id)}</span></div>`).join('');
}

function renderInfo() {
  const p = game.players[human];
  const id = view.locked || view.hover;
  const info = $('info');
  const key = [id, view.locked, view.hoverUpgrade, p.gold >= UPGRADE_COST, [...p.upgrades].join(),
    LANES.map((l) => p.roster[l][id]).join()].join('|');
  if (key === infoKey) return;
  infoKey = key;
  if (!id) {
    info.classList.add('hidden');
    return;
  }
  const u = p.faction.units.find((x) => x.id === id);
  const owned = p.upgrades.has(id);
  const lanes = LANES.filter((l) => laneTarget(l)).map((l) => `${laneArrow(l)} ${p.roster[l][id] || 0}`).join('  ');
  let html = `<div class="head"><b>${u.name}</b><span class="cost">${UNIT_COST}g</span><span class="lanes">${lanes}</span></div>`
    + `<div class="stats">${statsHtml(u, owned)}</div>`
    + `<div class="upgs"><span class="upg-icon${owned ? ' owned' : ''}${!owned && p.gold < UPGRADE_COST ? ' poor' : ''}" data-upg="${id}">`
    + `${upgradeIcon(p.factionId, u.upgrade)}</span>`;
  if (view.locked && view.hoverUpgrade) {
    const state = owned ? 'Owned' : p.gold >= UPGRADE_COST ? 'Click to buy' : 'Not enough gold';
    html += `<span class="upg-detail"><b>${u.upgrade.name}</b> · <span class="cost">${UPGRADE_COST}g</span> · `
      + `${modsText(u.upgrade.mods)} · ${state}</span>`;
  }
  html += '</div>';
  info.innerHTML = html;
  info.classList.remove('hidden');
  info.classList.toggle('locked', !!view.locked);
}

$('unit-bar').addEventListener('pointerover', (e) => {
  const icon = e.target.closest('.uicon');
  if (icon && !view.buyDrag) view.hover = icon.dataset.unit;
});
$('unit-bar').addEventListener('pointerleave', () => { view.hover = null; });

$('info').addEventListener('pointerover', (e) => { view.hoverUpgrade = !!e.target.closest('.upg-icon'); });
$('info').addEventListener('pointerleave', () => { view.hoverUpgrade = false; });
$('info').addEventListener('click', (e) => {
  const icon = e.target.closest('.upg-icon');
  if (!icon || !view.locked || !game) return;
  game.buyUpgrade(human, icon.dataset.upg);
  infoKey = '';
  barKey = '';
});

// Press on an icon: a click locks the info panel, a drag buys the unit wherever
// it is dropped (the deploy screen, or one of your towers on the map).
$('unit-bar').addEventListener('pointerdown', (e) => {
  const icon = e.target.closest('.uicon');
  if (!icon || !game) return;
  e.preventDefault();
  view.buyDrag = { unit: icon.dataset.unit, x0: e.clientX, y0: e.clientY, moved: false };
});

window.addEventListener('pointermove', (e) => {
  const d = view.buyDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) {
    d.moved = true;
    const g = $('ghost');
    g.src = spriteDataUrl(game.players[human].factionId, d.unit);
    g.classList.remove('hidden');
  }
  if (d.moved) {
    $('ghost').style.left = `${e.clientX}px`;
    $('ghost').style.top = `${e.clientY}px`;
    $('deploy-wrap').classList.toggle('drop', overElement(e, $('deploy')));
  }
});

window.addEventListener('pointerup', (e) => {
  const d = view.buyDrag;
  view.buyDrag = null;
  if (!d || !game) return;
  $('ghost').classList.add('hidden');
  $('deploy-wrap').classList.remove('drop');
  if (!d.moved) {
    view.locked = view.locked === d.unit ? null : d.unit;
    barKey = '';
    infoKey = '';
    return;
  }
  if (overElement(e, $('deploy'))) {
    const ec = editorContext();
    if (ec && game.buyUnit(human, d.unit, view.deployLane)) {
      const pt = canvasPoint(e, $('deploy'));
      placeNewest(ec.p, view.deployLane, d.unit, clampSlot(arenaToSlot(ec.fr.toArena(pt.x, pt.y), ec.dir)));
    }
  } else if (overElement(e, $('map'))) {
    const lane = towerLaneAt(e);
    if (lane && game.buyUnit(human, d.unit, lane)) view.deployLane = lane;
  }
});

function overElement(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

// ---- deploy screen ---------------------------------------------------------------

function canvasPoint(e, cv) {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
}

function editorContext() {
  if (!game || human === null) return null;
  const dir = laneDirection(game, human, view.deployLane);
  if (!dir) return null;
  const p = game.players[human];
  const slots = ensureSlots(p, view.deployLane);
  const fr = formationFrame($('deploy').getContext('2d'), dir);
  return { dir, p, slots, fr };
}

$('deploy').addEventListener('pointerdown', (e) => {
  const ec = editorContext();
  if (!ec) return;
  const pt = canvasPoint(e, $('deploy'));
  const q = ec.fr.toArena(pt.x, pt.y);
  let best = null;
  let bestD = 0.7;
  for (const { u, i, slot } of formationUnits(ec.p, view.deployLane, ec.slots)) {
    const a = slotToArena(slot, ec.dir);
    const d = Math.hypot(a.x - q.x, a.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = { type: u.id, i };
    }
  }
  if (!best) return;
  view.drag = { ...best, pos: q };
  $('deploy').setPointerCapture(e.pointerId);
});

$('deploy').addEventListener('pointermove', (e) => {
  const ec = editorContext();
  if (!ec || !view.drag) return;
  const pt = canvasPoint(e, $('deploy'));
  const slot = clampSlot(arenaToSlot(ec.fr.toArena(pt.x, pt.y), ec.dir));
  view.drag.pos = slotToArena(slot, ec.dir);
});

$('deploy').addEventListener('pointerup', () => {
  const ec = editorContext();
  const drag = view.drag;
  view.drag = null;
  if (!ec || !drag) return;
  const mine = ec.slots[drag.type][drag.i];
  const want = clampSlot(arenaToSlot(drag.pos, ec.dir));
  const all = formationUnits(ec.p, view.deployLane, ec.slots).map((x) => x.slot);
  // Dropping onto another unit swaps the two; otherwise take the nearest free spot.
  const other = all.find((s) => s !== mine && Math.hypot(s.lat - want.lat, s.depth - want.depth) < 0.6);
  if (other) {
    const tmp = { lat: other.lat, depth: other.depth };
    Object.assign(other, { lat: mine.lat, depth: mine.depth });
    Object.assign(mine, tmp);
  } else {
    Object.assign(mine, nearestFree(want, all, mine));
  }
});

// ---- map clicks and battle selection ----------------------------------------------

function mapPoint(e) {
  const r = $('map').getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * MAP_SIZE, y: ((e.clientY - r.top) / r.height) * MAP_SIZE };
}

function towerLaneAt(e) {
  if (human === null || !game.players[human].alive) return null;
  const m = mapPoint(e);
  const spots = towerSpots(human);
  for (let k = 0; k < LANES.length; k++) {
    if (Math.hypot(spots[k].x - m.x, spots[k].y - m.y) < 26 && laneTarget(LANES[k])) return LANES[k];
  }
  return null;
}

$('map').addEventListener('click', (e) => {
  if (!game) return;
  // Your own towers pick the deploy lane; a fight at that tower shows alongside.
  const lane = towerLaneAt(e);
  if (lane) {
    view.deployLane = lane;
    const tb = towerBattle(lane);
    if (tb) {
      view.selectedBattle = tb.id;
      view.pinned = true;
    }
    return;
  }
  const m = mapPoint(e);
  const b = battleAt(game, m.x, m.y);
  if (b) {
    view.selectedBattle = b.id;
    view.pinned = true;
  }
});

function pickBattle() {
  const current = game.battles.find((b) => b.id === view.selectedBattle);
  if (current && view.pinned) return current;
  view.pinned = false;
  // A fight at the tower on the deploy screen always takes the battle view.
  const tb = human !== null && laneTarget(view.deployLane) ? towerBattle(view.deployLane) : null;
  if (tb) {
    view.selectedBattle = tb.id;
    return tb;
  }
  if (current && current.units.length > 2) return current;
  let best = null;
  let bestScore = -1;
  for (const b of game.battles) {
    const mine = human === null ? b.units.length : b.units.filter((u) => u.owner === human).length;
    const score = mine * 2 + b.units.length;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  view.selectedBattle = best ? best.id : null;
  return best;
}

function drainLog() {
  const log = $('log');
  while (logSeen < game.events.length) {
    const e = game.events[logSeen++];
    if (e.type === 'battle') continue;
    const m = Math.floor(e.t / 60);
    const s = String(Math.floor(e.t % 60)).padStart(2, '0');
    log.insertAdjacentHTML('afterbegin', `<div>[${m}:${s}] ${e.text}</div>`);
  }
}

// ---- main loop ------------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const id of ['map', 'battle', 'deploy']) {
    const cv = $(id);
    const r = cv.getBoundingClientRect();
    if (!r.width) continue;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
  }
}
window.addEventListener('resize', resize);

for (const b of document.querySelectorAll('#controls button')) {
  b.onclick = () => setSpeed(Number(b.dataset.speed));
}
let lastSpeed = 1;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !game) return;
  e.preventDefault();
  if (speed === 0) setSpeed(lastSpeed);
  else {
    lastSpeed = speed;
    setSpeed(0);
  }
});

function shortName(pi) {
  return game.players[pi].faction.name.replace('The ', '');
}

// ?timer drives the loop with timers instead of animation frames (for testing in
// panes that pause animation frames while hidden).
const nextFrame = location.search.includes("timer")
  ? (cb) => setTimeout(() => cb(performance.now()), 16)
  : (cb) => requestAnimationFrame(cb);

let panelTimer = 0;
function frame(now) {
  nextFrame(frame);
  if (!game) return;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt * speed * TICK_HZ;
  let budget = 240;
  while (acc >= 1 && budget-- > 0 && !game.over) {
    for (const ai of ais) if (ai) ai.update();
    game.step();
    acc -= 1;
  }
  if (budget <= 0) acc = 0;

  drawMap($('map').getContext('2d'), game, view);
  const b = pickBattle();
  drawBattle($('battle').getContext('2d'), game, b);
  $('battle-caption').textContent = b
    ? `${[...b.owners()].map(shortName).join(' vs ')}${b.tower ? ` at ${shortName(b.tower.owner)}'s tower` : ''}`
      + ` · ${b.units.length} units${view.pinned ? ' (pinned)' : ''}`
    : '';

  if (human !== null) {
    if (!laneTarget(view.deployLane)) view.deployLane = LANES.find((l) => laneTarget(l)) || view.deployLane;
    const alive = game.players[human].alive && laneTarget(view.deployLane);
    if (alive) {
      const tb = towerBattle(view.deployLane);
      drawFormation($('deploy').getContext('2d'), game, human, view.deployLane, view.drag, !!tb);
      $('deploy-caption').textContent = `Lane toward ${laneTarget(view.deployLane).faction.name}`
        + (tb ? ' · under attack!' : '');
    }
  }

  panelTimer -= dt;
  if (panelTimer <= 0 || view.buyDrag || view.hover || view.locked) {
    panelTimer = 0.2;
    if (human !== null) {
      $('gold').textContent = game.players[human].gold;
      renderLaneTabs();
      renderBar();
      renderInfo();
    }
    drainLog();
    const t = Math.floor(game.time);
    $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (game.over && $('overlay').classList.contains('hidden')) {
      const w = game.winner === null ? null : game.players[game.winner];
      const msg = w ? (w.index === human ? 'Victory! The simulation favours you.' : `${w.faction.name} win the simulation.`) : 'The simulation ends without a victor.';
      $('overlay').innerHTML = `<div>${msg}</div><button id="again">Back to faction select</button>`;
      $('overlay').classList.remove('hidden');
      $('again').onclick = () => {
        game = null;
        $('game').classList.add('hidden');
        $('start').classList.remove('hidden');
      };
    }
  }
}

buildStart();
nextFrame(frame);
