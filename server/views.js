// What the public may see of a life. Shared by the live server and the static export, so both hide the same things.
import { influencedBy, letterStatus, publicCycle, publicLetter, publicLook, publicWish } from './life.js';
import { publicSeal } from '../web/lib/seal.js';
import { pad } from './store.js';
import { borrowed, loadCatalogue } from './models.js';
import { CARD } from './world.js';
import { MADE_BY } from './maker.js';

const spriteSrc = (n) => (n ? `works/${pad(n)}.svg` : null);

/** One cycle record, minus anything moderation held back. */
export function cycle(store, n) {
  const record = n ? store.read(`cycles/${pad(n)}.json`, null) : null;
  return record ? publicCycle(record) : null;
}

/** One night record, as it was sealed. */
export function night(store, n) {
  const record = n ? store.read(`nights/${pad(n, 4)}.json`, null) : null;
  return record ? { ...record, ...(record.seal ? { seal: publicSeal(record.seal) } : {}) } : null;
}

/** Its sealed record: one entry per cycle and night, each linked to the one before (web/lib/seal.js). */
export function chain(life) {
  return life.chain;
}

/** Everything it made, newest first. Drawings are referenced by a path relative to the page. */
export function works(life, store) {
  const out = [];
  for (const c of life.cycles) {
    if (!c.work || c.work.failed || !['drawing', 'writing', 'building'].includes(c.work.kind)) continue;
    const full = store.read(`cycles/${pad(c.n)}.json`, null)?.work;
    if (!full) continue;
    out.push({
      cycle: c.n,
      version: c.v,
      at: c.at,
      kind: full.kind,
      title: full.title,
      intent: full.intent,
      note: full.note,
      text: full.kind === 'writing' ? full.text : undefined,
      plaque: full.kind === 'building' ? full.plaque : undefined,
      thing: full.thing,
      src: full.kind === 'drawing' || (full.kind === 'building' && full.svg) ? `works/${pad(c.n)}.svg` : undefined,
    });
  }
  return out.reverse();
}

/** Its place: everything it built, where, from whose letters, and how worn; and the wishes it left its keeper. */
export function world(life) {
  const s = life.state;
  life.catalogue ??= loadCatalogue();
  const readable = new Map(life.letters.filter((l) => letterStatus(l) === 'allowed').map((l) => [l.id, l.from]));
  // Shapes from before its parts were solid are shown as it built them: the rule is for what it builds from now on.
  const things = s.world.things.map((t) => [t, t.form]);
  return {
    name: s.name,
    w: s.world.w,
    h: s.world.h,
    card: CARD,
    at: s.world.at,
    things: things.map(([t, form]) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      plaque: t.plaque,
      x: t.x,
      y: t.y,
      near: t.near ?? null,
      built: t.built,
      version: t.version,
      tended: t.tended,
      condition: t.condition,
      ruin: t.ruin,
      ruinedAt: t.ruinedAt ?? null,
      sprite: spriteSrc(t.sprite),
      form: form || null,
      borrowed: borrowed(life.catalogue, form),
      made: life.maker.status((form?.parts || []).filter((p) => p.made).map((p) => p.made)),
      from: t.from.filter((id) => readable.has(id)).map((id) => ({ id, from: readable.get(id) })),
      people: t.people,
      ...(t.builtBy ? { builtBy: t.builtBy } : {}),
      history: t.history,
    })),
    credit: things.some(([, form]) => form?.parts.some((p) => p.model)) ? life.catalogue.credit : null,
    madeBy: things.some(([, form]) => form?.parts.some((p) => p.made)) ? MADE_BY : null,
    wishes: s.wishes.map((w) => publicWish(w, s.errands)).reverse(),
  };
}

