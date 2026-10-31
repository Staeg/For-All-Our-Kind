// Finds, for each unit type, the upgrade strength at which buying the upgrade
// equals adding one more unit to a lane that already has N=9 of that type.
// Prints suggested `mods` to paste into src/sim/data.js.
//   node tools/tune-upgrades.js [seeds]
import { FACTIONS } from '../src/sim/data.js';
import { upgradeEdge } from './playtest-lib.js';

const seeds = Number(process.argv[2]) || 24;
const N = 9;

for (const f of FACTIONS) {
  for (const u of f.units) {
    const base = { ...u.upgrade.mods };
    const setScale = (k) => {
      for (const key of Object.keys(base)) u.upgrade.mods[key] = base[key] * k;
    };
    let lo = 0.05;
    let hi = 8;
    for (let it = 0; it < 10; it++) {
      const mid = Math.sqrt(lo * hi);
      setScale(mid);
      if (upgradeEdge(f.id, u.id, N, seeds) > 0) hi = mid;
      else lo = mid;
    }
    const k = Math.sqrt(lo * hi);
    setScale(k);
    const mods = Object.entries(u.upgrade.mods).map(([key, v]) => `${key}: ${+v.toFixed(2)}`).join(', ');
    console.log(`${u.name.padEnd(18)} scale ${k.toFixed(2)}  ->  { ${mods} }`);
  }
}
