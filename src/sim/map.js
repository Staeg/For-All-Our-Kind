// Strategic map: four corner bases joined by perimeter lanes, plus diagonals through
// the centre. Armies travel along polylines through these nodes; to the sim an army
// is just a distance `s` along its route.
import { MAP_SIZE } from './data.js';

const M = 100;
export const CENTRE = 4;
export const NODE_POS = [
  { x: M, y: M }, // 0: top-left
  { x: MAP_SIZE - M, y: M }, // 1: top-right
  { x: MAP_SIZE - M, y: MAP_SIZE - M }, // 2: bottom-right
  { x: M, y: MAP_SIZE - M }, // 3: bottom-left
  { x: MAP_SIZE / 2, y: MAP_SIZE / 2 }, // 4: centre
];

// Players sit on nodes 0-3 in clockwise order. Each has three lanes:
//   cw  - perimeter lane toward the clockwise neighbour
//   ccw - perimeter lane toward the counter-clockwise neighbour
//   mid - through the centre toward the diagonally opposite player
export const LANES = ['ccw', 'mid', 'cw'];

// Continue along the perimeter from `from` (exclusive) in direction `step` until an
// alive enemy of `owner` is reached. Returns the node list after `from`, or null.
function perimeterWalk(owner, from, step, alive) {
  const out = [];
  let j = from;
  for (let k = 0; k < 4; k++) {
    j = (j + step + 4) % 4;
    if (j === owner) return null;
    out.push(j);
    if (alive[j]) return out;
  }
  return null;
}

// The player a mid-lane army is after: the diagonal opponent, or if they are gone,
// the clockwise-closest survivor from that corner.
export function midTarget(owner, alive) {
  for (let k = 2; k < 6; k++) {
    const j = (owner + k) % 4;
    if (j !== owner && alive[j]) return j;
  }
  return null;
}

function cornerToCorner(a, b) {
  if (a === b) return [];
  return (a - b + 4) % 4 === 2 ? [CENTRE, b] : [b];
}

// Full node path for a fresh wave leaving `owner`'s base.
export function laneNodes(owner, lane, alive) {
  if (lane === 'mid') {
    const t = midTarget(owner, alive);
    return t === null ? null : [owner, CENTRE, t];
  }
  const rest = perimeterWalk(owner, owner, lane === 'cw' ? 1 : -1, alive);
  return rest ? [owner, ...rest] : null;
}

// Node path onward from `node` (where an army is currently heading) for an army
// whose target may have changed.
export function continueNodes(owner, lane, node, alive) {
  if (lane === 'mid') {
    const t = midTarget(owner, alive);
    if (t === null) return null;
    if (node === CENTRE) return [CENTRE, t];
    return [node, ...cornerToCorner(node, t)];
  }
  if (alive[node] && node !== owner) return [node];
  const rest = perimeterWalk(owner, node, lane === 'cw' ? 1 : -1, alive);
  return rest ? [node, ...rest] : null;
}

export function makeRoute(points, nodes) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { points, nodes, cum, length: cum[cum.length - 1] };
}

export function routeFromNodes(nodes) {
  return makeRoute(nodes.map((n) => NODE_POS[n]), nodes.slice());
}

export function segmentAt(route, s) {
  const { cum } = route;
  for (let i = 0; i < cum.length - 2; i++) if (s < cum[i + 1]) return i;
  return cum.length - 2;
}

export function posAt(route, s) {
  const i = segmentAt(route, s);
  const a = route.points[i];
  const b = route.points[i + 1];
  const len = route.cum[i + 1] - route.cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - route.cum[i]) / len));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    dx: (b.x - a.x) / len,
    dy: (b.y - a.y) / len,
  };
}
