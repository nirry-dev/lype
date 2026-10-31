// What the public may see of a life. Shared by the live server and the static export, so both hide the same things.
import { letterStatus, publicCycle, publicLetter } from './life.js';
import { pad } from './store.js';

/** One cycle record, minus anything moderation held back. */
export function cycle(store, n) {
  const record = n ? store.read(`cycles/${pad(n)}.json`, null) : null;
  return record ? publicCycle(record) : null;
}

/** Everything it made, newest first. Drawings are referenced by a path relative to the page. */
export function works(life, store) {
  const out = [];
  for (const c of life.cycles) {
    if (!c.work || c.work.failed || c.work.kind === 'question') continue;
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
      src: full.kind === 'drawing' ? `works/${pad(c.n)}.svg` : undefined,
    });
  }
  return out.reverse();
}

/** Letters the public may read, newest first; a visitor also sees their own letters with their screening status. */
export function letters(life, me = null) {
  return life.letters
    .filter((l) => letterStatus(l) === 'allowed' || (me && l.person === me))
    .map((l) => ({ ...publicLetter(l, { own: Boolean(me && l.person === me) }), mine: Boolean(me && l.person === me) }))
    .reverse();
}

/** The whole life in order, for replay: every cycle as the public may see it (drawings by path), and every night. */
export function replay(life, store) {
  const cycles = [];
  for (const c of life.cycles) {
    const record = cycle(store, c.n);
    if (!record) continue;
    const { svg, ...work } = record.work || {};
    const { gpu, ...when } = record.senses || {};
    cycles.push({
      ...record,
      senses: { ...when, gpu: gpu ? { tempC: gpu.tempC, util: gpu.util } : null },
      work: record.work ? { ...work, src: record.work.kind === 'drawing' && !record.work.failed ? `works/${pad(c.n)}.svg` : undefined } : null,
    });
  }
  return { born: life.state.born, name: life.state.name, cycles, nights: life.nights, milestones: life.state.milestones };
}
