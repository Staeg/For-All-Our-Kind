// Rudimentary AI: spend gold as it comes in, reinforce the lane under the most
// pressure, and buy a unit type's upgrade once it has enough of that type.
import { UNIT_COST, UPGRADE_COST, TOWER_OFFSET } from './data.js';
import { LANES, CENTRE } from './map.js';
import { Rng } from './rng.js';

const UPGRADE_AT = 8;

export class SimpleAI {
  constructor(game, playerIndex, seed) {
    this.game = game;
    this.pi = playerIndex;
    this.rng = new Rng(seed);
    this.nextThink = 1 + this.rng.next();
  }

  // Which of our lanes faces an army that ended its route at our base.
  laneFacing(army) {
    const nodes = army.route.nodes;
    const from = nodes[nodes.length - 2];
    if (from === CENTRE) return 'mid';
    if (from === (this.pi + 1) % 4) return 'cw';
    if (from === (this.pi + 3) % 4) return 'ccw';
    return null;
  }

  lanePressure() {
    const g = this.game;
    const pressure = { ccw: 1, mid: 1, cw: 1 };
    for (const a of g.armies) {
      if (a.owner === this.pi) continue;
      const nodes = a.route.nodes;
      if (nodes[nodes.length - 1] !== this.pi) continue;
      const lane = this.laneFacing(a);
      if (!lane) continue;
      const closeness = a.s / a.route.length; // 1 = at our door
      pressure[lane] += a.units.length * (0.5 + closeness * 2) * (a.s >= a.route.length - TOWER_OFFSET - 1 ? 3 : 1);
    }
    return pressure;
  }

  update() {
    const g = this.game;
    const p = g.players[this.pi];
    if (!p.alive || g.time < this.nextThink) return;
    this.nextThink = g.time + 1;

    // Upgrade the most numerous un-upgraded type once it is worth it.
    let best = null;
    for (const u of p.faction.units) {
      if (p.upgrades.has(u.id)) continue;
      const n = g.typeCount(this.pi, u.id);
      if (n >= UPGRADE_AT && (!best || n > best.n)) best = { id: u.id, n };
    }
    if (best) {
      if (p.gold >= UPGRADE_COST) g.buyUpgrade(this.pi, best.id);
      return; // save up
    }

    while (p.gold >= UNIT_COST) {
      const pressure = this.lanePressure();
      const total = LANES.reduce((s, l) => s + pressure[l], 0);
      let r = this.rng.next() * total;
      let lane = LANES[0];
      for (const l of LANES) {
        r -= pressure[l];
        if (r <= 0) {
          lane = l;
          break;
        }
      }
      // Prefer whichever type we have least of, with some randomness.
      const types = p.faction.units.map((u) => ({
        id: u.id,
        w: 1 / (1 + g.typeCount(this.pi, u.id)) + this.rng.next() * 0.15,
      }));
      types.sort((a, b) => b.w - a.w);
      g.buyUnit(this.pi, types[0].id, lane);
    }
  }
}
