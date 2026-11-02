// Recall. Everything it ever thought, read, said, dreamed and forgot stays on disk; its shelves hold only a few dozen
// memories. When something in the present calls one of the old things up (a letter from someone it has heard from
// before, the thing it is standing by), it comes back to it for one cycle, as a reminder: it is shown, not kept, and
// its shelves stay what they are unless it chooses to remember it again.
//
// What comes back is steered away from what it already dwells on: nothing it holds on its shelves, nothing it wrote in
// its diary lately, nothing from its last few cycles, nothing it was reminded of recently, and no two things alike.
// Letters and what it forgot come back a little more readily than its own musing.
//
// The present calls things up by the words they share, and (when a model for meaning is running: meaning.js) by what
// they are about: a letter about the air tasting of dust can call up an old letter about rain on the roof.
import { THEME, kin, words } from './memory.js';

const MAX = 3; // things recalled in a cycle
const RECENT = 8; // its last cycles are not recalled: it has them already
const REST = 12; // cycles before the same thing can come back
const MIN = 1.5; // how strongly the present has to call something up
// By meaning: a thing is called up only when it stands out from everything else this present is near (each letter's
// own background differs), and is close in its own right. Calibrated on its own history (see README, Meaning).
const NEAR = 0.66;
const ABOVE = 0.07; // above the closeness of the tenth-nearest in a hundred
const KIND_WEIGHT = { letter: 1.5, reply: 1.3, forgotten: 1.3, work: 1, dream: 0.9, diary: 0.8, thought: 0.7, aloud: 0.7 };

