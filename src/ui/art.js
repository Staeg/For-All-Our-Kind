// Placeholder art, drawn procedurally on canvas. Every unit is drawn facing right
// into a cached 64x64 sprite; callers flip it when the unit faces left.
import { FACTION_BY_ID } from '../sim/data.js';

const SIZE = 64;
const cache = new Map();

function ell(c, x, y, rx, ry, fill, stroke) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function poly(c, pts, fill, stroke) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) c.lineTo(x, y);
  c.closePath();
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function eyes(c, x, y, color, gap = 6, r = 2.2) {
  ell(c, x, y, r, r, color);
  ell(c, x + gap, y, r, r, color);
}

const DRAW = {
  // --- Librarians: sand, bandages, lapis --------------------------------------
  warden(c, k) {
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(20, 16, 22, 36, 9);
    c.fillStyle = k.main;
    c.fill();
    c.strokeStyle = k.dark;
    c.stroke();
    c.strokeStyle = k.dark;
    c.lineWidth = 1.5;
    for (let y = 24; y < 50; y += 6) {
      c.beginPath();
      c.moveTo(21, y);
      c.lineTo(41, y - 3);
      c.stroke();
    }
    eyes(c, 29, 23, k.accent);
    c.lineWidth = 2;
    poly(c, [[38, 28], [50, 28], [50, 42], [44, 48], [38, 42]], k.dark, '#3a2a14');
    ell(c, 44, 36, 2.5, 2.5, k.accent);
  },
  slinger(c, k) {
    c.lineWidth = 2;
    poly(c, [[32, 20], [46, 54], [18, 54]], k.dark, '#3a2a14');
    poly(c, [[32, 24], [40, 54], [24, 54]], k.main);
    ell(c, 32, 17, 7, 7, k.main, k.dark);
    eyes(c, 31, 16, k.accent, 5, 1.6);
    c.save();
    c.translate(47, 30);
    c.rotate(-0.4);
    c.fillStyle = '#f4ead2';
    c.fillRect(-3, -9, 6, 18);
    ell(c, 0, -9, 4, 2, '#e1cfa3');
    ell(c, 0, 9, 4, 2, '#e1cfa3');
    c.restore();
  },
  sage(c, k) {
    c.lineWidth = 2;
    poly(c, [[32, 28], [48, 56], [16, 56]], k.dark, '#3a2a14');
    poly(c, [[22, 8], [42, 8], [32, 20]], 'rgba(240,230,200,0.85)', k.dark);
    poly(c, [[32, 20], [42, 32], [22, 32]], 'rgba(240,230,200,0.85)', k.dark);
    poly(c, [[27, 26], [37, 26], [40, 31], [24, 31]], k.main);
    poly(c, [[26, 10], [38, 10], [32, 16]], k.main);
    c.fillStyle = k.dark;
    c.fillRect(20, 6, 24, 3);
    c.fillRect(20, 31, 24, 3);
    ell(c, 50, 30, 5, 5, k.accent);
    ell(c, 50, 30, 8, 8, null, 'rgba(47,168,160,0.6)');
  },

  // --- Visitors: violet elementals --------------------------------------------
  wisp(c, k) {
    const g = c.createLinearGradient(0, 8, 0, 54);
    g.addColorStop(0, k.accent);
    g.addColorStop(1, k.main);
    c.beginPath();
    c.moveTo(30, 6);
    c.bezierCurveTo(48, 22, 50, 40, 32, 54);
    c.bezierCurveTo(14, 44, 16, 26, 30, 6);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = k.dark;
    c.stroke();
    ell(c, 32, 40, 8, 9, 'rgba(255,255,255,0.35)');
    eyes(c, 29, 36, '#fff', 7, 2.4);
    eyes(c, 29, 36, k.dark, 7, 1.1);
  },
  monolith(c, k) {
    c.lineWidth = 2;
    poly(c, [[16, 52], [14, 26], [24, 12], [42, 10], [52, 26], [50, 52]], '#8b84a8', k.dark);
    poly(c, [[22, 52], [20, 30], [28, 18], [40, 18], [46, 30], [44, 52]], '#a39dbf');
    c.strokeStyle = k.accent;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(26, 40);
    c.lineTo(32, 34);
    c.lineTo(30, 28);
    c.moveTo(38, 46);
    c.lineTo(42, 38);
    c.stroke();
    eyes(c, 31, 24, k.accent, 9, 2.5);
  },
  sprite(c, k) {
    c.lineWidth = 3;
    c.strokeStyle = k.accent;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(26 - i * 4, 32, 10 + i * 6, -0.9, 0.9);
      c.globalAlpha = 0.85 - i * 0.25;
      c.stroke();
    }
    c.globalAlpha = 1;
    ell(c, 38, 32, 9, 9, k.main, k.dark);
    ell(c, 36, 30, 4, 4, 'rgba(255,255,255,0.5)');
    poly(c, [[38, 22], [44, 12], [42, 24]], k.main);
    eyes(c, 37, 31, k.dark, 5, 1.5);
  },

  // --- Compatriots: red-capped fungus folk ------------------------------------
  comrade(c, k) {
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(24, 28, 16, 24, 6);
    c.fillStyle = k.accent;
    c.fill();
    c.strokeStyle = k.dark;
    c.stroke();
    c.beginPath();
    c.ellipse(32, 26, 18, 13, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = k.main;
    c.fill();
    c.stroke();
    ell(c, 26, 20, 3, 2.4, k.accent);
    ell(c, 37, 18, 2.4, 2, k.accent);
    eyes(c, 29, 35, k.dark, 6, 1.6);
    c.strokeStyle = '#6b4a2a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(40, 44);
    c.lineTo(50, 30);
    c.stroke();
    c.fillStyle = '#9a9a9a';
    c.fillRect(46, 25, 9, 6);
  },
  bulwark(c, k) {
    c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(32, 24 + i * 11, 24 - i * 2, 9, 0, Math.PI, 0);
      c.closePath();
      c.fillStyle = i % 2 ? k.accent : k.main;
      c.fill();
      c.strokeStyle = k.dark;
      c.stroke();
    }
    c.fillStyle = '#d9c8a6';
    c.fillRect(26, 46, 12, 9);
    eyes(c, 28, 40, k.dark, 8, 1.8);
  },
  lobber(c, k) {
    c.lineWidth = 2;
    ell(c, 32, 34, 17, 16, k.accent, k.dark);
    c.beginPath();
    c.ellipse(32, 30, 17, 12, 0, Math.PI, 0);
    c.fillStyle = k.main;
    c.fill();
    for (const [x, y] of [[24, 26], [33, 22], [40, 27]]) ell(c, x, y, 2, 2, k.accent);
    eyes(c, 28, 38, k.dark, 8, 1.8);
    for (const [x, y, r] of [[50, 18, 3], [55, 12, 2], [46, 10, 2.5]]) ell(c, x, y, r, r, 'rgba(230,210,150,0.8)');
    c.fillStyle = k.dark;
    c.fillRect(24, 49, 5, 5);
    c.fillRect(35, 49, 5, 5);
  },

  // --- Apex: chrome machines with orange optics -------------------------------
  servitor(c, k) {
    c.lineWidth = 2;
    c.fillStyle = k.dark;
    c.fillRect(22, 48, 6, 8);
    c.fillRect(36, 48, 6, 8);
    c.beginPath();
    c.roundRect(18, 26, 28, 24, 3);
    c.fillStyle = k.main;
    c.fill();
    c.strokeStyle = k.dark;
    c.stroke();
    c.beginPath();
    c.roundRect(22, 8, 20, 17, 3);
    c.fill();
    c.stroke();
    c.fillStyle = k.accent;
    c.fillRect(28, 13, 13, 5);
    c.fillStyle = k.dark;
    c.fillRect(24, 32, 16, 3);
    c.fillRect(46, 30, 8, 5);
  },
  striker(c, k) {
    c.lineWidth = 2;
    poly(c, [[14, 50], [26, 14], [42, 24], [36, 50]], k.main, k.dark);
    poly(c, [[26, 14], [36, 10], [42, 24]], k.dark);
    c.fillStyle = k.accent;
    c.fillRect(33, 15, 7, 3);
    poly(c, [[38, 34], [58, 26], [58, 30], [40, 40]], k.accent, '#7a3a08');
    c.fillStyle = k.dark;
    c.fillRect(18, 50, 5, 7);
    c.fillRect(30, 50, 5, 7);
  },
  lancer(c, k) {
    c.lineWidth = 2;
    c.fillStyle = k.dark;
    c.fillRect(20, 48, 6, 8);
    c.fillRect(32, 48, 6, 8);
    c.beginPath();
    c.roundRect(14, 24, 28, 26, 4);
    c.fillStyle = k.main;
    c.fill();
    c.strokeStyle = k.dark;
    c.stroke();
    c.fillStyle = k.dark;
    c.fillRect(36, 28, 24, 6);
    ell(c, 60, 31, 3, 3, k.accent);
    ell(c, 26, 20, 9, 9, k.main, k.dark);
    ell(c, 28, 20, 5, 5, k.accent);
    ell(c, 29, 19, 2, 2, '#fff3d6');
  },
};

