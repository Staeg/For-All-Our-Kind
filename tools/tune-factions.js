// Coordinate search over unit HP to even out 1v1 lane pairings. Every pairing is
// evaluated in parallel worker threads; a step is kept when it lowers the worst
// one-sided snowball rate. Prints HP values to copy into src/sim/data.js.
//   node tools/tune-factions.js [seeds] [sweeps]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FACTIONS } from '../src/sim/data.js';
import { ids, laneMatch } from './playtest-lib.js';

const units = FACTIONS.flatMap((f) => f.units);
const STANDARD = new Set(['warden', 'wisp', 'comrade', 'servitor']);

function applyHp(hp) {
  units.forEach((u, i) => { u.stats.hp = hp[i]; });
}

if (!isMainThread) {
  parentPort.on('message', ({ hp, i, j, seeds }) => {
    applyHp(hp);
    let a = 0;
    let b = 0;
    for (let s = 0; s < seeds; s++) {
      const swap = s % 2 === 1;
      const r = laneMatch(swap ? ids[j] : ids[i], swap ? ids[i] : ids[j], 1000 + s);
      const snow = swap ? (r.snowball === null ? null : 1 - r.snowball) : r.snowball;
      if (snow === 0) a++;
      if (snow === 1) b++;
    }
    parentPort.postMessage({ i, j, a: a / seeds, b: b / seeds });
  });
} else {
  const seeds = Number(process.argv[2]) || 80;
  const sweeps = Number(process.argv[3]) || 2;
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([i, j]);
  const workers = pairs.map(() => new Worker(new URL(import.meta.url)));

  const evaluate = (hp) => Promise.all(pairs.map(([i, j], k) => new Promise((res) => {
    workers[k].once('message', res);
    workers[k].postMessage({ hp, i, j, seeds });
  }))).then((rs) => {
    const worst = Math.max(...rs.flatMap((r) => [r.a, r.b]));
    const spread = rs.reduce((s, r) => s + Math.abs(r.a - r.b), 0);
    return { worst, score: worst + spread * 0.05, rs };
  });

  let hp = units.map((u) => u.stats.hp);
  let cur = await evaluate(hp);
  const show = (r) => r.rs.map((x) => `${ids[x.i].slice(0, 4)}-${ids[x.j].slice(0, 4)} ${(x.a * 100).toFixed(0)}/${(x.b * 100).toFixed(0)}`).join('  ');
  console.log(`start worst ${(cur.worst * 100).toFixed(0)}%  ${show(cur)}`);
  for (let sw = 0; sw < sweeps && cur.worst > 0.56; sw++) {
    for (let k = 0; k < units.length; k++) {
      if (STANDARD.has(units[k].id)) continue; // bog-standard units keep default HP
      const step = Math.max(2, Math.round(hp[k] * 0.06));
      for (const d of [step, -step]) {
        const trial = hp.slice();
        trial[k] += d;
        const r = await evaluate(trial);
        if (r.score < cur.score) {
          hp = trial;
          cur = r;
          console.log(`${units[k].id} ${d > 0 ? '+' : ''}${d} -> ${hp[k]}: worst ${(cur.worst * 100).toFixed(0)}%  ${show(cur)}`);
          break;
        }
      }
    }
  }
  console.log('\nfinal HP:');
  units.forEach((u, k) => console.log(`  ${u.id}: ${hp[k]}`));
  for (const w of workers) w.terminate();
}