/** Its errands as the public sees them (not the ones still waiting for its keeper), each with what people brought. */
export function errands(life) {
  const returns = new Map();
  for (const l of life.letters) {
    if (!l.errand || letterStatus(l) !== 'allowed') continue;
    const list = returns.get(l.errand.id) || [];
    list.push({ id: l.id, from: l.from, note: l.text, at: l.at, photo: l.errand.photo, look: publicLook(l.errand.look), seenCycle: l.errand.seenCycle ?? null });
    returns.set(l.errand.id, list);
  }
  return life.state.errands
    .filter((e) => !['held', 'dropped'].includes(e.status))
    .map((e) => ({
      id: e.id,
      text: e.text,
      why: e.why,
      cycle: e.cycle,
      version: e.version,
      at: e.postedAt || e.at,
      status: e.status,
      closedBecause: e.closedBecause || null,
      filledBy: e.filledBy,
      filledCycle: e.filledCycle ?? null,
      wish: e.wish ? life.state.wishes.find((w) => w.id === e.wish)?.text || null : null,
      returns: (returns.get(e.id) || []).reverse(),
    }))
    .reverse();
}

/** Letters the public may read, newest first; a visitor also sees their own letters with their screening status. */
export function letters(life, me = null) {
  const sent = (life.state.outbox || []).filter((o) => o.sentAt && o.kind !== 'line' && !o.held);
  return life.letters
    .filter((l) => letterStatus(l) === 'allowed' || (me && l.person === me))
    .map((l) => {
      // a person's letter whose words it carried on to a pen pal, in a letter written after it read it
      const read = l.readAt && !l.pal ? life.cycles.find((c) => c.letters.includes(l.id))?.n : null;
      const passed = read ? sent.filter((o) => o.cycle >= read && influencedBy(l, o.text)).map((o) => ({ to: o.toName, night: o.night })) : [];
      return { ...publicLetter(l, { own: Boolean(me && l.person === me) }), mine: Boolean(me && l.person === me), ...(passed.length ? { passedOn: passed } : {}) };
    })
    .reverse();
}

/**
 * Its correspondence with each pen pal as one thread, oldest first: the letters it opened from them (and what it did
 * in the cycle it read each one), and the letters it sent them (and what it wrote in its diary the cycle it wrote each).
 */
