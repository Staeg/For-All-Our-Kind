// Game constants and faction content. Everything balance-related lives here so the
// playtest tools and the browser game share exactly the same numbers.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

// Battle arena, measured in default unit diameters.
export const UNIT_RADIUS = 0.5;
export const ARENA_RADIUS = 20; // centre to the far edge of a spawn zone
export const SPAWN_DEPTH = ARENA_RADIUS / 2; // the quarter of the field a player owns
export const SPAWN_WIDTH = 16;
export const SPD_SCALE = ARENA_RADIUS / 10; // SPD 1 crosses edge -> centre in 10 s
export const MELEE_REACH = 0.15; // RNG 0: edge-to-edge contact

// Strategic map, in map units (the map is a 1000 x 1000 square).
export const MAP_SIZE = 1000;
export const MARCH_SPEED = 25; // map units per second, same for every army
export const TOWER_OFFSET = 70; // towers stand this far out from the base along each lane
export const ENGAGE_DIST = 14; // two enemy dots this close start a battle
export const JOIN_DIST = 22; // an army this close to a battle joins it
export const WAVE_INTERVAL = 20; // seconds between waves

export const PLAYER_HP = 10000;
// Towers shoot at armies sieging them. ATK is read as accuracy.
export const TOWER_STATS = { acc: 100, dmg: 500, spd: 0.2 };
export const FIRE_SPEED = 220; // map units per second for the fire wave on elimination
export const UNIT_COST = 20;
export const UPGRADE_COST = 60;
export const MAX_GAME_SECONDS = 60 * 45;

export const STAT_KEYS = ['hp', 'acc', 'dmg', 'arm', 'eva', 'spd', 'rng'];

function unit(id, name, role, stats, upgrade, blurb) {
  const ranged = role === 'ranged';
  return {
    id,
    name,
    role,
    tier: 1,
    blurb,
    stats: {
      hp: ranged ? 50 : 100,
      acc: 0,
      dmg: 10,
      arm: 0,
      eva: 0,
      spd: 1,
      rng: ranged ? 3 : 0,
      ...stats,
    },
    upgrade,
  };
}

