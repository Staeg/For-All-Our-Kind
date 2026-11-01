// Exact formations. A slot is a position in the player's spawn zone:
//   lat   - sideways offset from the zone's centre line, in unit diameters
//   depth - distance from the back edge of the zone (0) toward the front (SPAWN_DEPTH)
// Each lane keeps one slot per unit in its wave, per unit type, in roster order.
import { SPAWN_DEPTH, SPAWN_WIDTH, UNIT_RADIUS } from './data.js';

const MIN_GAP = UNIT_RADIUS * 2 + 0.05;
export const LAT_MAX = SPAWN_WIDTH / 2 - UNIT_RADIUS;
export const DEPTH_MIN = UNIT_RADIUS;
export const DEPTH_MAX = SPAWN_DEPTH - UNIT_RADIUS;

export function clampSlot(s) {
  return {
    lat: Math.max(-LAT_MAX, Math.min(LAT_MAX, s.lat)),
    depth: Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, s.depth)),
  };
}

function isFree(slot, taken, ignore) {
  for (const t of taken) {
    if (t === ignore) continue;
    if (Math.hypot(t.lat - slot.lat, t.depth - slot.depth) < MIN_GAP) return false;
  }
  return true;
}

// The free spot nearest to `want`, searching outward on a fine grid.
export function nearestFree(want, taken, ignore = null, lateralFirst = false) {
  const w = clampSlot(want);
  if (isFree(w, taken, ignore)) return w;
  if (lateralFirst) {
    // Fill the row sideways before stepping out of it.
    for (let k = 1; k * 0.6 <= LAT_MAX * 2; k++) {
      for (const sgn of [1, -1]) {
        const c = { lat: w.lat + sgn * k * 0.6, depth: w.depth };
        if (Math.abs(c.lat) <= LAT_MAX && isFree(c, taken, ignore)) return c;
      }
    }
  }
  for (let r = 0.25; r < SPAWN_WIDTH; r += 0.25) {
    const steps = Math.max(8, Math.round(r * 12));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const c = clampSlot({ lat: w.lat + Math.cos(a) * r, depth: w.depth + Math.sin(a) * r });
      if (isFree(c, taken, ignore)) return c;
    }
  }
  return w;
}

// Make sure every unit in the lane's roster has a slot. New units are placed
// at their type's default depth, as close to the centre line as there is room.
export function ensureSlots(player, lane) {
  if (!player.slots) player.slots = {};
  if (!player.slots[lane]) player.slots[lane] = {};
  const lanes = player.slots[lane];
  const taken = Object.values(lanes).flat();
  for (const u of player.faction.units) {
    const list = lanes[u.id] || (lanes[u.id] = []);
    const need = player.roster[lane][u.id] || 0;
    while (list.length < need) {
      const s = nearestFree({ lat: 0, depth: player.formation[u.id] * SPAWN_DEPTH }, taken, null, true);
      list.push(s);
      taken.push(s);
    }
  }
  return lanes;
}

// Put the most recently bought unit of a type at (or near) a chosen spot.
export function placeNewest(player, lane, typeId, want) {
  const lanes = ensureSlots(player, lane);
  const n = player.roster[lane][typeId] || 0;
  if (!n) return;
  const mine = lanes[typeId][n - 1];
  const taken = player.faction.units.flatMap((u) => lanes[u.id].slice(0, player.roster[lane][u.id] || 0));
  Object.assign(mine, nearestFree(want, taken, mine));
}
