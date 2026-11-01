// A thing's shape: a few simple solids it stacks on its lot, so its place can be walked around in three dimensions.
// Shared by the server (which asks for a shape and keeps it) and the page (which draws it, and watches it arrive).
// A lot is one tile of its map, 10 by 10 steps across; a thing may stand up to 24 steps tall.

export const LOT = 10;
export const TALL = 24;
export const MAX_PARTS = 16;
export const SHAPES = ['block', 'cylinder', 'cone', 'ball', 'roof', 'pyramid'];
/** A part may instead be a ready-made model it borrows (see server/models.js), at most this many in one thing. */
export const MODEL = 'model';
export const MAX_BORROWED = 4;

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

/** What it answers with. Offered models to borrow, a part may be "model" and name one of them ("none" otherwise). */
export function formSchema(models = []) {
  const borrow = models.length ? { model: { type: 'string', enum: ['none', ...models] } } : {};
  return {
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
            shape: { type: 'string', enum: models.length ? [...SHAPES, MODEL] : SHAPES },
            ...borrow,
            x: int(0, LOT),
            z: int(0, LOT),
            y: int(0, TALL),
            w: int(1, LOT),
            d: int(1, LOT),
            h: int(1, TALL),
            color: { type: 'string', enum: Object.keys(COLORS) },
            glow: { type: 'boolean' },
          },
          required: ['shape', ...Object.keys(borrow), 'x', 'z', 'y', 'w', 'd', 'h', 'color', 'glow'],
        },
      },
    },
    required: ['parts'],
  };
}

export const FORM_SCHEMA = formSchema();

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || 0));

/**
 * One part as it may stand: a known shape and colour, inside its lot, at least one step in every direction. A borrowed
 * model must be one `model(name)` knows (it gives the model's id), or the part is dropped; without `model` (on the
 * page, while it is still writing) its name is kept as written.
 */
