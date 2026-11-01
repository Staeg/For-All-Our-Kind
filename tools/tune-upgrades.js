// Finds, for each unit type, the upgrade strength at which buying the upgrade
// equals adding one more unit to a lane that already has N=9 of that type.
// Each effect has one tuning knob (below); the tool scales it and prints the value
// to paste into src/sim/data.js. Effects without a knob are only measured.
//   node tools/tune-upgrades.js [seeds]
import { FACTIONS } from '../src/sim/data.js';
import { upgradeEdge } from './playtest-lib.js';

const seeds = Number(process.argv[2]) || 24;
const N = 9;

const KNOB = {
  reshelving: 'restore',
  footnotes: 'max',
  rewind: 'seconds',
  wildfire: 'dps',
  lodestone: 'pull',
  crosswind: 'push',
  shelter: 'share',
  cordyceps: 'hp',
  redline: 'attack',
  longExposure: 'perSecond',
};

for (const f of FACTIONS) {
  for (const u of f.units) {
    const up = u.upgrade;
    const knob = KNOB[up.effect];
    if (!knob) {
      console.log(`${u.name.padEnd(18)} ${up.name.padEnd(14)} no knob; edge at N=${N}: ${upgradeEdge(f.id, u.id, N, seeds).toFixed(3)}`);
      continue;
    }
    const base = up[knob];
    let lo = 0.05;
    let hi = 8;
    for (let it = 0; it < 10; it++) {
      const mid = Math.sqrt(lo * hi);
      up[knob] = base * mid;
      if (upgradeEdge(f.id, u.id, N, seeds) > 0) hi = mid;
      else lo = mid;
    }
    const k = Math.sqrt(lo * hi);
    up[knob] = base;
    console.log(`${u.name.padEnd(18)} ${up.name.padEnd(14)} scale ${k.toFixed(2)}  ->  ${knob}: ${+(base * k).toFixed(2)}`);
  }
}