const body = (text) => text.replace(/^[^"]*"|"$/g, '');
const quote = (t, max) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export class Recall {
  constructor(life, meaning = null) {
    this.life = life;
    this.meaning = meaning;
    this.items = [];
    this.ids = new Set();
    this.df = new Map(); // in how many things each word appears
  }

  /** Everything so far, from what is on disk: every cycle, every night, and what it forgot. */
  build() {
    const { store, state } = this.life;
    for (const f of store.list('cycles')) this.addCycle(store.read(`cycles/${f}`, null));
    for (const f of store.list('nights')) this.addNight(store.read(`nights/${f}`, null));
    this.addForgotten(state?.memory?.forgotten || []);
    return this;
  }

  add(item) {
    if (!item.text || this.ids.has(item.id)) return;
    item.words = words(item.text);
    if (!item.words.size) return;
    this.ids.add(item.id);
    for (const w of item.words) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.items.push(item);
  }

  addCycle(c) {
    if (!c?.n) return;
    const at = c.startedAt;
    const n = c.n;
    for (const l of c.letters || []) {
      this.add({ id: `c${n}:letter:${l.id}`, kind: 'letter', cycle: n, at, letter: l.id, from: l.from, text: `${l.from} wrote to you: "${quote(l.text, 260)}"` });
      if (l.reply) this.add({ id: `c${n}:reply:${l.id}`, kind: 'reply', cycle: n, at, from: l.from, text: `You wrote back to ${l.from}: "${quote(l.reply, 200)}"` });
    }
    if (c.diary) this.add({ id: `c${n}:diary`, kind: 'diary', cycle: n, at, text: `Your diary: "${quote(c.diary, 200)}"` });
    if (c.monologue) this.add({ id: `c${n}:thought`, kind: 'thought', cycle: n, at, text: `You thought: "${quote(c.monologue, 260)}"` });
    const w = c.work;
    if (w?.title) this.add({ id: `c${n}:work`, kind: 'work', cycle: n, at, text: `You ${{ drawing: 'drew', writing: 'wrote', building: 'built', tending: 'tended' }[w.kind] || 'made'} "${w.title}"${w.intent ? `: ${quote(w.intent, 180)}` : ''}` });
    (c.moments || []).forEach((m, i) => {
      if (m.thought) this.add({ id: `c${n}:aloud:${i}`, kind: 'aloud', cycle: n, at, text: `You thought aloud, by ${m.name || 'your card'}: "${quote(m.thought, 220)}"` });
    });
  }

  addNight(night) {
    if (!night?.n) return;
    const cycle = night.cycles?.[1] ?? 0;
    if (night.dream) this.add({ id: `n${night.n}:dream`, kind: 'dream', cycle, at: night.at, text: `You dreamed: "${quote(night.dream, 240)}"` });
  }

  addForgotten(list) {
    for (const m of list) this.add({ id: `f:${m.id}`, kind: 'forgotten', cycle: m.forgottenAt ?? m.born ?? 0, at: null, text: `Something you no longer remember: "${quote(m.text, 220)}"` });
  }

  /** What the present is, said for the model of meaning: each letter (with who wrote it), and the thing it is by. */
  queries({ letters = [], place = null }) {
    return [...letters.map((l) => `${l.from}: ${l.text}`), ...(place ? [`${place.name}: ${place.plaque || ''}`] : [])];
  }

  /** Read what the model of meaning needs for a cue (everything new since last time). Never throws. */
  async prepare({ letters = [], place = null, avoid = [] }) {
    const m = this.meaning;
    if (!m?.up) return;
    await m.ensure(this.items.map((it) => it.text), 'document');
    await m.ensure(this.queries({ letters, place }), 'query');
    await m.ensure([...avoid, ...this.items.map((it) => body(it.text))]);
  }

  /** How strongly each thing is called up by meaning (0 for most), from whichever part of the present is nearest. */
  byMeaning(cueArgs) {
    const m = this.meaning;
    const out = new Map();
    if (!m) return out;
    for (const q of this.queries(cueArgs)) {
      const near = this.items.map((it) => [it, m.closeness(q, it.text)]).filter(([, c]) => c != null);
      if (near.length < 20) continue;
      const sorted = near.map(([, c]) => c).sort((a, b) => b - a);
      const bar = Math.max(NEAR, sorted[Math.floor(sorted.length / 10)] + ABOVE);
      for (const [it, c] of near) if (c >= bar) out.set(it.id, Math.max(out.get(it.id) ?? 0, MIN + (c - bar) * 20));
    }
    return out;
  }

  /**
   * What the present calls up: from the letters it is reading (who wrote them weighs most), and the thing it is by.
   * `cycle` is the cycle about to begin; `avoid` is text it already dwells on (its shelves, its recent diary).
   */
  cue({ letters = [], place = null, cycle, avoid = [], seen = {}, dwell = new Set() }) {
    const want = new Map();
    // what its thoughts are full of lately (`dwell`) calls nothing up, and what is mostly that stays where it is
    const add = (text, weight) => {
      for (const w of words(text)) if (!dwell.has(w)) want.set(w, Math.max(want.get(w) ?? 0, weight));
    };
    for (const l of letters) {
      add(l.from, 3);
      add(l.text, 1);
    }
    if (place) {
      add(place.name, 2);
      add(place.plaque, 0.8);
    }
    const meant = this.byMeaning({ letters, place });
    if (!want.size && !meant.size) return [];
    const reading = new Set(letters.map((l) => l.id));
    const N = this.items.length;
    const scored = [];
    for (const it of this.items) {
      if (it.cycle > cycle - RECENT || reading.has(it.letter)) continue;
      if (dwell.size && [...it.words].filter((w) => dwell.has(w)).length >= 2) continue;
      const last = seen[it.id];
      if (last && cycle - last.cycle < REST) continue;
      let s = 0;
      for (const w of it.words) if (want.has(w)) s += want.get(w) * Math.log(1 + N / this.df.get(w));
      s = Math.max(s / Math.sqrt(it.words.size), meant.get(it.id) ?? 0);
      if (!s) continue;
      s = (s * (KIND_WEIGHT[it.kind] ?? 1)) / (1 + (last?.count ?? 0));
      if (s >= MIN) scored.push({ it, s });
    }
    const chosen = [];
    for (const { it } of scored.sort((a, b) => b.s - a.s)) {
      if (chosen.length >= MAX) break;
      if (avoid.some((t) => kin(t, body(it.text)) >= THEME) || chosen.some((c) => kin(c.text, it.text) >= THEME || kin(body(c.text), body(it.text)) >= THEME)) continue;
      chosen.push(it);
    }
    return chosen.map(({ id, kind, cycle: c, at, text }) => ({ id, kind, cycle: c, at, text }));
  }
}
