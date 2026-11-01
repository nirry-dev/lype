// A thing's shape: a few simple solids it stacks on its lot, so its place can be walked around in three dimensions.
// Shared by the server (which asks for a shape and keeps it) and the page (which draws it, and watches it arrive).
// A lot is one tile of its map, 10 by 10 steps across; a thing may stand up to 24 steps tall.

export const LOT = 10;
export const TALL = 24;
export const MAX_PARTS = 16;
export const SHAPES = ['block', 'cylinder', 'cone', 'ball', 'roof', 'pyramid'];

/** The colours it can build with: things it has been told about, never seen. */
export const COLORS = {
  stone: '#a29d92',
  slate: '#5d6670',
  brick: '#a8553f',
  clay: '#c98a5e',
  sand: '#d9c08f',
  wood: '#8a6340',
  bark: '#4f3a2a',
  moss: '#6f8a4a',
  leaf: '#4f9a52',
  water: '#4f86b8',
  glass: '#a9d4e6',
  iron: '#3f4247',
  copper: '#c07a3c',
  gold: '#d8b04a',
  bone: '#e9e1cf',
  paper: '#efe4d0',
  ember: '#e0573a',
  night: '#2c2f4a',
};

const int = (lo, hi) => ({ type: 'integer', minimum: lo, maximum: hi });

export const FORM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parts: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PARTS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shape: { type: 'string', enum: SHAPES },
          x: int(0, LOT),
          z: int(0, LOT),
          y: int(0, TALL),
          w: int(1, LOT),
          d: int(1, LOT),
          h: int(1, TALL),
          color: { type: 'string', enum: Object.keys(COLORS) },
          glow: { type: 'boolean' },
        },
        required: ['shape', 'x', 'z', 'y', 'w', 'd', 'h', 'color', 'glow'],
      },
    },
  },
  required: ['parts'],
};

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || 0));

/** One part as it may stand: a known shape and colour, inside its lot, at least one step in every direction. */
export function cleanPart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shape = SHAPES.includes(raw.shape) ? raw.shape : 'block';
  const w = clampInt(raw.w, 1, LOT);
  const d = clampInt(raw.d, 1, LOT);
  const h = clampInt(raw.h, 1, TALL);
  return {
    shape,
    x: clampInt(raw.x, 0, LOT - w),
    z: clampInt(raw.z, 0, LOT - d),
    y: clampInt(raw.y, 0, TALL - h),
    w,
    d,
    h,
    color: Object.hasOwn(COLORS, raw.color) ? raw.color : 'stone',
    glow: raw.glow === true,
  };
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const touches = (a, b) => overlap(a, b) && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Parts that hang in the air, touching nothing, come down onto whatever is under them (or the ground): a roof given too
 * high lands on its walls. A part that touches another stays where it was put (a window set into a wall), and so does
 * one that glows (a lantern may float).
 */
export function settle(parts) {
  const out = [];
  for (const p of [...parts].sort((a, b) => a.y - b.y)) {
    if (!p.glow && p.y > 0 && !out.some((q) => touches(p, q))) {
      const under = out.filter((q) => overlap(p, q) && q.y + q.h <= p.y).map((q) => q.y + q.h);
      p.y = Math.max(0, ...under);
    }
    out.push(p);
  }
  return parts;
}

/** A shape from what it answered (JSON text or already parsed), or null if nothing in it can stand. */
export function readForm(answer) {
  let raw = answer;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      return null;
    }
  }
  const seen = new Set();
  const parts = [];
  for (const p of Array.isArray(raw?.parts) ? raw.parts : []) {
    const c = cleanPart(p);
    const key = c && JSON.stringify(c);
    if (!c || seen.has(key)) continue;
    seen.add(key);
    parts.push(c);
    if (parts.length >= MAX_PARTS) break;
  }
  return parts.length ? { parts: settle(parts) } : null;
}

/** The parts it has finished writing so far, while the rest of its answer is still arriving (for watching it build). */
export function partialParts(text) {
  const parts = [];
  for (const m of String(text || '').matchAll(/\{[^{}]*\}/g)) {
    try {
      const c = cleanPart(JSON.parse(m[0]));
      if (c) parts.push(c);
    } catch {
      // not finished yet
    }
    if (parts.length >= MAX_PARTS) break;
  }
  return settle(parts);
}

/** How tall a shape stands, in tiles. */
export const formHeight = (form) => (form?.parts?.length ? Math.max(...form.parts.map((p) => p.y + p.h)) / LOT : 0);
