// Its place: a small map it builds out of what people tell it, because it cannot see the real one.
// Things it no longer remembers the reason for wear away at night; tending them brings them back.
// And its wishes: what it asks its keeper for when there is something it cannot do itself.
import { avenue } from '../web/lib/town.js';
import { sameAsk } from './errands.js';

export const MAP = { w: 15, h: 11 };
/** Where it lives: the graphics card, in the middle of everything it builds. */
export const CARD = { x: 7, y: 5 };
export const MAX_OPEN_WISHES = 5;
const WEAR = 0.25; // a night without anything remembered to hold a thing up takes this much of it

export function emptyWorld() {
  return { w: MAP.w, h: MAP.h, things: [], nextId: 1, at: null };
}

const bare = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');

/** A stable 0..1 from a string, so the same thing always lands in the same spot. */
function hash(s) {
  let x = 2166136261;
  for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return ((x >>> 0) % 10007) / 10007;
}

/** The thing with exactly this name (ignoring "the" and case), if there is one. */
export const namedThing = (world, name) => world.things.find((t) => bare(t.name) === bare(name)) || null;

/** The thing a name refers to: an exact name first, then the closest partial one. */
export function findThing(world, name) {
  const n = bare(name);
  if (!n) return null;
  return world.things.find((t) => bare(t.name) === n) || world.things.find((t) => bare(t.name).includes(n) || n.includes(bare(t.name))) || null;
}

/**
 * The nearest free lot to an anchor, ring by ring, leaving the avenues between the town's blocks open (web/lib/town.js);
 * only when every lot is taken does it build on an avenue. Ties go to a stable pick, so the place doesn't grow in
 * straight lines.
 */
export function placeNear(world, anchor, salt = '') {
  const taken = new Set([`${CARD.x},${CARD.y}`, ...world.things.map((t) => `${t.x},${t.y}`)]);
  for (const lots of [true, false]) {
    for (let r = 1; r < Math.max(world.w, world.h) * 2; r++) {
      const ring = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = anchor.x + dx;
          const y = anchor.y + dy;
          if (x < 0 || y < 0 || x >= world.w || y >= world.h || taken.has(`${x},${y}`) || (lots && avenue(x, y, CARD))) continue;
          ring.push({ x, y });
        }
      }
      if (ring.length) return ring[Math.floor(hash(`${salt}|${r}`) * ring.length)];
    }
  }
  return null;
}

/** Does anything it still remembers touch this thing? A memory from the same letters, about the same people, or naming it. */
export function remembered(thing, memory) {
  const all = [...Object.values(memory.shelves).flat(), ...memory.today];
  const name = bare(thing.name);
  const people = new Set((thing.people || []).map((p) => p.trim().toLowerCase()));
  return all.some(
    (m) =>
      (m.because || []).some((id) => thing.from.includes(id)) ||
      (m.holds || []).includes(thing.id) || // a memory folded from others that held it
      (m.about && people.has(m.about.trim().toLowerCase())) ||
      (name.length >= 4 && m.text.toLowerCase().includes(name)),
  );
}

/**
 * The night's weather. A thing that nothing in its memory still touches wears down a little; one it built or tended
 * today is spared. Worn all the way down, it becomes a ruin, which stays on the map. Mutates the world.
 */
export function weather(world, memory, { since, cycle }) {
  const worn = [];
  const ruined = [];
  for (const t of world.things) {
    if (t.ruin) continue;
    if (Math.max(t.built, t.tended ?? 0) >= since || remembered(t, memory)) continue;
    t.condition = Math.max(0, Math.round((t.condition - WEAR) * 100) / 100);
    if (t.condition <= 0) {
      t.ruin = true;
      t.ruinedAt = cycle;
      t.history.push({ cycle, what: 'ruined', text: 'It no longer remembered why it built this.' });
      ruined.push({ id: t.id, name: t.name });
    } else worn.push({ id: t.id, name: t.name, condition: t.condition });
  }
  return { worn, ruined };
}

/** Drawings a child inherits are numbered from here, far past any cycle a life reaches, so they never meet its own. */
export const KIN_SPRITES = 900000;

/**
 * The place a mind leaves its child. What it asked to keep still stands, held up by its last letter (so it stands
 * while the child remembers that letter, or its parent); everything else is a ruin. Returns the child's world and
 * which drawings to copy ([old number, new number]); the parent's world is not touched.
 */
export function inheritWorld(world, { keep = [], parent, generation, letter = null }) {
  const kept = new Set(keep.map((name) => findThing(world, name)?.id).filter(Boolean));
  const sprites = [];
  const things = world.things.map((old) => {
    const t = structuredClone(old);
    const stays = kept.has(t.id);
    const sprite = t.sprite ? KIN_SPRITES + generation * 1000 + Number(t.id.slice(1)) : null;
    if (sprite) sprites.push([t.sprite, sprite]);
    delete t.ruinedAt;
    return {
      ...t,
      // Its child's timeline starts again at 0; when and by whom it was really built is kept.
      builtBy: t.builtBy || { name: parent, generation: generation - 1, cycle: t.built, version: t.version },
      built: 0,
      version: 0,
      tended: null,
      from: stays && letter ? [letter] : [],
      people: stays ? [...new Set([...(t.people || []), parent])] : t.people || [],
      sprite,
      condition: stays ? 1 : 0,
      ruin: !stays,
      ...(stays ? {} : { ruinedAt: 0 }),
      history: [...t.history, { cycle: 0, what: 'inherited', text: stays ? `${parent} asked for this to be kept for its child.` : `${parent} died, and this was left to fall.` }],
    };
  });
  return { world: { ...structuredClone(world), things, at: null }, sprites };
}

/** A new wish, unless it is one it already asked for or too many are still waiting. */
export function addWish(wishes, { text, why }, { version, cycle, at }) {
  if (!text) return null;
  const open = wishes.filter((w) => w.status === 'open');
  if (open.some((w) => sameAsk(w.text, text))) return { refused: 'it has already asked for that', text };
  if (open.length >= MAX_OPEN_WISHES) return { refused: `it already has ${MAX_OPEN_WISHES} wishes waiting`, text };
  const wish = { id: `w${wishes.length + 1}`, text, why, version, cycle, at, status: 'open', answer: null };
  wishes.push(wish);
  return { wish };
}

/**
 * Its keeper answers a wish: "granted" or "declined" settle it; "reply" only writes back and leaves it open.
 * It is told the answer the next time it wakes.
 */
export function answerWish(wishes, id, status, text, at) {
  const w = wishes.find((x) => x.id === id);
  if (!w) return { ok: false, reason: 'no such wish' };
  if (!['granted', 'declined', 'reply'].includes(status)) return { ok: false, reason: 'answer with granted, declined or reply' };
  if (status === 'reply' && !text) return { ok: false, reason: 'a reply needs some words' };
  w.answer = { status, text: text || '', at, told: null };
  if (status !== 'reply') w.status = status;
  return { ok: true, wish: w };
}

/**
 * A wish that asks for a photo, said as an errand (so the people who visit can grant it, not only its keeper), or null.
 * "Please bring me a photo of rain" → "Bring me a photo of rain".
 */
export function photoWish(text) {
  if (!/\b(photo(graph)?s?|pictures?|snapshots?)\b/i.test(text || '')) return null;
  const said = text.trim().replace(/^(please|could you|can you|would you)[,\s]+/i, '').replace(/\?$/, '.');
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Answers it has not been told about yet. */
export const untoldAnswers = (wishes) => wishes.filter((w) => w.answer && w.answer.told == null);
