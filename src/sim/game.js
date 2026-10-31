// The whole deterministic game state. step() advances one 1/30 s tick. The browser
// calls it as fast as real time (times game speed) demands; playtests call it in a
// tight loop. Commands (buy, upgrade, formation) are applied between ticks.
import {
  DT, MARCH_SPEED, TOWER_OFFSET, ENGAGE_DIST, JOIN_DIST, WAVE_INTERVAL, PLAYER_HP,
  UNIT_COST, UPGRADE_COST, MAX_GAME_SECONDS, FACTION_BY_ID, TOWER_STATS, startingWave,
  defaultFormation, effectiveStats,
} from './data.js';
import { Rng } from './rng.js';
import { Battle, hitChance, hitDamage } from './battle.js';
import {
  LANES, laneNodes, continueNodes, routeFromNodes, makeRoute, posAt, segmentAt,
} from './map.js';

export class Game {
  // opts.factions: four faction ids, seat 0-3 clockwise from top-left.
  // opts.lanes: optional list of [player, lane] pairs; only those lanes send waves.
  // opts.maxSeconds: stop after this much game time.
  constructor(opts) {
    this.rng = new Rng(opts.seed ?? 1);
    this.maxSeconds = opts.maxSeconds ?? MAX_GAME_SECONDS;
    this.activeLanes = opts.lanes ? new Set(opts.lanes.map(([p, l]) => `${p}:${l}`)) : null;
    this.players = opts.factions.map((fid, i) => {
      const wave = startingWave(fid);
      return {
        index: i,
        factionId: fid,
        faction: FACTION_BY_ID[fid],
        hp: PLAYER_HP,
        gold: 0,
        alive: true,
        roster: Object.fromEntries(LANES.map((l) => [l, { ...wave }])),
        upgrades: new Set(),
        formation: defaultFormation(fid),
        kills: 0,
        towerDamage: 0,
        eliminatedAt: null,
      };
    });
    this.armies = [];
    this.battles = [];
    this.time = 0;
    this.tick = 0;
    this.nextWave = 0;
    this.waveCount = 0;
    this.nextId = 1;
    this.over = false;
    this.winner = null;
    this.events = [];
    this.firstBattleWinner = null;
    this.towers = new Map(); // "player:x,y" -> { cooldown }
    this.towerShots = []; // recent shots, for rendering
  }

  alive() {
    return this.players.map((p) => p.alive);
  }

  log(type, text, extra = {}) {
    this.events.push({ t: this.time, type, text, ...extra });
  }

  // ---- commands -------------------------------------------------------------

  buyUnit(pi, typeId, lane) {
    const p = this.players[pi];
    if (!p.alive || p.gold < UNIT_COST) return false;
    p.gold -= UNIT_COST;
    p.roster[lane][typeId] = (p.roster[lane][typeId] || 0) + 1;
    return true;
  }

  buyUpgrade(pi, typeId) {
    const p = this.players[pi];
    if (!p.alive || p.gold < UPGRADE_COST || p.upgrades.has(typeId)) return false;
    p.gold -= UPGRADE_COST;
    p.upgrades.add(typeId);
    // Upgrades apply immediately to every living unit of that type, in all lanes.
    for (const a of this.armies) {
      if (a.owner !== pi) continue;
      for (const u of a.units) {
        if (u.def.id !== typeId) continue;
        const next = effectiveStats(u.def, true);
        u.hp += next.hp - u.stats.hp;
        Object.assign(u.stats, next);
      }
    }
    return true;
  }

  setFormation(pi, typeId, depth) {
    this.players[pi].formation[typeId] = Math.max(0, Math.min(1, depth));
  }

  typeCount(pi, typeId) {
    const p = this.players[pi];
    return LANES.reduce((n, l) => n + (p.roster[l][typeId] || 0), 0);
  }

  // ---- simulation -------------------------------------------------------------

