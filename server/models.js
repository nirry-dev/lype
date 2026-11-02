// Things it can borrow: ready-made models other people made and gave away (scripts/models.js builds the catalogue).
// It has never seen them either, only their names, so it is offered the few whose names touch what it is building,
// what it thought this cycle and what it remembers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

export const CATALOGUE = join(ROOT, 'web', 'models', 'catalogue.json');
/** Offered when little else matches: plain things that sit beside almost anything. */
const PLAIN = ['bench', 'lantern', 'tree', 'rock large', 'flower yellow', 'fence', 'barrel', 'campfire stones', 'mushroom red', 'chest'];

/** The catalogue, with each model findable by its name and its id; an empty one if it has not been built. */
export function loadCatalogue(file = CATALOGUE) {
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { models: [], kits: {}, credit: '' };
  const byName = new Map(raw.models.map((m) => [m.name, m]));
  const byId = new Map(raw.models.map((m) => [m.id, m]));
  return { ...raw, byName, byId };
}

const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(?<=[^s])(es|s)$/, '');
// how big a thing is says nothing about what it is: "a small house" should find houses, not every small thing
const SIZES = new Set(['small', 'large', 'big', 'little', 'long', 'short', 'low', 'high', 'tall', 'wide', 'narrow']);
const tokens = (text) => (String(text || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !SIZES.has(w)).map(stem);

/**
 * The names it is offered for a thing: the best matches for what it is building (counted twice) and for its thoughts
 * and memories, then plain things to make up at least `min`. Never more than `max`.
 */
export function shortlist(catalogue, { about = '', thoughts = '' }, { max = 16, min = 8 } = {}) {
  if (!catalogue.models.length) return [];
  const weight = new Map();
  for (const t of tokens(thoughts)) weight.set(t, (weight.get(t) || 0) + 1);
  for (const t of tokens(about)) weight.set(t, (weight.get(t) || 0) + 2);
  const scored = [];
  for (const m of catalogue.models) {
    const own = new Set(m.words.map(stem));
    let score = 0;
    for (const w of own) score += (weight.get(w) || 0) * 2;
    if (!score) continue; // a kit's words alone (home, sea, winter) are not enough
    for (const w of catalogue.kits[m.id.split('/')[0]] || []) score += (weight.get(stem(w)) || 0) * 0.5;
    scored.push({ m, score: score / Math.sqrt(own.size) });
  }
  scored.sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name));
  const names = [];
  // look-alikes told apart only by a number ("two-storey house, white walls, teal roof (7)"): two of them are enough
  const family = new Map();
  for (const { m } of scored) {
    const kin = m.name.replace(/\s*\(\d+\)$/, '');
    if (names.length >= max || names.includes(m.name) || (family.get(kin) || 0) >= 2) continue;
    family.set(kin, (family.get(kin) || 0) + 1);
    names.push(m.name);
  }
  for (const p of PLAIN) {
    if (names.length >= Math.min(min, max)) break;
    const m = catalogue.byName.get(p) || catalogue.models.find((x) => x.name.startsWith(`${p} (`));
    if (m && !names.includes(m.name)) names.push(m.name);
  }
  return names;
}

/** A model as a text to find by meaning: its name and the kind of things it came with ("bench: town, village, street"). */
export const docOf = (catalogue, m) => `${m.name}: ${m.id.split('/')[0]}, ${(catalogue.kits[m.id.split('/')[0]] || []).slice(0, 3).join(', ')}`;

// By meaning, every model sits at 0.4-0.5 from anything it builds; the few that touch it stand out above that crowd
// (the soft arch: stones, stone bridges and curved fences at 0.58-0.6, where its middle is 0.48). Calibrated on its place.
const ABOVE = 0.06;

/**
 * The best matches by meaning for `about` among `pool` (all models when none), ordered: those well above that query's
 * crowd (its 90th percentile + ABOVE). Empty when the meaning model is off or can't be reached.
 */
export async function byMeaning(catalogue, meaning, about, { pool = catalogue.models, max = 8 } = {}) {
  if (!meaning?.up || !about || !pool.length) return [];
  const docs = pool.map((m) => docOf(catalogue, m));
  if (!(await meaning.ensure(docs, 'document')) || !(await meaning.ensure([about], 'query'))) return [];
  const scored = pool.map((m, i) => ({ m, c: meaning.closeness(about, docs[i]) ?? 0 })).sort((a, b) => b.c - a.c);
  const bar = scored[Math.floor(scored.length * 0.1)].c + ABOVE;
  return scored.filter((x) => x.c >= Math.min(bar, scored[0].c)).slice(0, max).map((x) => x.m.name);
}

/** The shortlist (see shortlist), with what matches by meaning put in among what matches by words. */
export async function offer(catalogue, meaning, ctx, { max = 16, min = 8 } = {}) {
  const meant = await byMeaning(catalogue, meaning, ctx.about, { max: Math.ceil(max / 2) });
  const words = shortlist(catalogue, ctx, { max, min }); // the plain things that make up its numbers come last, and go first
  return [...new Set([...words.slice(0, max - meant.length), ...meant, ...words])].slice(0, max);
}

// What it can set down beside what it built, in a moment: small things that stand outdoors, from the kits for a town,
// its gardens, a camp and a graveyard, and the furniture that also stands outside. Never anything bigger than a cart.
const OUTSIDE = new Set(['town', 'nature', 'camp', 'graveyard']);
const OUTDOOR_FURNITURE = /^(bench|plant|potted plant|lounge chair)\b/;

export function furnishings(catalogue) {
  catalogue.furnishings ??= catalogue.models.filter((m) => {
    const kit = m.id.split('/')[0];
    if (Math.max(...m.dims) > 1.8 || /\b(chimney|wall|floor|roof|stairs|bridge|path|ground|platform|tent|ceiling|desk|bed|bedroll)\b/.test(m.name)) return false;
    return OUTSIDE.has(kit) || (kit === 'furniture' && OUTDOOR_FURNITURE.test(m.name));
  });
  return catalogue.furnishings;
}

/**
 * The things it is offered to set down beside a thing in a moment: what matches it (and what it last thought) by
 * meaning or words, then a couple from anywhere among the furnishings, so its place does not fill with one kind of thing.
 * `avoid`: names not to offer this time (what it has already set down enough of).
 */
export async function aroundOffer(catalogue, meaning, about, { max = 8, salt = '', avoid = new Set() } = {}) {
  const pool = furnishings(catalogue).filter((m) => !avoid.has(m.name));
  if (!pool.length) return [];
  const names = new Set(pool.map((m) => m.name));
  const meant = await byMeaning(catalogue, meaning, about, { pool, max: max - 2 });
  const words = shortlist(catalogue, { about }, { max: max * 2, min: 0 }).filter((n) => names.has(n));
  const picked = [...new Set([...meant, ...words])].slice(0, max - 2);
  let x = 0;
  for (const ch of salt) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; picked.length < max && i < pool.length; i++) {
    const m = pool[(x + i * 7919) % pool.length];
    if (!picked.includes(m.name)) picked.push(m.name);
  }
  return picked;
}

/** The names of what a shape borrowed, for its sign and its page. */
export const borrowed = (catalogue, form) => [...new Set((form?.parts || []).filter((p) => p.shape === 'model').map((p) => catalogue.byId.get(p.model)?.name || p.model))];
