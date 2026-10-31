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

// Upgrade `mods` are added to the unit's stats. Two special keys exist:
//   regen  - HP regenerated per second while in battle
//   splash - fraction of each hit's damage also dealt to enemies touching the target
export const FACTIONS = [
  {
    id: 'librarians',
    name: 'The Librarians',
    blurb: 'Sandy undead, recently awakened to find their eons-old masters missing.',
    colors: { main: '#d9b26f', dark: '#7a5a2e', accent: '#2fa8a0', banner: '#c99a45' },
    units: [
      unit('warden', 'Dust Warden', 'melee', {}, {
        name: 'Rebound Linen', desc: 'Fresh wrappings.', mods: { hp: 20 },
      }, 'Bog-standard shambling guard.'),
      unit('slinger', 'Scroll Slinger', 'ranged', { acc: 30, dmg: 8, rng: 4 }, {
        name: 'Errata', desc: 'Corrected scrolls cut deeper.', mods: { dmg: 1.1 },
      }, 'Accurate but feeble paper cuts from afar.'),
      unit('sage', 'Hourglass Sage', 'ranged', { spd: 0.6, dmg: 20, rng: 4.5 }, {
        name: 'Borrowed Time', desc: 'The sand runs faster.', mods: { spd: 0.07 },
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
        name: 'Kindling', desc: 'Hits splash onto whoever is touching the target.', mods: { splash: 0.17 },
      }, 'Bog-standard drifting firebolt thrower.'),
      unit('monolith', 'Stone Visitor', 'melee', { hp: 116, arm: 2, dmg: 9, spd: 0.7 }, {
        name: 'Bedrock', desc: 'Denser stone.', mods: { arm: 1 },
      }, 'Slow armoured boulder with a weak punch.'),
      unit('sprite', 'Gale Sprite', 'ranged', { hp: 40, eva: 10, dmg: 8, spd: 1.4, rng: 2.5 }, {
        name: 'Tailwind', desc: 'Even harder to pin down.', mods: { eva: 21 },
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
        name: 'Shared Burden', desc: 'The network mends its members mid-fight.', mods: { regen: 1.5 },
      }, 'Bog-standard mushroom worker with a hammer.'),
      unit('bulwark', 'Shelf Bulwark', 'melee', { hp: 135, dmg: 8, arm: 2, spd: 0.8 }, {
        name: 'Collective Wall', desc: 'Thicker shelves.', mods: { hp: 25 },
      }, 'Armoured bracket-fungus wall that hits softly.'),
      unit('lobber', 'Puffball Lobber', 'ranged', { hp: 90, dmg: 9, rng: 2.5 }, {
        name: 'Spore Cloud', desc: 'Puffs spread to everyone touching the target.', mods: { splash: 0.24 },
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
        name: 'Iterated Plating', desc: 'Each revision is tougher.', mods: { arm: 1.15 },
      }, 'Bog-standard boxy melee drone.'),
      unit('striker', 'Striker Frame', 'melee', { hp: 75, dmg: 9, spd: 1.5 }, {
        name: 'Overclock', desc: 'Faster servos.', mods: { spd: 0.38 },
      }, 'Very fast, fragile blade frame.'),
      unit('lancer', 'Optic Lancer', 'ranged', { hp: 52, acc: 20, dmg: 14, spd: 0.7, rng: 4 }, {
        name: 'Targeting Lattice', desc: 'Sharper optics.', mods: { acc: 11 },
      }, 'Slow-firing precise long-range laser.'),
    ],
  },
];

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

export function effectiveStats(def, upgraded) {
  const s = { ...def.stats, regen: 0, splash: 0 };
  if (upgraded) for (const [k, v] of Object.entries(def.upgrade.mods)) s[k] = (s[k] || 0) + v;
  return s;
}
