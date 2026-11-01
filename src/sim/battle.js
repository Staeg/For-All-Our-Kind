// 2D battle engine. Units are circles on a round arena; one call to step() advances
// the fight by one fixed tick (DT). No wall-clock time or Math.random is used, so a
// battle is a pure function of its inputs and the shared seeded Rng.
//
// Upgrades are effects, not stats. Each one hooks into a fixed point of the tick:
//   tick     burning, heat, husk decay, Rewind history       (statusTick, record)
//   move     Redline move speed, Lodestone pull              (moveSpeed, lodestone)
//   attack   Long Exposure, Postmortem, Footnotes, Wildfire,
//            Cordyceps, Redline heat, Crosswind               (attack)
//   damage   Shelter, then Common Body                       (damage)
//   death    Rewind, then Postmortem, Wildfire spread,
//            Cordyceps husks, Reshelving piles               (hurt, die)
//   end      Reshelving restores piles                       (survivorsByArmy)
import {
  DT, TOWER_STATS, UNIT_RADIUS, ARENA_RADIUS, SPAWN_DEPTH, SPAWN_WIDTH, SPD_SCALE, MELEE_REACH,
} from './data.js';

const SLOT = 1.25; // lateral spacing between units in a formation row
const ROW = 1.2; // spacing between rows when a type overflows one row
const PER_ROW = Math.floor(SPAWN_WIDTH / SLOT);
const BOUND = ARENA_RADIUS + 1;
const TOUCH = 0.35; // edge-to-edge gap that counts as touching
export const TOWER_RADIUS = 1.6;
export const TOWER_RANGE = 12; // in diameters, from the tower's edge
const TOWER_FORWARD = 8; // tower stands this far from the centre, on the defender's side

export function hitChance(acc, eva) {
  return Math.min(1, (50 + acc) / (100 + 2 * eva));
}

export function hitDamage(dmg, arm) {
  return Math.max(1, dmg - arm);
}

// Does battle unit `u` carry the upgrade with this effect?
function has(u, effect) {
  return u.src.upgraded && u.def.upgrade.effect === effect;
}

function gap(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r;
}

export class Battle {
  // memory: per-player knowledge that outlives battles (Postmortem), shared with the game.
  // startTime: game time at which the battle began, so units can tell how long they idled.
  constructor(id, x, y, rng, { memory = {}, startTime = 0 } = {}) {
    this.id = id;
    this.x = x; // position on the strategic map
    this.y = y;
    this.rng = rng;
    this.memory = memory;
    this.startTime = startTime;
    this.units = [];
    this.armies = new Map(); // armyId -> army record (route state for when it leaves)
    this.piles = []; // Reshelving: fallen Wardens waiting to re-form
    this.fx = []; // short-lived visual events for the renderer
    this.time = 0;
    this.onKill = null; // (killerOwner, victimUnit, killer) => void; killer may be the tower
    this.onTowerDamage = null; // (attackerOwner, towerOwner, amount) => void
    this.tower = null;
    this.nextUnitId = 1;
  }

  get gameTime() {
    return this.startTime + this.time;
  }

