// Shared headless match helpers used by the playtest and tuning tools.
import { Game } from '../src/sim/game.js';
import { SimpleAI } from '../src/sim/ai.js';
import { Battle } from '../src/sim/battle.js';
import { Rng } from '../src/sim/rng.js';
import { FACTIONS, startingWave, defaultFormation, effectiveStats } from '../src/sim/data.js';

export const ids = FACTIONS.map((f) => f.id);

export function laneMatch(fa, fb, seed, seconds = 300) {
  const g = new Game({
    factions: [fa, fb, fa, fb],
    seed,
    lanes: [[0, 'cw'], [1, 'ccw']],
    maxSeconds: seconds,
  });
  while (!g.over) g.step();
  const [a, b] = g.players;
  let snowball = null;
  if (a.towerDamage > b.towerDamage * 1.5 && a.towerDamage > 200) snowball = 0;
  else if (b.towerDamage > a.towerDamage * 1.5 && b.towerDamage > 200) snowball = 1;
  return { first: g.firstBattleWinner, snowball };
}

export function aiGame(seed) {
  const rng = new Rng(seed * 7 + 3);
  const seats = [...ids];
  for (let i = seats.length - 1; i > 0; i--) {
    const k = rng.int(i + 1);
    [seats[i], seats[k]] = [seats[k], seats[i]];
  }
  const g = new Game({ factions: seats, seed });
  const ais = seats.map((_, i) => new SimpleAI(g, i, seed * 13 + i));
  while (!g.over) {
    for (const ai of ais) ai.update();
    g.step();
  }
  return { winner: g.winner === null ? null : seats[g.winner], time: g.time, seats, g };
}

function makeUnits(fid, counts, upgraded, owner) {
  const out = [];
  const f = FACTIONS.find((x) => x.id === fid);
  for (const u of f.units) {
    for (let k = 0; k < (counts[u.id] || 0); k++) {
      const stats = effectiveStats(u, upgraded.has(u.id));
      out.push({ def: u, owner, stats, hp: stats.hp });
    }
  }
  return out;
}

// Spread `extra` additional units over a faction's types, round-robin.
function padded(fid, extra) {
  const counts = startingWave(fid);
  const f = FACTIONS.find((x) => x.id === fid);
  for (let k = 0; k < extra; k++) counts[f.units[k % 3].id]++;
  return counts;
}

function totalHp(units) {
  return units.reduce((s, u) => s + Math.max(0, u.hp), 0);
}

// One isolated battle. Returns own share of surviving HP fraction minus the enemy's.
export function fight(fa, ca, upA, fb, cb, seed) {
  const rng = new Rng(seed);
  const b = new Battle(1, 0, 0, rng);
  const ua = makeUnits(fa, ca, upA, 0);
  const ub = makeUnits(fb, cb, new Set(), 1);
  const ha = totalHp(ua);
  const hb = totalHp(ub);
  b.addArmy({ id: 1, owner: 0, units: ua }, { x: 1, y: 0 }, defaultFormation(fa));
  b.addArmy({ id: 2, owner: 1, units: ub }, { x: -1, y: 0 }, defaultFormation(fb));
  let ticks = 0;
  while (!b.isOver() && ticks < 30 * 240) {
    b.step();
    ticks++;
  }
  return totalHp(ua) / ha - totalHp(ub) / hb;
}

// For unit type `typeId` with N copies in an army, compare +1 copy vs the upgrade.
export function upgradeEdge(fid, typeId, n, seeds) {
  const base = startingWave(fid);
  const counts = { ...base, [typeId]: n };
  const plusOne = { ...counts, [typeId]: n + 1 };
  const size = Object.values(counts).reduce((s, x) => s + x, 0);
  let edge = 0;
  for (const opp of ids) {
    if (opp === fid) continue;
    const oc = padded(opp, Math.max(0, size - 4));
    for (let s = 0; s < seeds; s++) {
      const seed = 77 + s * 31;
      const withUp = fight(fid, counts, new Set([typeId]), opp, oc, seed);
      const withUnit = fight(fid, plusOne, new Set(), opp, oc, seed);
      edge += withUp - withUnit;
    }
  }
  return edge / (seeds * (ids.length - 1));
}

