// Browser entry point: start screen, real-time loop around the deterministic sim,
// shop/formation panel and the two canvases.
import {
  FACTIONS, TICK_HZ, UNIT_COST, UPGRADE_COST, STAT_KEYS, effectiveStats, MAP_SIZE,
} from '../sim/data.js';
import { Game } from '../sim/game.js';
import { SimpleAI } from '../sim/ai.js';
import { LANES, laneNodes } from '../sim/map.js';
import { nearestFree, clampSlot, ensureSlots } from '../sim/formation.js';
import { spriteDataUrl, STAT_ICON, STAT_LABEL } from './art.js';
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
const view = { selectedBattle: null, pinned: false, editLane: null, drag: null };
let logSeen = 0;
let shopDirty = true;

// ---- start screen -------------------------------------------------------------

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
    if (k === 'regen') return `+${v} HP/s regen`;
    if (k === 'splash') return `${Math.round(v * 100)}% splash`;
    return `+${+v.toFixed(2)} ${STAT_LABEL[k]}`;
  }).join(', ');
}

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
  let others = FACTIONS.map((f) => f.id).filter((id) => id !== factionId);
  // Shuffle opponents' seats.
  for (let i = others.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [others[i], others[k]] = [others[k], others[i]];
  }
  let seats;
  if (factionId) {
    seats = [...others];
    seats.splice(HUMAN_SEAT, 0, factionId);
    human = HUMAN_SEAT;
  } else {
    seats = others.length === 4 ? others : FACTIONS.map((f) => f.id);
    human = null;
  }
  game = new Game({ factions: seats, seed });
  ais = seats.map((_, i) => (i === human ? null : new SimpleAI(game, i, seed + i * 101)));
  view.selectedBattle = null;
  view.pinned = false;
  view.editLane = null;
  view.drag = null;
  logSeen = 0;
  shopDirty = true;
  $('log').innerHTML = '';
  $('overlay').classList.add('hidden');
  $('start').classList.add('hidden');
  $('game').classList.remove('hidden');
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

// ---- side panel -----------------------------------------------------------------

function laneLabel(lane) {
  const nodes = laneNodes(human, lane, game.alive());
  if (!nodes) return null;
  const target = game.players[nodes[nodes.length - 1]].faction.name.replace('The ', '');
  if (lane === 'mid') return `Centre → ${target}`;
  return `→ ${target}`;
}

function renderPlayers() {
  $('players').innerHTML = game.players.map((p) => {
    const you = p.index === human ? ' <span class="you">(you)</span>' : '';
    const gold = p.index === human || human === null ? ` · ${p.gold}g` : '';
    return `<div class="pl${p.alive ? '' : ' dead'}" style="border-color:${p.faction.colors.main}">`
      + `${p.faction.name}${you} · ${Math.ceil(p.hp)} HP${gold}`
      + `<div class="bar"><div style="width:${(p.hp / 100).toFixed(1)}%"></div></div></div>`;
  }).join('');
}

function renderShop() {
  const shop = $('shop');
  if (human === null) {
    shop.innerHTML = '<div class="gold-line">Spectating four AIs. Click a battle on the map to watch it.</div>';
    return;
  }
  const p = game.players[human];
  const lanes = LANES.map((l) => ({ l, label: laneLabel(l) }));
  let html = `<div class="gold-line">Gold: <b>${p.gold}</b> · unit ${UNIT_COST}g · upgrade ${UPGRADE_COST}g</div>`
    + '<div class="ucard"><div class="row">Formation (or click your towers): '
    + lanes.map(({ l, label }) => (label ? `<button data-form="${l}" class="${view.editLane === l ? 'on' : ''}">${label}</button>` : '')).join('')
    + '</div></div>';
  for (const u of p.faction.units) {
    const up = p.upgrades.has(u.id);
    html += `<div class="ucard"><img src="${spriteDataUrl(p.factionId, u.id)}" alt="">`
      + `<div class="title">${u.name} <small>${u.role} · ${game.typeCount(human, u.id)} in waves</small></div>`
      + `<div class="stats">${statsHtml(u, up)}</div>`
      + '<div class="row">Add to wave: '
      + lanes.map(({ l, label }) => (label
        ? `<button data-buy="${u.id}" data-lane="${l}" ${p.gold < UNIT_COST || !p.alive ? 'disabled' : ''}>${label} (${p.roster[l][u.id] || 0})</button>`
        : '')).join('')
      + '</div><div class="row">'
      + (up
        ? `<span class="upg">✓ ${u.upgrade.name}: ${modsText(u.upgrade.mods)}</span>`
        : `<button data-up="${u.id}" ${p.gold < UPGRADE_COST || !p.alive ? 'disabled' : ''}>Upgrade: ${u.upgrade.name}</button> <span class="upg">${modsText(u.upgrade.mods)}</span>`)
      + '</div></div>';
  }
  shop.innerHTML = html;
}