  // dir: unit vector of the army's travel direction at the moment it arrives. The
  // army phases in on the side it came from, with its formation facing along dir.
  addArmy(army, dir, formation) {
    this.armies.set(army.id, army);
    const lat = { x: -dir.y, y: dir.x };
    const byType = new Map();
    for (const u of army.units) {
      if (!byType.has(u.def.id)) byType.set(u.def.id, []);
      byType.get(u.def.id).push(u);
    }
    for (const [typeId, list] of byType) {
      const depth = formation[typeId] ?? 0.5;
      const back = depth < 0.5; // overflow rows grow toward the open side of the zone
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        let side;
        let fromCentre;
        if (u.slot) {
          // Exact formation slot chosen by the player.
          side = u.slot.lat;
          fromCentre = ARENA_RADIUS - u.slot.depth;
        } else {
          const row = Math.floor(i / PER_ROW);
          const inRow = Math.min(PER_ROW, list.length - row * PER_ROW);
          const col = i % PER_ROW;
          side = (col - (inRow - 1) / 2) * SLOT + this.rng.range(-0.08, 0.08);
          fromCentre = ARENA_RADIUS - depth * SPAWN_DEPTH + (back ? -row * ROW : row * ROW);
          fromCentre = Math.max(ARENA_RADIUS - SPAWN_DEPTH, Math.min(ARENA_RADIUS, fromCentre));
          fromCentre += this.rng.range(-0.08, 0.08);
        }
        this.units.push(this.makeUnit(u, army.owner, army.id,
          -dir.x * fromCentre + lat.x * side, -dir.y * fromCentre + lat.y * side, dir,
          this.rng.range(0, 0.3 / u.stats.spd)));
      }
    }
    // Newcomers pick the closest enemy immediately.
    for (const bu of this.units) if (bu.armyId === army.id) bu.target = this.closestEnemy(bu, false);
  }

  makeUnit(src, owner, armyId, x, y, dir, cooldown) {
    return {
      uid: this.nextUnitId++,
      src, // the persistent unit record (hp carries over between battles)
      def: src.def,
      owner,
      armyId, // null for husks, which never leave the battle
      stats: src.stats,
      r: UNIT_RADIUS,
      x,
      y,
      fx: dir.x, // facing, for rendering
      fy: dir.y,
      target: null,
      cooldown,
      dead: false,
      atk: null,
      joinedAt: this.gameTime,
      // Effect state, all local to this battle.
      notes: 0, // Footnotes: ARM lost
      burn: null, // Wildfire: { until, by }
      infected: null, // Cordyceps: { owner, up } of the infecting Lobber
      husk: null, // Cordyceps: time this husk collapses
      heat: 0, // Redline stacks
      exposed: false, // Long Exposure: first shot fired
      rewindUsed: false, // Rewind: this Sage's charge is spent
      hist: null, // Rewind: recent { x, y, hp }, oldest first
    };
  }

  owners() {
    const s = new Set();
    for (const u of this.units) s.add(u.owner);
    return s;
  }

  // The defending tower stands on the far side from attackers arriving along dir.
  setTower(owner, dir) {
    this.tower = {
      isTower: true,
      owner,
      x: dir.x * TOWER_FORWARD,
      y: dir.y * TOWER_FORWARD,
      r: TOWER_RADIUS,
      dead: false,
      stats: { eva: 0, arm: 0 },
      cooldown: 0,
      atk: null,
    };
  }

  // A battle at a tower keeps going while anyone hostile to the tower is left.
  isOver() {
    const owners = this.owners();
    if (owners.size === 0) return true;
    if (this.tower && [...owners].some((o) => o !== this.tower.owner)) return false;
    return owners.size <= 1;
  }

  // The tower can only be hit while none of its owner's units are in the fight.
  towerFor(u) {
    const t = this.tower;
    if (!t || t.owner === u.owner) return null;
    for (const e of this.units) if (e.owner === t.owner && !e.dead) return null;
    return t;
  }

  inRange(a, b) {
    const reach = a.stats.rng > 0 ? a.stats.rng : MELEE_REACH;
    return gap(a, b) <= reach;
  }

  closestEnemy(u, mustBeInRange) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.units) {
      if (e.owner === u.owner || e.dead) continue;
      if (mustBeInRange && !this.inRange(u, e)) continue;
      const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  randomEnemyInRange(u) {
    const opts = [];
    for (const e of this.units) if (e.owner !== u.owner && !e.dead && this.inRange(u, e)) opts.push(e);
    return opts.length ? this.rng.pick(opts) : null;
  }

  // ---- derived stats ------------------------------------------------------------

  // Footnotes strip armour, and armour may go negative to amplify damage.
  arm(u) {
    return u.stats.arm - u.notes;
  }

  // Redline heat speeds up attacks and movement.
  attackSpeed(u) {
    return u.heat ? u.stats.spd * (1 + u.heat * u.def.upgrade.attack) : u.stats.spd;
  }

  moveSpeed(u) {
    return u.heat ? u.stats.spd * (1 + u.heat * u.def.upgrade.move) : u.stats.spd;
  }

  // ---- the tick -------------------------------------------------------------------

  step() {
    this.time += DT;
    const units = this.units;
    this.record();

    // 1. Statuses, targeting and movement intent.
    for (const u of units) {
      if (u.dead) continue;
      this.statusTick(u);
      if (u.dead) continue;
      if (u.target && u.target.isTower && !this.towerFor(u)) u.target = null;
      if (!u.target || u.target.dead) {
        u.target = this.randomEnemyInRange(u) || this.closestEnemy(u, false) || this.towerFor(u);
      } else if (!this.inRange(u, u.target)) {
        const near = this.closestEnemy(u, true);
        if (near) u.target = near;
      }
      u.cooldown -= DT;
      const t = u.target;
      if (!t) continue;
      const dx = t.x - u.x;
      const dy = t.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      u.fx = dx / d;
      u.fy = dy / d;
      if (this.inRange(u, t)) {
        if (u.cooldown <= 0) {
          u.cooldown = 1 / this.attackSpeed(u);
          this.attack(u, t);
        }
      } else {
        const step = Math.min(this.moveSpeed(u) * SPD_SCALE * DT, d - u.r - t.r);
        u.x += u.fx * step;
        u.y += u.fy * step;
      }
    }

    this.lodestone();
    if (this.tower) this.towerStep();

    // 2. Remove the dead before collision so corpses don't block.
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    const old = this.time - 1;
    if (this.fx.length && this.fx[0].time < old) this.fx = this.fx.filter((f) => f.time >= old);

    // 3. Collision: nobody overlaps, friend or foe.
    this.resolveCollisions();
  }

  statusTick(u) {
    if (u.husk !== null && this.time >= u.husk) {
      u.dead = true; // a husk simply collapses: no bounty, no remains
      return;
    }
    if (u.burn) {
      if (this.time >= u.burn.until) u.burn = null;
      else this.damage(u.burn.by, u, u.burn.dps * DT, false);
    }
    if (u.heat && !u.dead) this.hurt(u, u, u.heat * u.def.upgrade.dps * DT);
  }

  // Rewind: remember where every unit that a Sage could save has been.
  record() {
    let owners = null;
    for (const u of this.units) {
      if (!u.dead && !u.rewindUsed && has(u, 'rewind')) (owners ||= new Set()).add(u.owner);
    }
    if (!owners) return;
    const keep = Math.round(this.maxRewindSeconds() / DT);
    for (const u of this.units) {
      if (u.dead || !owners.has(u.owner)) continue;
      const h = (u.hist ||= []);
      h.push({ x: u.x, y: u.y, hp: u.src.hp });
      if (h.length > keep) h.shift();
    }
  }

  maxRewindSeconds() {
    let s = 0;
    for (const u of this.units) if (has(u, 'rewind')) s = Math.max(s, u.def.upgrade.seconds);
    return s;
  }

  // Lodestone: Stones drag nearby enemies toward themselves, harder up close.
  lodestone() {
    for (const s of this.units) {
      if (s.dead || !has(s, 'lodestone')) continue;
      const { radius, pull } = s.def.upgrade;
      for (const e of this.units) {
        if (e.dead || e.owner === s.owner) continue;
        const g = gap(s, e);
        if (g > radius || g <= 0) continue;
        const dx = s.x - e.x;
        const dy = s.y - e.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const step = Math.min(g, pull * (1 - g / radius) * DT);
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
    }
  }

  towerStep() {
    const t = this.tower;
    t.cooldown -= DT;
    if (t.cooldown > 0) return;
    const opts = [];
    for (const e of this.units) {
      if (e.dead || e.owner === t.owner) continue;
      if (gap(e, t) <= TOWER_RANGE) opts.push(e);
    }
    if (!opts.length) return;
    t.cooldown = 1 / TOWER_STATS.spd;
    this.attack({ ...t, stats: TOWER_STATS, def: null, src: {}, heat: 0 }, this.rng.pick(opts), t);
  }

  // ---- attacks and damage ------------------------------------------------------------

  attack(u, t, record = u) {
    record.atk = { tx: t.x, ty: t.y, time: this.time, hit: false };
    let dmg = u.stats.dmg;
    if (!u.isTower && !u.exposed && has(u, 'longExposure')) {
      // Long Exposure: the first shot of the battle releases the charge, hit or miss.
      u.exposed = true;
      const { perSecond, max } = u.def.upgrade;
      const bonus = Math.min(max, Math.max(0, u.joinedAt - u.src.idleSince) * perSecond);
      dmg += bonus;
      if (bonus >= 1) this.fx.push({ kind: 'exposure', x: u.x, y: u.y, tx: t.x, ty: t.y, time: this.time });
    }
    if (this.rng.next() >= hitChance(u.stats.acc, t.stats.eva)) return;
    record.atk.hit = true;
    if (t.isTower) {
      if (this.onTowerDamage) this.onTowerDamage(u.owner, t.owner, hitDamage(dmg, 0));
      return;
    }

    // Statuses land before the damage, so a killing blow can still infect or ignite.
    const up = u.def && u.src.upgraded ? u.def.upgrade : null;
    if (up) {
      if (up.effect === 'footnotes') t.notes = Math.min(up.max, t.notes + 1);
      if (up.effect === 'wildfire') this.ignite(t, u, up);
      if (up.effect === 'cordyceps' && t.husk === null) t.infected = { owner: u.owner, up };
      if (up.effect === 'redline') u.heat++;
    }

    // Postmortem: Servitors shrug off the unit types that killed Servitors before.
    let arm = this.arm(t);
    if (has(t, 'postmortem')) arm += this.memory[t.owner]?.[killerType(u)] || 0;
    this.damage(u, t, hitDamage(dmg, arm), true);

    if (up && up.effect === 'crosswind' && !t.dead) {
      const dx = t.x - u.x;
      const dy = t.y - u.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      t.x += (dx / d) * up.push;
      t.y += (dy / d) * up.push;
    }
  }

  ignite(t, by, up) {
    t.burn = { until: this.time + up.seconds, dps: up.dps, by: { owner: by.owner, def: by.def, src: by.src, armyId: by.armyId } };
  }

  // Routes damage from `by` (a unit, or anything with owner/def) to `t`. Hits (as
  // opposed to burning or heat) can be sheltered by a Bulwark.
  damage(by, t, amount, isHit) {
    if (t.dead) return;
    const bw = isHit ? this.shelterFor(t) : null;
    if (bw) {
      const share = amount * bw.def.upgrade.share;
      amount -= share;
      this.hurt(by, bw, Math.max(0, share - this.arm(bw)));
      this.fx.push({ kind: 'shelter', a: bw, b: t, time: this.time });
    }
    if (has(t, 'commonBody')) {
      const pool = this.units.filter((c) => !c.dead && c.owner === t.owner && has(c, 'commonBody'));
      for (const c of pool) this.hurt(by, c, amount / pool.length);
    } else {
      this.hurt(by, t, amount);
    }
    if (bw && !t.dead) t.src.hp = Math.min(t.stats.hp, t.src.hp + Math.max(0, this.arm(bw)));
  }

  // Shelter: a Bulwark touching this Compatriot takes part of the hit.
  shelterFor(t) {
    for (const b of this.units) {
      if (b === t || b.dead || b.owner !== t.owner || !has(b, 'shelter')) continue;
      if (gap(b, t) <= TOUCH) return b;
    }
    return null;
  }

  hurt(by, t, amount) {
    if (t.dead || amount <= 0) return;
    t.src.hp -= amount;
    if (t.src.hp > 0 || this.rewind(t)) return;
    this.die(by, t);
  }

  // Rewind: a Sage with its charge left pulls a dying ally back three seconds.
  rewind(t) {
    if (!t.hist || !t.hist.length) return false;
    for (const s of this.units) {
      if (s.dead || s.rewindUsed || s.owner !== t.owner || !has(s, 'rewind')) continue;
      if (Math.hypot(s.x - t.x, s.y - t.y) > s.def.upgrade.radius) continue;
      s.rewindUsed = true;
      const back = Math.round(s.def.upgrade.seconds / DT);
      const h = t.hist[Math.max(0, t.hist.length - back)];
      this.fx.push({ kind: 'rewind', path: t.hist.slice(-back).map((p) => ({ x: p.x, y: p.y })), from: { x: t.x, y: t.y }, time: this.time });
      t.x = h.x;
      t.y = h.y;
      t.src.hp = h.hp;
      t.hist = [];
      return true;
    }
    return false;
  }

  die(by, t) {
    t.dead = true;
    t.src.hp = 0;
    if (t.husk !== null) return; // husks give nothing and leave nothing
    if (this.onKill && by.owner !== t.owner) this.onKill(by.owner, t, by);
    if (has(t, 'postmortem') && by.owner !== t.owner) {
      const mem = (this.memory[t.owner] ||= {});
      const key = killerType(by);
      mem[key] = Math.min(t.def.upgrade.max, (mem[key] || 0) + 1);
    }
    if (t.burn) {
      // Wildfire: the flames jump to every enemy of the fire-starter touching the body.
      for (const e of this.units) {
        if (e === t || e.dead || e.owner === t.burn.by.owner || gap(e, t) > TOUCH) continue;
        this.ignite(e, t.burn.by, t.burn.by.def.upgrade);
      }
    }
    if (t.infected) {
      this.raiseHusk(t);
      return;
    }
    if (has(t, 'reshelving')) this.piles.push({ src: t.src, owner: t.owner, armyId: t.armyId, x: t.x, y: t.y, time: this.time });
  }

  // Cordyceps: the infected corpse stands up for the infector, keeping its weapon.
  raiseHusk(t) {
    const { owner, up: { seconds, hp } } = t.infected;
    const src = { def: t.def, owner, stats: t.stats, hp: t.stats.hp * hp, upgraded: t.src.upgraded, idleSince: this.gameTime };
    const h = this.makeUnit(src, owner, null, t.x, t.y, { x: t.fx, y: t.fy }, 0.4);
    h.husk = this.time + seconds;
    h.exposed = true;
    this.units.push(h);
    this.fx.push({ kind: 'husk', x: t.x, y: t.y, time: this.time });
  }

  resolveCollisions() {
    const us = this.units;
    const n = us.length;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < n; i++) {
        const a = us[i];
        for (let j = i + 1; j < n; j++) {
          const b = us[j];
          const min = a.r + b.r;
          const dx = b.x - a.x;
          if (dx > min || dx < -min) continue;
          const dy = b.y - a.y;
          if (dy > min || dy < -min) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          let d = Math.sqrt(d2);
          let nx;
          let ny;
          if (d < 1e-6) {
            // Perfect overlap: separate along a deterministic pseudo-random axis.
            const ang = ((a.uid * 7919 + b.uid * 104729) % 628) / 100;
            nx = Math.cos(ang);
            ny = Math.sin(ang);
            d = 0;
          } else {
            nx = dx / d;
            ny = dy / d;
          }
          const push = (min - d) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    const t = this.tower;
    for (const u of us) {
      if (t) {
        const dx = u.x - t.x;
        const dy = u.y - t.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const min = u.r + t.r;
        if (d < min) {
          u.x = t.x + (dx / d) * min;
          u.y = t.y + (dy / d) * min;
        }
      }
      const d = Math.hypot(u.x, u.y);
      if (d > BOUND) {
        u.x *= BOUND / d;
        u.y *= BOUND / d;
      }
    }
  }

  // Survivors grouped back into the armies they arrived with. Husks crumble; Warden
  // piles re-form for any owner who still has someone standing (Reshelving).
  survivorsByArmy() {
    const out = new Map();
    const add = (armyId, src) => {
      if (!out.has(armyId)) out.set(armyId, []);
      out.get(armyId).push(src);
    };
    const standing = new Set();
    for (const u of this.units) {
      if (u.husk !== null || u.dead) continue;
      standing.add(u.owner);
      add(u.armyId, u.src);
    }
    for (const p of this.piles) {
      if (!standing.has(p.owner)) continue;
      p.src.hp = p.src.stats.hp * p.src.def.upgrade.restore;
      add(p.armyId, p.src);
    }
    return out;
  }
}

function killerType(by) {
  return by.def ? by.def.id : 'tower';
}