// Each unit type has one upgrade: a named `effect` that changes how the unit fights
// (implemented in battle.js), plus that effect's tuning numbers. Upgrades never
// change stats, so a unit's stats are always its type's base stats.
export const FACTIONS = [
  {
    id: 'librarians',
    name: 'The Librarians',
    blurb: 'Sandy undead, recently awakened to find their eons-old masters missing.',
    colors: { main: '#d9b26f', dark: '#7a5a2e', accent: '#2fa8a0', banner: '#c99a45' },
    units: [
      unit('warden', 'Dust Warden', 'melee', {}, {
        name: 'Reshelving', effect: 'reshelving', restore: 0.25,
        desc: 'A fallen Warden crumbles into a sand pile. If any Librarian is still standing when the battle ends, the pile re-forms at 25% HP.',
      }, 'Bog-standard shambling guard.'),
      unit('slinger', 'Scroll Slinger', 'ranged', { hp: 47, acc: 30, dmg: 8, rng: 4 }, {
        name: 'Footnotes', effect: 'footnotes', max: 5,
        desc: 'Each hit annotates the target: -1 ARM per footnote, up to -5, for the rest of the battle. ARM can go negative.',
      }, 'Accurate but feeble paper cuts from afar.'),
      unit('sage', 'Hourglass Sage', 'ranged', { hp: 56, spd: 0.6, dmg: 19, rng: 4.5 }, {
        name: 'Rewind', effect: 'rewind', radius: 6, seconds: 3,
        desc: 'Once per battle, when a Librarian within 6 diameters would die, the sand runs back: it returns to where it stood, with the HP it had, 3 s earlier.',
      }, 'Slow, heavy, long-range blasts of time-sand.'),
    ],
  },
  {
    id: 'visitors',
    name: 'The Visitors',
    blurb: 'Curious elemental creatures from other planes.',
    colors: { main: '#9a7cf4', dark: '#43308f', accent: '#38e0ea', banner: '#7f5ff0' },
    units: [
      unit('wisp', 'Ember Wisp', 'ranged', {}, {
        name: 'Wildfire', effect: 'wildfire', seconds: 3, dps: 2,
        desc: 'Hits set the target burning for 3 s (2 damage per second, ignoring ARM). When a burning unit dies, the fire jumps to every enemy touching it.',
      }, 'Bog-standard drifting firebolt thrower.'),
      unit('monolith', 'Stone Visitor', 'melee', { hp: 116, arm: 2, dmg: 9, spd: 0.7 }, {
        name: 'Lodestone', effect: 'lodestone', radius: 4, pull: 0.6,
        desc: 'Pulls enemies within 4 diameters gently toward the Stone, harder the closer they are.',
      }, 'Slow armoured boulder with a weak punch.'),
      unit('sprite', 'Gale Sprite', 'ranged', { hp: 39, eva: 10, dmg: 8, spd: 1.4, rng: 2.5 }, {
        name: 'Crosswind', effect: 'crosswind', push: 0.5,
        desc: 'Every hit shoves the target half a diameter away from the Sprite.',
      }, 'Fast, evasive, fragile, short-ranged gusts.'),
    ],
  },
  {
    id: 'compatriots',
    name: 'The Compatriots',
    blurb: 'Fungal network beings who share everything.',
    colors: { main: '#c8372d', dark: '#6e1a14', accent: '#f2e3c6', banner: '#d8402f' },
    units: [
      unit('comrade', 'Spore Comrade', 'melee', {}, {
        name: 'Common Body', effect: 'commonBody',
        desc: 'Damage taken by any Comrade is split evenly across every Comrade in the battle.',
      }, 'Bog-standard mushroom worker with a hammer.'),
      unit('bulwark', 'Shelf Bulwark', 'melee', { hp: 120, dmg: 8, arm: 2, spd: 0.8 }, {
        name: 'Shelter', effect: 'shelter', share: 0.5,
        desc: 'Half of every hit on a Compatriot touching a Bulwark goes to the Bulwark instead, through its ARM, and the sheltered ally heals by the Bulwark\'s ARM.',
      }, 'Armoured bracket-fungus wall that hits softly.'),
      unit('lobber', 'Puffball Lobber', 'ranged', { hp: 95, dmg: 9, rng: 3 }, {
        name: 'Cordyceps', effect: 'cordyceps', seconds: 6, hp: 0.5,
        desc: 'Hits infect the target. An infected enemy that dies rises as a husk under your control for 6 s, at half HP, keeping its weapon.',
      }, 'Hardy, short-ranged spore puffer.'),
    ],
  },
  {
    id: 'apex',
    name: 'The Apex',
    blurb: 'Robotic seekers of hyper-evolution.',
    colors: { main: '#b9c6d3', dark: '#3d4a5a', accent: '#ff8a2a', banner: '#8fa3b8' },
    units: [
      unit('servitor', 'Servitor', 'melee', {}, {
        name: 'Postmortem', effect: 'postmortem', max: 5,
        desc: 'A dying Servitor uploads what killed it. All your Servitors take 1 less damage per hit from that unit type for the rest of the game, up to 5.',
      }, 'Bog-standard boxy melee drone.'),
      unit('striker', 'Striker Frame', 'melee', { hp: 70, dmg: 9, spd: 1.5 }, {
        name: 'Redline', effect: 'redline', attack: 0.2, move: 0.1, dps: 1,
        desc: 'Every hit adds a heat stack: +20% attack speed and +10% move speed each, but 1 damage per second each. Heat lasts until the battle ends.',
      }, 'Very fast, fragile blade frame.'),
      unit('lancer', 'Optic Lancer', 'ranged', { hp: 46, acc: 20, dmg: 14, spd: 0.7, rng: 4.5 }, {
        name: 'Long Exposure', effect: 'longExposure', perSecond: 1, max: 40,
        desc: 'Lancers charge while away from battle. Each Lancer\'s first shot in a battle deals +1 damage per second since its last battle, up to +40.',
      }, 'Slow-firing precise long-range laser.'),
    ],
  },
];

// Each unit type knows its faction, so a unit fighting for someone else (a husk)
// still looks like itself.
for (const f of FACTIONS) for (const u of f.units) u.faction = f.id;

export const FACTION_BY_ID = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

export function unitDef(factionId, unitId) {
  return FACTION_BY_ID[factionId].units.find((u) => u.id === unitId);
}

// Starting wave: 2 melee and 2 ranged in total. The role with two unit types sends
// one of each; the role with a single type sends two of it.
export function startingWave(factionId) {
  const f = FACTION_BY_ID[factionId];
  const wave = {};
  for (const role of ['melee', 'ranged']) {
    const types = f.units.filter((u) => u.role === role);
    for (const u of types) wave[u.id] = types.length === 1 ? 2 : 1;
  }
  return wave;
}

// Default formation: depth 0 = back edge of the spawn zone, 1 = front edge.
// Melee in front, slower units pushed further forward so the line arrives together.
export function defaultFormation(factionId) {
  const f = FACTION_BY_ID[factionId];
  const formation = {};
  for (const u of f.units) {
    let depth = u.role === 'melee' ? 0.85 : 0.25;
    if (u.stats.spd < 1) depth += 0.12;
    if (u.stats.spd > 1) depth -= 0.2;
    formation[u.id] = Math.max(0, Math.min(1, depth));
  }
  return formation;
}

// A fresh unit record. `upgraded` is read live by the battle engine, so buying an
// upgrade takes effect immediately, even mid-fight. `idleSince` is the game time the
// unit last left a battle (or spawned), for Long Exposure.
export function newUnit(def, owner, upgraded, time = 0) {
  const stats = { ...def.stats };
  return { def, owner, stats, hp: stats.hp, upgraded, idleSince: time };
}