$('shop').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !game) return;
  if (b.dataset.buy) game.buyUnit(human, b.dataset.buy, b.dataset.lane);
  if (b.dataset.up) game.buyUpgrade(human, b.dataset.up);
  if (b.dataset.form) openFormation(b.dataset.form);
  shopDirty = true;
});

// ---- formation editor ------------------------------------------------------------

function openFormation(lane) {
  view.editLane = view.editLane === lane ? null : lane;
  view.drag = null;
  shopDirty = true;
}

function canvasPoint(e) {
  const cv = $('battle');
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
}

function editorContext() {
  if (!game || view.editLane === null || human === null) return null;
  const dir = laneDirection(game, human, view.editLane);
  if (!dir) return null;
  const p = game.players[human];
  const slots = ensureSlots(p, view.editLane);
  const fr = formationFrame($('battle').getContext('2d'), dir);
  return { dir, p, slots, fr };
}

$('battle').addEventListener('pointerdown', (e) => {
  const ec = editorContext();
  if (!ec) return;
  const pt = canvasPoint(e);
  const q = ec.fr.toArena(pt.x, pt.y);
  let best = null;
  let bestD = 0.7;
  for (const { u, i, slot } of formationUnits(ec.p, view.editLane, ec.slots)) {
    const a = slotToArena(slot, ec.dir);
    const d = Math.hypot(a.x - q.x, a.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = { type: u.id, i };
    }
  }
  if (!best) return;
  view.drag = { ...best, pos: q };
  $('battle').setPointerCapture(e.pointerId);
});

$('battle').addEventListener('pointermove', (e) => {
  const ec = editorContext();
  if (!ec || !view.drag) return;
  const pt = canvasPoint(e);
  const slot = clampSlot(arenaToSlot(ec.fr.toArena(pt.x, pt.y), ec.dir));
  view.drag.pos = slotToArena(slot, ec.dir);
});

$('battle').addEventListener('pointerup', () => {
  const ec = editorContext();
  const drag = view.drag;
  view.drag = null;
  if (!ec || !drag) return;
  const mine = ec.slots[drag.type][drag.i];
  const want = clampSlot(arenaToSlot(drag.pos, ec.dir));
  const all = formationUnits(ec.p, view.editLane, ec.slots).map((x) => x.slot);
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

let shopKey = '';
function maybeRenderShop() {
  if (human === null) {
    if (shopDirty) renderShop();
    shopDirty = false;
    return;
  }
  // Only rebuild when something visible changed, so sliders stay draggable.
  const p = game.players[human];
  const key = [p.gold >= UNIT_COST, p.gold >= UPGRADE_COST, p.gold, p.alive, game.alive().join()].join('|');
  if (shopDirty || key !== shopKey) {
    if (document.activeElement && document.activeElement.type === 'range') return;
    renderShop();
    shopKey = key;
    shopDirty = false;
  }
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

// ---- battle selection -----------------------------------------------------------

function pickBattle() {
  const current = game.battles.find((b) => b.id === view.selectedBattle);
  if (current && view.pinned) return current;
  view.pinned = false;
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

$('map').addEventListener('click', (e) => {
  if (!game) return;
  const r = e.target.getBoundingClientRect();
  const mx = ((e.clientX - r.left) / r.width) * MAP_SIZE;
  const my = ((e.clientY - r.top) / r.height) * MAP_SIZE;
  if (human !== null && game.players[human].alive) {
    const spots = towerSpots(human);
    for (let k = 0; k < LANES.length; k++) {
      if (Math.hypot(spots[k].x - mx, spots[k].y - my) < 24 && laneDirection(game, human, LANES[k])) {
        openFormation(LANES[k]);
        return;
      }
    }
  }
  const b = battleAt(game, mx, my);
  if (b) {
    view.selectedBattle = b.id;
    view.pinned = true;
    view.editLane = null;
    shopDirty = true;
  }
});

// ---- main loop ------------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const id of ['map', 'battle']) {
    const cv = $(id);
    const r = cv.getBoundingClientRect();
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

let panelTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
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
  if (view.editLane !== null && (human === null || !laneDirection(game, human, view.editLane))) view.editLane = null;
  const b = pickBattle();
  if (view.editLane !== null) {
    drawFormation($('battle').getContext('2d'), game, human, view.editLane, view.drag);
    $('battle-caption').textContent = `Formation: ${laneLabel(view.editLane)} · drag units to place them, `
      + 'drop on another unit to swap · click the lane button or a battle to return';
  } else drawBattle($('battle').getContext('2d'), game, b);
  if (view.editLane === null) $('battle-caption').textContent = b
    ? `Battle: ${[...b.owners()].map((o) => game.players[o].faction.name.replace('The ', '')).join(' vs ')} · ${b.units.length} units${view.pinned ? ' (pinned)' : ''}`
    : '';

  panelTimer -= dt;
  if (panelTimer <= 0) {
    panelTimer = 0.2;
    renderPlayers();
    maybeRenderShop();
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
requestAnimationFrame(frame);
