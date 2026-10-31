// 2D battle engine. Units are circles on a round arena; one call to step() advances
// the fight by one fixed tick (DT). No wall-clock time or Math.random is used, so a
// battle is a pure function of its inputs and the shared seeded Rng.
import {
  DT, UNIT_RADIUS, ARENA_RADIUS, SPAWN_DEPTH, SPAWN_WIDTH, SPD_SCALE, MELEE_REACH,
} from './data.js';

const SLOT = 1.25; // lateral spacing between units in a formation row
const ROW = 1.2; // spacing between rows when a type overflows one row
const PER_ROW = Math.floor(SPAWN_WIDTH / SLOT);
const BOUND = ARENA_RADIUS + 1;
const SPLASH_REACH = 0.35;

export function hitChance(acc, eva) {
  return Math.min(1, (50 + acc) / (100 + 2 * eva));
}

export function hitDamage(dmg, arm) {
  return Math.max(1, dmg - arm);
}

export class Battle {
  constructor(id, x, y, rng) {
    this.id = id;
    this.x = x; // position on the strategic map
    this.y = y;
    this.rng = rng;
    this.units = [];
    this.armies = new Map(); // armyId -> army record (route state for when it leaves)
    this.time = 0;
    this.onKill = null; // (killerOwner, victimUnit) => void
    this.nextUnitId = 1;
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
        const row = Math.floor(i / PER_ROW);
        const inRow = Math.min(PER_ROW, list.length - row * PER_ROW);
        const col = i % PER_ROW;
        const side = (col - (inRow - 1) / 2) * SLOT + this.rng.range(-0.08, 0.08);
        let fromCentre = ARENA_RADIUS - depth * SPAWN_DEPTH + (back ? -row * ROW : row * ROW);
        fromCentre = Math.max(ARENA_RADIUS - SPAWN_DEPTH, Math.min(ARENA_RADIUS, fromCentre));
        fromCentre += this.rng.range(-0.08, 0.08);
        const u = list[i];
        this.units.push({
          uid: this.nextUnitId++,
          src: u, // the persistent unit record (hp carries over between battles)
          def: u.def,
          owner: army.owner,
          armyId: army.id,
          stats: u.stats,
          r: UNIT_RADIUS,
          x: -dir.x * fromCentre + lat.x * side,
          y: -dir.y * fromCentre + lat.y * side,
          fx: dir.x, // facing, for rendering
          fy: dir.y,
          target: null,
          cooldown: this.rng.range(0, 0.3 / u.stats.spd),
          dead: false,
          atk: null,
        });
      }
    }
    // Newcomers pick the closest enemy immediately.
    for (const bu of this.units) if (bu.armyId === army.id) bu.target = this.closestEnemy(bu, false);
  }

  owners() {
    const s = new Set();
    for (const u of this.units) s.add(u.owner);
    return s;
  }

  isOver() {
    return this.owners().size <= 1;
  }

  inRange(a, b) {
    const reach = a.stats.rng > 0 ? a.stats.rng : MELEE_REACH;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const gap = Math.sqrt(dx * dx + dy * dy) - a.r - b.r;
    return gap <= reach;
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

  step() {
    this.time += DT;
    const units = this.units;

    // 1. Targeting and movement intent.
    for (const u of units) {
      if (u.dead) continue;
      if (u.stats.regen) u.src.hp = Math.min(u.stats.hp, u.src.hp + u.stats.regen * DT);
      if (!u.target || u.target.dead) {
        u.target = this.randomEnemyInRange(u) || this.closestEnemy(u, false);
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
          u.cooldown = 1 / u.stats.spd;
          this.attack(u, t);
        }
      } else {
        const step = Math.min(u.stats.spd * SPD_SCALE * DT, d - u.r - t.r);
        u.x += u.fx * step;
        u.y += u.fy * step;
      }
    }

    // 2. Remove the dead before collision so corpses don't block.
    if (units.some((u) => u.dead)) this.units = units.filter((u) => !u.dead);

    // 3. Collision: nobody overlaps, friend or foe.
    this.resolveCollisions();
  }

  attack(u, t) {
    u.atk = { tx: t.x, ty: t.y, time: this.time, hit: false };
    if (this.rng.next() >= hitChance(u.stats.acc, t.stats.eva)) return;
    u.atk.hit = true;
    this.damage(u, t, hitDamage(u.stats.dmg, t.stats.arm));
    if (u.stats.splash > 0) {
      for (const e of this.units) {
        if (e === t || e.dead || e.owner === u.owner) continue;
        const gap = Math.hypot(e.x - t.x, e.y - t.y) - e.r - t.r;
        if (gap <= SPLASH_REACH) {
          const sd = u.stats.dmg * u.stats.splash - e.stats.arm;
          if (sd > 0) this.damage(u, e, sd);
        }
      }
    }
  }

  damage(u, t, amount) {
    if (t.dead) return;
    t.src.hp -= amount;
    if (t.src.hp <= 0) {
      t.dead = true;
      t.src.hp = 0;
      if (this.onKill) this.onKill(u.owner, t);
    }
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
    for (const u of us) {
      const d = Math.hypot(u.x, u.y);
      if (d > BOUND) {
        u.x *= BOUND / d;
        u.y *= BOUND / d;
      }
    }
  }

  // Survivors grouped back into the armies they arrived with.
  survivorsByArmy() {
    const out = new Map();
    for (const u of this.units) {
      if (!out.has(u.armyId)) out.set(u.armyId, []);
      out.get(u.armyId).push(u.src);
    }
    return out;
  }
}
