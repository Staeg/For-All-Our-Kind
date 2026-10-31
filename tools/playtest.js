// Headless balance playtests. Usage:
//   node tools/playtest.js lanes [seeds]     1v1 lane snowball rates for every pairing
//   node tools/playtest.js games [count]     full 4-player games with the simple AI
//   node tools/playtest.js upgrades [seeds]  upgrade vs +1 unit crossover per unit type
//   node tools/playtest.js all
import { FACTIONS, startingWave } from '../src/sim/data.js';
import { ids, laneMatch, aiGame, fight, upgradeEdge } from './playtest-lib.js';
const pct = (x) => `${(x * 100).toFixed(0)}%`.padStart(4);

// ---- 1v1 lane: starting waves only, no purchases --------------------------------

function lanes(seeds) {
  console.log(`\n1v1 lane playtests (${seeds} seeds per pairing, 5 min, starting waves only)`);
  console.log('pairing                       first-clash A/B   snowball A/B/none');
  let worst = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let fa = 0;
      let fb = 0;
      let sa = 0;
      let sb = 0;
      for (let s = 0; s < seeds; s++) {
        // Alternate seats so lane geometry can't favour either side.
        const swap = s % 2 === 1;
        const r = laneMatch(swap ? ids[j] : ids[i], swap ? ids[i] : ids[j], 1000 + s);
        const first = swap ? (r.first === null ? null : 1 - r.first) : r.first;
        const snow = swap ? (r.snowball === null ? null : 1 - r.snowball) : r.snowball;
        if (first === 0) fa++;
        if (first === 1) fb++;
        if (snow === 0) sa++;
        if (snow === 1) sb++;
      }
      worst = Math.max(worst, sa / seeds, sb / seeds, fa / seeds, fb / seeds);
      console.log(
        `${(ids[i] + ' vs ' + ids[j]).padEnd(30)}${pct(fa / seeds)} /${pct(fb / seeds)}       `
        + `${pct(sa / seeds)} /${pct(sb / seeds)} /${pct((seeds - sa - sb) / seeds)}`,
      );
    }
  }
  console.log(`worst one-sided rate: ${pct(worst)} (target <= 60%)`);
  return worst;
}

// ---- full games ----------------------------------------------------------------

function games(count) {
  console.log(`\nFull 4-player AI games (${count} games, random seats)`);
  const wins = Object.fromEntries(ids.map((id) => [id, 0]));
  let draws = 0;
  let total = 0;
  const t0 = Date.now();
  for (let s = 0; s < count; s++) {
    const r = aiGame(5000 + s);
    total += r.time;
    if (r.winner) wins[r.winner]++;
    else draws++;
  }
  for (const id of ids) console.log(`${id.padEnd(14)}${pct(wins[id] / count)}`);
  console.log(`no winner     ${pct(draws / count)}`);
  console.log(`avg game length ${(total / count / 60).toFixed(1)} min, wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const worst = Math.max(...ids.map((id) => wins[id] / count));
  console.log(`top faction win rate: ${pct(worst)} (target <= 50%)`);
  return worst;
}

// ---- upgrade value ---------------------------------------------------------------

function upgrades(seeds, ns = [2, 4, 6, 7, 8, 9, 10, 11, 13]) {
  console.log(`\nUpgrade vs one extra unit (positive = upgrade better; ${seeds} seeds x 3 opponents)`);
  console.log(`unit                 ${ns.map((n) => `N=${n}`.padStart(7)).join('')}   crossover`);
  const results = [];
  for (const f of FACTIONS) {
    for (const u of f.units) {
      const edges = ns.map((n) => upgradeEdge(f.id, u.id, n, seeds));
      let cross = null;
      for (let k = 0; k < ns.length; k++) {
        if (edges[k] > 0) {
          cross = ns[k];
          break;
        }
      }
      results.push({ unit: u.id, edges, cross });
      console.log(
        `${u.name.padEnd(21)}${edges.map((e) => e.toFixed(3).padStart(7)).join('')}   ${cross ? `~${cross}` : 'never'}`,
      );
    }
  }
  return results;
}

const mode = process.argv[2] || 'all';
const arg = Number(process.argv[3]);
if (mode === 'lanes' || mode === 'all') lanes(arg || 40);
if (mode === 'upgrades' || mode === 'all') upgrades(arg || 12);
if (mode === 'games' || mode === 'all') games(arg || 40);
if (mode === 'clash') {
  // Isolated starting-wave fights, both sides fresh. Quick balance signal.
  const seeds = arg || 100;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let w = 0;
      for (let s = 0; s < seeds; s++) {
        const e = s % 2
          ? -fight(ids[j], startingWave(ids[j]), new Set(), ids[i], startingWave(ids[i]), s)
          : fight(ids[i], startingWave(ids[i]), new Set(), ids[j], startingWave(ids[j]), s);
        if (e > 0) w++;
      }
      console.log(`${(ids[i] + ' vs ' + ids[j]).padEnd(30)}${pct(w / seeds)}`);
    }
  }
}
if (mode === 'one') {
  const r = aiGame(arg || 1);
  console.log(r.winner, (r.time / 60).toFixed(1), 'min', r.seats, r.g.players.map((p) => `${p.factionId}:${p.hp.toFixed(0)} k${p.kills} up${p.upgrades.size}`));
}