  step() {
    if (this.over) return;
    this.tick++;
    this.time = this.tick * DT;

    if (this.time >= this.nextWave) {
      this.spawnWaves();
      this.nextWave += WAVE_INTERVAL;
    }

    for (const a of this.armies) {
      if (a.state === 'march') {
        a.s += MARCH_SPEED * DT;
        if (a.s >= a.route.length - TOWER_OFFSET) {
          a.s = a.route.length - TOWER_OFFSET;
          a.state = 'siege';
        }
      }
      if (a.state === 'siege') this.siege(a);
    }
    this.towerFire();

    for (const b of this.battles) b.step();
    this.endBattles();
    this.engage();
    this.checkEliminations();
    if (!this.over && this.time >= this.maxSeconds) this.finish();
  }

  spawnWaves() {
    this.waveCount++;
    const alive = this.alive();
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const lane of LANES) {
        if (this.activeLanes && !this.activeLanes.has(`${p.index}:${lane}`)) continue;
        const nodes = laneNodes(p.index, lane, alive);
        if (!nodes) continue;
        const units = [];
        for (const u of p.faction.units) {
          const n = p.roster[lane][u.id] || 0;
          for (let k = 0; k < n; k++) {
            const stats = effectiveStats(u, p.upgrades.has(u.id));
            units.push({ def: u, owner: p.index, stats, hp: stats.hp });
          }
        }
        if (!units.length) continue;
        this.armies.push({
          id: this.nextId++,
          owner: p.index,
          lane,
          route: routeFromNodes(nodes),
          s: 0,
          state: 'march',
          battle: null,
          units,
          wave: this.waveCount,
        });
      }
    }
  }

  armyPos(a) {
    return posAt(a.route, a.s);
  }

  siege(a) {
    const target = a.route.nodes[a.route.nodes.length - 1];
    const p = this.players[target];
    if (!p.alive) return;
    let dmg = 0;
    // Towers have no ARM or EVA; use expected damage so sieges need no rolls.
    for (const u of a.units) dmg += u.stats.spd * hitChance(u.stats.acc, 0) * u.stats.dmg * DT;
    p.hp -= dmg;
    this.players[a.owner].towerDamage += dmg;
  }

  // Each lane's tower shoots one random unit among the armies sieging it.
  towerFire() {
    const groups = new Map();
    for (const a of this.armies) {
      if (a.state !== 'siege' || !a.units.length) continue;
      const target = a.route.nodes[a.route.nodes.length - 1];
      const p = this.armyPos(a);
      const key = `${target}:${Math.round(p.x)},${Math.round(p.y)}`;
      if (!groups.has(key)) groups.set(key, { target, x: p.x, y: p.y, armies: [] });
      groups.get(key).armies.push(a);
    }
    for (const t of this.towers.values()) t.cooldown -= DT;
    for (const [key, g] of groups) {
      if (!this.players[g.target].alive) continue;
      const tower = this.towers.get(key) || { cooldown: 0 };
      this.towers.set(key, tower);
      if (tower.cooldown > 0) continue;
      tower.cooldown = 1 / TOWER_STATS.spd;
      const units = g.armies.flatMap((a) => a.units);
      const victim = this.rng.pick(units);
      const hit = this.rng.next() < hitChance(TOWER_STATS.acc, victim.stats.eva);
      this.towerShots.push({ t: this.time, x: g.x, y: g.y, owner: g.target, hit });
      if (!hit) continue;
      victim.hp -= hitDamage(TOWER_STATS.dmg, victim.stats.arm);
      if (victim.hp <= 0) {
        for (const a of g.armies) a.units = a.units.filter((u) => u !== victim);
        this.onKill(g.target, victim);
      }
    }
    if (this.towerShots.length > 40) this.towerShots.splice(0, this.towerShots.length - 40);
    this.armies = this.armies.filter((a) => a.units.length > 0);
  }

  engage() {
    const free = this.armies.filter((a) => a.state !== 'battle');
    if (!free.length) return;
    const pos = new Map(free.map((a) => [a, this.armyPos(a)]));

    // Armies reaching an ongoing battle join it.
    for (const a of free) {
      if (a.state === 'battle') continue;
      const p = pos.get(a);
      for (const b of this.battles) {
        if (Math.hypot(p.x - b.x, p.y - b.y) > JOIN_DIST) continue;
        if (![...b.owners()].some((o) => o !== a.owner)) continue;
        this.joinBattle(a, b);
        break;
      }
    }

    // Two enemy armies meeting start a new battle.
    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (a.state === 'battle') continue;
      for (let j = i + 1; j < free.length; j++) {
        const c = free[j];
        if (c.state === 'battle' || c.owner === a.owner) continue;
        const pa = pos.get(a);
        const pc = pos.get(c);
        if (Math.hypot(pa.x - pc.x, pa.y - pc.y) > ENGAGE_DIST) continue;
        const b = new Battle(this.nextId++, (pa.x + pc.x) / 2, (pa.y + pc.y) / 2, this.rng);
        b.onKill = (owner, victim) => this.onKill(owner, victim);
        this.battles.push(b);
        this.joinBattle(a, b);
        this.joinBattle(c, b);
        // Anyone else already standing there piles in too.
        for (const o of free) {
          if (o.state === 'battle') continue;
          const po = pos.get(o);
          if (Math.hypot(po.x - b.x, po.y - b.y) <= JOIN_DIST) this.joinBattle(o, b);
        }
        break;
      }
    }
  }

  joinBattle(a, b) {
    const p = this.armyPos(a);
    a.state = 'battle';
    a.battle = b.id;
    b.addArmy(a, { x: p.dx, y: p.dy }, this.players[a.owner].formation);
  }

  onKill(owner, victim) {
    const p = this.players[owner];
    p.gold += victim.def.tier;
    p.kills++;
  }

  endBattles() {
    const keep = [];
    for (const b of this.battles) {
      if (!b.isOver()) {
        keep.push(b);
        continue;
      }
      const survivors = b.survivorsByArmy();
      const winner = b.units.length ? b.units[0].owner : null;
      if (this.firstBattleWinner === null) this.firstBattleWinner = winner;
      for (const a of b.armies.values()) {
        a.units = survivors.get(a.id) || [];
        a.battle = null;
        a.state = a.s >= a.route.length - TOWER_OFFSET - 1e-6 ? 'siege' : 'march';
      }
      this.log('battle', `Battle ended`, { battle: b.id, winner });
    }
    this.battles = keep;
    this.armies = this.armies.filter((a) => a.units.length > 0);
  }

  checkEliminations() {
    let changed = false;
    for (const p of this.players) {
      if (p.alive && p.hp <= 0) {
        p.alive = false;
        p.hp = 0;
        p.eliminatedAt = this.time;
        changed = true;
        this.log('elim', `${p.faction.name} have been eliminated`, { player: p.index });
        for (const b of this.battles) b.units = b.units.filter((u) => u.owner !== p.index);
        this.armies = this.armies.filter((a) => a.owner !== p.index);
      }
    }
    if (!changed) return;
    const alive = this.alive();
    if (alive.filter(Boolean).length <= 1) {
      this.finish();
      return;
    }
    // Battles that lost their last opponent end next tick; reroute everyone else.
    for (const a of this.armies) this.reroute(a, alive);
  }

  reroute(a, alive) {
    const seg = segmentAt(a.route, a.s);
    const nextNode = a.route.nodes[seg + 1];
    const cont = continueNodes(a.owner, a.lane, nextNode, alive);
    if (!cont) {
      a.units = [];
      return;
    }
    const oldTarget = a.route.nodes[a.route.nodes.length - 1];
    if (cont[cont.length - 1] === oldTarget) return;
    const here = this.armyPos(a);
    const tail = routeFromNodes(cont);
    a.route = makeRoute([{ x: here.x, y: here.y }, ...tail.points], [null, ...cont]);
    a.s = 0;
    if (a.state === 'siege') a.state = 'march';
  }

  finish() {
    this.over = true;
    const ranked = [...this.players].sort((x, y) => y.hp - x.hp);
    this.winner = ranked[0].hp > 0 ? ranked[0].index : null;
    if (this.winner !== null) this.log('end', `${this.players[this.winner].faction.name} win the simulation`);
  }
}