// Returns a cached canvas with the unit drawn facing right.
export function unitSprite(factionId, unitId) {
  const key = `${factionId}/${unitId}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = SIZE;
  cv.height = SIZE;
  const c = cv.getContext('2d');
  c.lineJoin = 'round';
  c.lineCap = 'round';
  DRAW[unitId](c, FACTION_BY_ID[factionId].colors);
  cache.set(key, cv);
  return cv;
}

// Draw a unit centred at (x, y) with the given on-screen size.
export function drawUnit(ctx, factionId, unitId, x, y, size, faceLeft = false) {
  const s = unitSprite(factionId, unitId);
  ctx.save();
  ctx.translate(x, y);
  if (faceLeft) ctx.scale(-1, 1);
  ctx.drawImage(s, -size / 2, -size / 2, size, size);
  ctx.restore();
}

export function spriteDataUrl(factionId, unitId) {
  return unitSprite(factionId, unitId).toDataURL();
}

// Faction base: a little keep in the faction's palette.
export function drawBase(ctx, factionId, x, y, size, dim) {
  const k = FACTION_BY_ID[factionId].colors;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = dim ? 0.35 : 1;
  const s = size / 2;
  ctx.lineWidth = 2;
  ctx.fillStyle = k.dark;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(-s, -s * 0.5, size, s * 1.4, 4);
  ctx.fill();
  ctx.stroke();
  for (const dx of [-s, s * 0.45]) {
    ctx.fillStyle = k.main;
    ctx.fillRect(dx, -s * 1.05, s * 0.55, s * 1.9);
    ctx.strokeRect(dx, -s * 1.05, s * 0.55, s * 1.9);
  }
  ctx.fillStyle = k.banner;
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.5);
  ctx.lineTo(0, -s * 0.4);
  ctx.stroke();
  ctx.fillRect(0, -s * 1.5, s * 0.6, s * 0.35);
  ctx.fillStyle = k.accent;
  ctx.beginPath();
  ctx.arc(0, s * 0.25, s * 0.28, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

export function drawTower(ctx, factionId, x, y, size, dim) {
  const k = FACTION_BY_ID[factionId].colors;
  ctx.save();
  ctx.globalAlpha = dim ? 0.3 : 1;
  ctx.fillStyle = k.dark;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.35, y + size * 0.5);
  ctx.lineTo(x - size * 0.25, y - size * 0.4);
  ctx.lineTo(x + size * 0.25, y - size * 0.4);
  ctx.lineTo(x + size * 0.35, y + size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = k.main;
  ctx.fillRect(x - size * 0.32, y - size * 0.6, size * 0.64, size * 0.24);
  ctx.fillStyle = k.accent;
  ctx.fillRect(x - size * 0.08, y - size * 0.15, size * 0.16, size * 0.22);
  ctx.restore();
}

// Stat icons (inline SVG). HP heart, ACC bullseye, DMG pow, ARM shield,
// EVA blurred face, SPD boot, RNG bow.
export const STAT_ICON = {
  hp: '<svg viewBox="0 0 16 16"><path d="M8 14 L2 8 A3.2 3.2 0 0 1 8 3.6 A3.2 3.2 0 0 1 14 8 Z" fill="#e0313b" stroke="#7a0f15" stroke-width="1"/></svg>',
  acc: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#c22" stroke-width="1"/><circle cx="8" cy="8" r="4.3" fill="#d33"/><circle cx="8" cy="8" r="2.4" fill="#fff"/><circle cx="8" cy="8" r="1" fill="#d33"/></svg>',
  dmg: '<svg viewBox="0 0 16 16"><path d="M8 0.5 L9.6 5 L14.5 3 L11.4 7.2 L15.5 9.5 L10.5 10 L11.5 15 L8 11.6 L4.5 15 L5.4 10 L0.5 9.5 L4.6 7.2 L1.5 3 L6.4 5 Z" fill="#ffd23a" stroke="#d6331f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8.2" r="2.2" fill="#e8401c"/></svg>',
  arm: '<svg viewBox="0 0 16 16"><path d="M8 1 L14 3.2 L13.4 8.6 C12.8 11.6 10.6 13.6 8 15 C5.4 13.6 3.2 11.6 2.6 8.6 L2 3.2 Z" fill="#c9d1da" stroke="#6b7682" stroke-width="1.1"/><path d="M8 2.6 L8 13.4" stroke="#fff" stroke-width="1" opacity="0.7"/></svg>',
  eva: '<svg viewBox="0 0 16 16"><defs><filter id="bl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.9"/></filter></defs><g filter="url(#bl)"><circle cx="6.5" cy="8" r="5.5" fill="#f1c27d" opacity="0.6"/><circle cx="9.5" cy="8" r="5.5" fill="#f1c27d"/><circle cx="7.6" cy="7" r="0.9" fill="#333"/><circle cx="11.2" cy="7" r="0.9" fill="#333"/><path d="M7.6 10.4 Q9.5 11.6 11.3 10.4" stroke="#333" stroke-width="0.9" fill="none"/></g></svg>',
  spd: '<svg viewBox="0 0 16 16"><path d="M5 1.5 L9.5 1.5 L9.5 9 L14 10.5 C15 11 15 13.5 14 13.5 L3 13.5 C2.2 13.5 2 12.6 2.6 12 L5 9.5 Z" fill="#8a5a33" stroke="#4a2c14" stroke-width="1"/><rect x="2" y="13.3" width="12.6" height="1.6" rx="0.6" fill="#3a2410"/></svg>',
  rng: '<svg viewBox="0 0 16 16"><path d="M4 1.5 Q14 8 4 14.5" fill="none" stroke="#8a5a2b" stroke-width="1.7"/><path d="M4 1.5 L4 14.5" stroke="#ddd" stroke-width="0.8"/><path d="M2 8 L13.5 8" stroke="#555" stroke-width="1"/><path d="M13.5 8 L11.3 6.7 L11.3 9.3 Z" fill="#555"/></svg>',
};

export const STAT_LABEL = { hp: 'HP', acc: 'ACC', dmg: 'DMG', arm: 'ARM', eva: 'EVA', spd: 'SPD', rng: 'RNG' };

const EXTRA_ICON = {
  regen: '<svg viewBox="0 0 16 16"><path d="M6 1.5 H10 V6 H14.5 V10 H10 V14.5 H6 V10 H1.5 V6 H6 Z" fill="#5fd35f" stroke="#1d6b1d" stroke-width="1"/></svg>',
  splash: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#ff8a2a" stroke-width="1.3"/><circle cx="8" cy="8" r="4" fill="none" stroke="#ffb347" stroke-width="1.3"/><circle cx="8" cy="8" r="1.8" fill="#ff5a1a"/></svg>',
};

// An upgrade as a single badge: the icon of what it improves inside a ring in the
// faction's colour, with a small up-arrow.
export function upgradeIcon(factionId, upgrade) {
  const k = FACTION_BY_ID[factionId].colors;
  const key = Object.keys(upgrade.mods)[0];
  const inner = (STAT_ICON[key] || EXTRA_ICON[key]).replace('<svg viewBox="0 0 16 16">', '<svg x="5" y="5" width="18" height="18" viewBox="0 0 16 16">');
  return `<svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="12.5" fill="${k.dark}" stroke="${k.main}" stroke-width="2"/>${inner}`
    + '<path d="M21 3 L26 9 H23 V13 H19 V9 H16 Z" fill="#9fe39f" stroke="#1d4d1d" stroke-width="0.8"/></svg>';
}
