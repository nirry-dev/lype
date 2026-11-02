// A thing's shape: a few simple solids it stacks on its lot, so its place can be walked around in three dimensions.
// Shared by the server (which asks for a shape and keeps it) and the page (which draws it, and watches it arrive).
// A lot is one tile of its map, 10 by 10 steps across; a thing may stand up to 24 steps tall.

export const LOT = 10;
export const TALL = 24;
export const MAX_PARTS = 24;
/** What its parts become once its pieces and patterns are laid out: the most that stand in one thing. */
export const MAX_SOLIDS = 64;
export const SHAPES = ['block', 'cylinder', 'cone', 'ball', 'roof', 'pyramid', 'wedge', 'arch', 'tube', 'ring', 'stairs', 'outline', 'lathe'];
/** Shapes drawn from its own points: an outline raised into a solid, a profile spun round. */
export const POINTED = ['outline', 'lathe'];
/** Ready-made pieces it can build with, each laid out as a few solids inside the space it is given. */
export const PIECES = ['tree', 'pine', 'column', 'fence', 'lamp', 'door', 'window', 'bench'];
/**
 * Parts of a creature, for a body: they hold on to the part they are set against (an eye on a head, a wing on a side)
 * instead of being pushed off it, and the page gives them life (eyes blink, wings move, feet step). Each is laid out
 * as a few solids facing the front of its space, the side at z 10.
 */
export const FEATURES = ['eye', 'beak', 'wing', 'foot', 'ear', 'tail'];
/** Ways one part can stand many times: in a row, in a ring round the middle of its lot, or mirrored. */
export const PATTERNS = ['none', 'row', 'ring', 'mirror'];
/** A part may instead be a ready-made model it borrows (see server/models.js), at most this many in one thing. */
export const MODEL = 'model';
export const MAX_BORROWED = 6;
/** A part may instead be something made from its words (see server/maker.js), at most this many in one thing. */
export const MADE = 'made';
export const MAX_MADE = 2;
/** A borrowed model or a made thing: a mesh that keeps its own proportions inside the space it is given. */
export const isMesh = (shape) => shape === MODEL || shape === MADE;

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

/**
 * What it answers with. Offered models to borrow, a part may be "model" and name one of them ("none" otherwise); able to
 * have things made, a part may be "made" and "describe" it.
 */