export function cleanPart(raw, { model = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  let borrowed = null;
  if (raw.shape === MODEL) {
    borrowed = model ? model(raw.model) : typeof raw.model === 'string' && raw.model !== 'none' ? raw.model.slice(0, 80) : null;
    if (!borrowed) return null;
  }
  const shape = borrowed ? MODEL : SHAPES.includes(raw.shape) ? raw.shape : 'block';
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
    ...(borrowed ? { model: borrowed } : {}),
  };
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const shares = (a, b) => overlap(a, b) && a.y < b.y + b.h && b.y < a.y + a.h;
const size = (p) => p.w * p.d * p.h;

/**
 * The face of block `q` that a part one step thin is set flush into (a window in a wall, a door, a pool in a floor), as
 * [axis, -1 | 1] pointing out of it; null if it is not set into it. The page draws such a part a hair proud of its face.
 */
export function inlay(p, q) {
  if (p === q || q.shape !== 'block' || size(p) >= size(q) || !shares(p, q)) return null;
  if (p.d === 1 && p.z === q.z) return ['z', -1];
  if (p.d === 1 && p.z + 1 === q.z + q.d) return ['z', 1];
  if (p.w === 1 && p.x === q.x) return ['x', -1];
  if (p.w === 1 && p.x + 1 === q.x + q.w) return ['x', 1];
  if (p.h === 1 && p.y + 1 === q.y + q.h) return ['y', 1];
  return null;
}

/** A narrower part rising up out of a wider one, as a chimney comes up through its roof or a mast through a deck. */
const through = (p, q) =>
  p.y > q.y && p.y + p.h > q.y + q.h && p.w < q.w && p.d < q.d && p.x >= q.x && p.z >= q.z && p.x + p.w <= q.x + q.w && p.z + p.d <= q.z + q.d;

/** Two parts that would be in the same space: solids do not pass through each other, unless one is set into the other. */
const collide = (p, q) => shares(p, q) && !inlay(p, q) && !inlay(q, p) && !through(p, q) && !through(q, p);

const fits = (p) => p.x >= 0 && p.z >= 0 && p.x + p.w <= LOT && p.z + p.d <= LOT && p.y + p.h <= TALL;

/**
 * Where a part can stand among those already standing: where it was put, if nothing is there; otherwise the nearest
 * place it fits inside its lot, a few moves away (onto what it ran into, or beside it, or both: up onto a step, then
 * along a wall). A borrowed model, which only keeps to the space it is given, may have that space narrowed at the edge
 * of its lot. Null if there is no such place.
 */
function room(p, standing) {
  const hit = (s) => standing.filter((q) => collide(s, q));
  if (!hit(p).length) return p;
  const cost = (s) => Math.abs(s.x - p.x) + Math.abs(s.z - p.z) + (s.y - p.y) + (p.w - s.w) + (p.d - s.d);
  const inside = (s) => {
    if (p.shape !== MODEL) return s;
    const w = Math.min(s.w, LOT - Math.max(0, s.x)) - Math.max(0, -s.x);
    const d = Math.min(s.d, LOT - Math.max(0, s.z)) - Math.max(0, -s.z);
    return w < 1 || d < 1 ? s : { ...s, x: Math.max(0, s.x), z: Math.max(0, s.z), w, d };
  };
  const seen = new Set();
  let best = null;
  let tries = [p];
  for (let step = 0; step < 3 && tries.length; step++) {
    const next = [];
    for (const s of tries) {
      for (const q of hit(s)) {
        for (const t of [{ ...s, y: q.y + q.h }, { ...s, x: q.x - s.w }, { ...s, x: q.x + q.w }, { ...s, z: q.z - s.d }, { ...s, z: q.z + q.d }].map(inside)) {
          const key = `${t.x},${t.z},${t.y},${t.w},${t.d}`;
          if (seen.has(key) || !fits(t)) continue;
          seen.add(key);
          if (!hit(t).length) {
            if (!best || cost(t) < cost(best)) best = t;
          } else if (next.length < 64) next.push(t);
        }
      }
    }
    tries = next;
  }
  if (best) return best;
  let up = p; // failing all that, straight up onto whatever is in its way
  for (let h; (h = hit(up)).length; ) up = { ...up, y: Math.max(...h.map((q) => q.y + q.h)) };
  return fits(up) ? up : null;
}

/** What keeps a part up: something under it, something it is fixed to the side of, or something it is set into. */
const holds = (q, p) =>
  (overlap(p, q) && q.y + q.h === p.y) ||
  shares(p, q) ||
  (p.y < q.y + q.h &&
    q.y < p.y + p.h &&
    (((p.x + p.w === q.x || q.x + q.w === p.x) && p.z < q.z + q.d && q.z < p.z + p.d) ||
      ((p.z + p.d === q.z || q.z + q.d === p.z) && p.x < q.x + q.w && q.x < p.x + p.w)));

/**
 * Its parts stood up in the world, from the ground up (the bigger first, where two start at the same height). They are
 * solid: the parts that fit where they were put stand first, then each one put where another already is moves to the
 * nearest place it fits (a box given inside a roof goes on top of it), and one with nowhere to fit is left out. Parts
 * that hang in the air, held by nothing, come down onto whatever is under them, or the ground: a roof given too high
 * lands on its walls. One that glows may float (a lantern). Returns the parts that stand, as new objects, in the order
 * they were given.
 */
export function settle(parts) {
  const standing = [];
  const kept = [];
  const stand = (p, i) => {
    if (!p.glow && p.y > 0 && !standing.some((q) => holds(q, p))) {
      p.y = Math.max(0, ...standing.filter((q) => overlap(p, q) && q.y + q.h <= p.y).map((q) => q.y + q.h));
    }
    standing.push(p);
    kept[i] = p;
  };
  const order = parts.map((p, i) => [p, i]).sort(([a, i], [b, j]) => a.y - b.y || size(b) - size(a) || i - j);
  const moved = [];
  for (const [given, i] of order) {
    if (standing.some((q) => collide(given, q))) moved.push([given, i]);
    else stand({ ...given }, i);
  }
  for (const [given, i] of moved) {
    const p = room({ ...given }, standing);
    if (p) stand(p, i);
  }
  return kept.filter(Boolean);
}

/**
 * A shape as it stands now that its parts are solid. Shapes kept from before they were (`solid` unset) are stood up again
 * for showing; what was kept is left as it was built.
 */
export const standing = (form) => (!form?.parts?.length || form.solid ? form : { ...form, parts: settle(form.parts), solid: true });

/** A shape from what it answered (JSON text or already parsed), or null if nothing in it can stand. */
export function readForm(answer, { model = null } = {}) {
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
  let lent = 0;
  for (const p of Array.isArray(raw?.parts) ? raw.parts : []) {
    const c = cleanPart(p, { model });
    const key = c && JSON.stringify(c);
    if (!c || seen.has(key)) continue;
    if (c.shape === MODEL && ++lent > MAX_BORROWED) continue; // mostly its own work
    seen.add(key);
    parts.push(c);
    if (parts.length >= MAX_PARTS * 4) break;
  }
  // the first sixteen that find room (a part left out for want of room makes way for the next one it gave)
  let kept = [];
  for (let n = Math.min(MAX_PARTS, parts.length); ; n++) {
    kept = settle(parts.slice(0, n));
    if (kept.length >= MAX_PARTS || n >= parts.length) break;
  }
  if (kept.length > MAX_PARTS) kept = settle(kept.slice(0, MAX_PARTS));
  return kept.length ? { parts: kept, solid: true } : null;
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
