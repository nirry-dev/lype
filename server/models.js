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
const tokens = (text) => (String(text || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2).map(stem);

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
  for (const { m } of scored) if (names.length < max && !names.includes(m.name)) names.push(m.name);
  for (const p of PLAIN) {
    if (names.length >= Math.min(min, max)) break;
    const m = catalogue.byName.get(p) || catalogue.models.find((x) => x.name.startsWith(`${p} (`));
    if (m && !names.includes(m.name)) names.push(m.name);
  }
  return names;
}

/** The names of what a shape borrowed, for its sign and its page. */
export const borrowed = (catalogue, form) => [...new Set((form?.parts || []).filter((p) => p.shape === 'model').map((p) => catalogue.byId.get(p.model)?.name || p.model))];