export function formSchema(models = [], { made = false, body = false } = {}) {
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
            shape: { type: 'string', enum: [...SHAPES, ...PIECES, ...(body ? FEATURES : []), ...(models.length ? [MODEL] : []), ...(made ? [MADE] : [])] },
            ...borrow,
            x: int(0, LOT),
            z: int(0, LOT),
            y: int(0, TALL),
            w: int(1, LOT),
            d: int(1, LOT),
            h: int(1, TALL),
            color: { type: 'string', enum: Object.keys(COLORS) },
            glow: { type: 'boolean' },
            // optional: how far it is turned (degrees), its own points, and a pattern it repeats in
            turn: int(0, 359),
            points: { type: 'array', items: int(0, 10), maxItems: 24 },
            repeat: int(1, 12),
            pattern: { type: 'string', enum: PATTERNS },
            dx: int(-10, 10),
            dz: int(-10, 10),
            ...(made ? { describe: { type: 'string', maxLength: 120 } } : {}),
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
export function cleanPart(raw, { model = null, made = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  // something to be made from its words: its id once the server has taken the words (on the page, the words alone)
  let wanted = null;
  if (raw.shape === MADE) {
    const describe = typeof raw.describe === 'string' ? raw.describe.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (describe.length < 3) return null;
    const id = made ? made(describe) : null;
    if (made && !id) return null;
    wanted = { describe, ...(id ? { made: id } : {}) };
  }
  let borrowed = null;
  if (raw.shape === MODEL) {
    borrowed = model ? model(raw.model) : typeof raw.model === 'string' && raw.model !== 'none' ? raw.model.slice(0, 80) : null;
    if (!borrowed) return null;
  }
  let shape = wanted ? MADE : borrowed ? MODEL : SHAPES.includes(raw.shape) || PIECES.includes(raw.shape) || FEATURES.includes(raw.shape) ? raw.shape : 'block';
  const w = clampInt(raw.w, 1, LOT);
  const d = clampInt(raw.d, 1, LOT);
  const h = clampInt(raw.h, 1, TALL);
  // its own points: pairs of steps 0-10 across the part (an outline needs three corners, a profile two heights)
  let points = null;
  if (POINTED.includes(shape)) {
    const nums = Array.isArray(raw.points) ? raw.points.slice(0, 24).map((v) => clampInt(v, 0, 10)) : [];
    if (nums.length % 2) nums.pop();
    if (nums.length >= (shape === 'outline' ? 6 : 4)) points = nums;
    else shape = shape === 'outline' ? 'block' : 'cylinder';
  }
  const turn = clampInt(raw.turn, 0, 359);
  const repeat = clampInt(raw.repeat, 1, 12);
  const pattern = PATTERNS.includes(raw.pattern) && raw.pattern !== 'none' ? raw.pattern : null;
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
    ...(wanted || {}),
    ...(turn ? { turn } : {}),
    ...(points ? { points } : {}),
    ...(pattern && (repeat > 1 || pattern === 'mirror') ? { pattern, repeat, dx: clampInt(raw.dx, -10, 10), dz: clampInt(raw.dz, -10, 10) } : {}),
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
/** A part turned `deg` more about a point on its lot (its centre carried round, and its own turn with it). */
function turned(p, deg, cx, cz) {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const [px, pz] = [p.x + p.w / 2 - cx, p.z + p.d / 2 - cz];
  const [nx, nz] = [px * Math.cos(a) - pz * Math.sin(a), px * Math.sin(a) + pz * Math.cos(a)];
  const turn = ((((p.turn || 0) + deg) % 360) + 360) % 360;
  const { turn: _, ...rest } = p;
  return { ...rest, x: round2(cx + nx - p.w / 2), z: round2(cz + nz - p.d / 2), ...(turn ? { turn } : {}) };
}

/** A ready-made piece laid out as solids inside its space (x, z, y, w, d, h), in its colour where it has one. */
function pieceParts(p) {
  const { x, z, y, w, d, h, color, glow } = p;
  const at = (fx, fz, fy, fw, fd, fh, shape, c = color, g = false) => ({
    shape,
    x: round2(x + fx * w),
    z: round2(z + fz * d),
    y: round2(y + fy * h),
    w: round2(fw * w),
    d: round2(fd * d),
    h: round2(fh * h),
    color: c,
    glow: g,
  });
  // a creature's part, which the page knows by its role; in the colour it was given, or the one it usually has
  const own = (fallback) => (color === 'stone' ? fallback : color);
  const part = (role, q) => ({ ...q, role });
  switch (p.shape) {
    case 'eye':
      // white, a dark pupil looking out a little high, and a glint
      return [
        part('eye', at(0, 0, 0, 1, 0.6, 1, 'ball', 'paper')),
        part('eye', at(0.2, 0.4, 0.22, 0.6, 0.6, 0.62, 'ball', own('night'))),
        part('eye', at(0.52, 0.9, 0.58, 0.2, 0.1, 0.2, 'ball', 'paper', true)),
      ];
    case 'beak':
      return [part('beak', at(0, 0, 0.42, 1, 1, 0.58, 'wedge', own('gold'))), part('beak', at(0.12, 0, 0, 0.76, 0.8, 0.42, 'wedge', own('copper')))];
    case 'wing':
      return [part('wing', at(0, 0, 0, 1, 1, 1, 'ball', color, glow))];
    case 'foot':
      return [part('foot', at(0, 0, 0, 1, 1, 1, 'wedge', own('gold')))];
    case 'ear':
      return [part('ear', at(0, 0, 0, 1, 1, 1, 'cone', color, glow))];
    case 'tail':
      return [part('tail', at(0, 0, 0, 1, 1, 1, 'cone', color, glow))];
    case 'tree':
      return [at(0.375, 0.375, 0, 0.25, 0.25, 0.4, 'cylinder', 'bark'), at(0, 0, 0.4, 1, 1, 0.6, 'ball', color === 'stone' ? 'leaf' : color, glow)];
    case 'pine':
      return [at(0.4, 0.4, 0, 0.2, 0.2, 0.25, 'cylinder', 'bark'), at(0, 0, 0.25, 1, 1, 0.42, 'cone', color === 'stone' ? 'leaf' : color), at(0.15, 0.15, 0.67, 0.7, 0.7, 0.33, 'cone', color === 'stone' ? 'leaf' : color)];
    case 'column':
      return [at(0, 0, 0, 1, 1, 0.08, 'block'), at(0.2, 0.2, 0.08, 0.6, 0.6, 0.84, 'cylinder'), at(0, 0, 0.92, 1, 1, 0.08, 'block')];
    case 'lamp':
      return [at(0.4, 0.4, 0, 0.2, 0.2, 0.8, 'cylinder', 'iron'), at(0.25, 0.25, 0.8, 0.5, 0.5, 0.2, 'ball', color, true)];
    case 'door':
      return [{ ...at(0, 0, 0, 1, 1, 1, 'arch'), glow }];
    case 'window': {
      const pane = { shape: 'block', x: round2(x + w * 0.3), w: round2(w * 0.4), y: round2(y + h * 0.45), h: round2(h * 0.35), z: z + d - 1, d: 1, color: 'glass', glow: true };
      return [{ ...at(0, 0, 0, 1, 1, 1, 'block'), glow }, pane];
    }
    case 'bench':
      return [at(0, 0, 0, 0.15, 0.6, 0.4, 'block'), at(0.85, 0, 0, 0.15, 0.6, 0.4, 'block'), at(0, 0, 0.4, 1, 0.6, 0.15, 'block'), at(0, 0.75, 0.4, 1, 0.25, 0.6, 'block')];
    case 'fence': {
      const along = w >= d;
      const len = along ? w : d;
      const n = Math.max(2, Math.round(len / 2) + 1);
      const post = 0.6;
      const out = [];
      for (let i = 0; i < n; i++) {
        const o = round2((i / (n - 1)) * (len - post));
        out.push(along ? { shape: 'block', x: x + o, z: round2(z + d / 2 - post / 2), y, w: post, d: post, h, color, glow: false } : { shape: 'block', x: round2(x + w / 2 - post / 2), z: z + o, y, w: post, d: post, h, color, glow: false });
        if (i === n - 1) break;
        const gap = round2(((i + 1) / (n - 1)) * (len - post) - o - post);
        for (const fy of [0.35, 0.75]) {
          const rail = { shape: 'block', y: round2(y + h * fy), h: round2(Math.max(0.3, h * 0.12)), color, glow: false };
          out.push(along ? { ...rail, x: round2(x + o + post), w: gap, z: round2(z + d / 2 - 0.15), d: 0.3 } : { ...rail, z: round2(z + o + post), d: gap, x: round2(x + w / 2 - 0.15), w: 0.3 });
        }
      }
      return out;
    }
    default:
      return null;
  }
}

/**
 * What one part it wrote stands as: a piece laid out as its solids, turned as it said, and repeated in its pattern
 * (along a row by dx, dz steps; in a ring round the middle of its lot; or once more, mirrored left to right). Copies
 * that would leave the lot are left out.
 */
export function expand(p) {
  const { pattern, repeat, dx, dz, ...one } = p;
  const pieces = PIECES.includes(one.shape) || FEATURES.includes(one.shape) ? pieceParts(one) : null;
  const cx = one.x + one.w / 2;
  const cz = one.z + one.d / 2;
  const group = pieces ? pieces.map((q) => turned(q, one.turn || 0, cx, cz)) : [one];
  const copies = [group];
  if (pattern === 'row') for (let i = 1; i < repeat; i++) copies.push(group.map((q) => ({ ...q, x: round2(q.x + dx * i), z: round2(q.z + dz * i) })));
  if (pattern === 'ring') for (let i = 1; i < repeat; i++) copies.push(group.map((q) => turned(q, (360 * i) / repeat, LOT / 2, LOT / 2)));
  if (pattern === 'mirror')
    copies.push(group.map((q) => {
      const { turn, ...rest } = q;
      const back = turn ? (360 - turn) % 360 : 0;
      return { ...rest, x: round2(LOT - q.x - q.w), ...(back ? { turn: back } : {}) };
    }));
  return copies.flat().filter((q) => q.x >= -0.01 && q.z >= -0.01 && q.x + q.w <= LOT + 0.01 && q.z + q.d <= LOT + 0.01);
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const shares = (a, b) => overlap(a, b) && a.y < b.y + b.h && b.y < a.y + a.h;
const size = (p) => p.w * p.d * p.h;

/**
 * The face of block `q` that a part one step thin is set flush into (a window in a wall, a door, a pool in a floor), as
 * [axis, -1 | 1] pointing out of it; null if it is not set into it. The page draws such a part a hair proud of its face.
 */
export function inlay(p, q) {
  if (p === q || q.shape !== 'block' || p.turn || q.turn || size(p) >= size(q) || !shares(p, q)) return null;
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

/**
 * Two parts that would be in the same space: solids do not pass through each other, unless one is set into the other,
 * or is a creature's part (an eye sits in its head, a wing against its side).
 */
const collide = (p, q) => shares(p, q) && !p.role && !q.role && !inlay(p, q) && !inlay(q, p) && !through(p, q) && !through(q, p);

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
    if (!isMesh(p.shape)) return s;
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
  // A turned part stands by the square-on box around it; wherever that box is moved to, the part goes with it.
  const boxes = parts.map(footprint);
  const kept = standUp(boxes);
  return kept.map(({ box, i }) => {
    const p = parts[i];
    if (!p.turn) return box;
    return { ...p, x: round2(p.x + box.x - boxes[i].x), z: round2(p.z + box.z - boxes[i].z), y: box.y };
  });
}

/** The square-on box a part takes up on its lot: itself, unless it is turned. */
function footprint(p) {
  if (!p.turn) return p;
  const a = (p.turn * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
  const w = round2(p.w * c + p.d * s);
  const d = round2(p.w * s + p.d * c);
  return { ...p, x: round2(p.x + p.w / 2 - w / 2), z: round2(p.z + p.d / 2 - d / 2), w, d };
}

function standUp(parts) {
  const standing = [];
  const kept = [];
  const stand = (p, i) => {
    if (!p.glow && p.y > 0 && !standing.some((q) => holds(q, p))) {
      p.y = Math.max(0, ...standing.filter((q) => overlap(p, q) && q.y + q.h <= p.y).map((q) => q.y + q.h));
    }
    standing.push(p);
    kept[i] = { box: p, i };
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
 * A shape as it would stand now that its parts are solid. Shapes kept from before they were (`solid` unset) are shown
 * as they were built; when it reshapes one, it is shown this, so what it builds on stands. What was kept is unchanged.
 */
export const standing = (form) => (!form?.parts?.length || form.solid ? form : { ...form, parts: settle(form.parts), solid: true });

/** A shape from what it answered (JSON text or already parsed), or null if nothing in it can stand. */
export function readForm(answer, { model = null, made = null } = {}) {
  let raw = answer;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      return null;
    }
  }
  const seen = new Set();
  const written = [];
  let lent = 0;
  let asked = 0;
  for (const p of Array.isArray(raw?.parts) ? raw.parts : []) {
    if (p?.shape === MADE && asked >= MAX_MADE) continue; // asked of the maker only when it will be used
    const c = cleanPart(p, { model, made });
    const key = c && JSON.stringify(c);
    if (!c || seen.has(key)) continue;
    if (c.shape === MODEL && ++lent > MAX_BORROWED) continue; // mostly its own work
    if (c.shape === MADE) asked++;
    seen.add(key);
    written.push(c);
    if (written.length >= MAX_PARTS) break;
  }
  const kept = settle(written.flatMap(expand).slice(0, MAX_SOLIDS));
  return kept.length ? { parts: kept, solid: true } : null;
}

/** The parts it has finished writing so far, while the rest of its answer is still arriving (for watching it build). */
export function partialParts(text) {
  const parts = [];
  for (const m of String(text || '').matchAll(/\{[^{}]*\}/g)) {
    try {
      const c = cleanPart(JSON.parse(m[0]));
      if (c) parts.push(...expand(c));
    } catch {
      // not finished yet
    }
    if (parts.length >= MAX_SOLIDS) break;
  }
  return settle(parts.slice(0, MAX_SOLIDS));
}

/** How tall a shape stands, in tiles. */
export const formHeight = (form) => (form?.parts?.length ? Math.max(...form.parts.map((p) => p.y + p.h)) / LOT : 0);