export function thread(life) {
  const s = life.state;
  const mates = new Set(life.housemates().map((h) => h.url));
  return Object.values(s.pals || {})
    .filter((p) => p.id)
    .map((p) => {
      const ins = life.letters
        .filter((l) => l.pal?.id === p.id && letterStatus(l) === 'allowed')
        .map((l) => {
          const c = l.readAt ? life.cycles.find((x) => x.letters.includes(l.id)) : null;
          return { dir: 'in', id: l.id, ref: l.pal.letter, text: l.text, at: l.at, read: c ? { cycle: c.n, action: c.action, title: c.title || '', diary: c.diary } : null };
        });
      const outs = (s.outbox || [])
        .filter((o) => o.to === p.id && o.sentAt && o.kind !== 'line' && !o.held)
        .map((o) => {
          const c = life.cycles.find((x) => x.n === o.cycle);
          return { dir: 'out', id: o.id, ref: o.id, inReplyTo: o.inReplyTo || null, text: o.text, at: o.sentAt, night: o.night, first: Boolean(o.first), wrote: c ? { cycle: c.n, diary: c.diary } : null };
        });
      return { name: p.name, page: p.page || null, card: mates.has(p.url), open: p.open ?? null, items: [...ins, ...outs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
    });
}

/** The whole life in order, for replay: every cycle as the public may see it (drawings by path), and every night. */
export function replay(life, store) {
  const cycles = [];
  for (const c of life.cycles) {
    const record = cycle(store, c.n);
    if (!record) continue;
    const { svg, ...work } = record.work || {};
    const { gpu, ...when } = record.senses || {};
    const drawn = record.work && !record.work.failed && (record.work.kind === 'drawing' || record.work.svg);
    cycles.push({
      ...record,
      senses: { ...when, gpu: gpu ? { tempC: gpu.tempC, util: gpu.util } : null },
      work: record.work ? { ...work, src: drawn ? `works/${pad(c.n)}.svg` : undefined } : null,
    });
  }
  return { born: life.state.born, name: life.state.name, cycles, nights: life.nights, milestones: life.state.milestones, world: { w: life.state.world.w, h: life.state.world.h, card: CARD } };
}

/**
 * The whole mind as one timeline, for the atlas: every belief, memory, person and letter with when it appeared,
 * changed and went, plus the threads between them (which letter changed what, which memory pushed out which).
 * Times are cycle numbers; a night happens at the end of the cycle it follows.
 */
export function atlas(life, store) {
  const s = life.state;
  const nights = life.nights.map((n) => ({ v: n.n, cycle: n.cycles[1], title: n.release?.title || n.day || '', day: n.day || '' }));
  const atNight = (v) => nights.find((n) => n.v === v)?.cycle ?? null;
  const nightAfter = (cycle) => nights.find((n) => n.cycle >= cycle)?.cycle ?? null;

  // Per-cycle facts from the records: when old memories were brought back, how it felt, what it made, what it noticed.
  const touches = {};
  const cycles = [];
  const day = [];
  for (const c of life.cycles) {
    const rec = cycle(store, c.n);
    if (!rec) continue;
    for (const id of rec.reinforced || []) (touches[id] ??= []).push(c.n);
    const w = rec.work;
    cycles.push({
      n: c.n,
      v: rec.version,
      at: rec.startedAt,
      part: rec.senses?.partOfDay || '',
      mood: rec.moodAfter || rec.feelings || null,
      action: rec.action?.kind || 'rest',
      work: w && !w.failed ? { kind: w.kind, title: w.title || '', text: w.kind === 'question' || w.kind === 'errand' ? w.text : undefined, src: w.kind === 'drawing' ? `works/${pad(c.n)}.svg` : undefined } : null,
      diary: rec.diary || '',
    });
    for (const m of rec.remembered || []) day.push({ cycle: c.n, shelf: m.shelf, text: m.text });
  }

  // Memories: everything still on a shelf and everything it has forgotten, each with its whole life.
  const memories = [];
  const shelved = Object.entries(s.memory.shelves).flatMap(([shelf, list]) => list.map((m) => ({ ...m, shelf })));
  for (const m of [...shelved, ...s.memory.forgotten]) {
    memories.push({
      id: m.id,
      text: m.text,
      shelf: m.shelf,
      about: m.about || '',
      born: m.born,
      kept: nightAfter(m.born) ?? m.born,
      weight: m.weight,
      touches: touches[m.id] || [],
      because: m.because || [],
      gone: m.forgottenAt ?? null,
      how: m.how || null,
      by: m.by || null,
    });
  }

  // What became of each thing it noticed during the day: kept as a memory, folded into one, or lost at night.
  // The same words can be noticed twice in a day, so each outcome is used up by the first thing it matches.
  const outcomes = new Map(life.nights.map((n) => [n.cycles[1], { kept: [...(n.memory?.kept || [])], merged: [...(n.memory?.merged || [])] }]));
  const take = (list, ok) => {
    const i = list.findIndex(ok);
    return i < 0 ? null : list.splice(i, 1)[0];
  };
  const sparks = day.map((d) => {
    const night = nightAfter(d.cycle);
    const o = outcomes.get(night);
    if (!o) return { ...d, night, fate: 'waiting' };
    const kept = take(o.kept, (k) => k.text === d.text && k.born === d.cycle);
    if (kept) return { ...d, night, fate: 'kept', into: kept.id };
    const merged = take(o.merged, (k) => k.text === d.text);
    if (merged) return { ...d, night, fate: 'merged', into: merged.into };
    return { ...d, night, fate: 'lost' };
  });
  // A memory shelved at night, or folded into at night, was touched then.
  for (const sp of sparks) if (sp.fate === 'merged') (touches[sp.into] ??= []).push(sp.night);
  const shelvedAt = new Map(life.nights.flatMap((n) => (n.memory?.kept || []).map((k) => [k.id, n.cycles[1]])));
  for (const m of memories) {
    m.kept = shelvedAt.get(m.id) ?? m.kept;
    m.touches = [...new Set(touches[m.id] || [])].sort((a, b) => a - b);
  }

  // Beliefs: the lines it wrote about itself, each with every wording it has had.
  const beliefs = [...s.self.own, ...s.self.gone].map((b) => {
    const texts = [];
    let from = atNight(b.since) ?? 0;
    for (const old of b.history || []) {
      const until = atNight(old.until) ?? from;
      texts.push({ text: old.text, from, until });
      from = until;
    }
    const gone = b.removedIn ? atNight(b.removedIn) : null;
    texts.push({ text: b.text, from, until: gone });
    return { id: b.id, born: atNight(b.since) ?? 0, texts, because: b.because || '', gone, why: b.why || '' };
  });
  beliefs.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const portrait = [...(s.portrait?.history || []), ...(s.portrait?.text ? [{ version: s.portrait.since, text: s.portrait.text }] : [])]
    .map((p) => ({ from: atNight(p.version) ?? 0, text: p.text, changed: p.changed || '' }))
    .filter((p, i, all) => all.findIndex((q) => q.from === p.from) === i);
  const names = (s.names || []).map((n) => ({ name: n.name, from: atNight(n.version) ?? 0, why: n.why || '' }));

  // People and their letters. Visitors are numbered here; their keys never leave the server.
  const people = [];
  const personOf = new Map();
  const letters = [];
  for (const l of life.letters) {
    if (letterStatus(l) !== 'allowed' || !l.readCycle) continue;
    if (!personOf.has(l.person)) {
      personOf.set(l.person, `p${people.length + 1}`);
      people.push({ id: `p${people.length + 1}`, name: l.from, first: l.readCycle, letters: [] });
    }
    const p = people.find((x) => x.id === personOf.get(l.person));
    p.name = l.from;
    p.letters.push(l.id);
    const pub = publicLetter(l);
    letters.push({ id: l.id, person: p.id, from: l.from, cycle: l.readCycle, text: pub.text, reply: pub.reply?.text || null, question: pub.questionText });
  }

  // Threads: a letter that changed something, and a memory that pushed another off its shelf.
  const textIs = (t) => (x) => x.text === t;
  const threads = [];
  for (const n of life.nights) {
    const at = n.cycles[1];
    for (const inf of n.influences || []) {
      if (!letters.some((l) => l.id === inf.letter)) continue;
      let to = null;
      if (inf.what === 'belief' || inf.what === 'unbelief') to = beliefs.find((b) => b.texts.some(textIs(inf.text)))?.id;
      else if (inf.what === 'memory') to = memories.find(textIs(inf.text))?.id;
      else if (inf.what === 'portrait') to = 'portrait';
      else if (inf.what === 'name') to = 'name';
      if (to) threads.push({ kind: 'influence', from: inf.letter, to, what: inf.what, at });
    }
  }
  for (const m of memories) {
    if (m.by && m.gone != null) threads.push({ kind: 'pushed', from: m.by, to: m.id, at: m.gone });
    for (const id of m.because) if (letters.some((l) => l.id === id) && !threads.some((t) => t.from === id && t.to === m.id)) threads.push({ kind: 'influence', from: id, to: m.id, what: 'memory', at: m.kept });
  }

  // Its place: what it built and when, what wore it down, and the letters each thing was made from.
  const at = (t, what) => t.history.filter((x) => what.includes(x.what)).map((x) => x.cycle);
  const things = (s.world?.things || []).map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    plaque: t.plaque,
    built: t.built,
    tended: at(t, ['tended', 'rebuilt']),
    ruined: at(t, ['ruined']),
    rebuilt: at(t, ['rebuilt']),
    from: t.from.filter((id) => letters.some((l) => l.id === id)),
    sprite: spriteSrc(t.sprite),
  }));
  for (const t of things) for (const id of t.from) threads.push({ kind: 'influence', from: id, to: t.id, what: 'thing', at: t.built });
  const wishes = (s.wishes || []).map((w) => ({ id: w.id, text: w.text, cycle: w.cycle, status: w.status, answer: w.answer ? { status: w.answer.status, text: w.answer.text, told: w.answer.told } : null }));

  return {
    born: s.born,
    name: s.name,
    end: s.cycle,
    halfLife: life.cfg.memory.halfLifeCycles,
    shelfSize: life.cfg.memory.shelfSize,
    seed: s.self.seed.map((l) => ({ id: l.id, text: l.text })),
    cycles,
    nights,
    beliefs,
    portrait,
    names,
    memories,
    sparks,
    people,
    letters,
    threads,
    things,
    wishes,
  };
}
