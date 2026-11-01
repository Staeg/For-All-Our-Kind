// The whole deterministic game state. step() advances one 1/30 s tick. The browser
// calls it as fast as real time (times game speed) demands; playtests call it in a
// tight loop. Commands (buy, upgrade, formation) are applied between ticks.
import {
  DT, MARCH_SPEED, TOWER_OFFSET, ENGAGE_DIST, JOIN_DIST, WAVE_INTERVAL, PLAYER_HP,
  UNIT_COST, UPGRADE_COST, MAX_GAME_SECONDS, FACTION_BY_ID, FIRE_SPEED, startingWave,
  defaultFormation, newUnit,
} from './data.js';
import { Rng } from './rng.js';
import { Battle } from './battle.js';
import { ensureSlots } from './formation.js';
import {
  NODE_POS, CENTRE, LANES, laneNodes, continueNodes, routeFromNodes, makeRoute, posAt, segmentAt,
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
        // Per lane: gold earned from kills by that lane's units, and units sent down it.
        laneStats: Object.fromEntries(LANES.map((l) => [l, { gold: 0, sent: 0 }])),
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
    this.fires = []; // fire waves rolling out from eliminated players' corners
    this.memory = {}; // per-player knowledge that outlives battles (Postmortem)
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
    // Upgrades apply immediately to every living unit of that type, in all lanes,
    // including units in the middle of a battle.
    for (const a of this.armies) {
      if (a.owner !== pi) continue;
      for (const u of a.units) if (u.def.id === typeId) u.upgraded = true;
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
          a.state = 'siege'; // at the enemy tower: a tower battle starts in engage()
        }
      }
    }

    for (const b of this.battles) b.step();
    this.endBattles();
    this.engage();
    this.checkEliminations();
    this.burn();
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
        const slots = ensureSlots(p, lane);
        for (const u of p.faction.units) {
          const n = p.roster[lane][u.id] || 0;
          for (let k = 0; k < n; k++) {
            const unit = newUnit(u, p.index, p.upgrades.has(u.id), this.time);
            unit.slot = { ...slots[u.id][k] };
            units.push(unit);
          }
        }
        if (!units.length) continue;
        p.laneStats[lane].sent += units.length;
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
        const b = this.newBattle((pa.x + pc.x) / 2, (pa.y + pc.y) / 2);
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

    // Armies standing at an enemy tower with nobody to fight attack the tower itself.
    for (const a of free) {
      if (a.state !== 'siege') continue;
      const target = a.route.nodes[a.route.nodes.length - 1];
      const p = pos.get(a);
      let b = this.battles.find((x) => x.tower && x.tower.owner === target
        && Math.hypot(p.x - x.x, p.y - x.y) <= JOIN_DIST);
      if (!b) {
        b = this.newBattle(p.x, p.y);
        b.setTower(target, { x: p.dx, y: p.dy });
        const from = a.route.nodes[a.route.nodes.length - 2];
        b.towerLane = from === CENTRE ? 'mid' : from === (target + 1) % 4 ? 'cw' : 'ccw';
      }
      this.joinBattle(a, b);
    }
  }

  newBattle(x, y) {
    const b = new Battle(this.nextId++, x, y, this.rng, { memory: this.memory, startTime: this.time });
    // Tower kills count toward the defender's lane facing that tower.
    b.onKill = (owner, victim, killer) => this.onKill(owner, victim,
      killer.isTower ? b.towerLane : b.armies.get(killer.armyId)?.lane);
    b.onTowerDamage = (attacker, owner, amount) => {
      this.players[owner].hp -= amount;
      this.players[attacker].towerDamage += amount;
    };
    this.battles.push(b);
    return b;
  }

  joinBattle(a, b) {
    const p = this.armyPos(a);
    a.state = 'battle';
    a.battle = b.id;
    b.addArmy(a, { x: p.dx, y: p.dy }, this.players[a.owner].formation);
  }

  onKill(owner, victim, lane) {
    const p = this.players[owner];
    p.gold += victim.def.tier;
    if (lane) p.laneStats[lane].gold += victim.def.tier;
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
        for (const u of a.units) u.idleSince = this.time;
        a.battle = null;
        a.state = 'march';
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
        for (const b of this.battles) {
          b.units = b.units.filter((u) => u.owner !== p.index);
          b.piles = b.piles.filter((x) => x.owner !== p.index);
          if (b.tower && b.tower.owner === p.index) b.tower = null;
        }
        // A wave of fire rolls from their corner down both perimeter lanes.
        for (const n of [(p.index + 1) % 4, (p.index + 3) % 4]) {
          const a = NODE_POS[p.index];
          const b = NODE_POS[n];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          this.fires.push({ ax: a.x, ay: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len: len - 25, d: 0, start: this.time });
        }
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

  // Advance fire waves and kill every unit they reach, in or out of battle.
  burn() {
    if (!this.fires.length) return;
    const reached = (x, y, f) => {
      const t = (x - f.ax) * f.ux + (y - f.ay) * f.uy;
      const off = Math.abs((x - f.ax) * f.uy - (y - f.ay) * f.ux);
      return off < 26 && t >= -30 && t <= Math.min(f.d, f.len);
    };
    for (const f of this.fires) {
      if (f.d >= f.len) continue;
      f.d += FIRE_SPEED * DT;
      for (const b of this.battles) if (reached(b.x, b.y, f)) b.units = [];
      for (const a of this.armies) {
        if (a.state === 'battle') continue;
        const p = this.armyPos(a);
        if (reached(p.x, p.y, f)) a.units = [];
      }
    }
    this.armies = this.armies.filter((a) => a.units.length > 0 || a.state === 'battle');
    this.fires = this.fires.filter((f) => this.time - f.start < f.len / FIRE_SPEED + 0.5);
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
