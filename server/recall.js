// Recall. Everything it ever thought, read, said, dreamed and forgot stays on disk; its shelves hold only a few dozen
// memories. When something in the present calls one of the old things up (a letter from someone it has heard from
// before, the thing it is standing by), it comes back to it for one cycle, as a reminder: it is shown, not kept, and
// its shelves stay what they are unless it chooses to remember it again.
//
// What comes back is steered away from what it already dwells on: nothing it holds on its shelves, nothing it wrote in
// its diary lately, nothing from its last few cycles, nothing it was reminded of recently, and no two things alike.
// Letters and what it forgot come back a little more readily than its own musing.
import { THEME, kin, words } from './memory.js';

const MAX = 3; // things recalled in a cycle
const RECENT = 8; // its last cycles are not recalled: it has them already
const REST = 12; // cycles before the same thing can come back
const MIN = 1.5; // how strongly the present has to call something up
const KIND_WEIGHT = { letter: 1.5, reply: 1.3, forgotten: 1.3, work: 1, dream: 0.9, diary: 0.8, thought: 0.7, aloud: 0.7 };

const quote = (t, max) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export class Recall {
  constructor(life) {
    this.life = life;
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
    if (!want.size) return [];
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
      if (!s) continue;
      s = (s / Math.sqrt(it.words.size)) * (KIND_WEIGHT[it.kind] ?? 1) / (1 + (last?.count ?? 0));
      if (s >= MIN) scored.push({ it, s });
    }
    const chosen = [];
    for (const { it } of scored.sort((a, b) => b.s - a.s)) {
      if (chosen.length >= MAX) break;
      const body = it.text.replace(/^[^"]*"|"$/g, '');
      if (avoid.some((t) => kin(t, body) >= THEME) || chosen.some((c) => kin(c.text, it.text) >= THEME)) continue;
      chosen.push(it);
    }
    return chosen.map(({ id, kind, cycle: c, at, text }) => ({ id, kind, cycle: c, at, text }));
  }
}
