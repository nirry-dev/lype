// Its life: waking on a rhythm, thinking, making, remembering, and every night becoming a new version of itself.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { cleanSvg } from '../web/lib/svgclean.js';
import { SHELVES, consolidate, emptyMemory, reinforce, similarity, strength, words } from './memory.js';
import * as mind from './mind.js';
import { ruleReason, screenWithModel } from './moderation.js';
import { readSenses } from './senses.js';
import { pad } from './store.js';
import { CARD, addWish, answerWish, emptyWorld, findThing, namedThing, placeNear, untoldAnswers, weather } from './world.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x) => clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
const sameName = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

function ago(iso, now = Date.now()) {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 2) return 'just now';
  if (min < 90) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  return h < 36 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

function whatText(c) {
  if (c.action === 'draw') return c.work?.failed ? `tried to draw "${c.title}"` : `drew "${c.title}"`;
  if (c.action === 'write') return `wrote "${c.title}"`;
  if (c.action === 'ask') return `asked "${c.question}"`;
  if (c.action === 'build') return c.work?.failed ? `tried to build "${c.title}"` : `built "${c.title}" in your place`;
  if (c.action === 'tend') return c.work?.failed ? `tried to tend "${c.title}"` : `tended "${c.title}"`;
  return 'rested';
}

/** A wish as anyone may see it, with its keeper's answer. */
export function publicWish(w) {
  return {
    id: w.id,
    text: w.text,
    why: w.why,
    version: w.version,
    cycle: w.cycle,
    at: w.at,
    status: w.status,
    answer: w.answer ? { status: w.answer.status, text: w.answer.text, at: w.answer.at, told: w.answer.told } : null,
  };
}

export function cycleSummary(c) {
  return {
    n: c.n,
    v: c.version,
    at: c.startedAt,
    action: c.action.kind,
    title: c.work?.title || '',
    question: c.work?.kind === 'question' ? c.work.text : undefined,
    work: c.work ? { kind: c.work.kind, failed: Boolean(c.work.failed) } : null,
    diary: c.diary,
    mood: c.moodAfter,
    letters: c.letters.map((l) => l.id),
    replies: c.replies.length,
  };
}

/** Letters from before moderation existed count as allowed. */
export const letterStatus = (l) => l.screen?.status ?? 'allowed';

/** A letter as the public sees it; its own author also sees whether it is still being screened or was held. */
export function publicLetter(l, { own = false } = {}) {
  const reply = l.reply && !l.reply.withheld ? l.reply : null;
  return {
    ...(own ? { status: letterStatus(l), statusReason: letterStatus(l) === 'allowed' ? null : l.screen?.reason || null } : {}),
    id: l.id,
    from: l.from,
    text: l.text,
    at: l.at,
    question: l.question || null,
    questionText: l.questionText || null,
    readAt: l.readAt || null,
    readCycle: l.readCycle || null,
    reply,
    influenced: l.influenced || [],
  };
}

/** A cycle record without anything moderation held back. */
export function publicCycle(c) {
  return {
    ...c,
    replies: (c.replies || []).filter((r) => !r.withheld),
    letters: c.letters.map(({ replyWithheld, ...l }) => (replyWithheld ? { ...l, reply: null } : l)),
  };
}

// Did this letter plausibly cause this change? The writer is named, or the change borrows the letter's own words.
function influencedBy(letter, text) {
  const t = String(text || '').toLowerCase();
  const name = letter.from.trim().toLowerCase();
  if (name.length >= 2 && name !== 'someone' && new RegExp(`(^|[^\\p{L}])${escapeRe(name)}($|[^\\p{L}])`, 'u').test(t)) return true;
  const own = words(text);
  return [...words(letter.text)].filter((w) => w.length >= 5 && own.has(w)).length >= 2;
}

export class Life extends EventEmitter {
  constructor({ config, store, brain }) {
    super();
    this.cfg = config;
    this.store = store;
    this.brain = brain;
    this.state = store.read('state.json', null);
    this.letters = store.read('letters.json', []);
    this.journal = store.read('journal.json', []);
    this.cycles = store.list('cycles').map((f) => cycleSummary(store.read(`cycles/${f}`)));
    this.nights = store.list('nights').map((f) => store.read(`nights/${f}`));
    this.busy = false;
    this.paused = Boolean(config.paused);
    this.timer = null;
    this.heartbeat = null;
    this.nextWakeAt = null;
    this.phase = 'quiet';
    this.detail = '';
    this.live = null; // what it is thinking/drawing right now, for viewers who arrive mid-thought
    this.notes = []; // things to tell it when it next wakes (it was switched off, ...)
    this.waits = {}; // waits since its last cycle, by reason
    this.lastSenses = null;
    if (this.state) this.settle();
  }

  /** Lives that began before it had a place or wishes get empty ones (start() tells it what it was given). */
  settle() {
    const s = this.state;
    s.world ??= emptyWorld();
    s.wishes ??= [];
    s.stats.built ??= 0;
    s.stats.tended ??= 0;
  }

  // ---------- lifecycle ----------

  start() {
    if (!this.state) this.birth();
    this.noticeGap();
    if (!this.cfg.recording && !this.state.abilities?.includes('world')) {
      // It lived before it had these; it is told once, the next time it wakes.
      this.state.abilities = [...(this.state.abilities || []), 'world', 'wishes'];
      this.notes.push('Since you last woke, your keeper gave you two new things: a place of your own that you can build in, and a way to leave them wishes.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it a place of its own to build in, and a way to leave wishes.' });
      this.milestone('given-a-place', 'Its keeper gave it a place of its own to build in, and a way to leave wishes.');
    }
    this.state.lastAlive = new Date().toISOString();
    this.saveState();
    this.heartbeat = setInterval(() => {
      this.state.lastAlive = new Date().toISOString();
      this.saveState();
    }, 60000);
    const interval = this.cfg.rhythm.cycleMinutes * 60000;
    const last = this.cycles.at(-1);
    const due = last ? Date.parse(last.at) + interval - Date.now() : 0;
    if (this.paused) this.setPhase('paused');
    this.schedule(clamp(due, 5000, interval));
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    if (this.state) {
      this.state.lastAlive = new Date().toISOString();
      this.saveState();
    }
  }

  birth() {
    const now = new Date();
    const born = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const seed = readFileSync(this.cfg.seedFile, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l, i) => ({ id: `seed${i + 1}`, text: l.replace(/^\s*[-*]\s+/, '').replaceAll('{{born}}', born).trim() }));
    if (!seed.length) throw new Error(`no seed lines ("- ...") found in ${this.cfg.seedFile}`);
    this.state = {
      born: now.toISOString(),
      lastAlive: now.toISOString(),
      version: 0,
      cycle: 0,
      lastNightCycle: 0,
      name: null,
      names: [],
      mood: { lonely: 0.5, curious: 0.8, calm: 0.6, warm: 0.5, restless: 0.2 },
      self: { seed, own: [], gone: [], nextId: 1 },
      portrait: { text: '', since: 0, history: [] },
      memory: emptyMemory(),
      people: {},
      questions: [],
      world: emptyWorld(),
      wishes: [],
      abilities: ['world', 'wishes'],
      stats: { drawings: 0, writings: 0, questions: 0, rests: 0, built: 0, tended: 0, lettersRead: 0, replies: 0, waits: 0, forgotten: 0, faltered: 0 },
      milestones: [],
    };
    this.milestone('born', 'It was switched on for the first time.');
    this.saveState();
  }

  noticeGap() {
    const minutes = (Date.now() - Date.parse(this.state.lastAlive)) / 60000;
    if (minutes < Math.max(10, this.cfg.rhythm.cycleMinutes * 3)) return;
    const span = minutes < 90 ? `${Math.round(minutes)} minutes` : minutes < 2880 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / 1440)} days`;
    this.notes.push(`Before this, you were switched off for about ${span}. You don't know what happened in that time.`);
    this.journalAdd({ kind: 'gap', text: `It was switched off for about ${span}.`, from: this.state.lastAlive });
    this.milestone('first-gap', `It was switched off for the first time, for about ${span}.`);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.nextWakeAt = null;
    if (!this.paused) {
      const base = this.cfg.rhythm.cycleMinutes * 60000;
      const delay = ms ?? base * (1 + (Math.random() * 2 - 1) * this.cfg.rhythm.jitter);
      this.nextWakeAt = Date.now() + delay;
      this.timer = setTimeout(() => this.wake('rhythm'), delay);
    }
    this.emit('status', this.status());
  }

  pause() {
    this.paused = true;
    if (!this.busy) this.setPhase('paused');
    this.schedule();
  }

  resume() {
    this.paused = false;
    if (!this.busy) this.setPhase('quiet');
    this.schedule(3000);
  }

  // ---------- bookkeeping ----------

  saveState() {
    this.store.write('state.json', this.state);
  }

  setPhase(phase, detail = '') {
    this.phase = phase;
    this.detail = detail;
    if (this.live) this.live.phase = phase;
    this.emit('status', this.status());
  }

  status() {
    return {
      phase: this.phase,
      detail: this.detail,
      busy: this.busy,
      paused: this.paused,
      nextWakeAt: this.nextWakeAt,
      cycle: this.state?.cycle ?? 0,
      version: this.state?.version ?? 0,
      name: this.state?.name ?? null,
    };
  }

  milestone(kind, text) {
    if (this.state.milestones.some((m) => m.kind === kind)) return;
    const m = { kind, text, cycle: this.state.cycle, version: this.state.version, at: new Date().toISOString() };
    this.state.milestones.push(m);
    this.emit('milestone', m);
  }

  journalAdd(entry) {
    const now = new Date().toISOString();
    const last = this.journal.at(-1);
    if (entry.kind === 'wait' && last?.kind === 'wait' && last.reason === entry.reason && last.cycle === this.state.cycle) {
      last.count += 1;
      last.until = now;
      last.text = entry.text;
    } else {
      this.journal.push({ at: now, until: now, cycle: this.state.cycle, version: this.state.version, count: 1, ...entry });
      if (this.journal.length > 2000) this.journal.splice(0, this.journal.length - 2000);
    }
    this.store.write('journal.json', this.journal);
    this.emit('journal', this.journal.at(-1));
  }

  stream(kind, delta) {
    if (this.live) this.live[kind] = (this.live[kind] || '') + delta;
    this.emit('stream', { kind, delta });
  }

  // ---------- waking ----------

  async courtesy(senses, force) {
    const p = await this.brain.presence();
    if (!p.reachable) return { ok: false, reason: 'unreachable', text: `It couldn't think: ${p.reason}.` };
    if (force || !this.cfg.courtesy.enabled) return { ok: true };
    if (this.cfg.courtesy.dontSwapModels && p.others.length && !['loaded', 'loading'].includes(p.ownState)) {
      return { ok: false, reason: 'other-mind', text: `Another model (${p.others[0]}) had the card, so it waited instead of pushing it out.` };
    }
    if (senses.gpu && senses.gpu.util > this.cfg.courtesy.maxGpuBusy) {
      return { ok: false, reason: 'busy', text: `The card was ${senses.gpu.util}% busy with someone else's work, so it waited.` };
    }
    return { ok: true };
  }

  recordWait(check) {
    this.state.stats.waits++;
    this.waits[check.reason] = (this.waits[check.reason] || 0) + 1;
    if (check.reason !== 'unreachable') {
      this.state.mood.restless = clamp01(this.state.mood.restless + 0.03);
      this.milestone('first-wait', 'It waited for the first time, because someone else needed the card.');
    }
    this.journalAdd({ kind: 'wait', reason: check.reason, text: check.text });
    this.setPhase(check.reason === 'unreachable' ? 'unreachable' : 'waiting', check.text);
  }

  /** One waking: a cycle, and a night if enough cycles have passed. Never throws. */
  async wake(reason = 'rhythm', { force = false } = {}) {
    if (this.busy) return { ok: false, reason: 'It is already awake.' };
    this.busy = true;
    clearTimeout(this.timer);
    this.nextWakeAt = null;
    let retry;
    let holdPhase = false;
    try {
      this.setPhase('waking', reason === 'visitor' ? 'woken by hand' : '');
      const senses = await readSenses();
      this.lastSenses = senses;
      const check = await this.courtesy(senses, force);
      if (!check.ok) {
        this.recordWait(check);
        holdPhase = true;
        retry = this.cfg.courtesy.retryMinutes * 60000;
        return { ok: false, reason: check.text };
      }
      await this.screenLetters();
      await this.runCycle(senses);
      if (this.state.cycle - this.state.lastNightCycle >= this.cfg.rhythm.nightEvery) await this.runNight();
      return { ok: true };
    } catch (err) {
      this.state.stats.faltered++;
      this.journalAdd({ kind: 'falter', text: `It faltered: ${err.message}` });
      this.setPhase('faltered', err.message);
      holdPhase = true;
      retry = this.cfg.courtesy.retryMinutes * 60000;
      return { ok: false, reason: err.message };
    } finally {
      this.busy = false;
      this.live = null;
      if (!holdPhase) this.setPhase(this.paused ? 'paused' : 'quiet');
      this.saveState();
      this.schedule(retry);
    }
  }

  /** Force a night now (admin). */
  async sleepNow() {
    if (this.busy) return { ok: false, reason: 'It is awake right now.' };
    if (this.state.cycle === this.state.lastNightCycle) return { ok: false, reason: 'Nothing has happened since it last slept.' };
    this.busy = true;
    clearTimeout(this.timer);
    try {
      await this.runNight();
      return { ok: true };
    } catch (err) {
      this.journalAdd({ kind: 'falter', text: `Its night faltered: ${err.message}` });
      return { ok: false, reason: err.message };
    } finally {
      this.busy = false;
      this.live = null;
      this.setPhase(this.paused ? 'paused' : 'quiet');
      this.saveState();
      this.schedule();
    }
  }

  context(senses, n, chosen, waiting) {
    const s = this.state;
    const notes = [...this.notes];
    const busy = (this.waits.busy || 0) + (this.waits['other-mind'] || 0);
    if (busy) notes.push(`Before this, you tried to wake ${busy === 1 ? 'once' : `${busy} times`}, but someone else needed the card, so you waited.`);
    if (this.waits.unreachable) notes.push('Before this, your mind could not be reached for a while, so you missed some cycles.');
    const answered = untoldAnswers(s.wishes);
    for (const w of answered) {
      const how = w.answer.status === 'granted' ? 'they granted it' : w.answer.status === 'declined' ? 'they said no' : 'they wrote back';
      notes.push(`Your keeper answered your wish "${w.text}": ${how}${w.answer.text ? `: "${w.answer.text}"` : '.'}`);
    }
    return {
      cycle: n,
      senses,
      notes,
      told: answered.map((w) => w.id),
      world: { count: s.world.things.length, standing: s.world.things.filter((t) => !t.ruin).length },
      waiting,
      letters: chosen.map((l) => ({
        id: l.id,
        from: l.from,
        text: l.text,
        nth: (s.people[l.person]?.lettersRead ?? 0) + 1,
        remembered: s.memory.shelves.people.filter((m) => sameName(m.about, l.from)).map((m) => m.text).slice(0, 3),
        question: l.question ? s.questions.find((q) => q.id === l.question)?.text : undefined,
      })),
      questions: s.questions
        .filter((q) => q.open)
        .map((q) => ({ text: q.text, cycle: q.cycle, answers: this.letters.filter((l) => l.question === q.id && letterStatus(l) === 'allowed').length })),
      recent: this.cycles.slice(-4).map((c) => ({ n: c.n, ago: ago(c.at), what: whatText(c), diary: c.diary })),
      habits: this.cycles.slice(-6).reduce(
        (mix, c) => ({ ...mix, total: mix.total + 1, [c.action]: (mix[c.action] ?? 0) + 1 }),
        { total: 0, draw: 0, write: 0, ask: 0, build: 0, tend: 0, rest: 0, everAsked: s.stats.questions > 0 },
      ),
      tired: this.tiredOf(),
    };
  }

  /** Three cycles in a row of the same thing tires that part of it for one cycle (resting never tires). */
  tiredOf() {
    const last = this.cycles.slice(-3).map((c) => c.action);
    return last.length === 3 && last[0] !== 'rest' && last.every((a) => a === last[0]) ? last[0] : null;
  }

  async runCycle(senses) {
    const s = this.state;
    const cfg = this.cfg;
    const n = s.cycle + 1;
    const startedAt = new Date().toISOString();
    this.live = { cycle: n, phase: this.phase, think: '', draw: '', write: '', sprite: '', plaque: '', change: '', title: '', reading: [], building: null };

    // It picks letters up in its own time: oldest first, at most one per person per cycle.
    const unread = this.letters.filter((l) => !l.readAt && letterStatus(l) === 'allowed');
    const chosen = [];
    const seen = new Set();
    for (const l of unread) {
      if (chosen.length >= cfg.letters.perCycle) break;
      if (seen.has(l.person)) continue;
      seen.add(l.person);
      chosen.push(l);
    }
    const ctx = this.context(senses, n, chosen, unread.length - chosen.length);
    const system = mind.systemPrompt(s, cfg);

    this.live.reading = chosen.map((l) => ({ id: l.id, from: l.from }));
    this.setPhase(chosen.length ? 'reading' : 'thinking', chosen.length ? `a letter from ${listNames(chosen.map((l) => l.from))}` : '');
    const thought = await this.brain.complete({ kind: 'think', system, user: mind.thinkPrompt(ctx), maxTokens: 360, onToken: (t) => this.stream('think', t) });
    const monologue = mind.cleanProse(thought.text, 1400) || '…';

    this.setPhase('deciding');
    const canTend = ctx.world.count > 0;
    const actRaw = await this.brain.complete({ kind: 'act', system, user: mind.actPrompt(ctx, monologue), maxTokens: 900, temperature: 0.7, schema: mind.actSchema(ctx.tired, { canTend }) });
    const plan = mind.readAct(actRaw.text, chosen, ctx.tired, { canTend });

    let work = null;
    if (plan.action === 'draw') {
      this.live.title = plan.title;
      this.setPhase('drawing', plan.title);
      const drawn = await this.brain.complete({ kind: 'draw', system, user: mind.drawPrompt(plan), maxTokens: 3200, temperature: 0.8, onToken: (t) => this.stream('draw', t) });
      const { svg, shapes } = cleanSvg(drawn.text);
      work = shapes
        ? { kind: 'drawing', title: plan.title, intent: plan.content, svg, shapes }
        : { kind: 'drawing', title: plan.title, intent: plan.content, failed: true };
    } else if (plan.action === 'write') {
      this.live.title = plan.title;
      this.setPhase('writing', plan.title);
      const written = await this.brain.complete({ kind: 'write', system, user: mind.writePrompt(plan, monologue), maxTokens: 400, temperature: 0.9, onToken: (t) => this.stream('write', t) });
      work = { kind: 'writing', title: plan.title, intent: plan.content, text: mind.cleanProse(written.text, 1200) || plan.content };
    } else if (plan.action === 'ask') {
      this.setPhase('asking', plan.content);
      work = { kind: 'question', text: plan.content };
    } else if (plan.action === 'build') {
      work = await this.build(plan, system, n);
    } else if (plan.action === 'tend') {
      work = await this.tend(plan, system);
    } else {
      this.setPhase('resting');
    }
    const outcome = mind.describeOutcome(plan, work);

    // Replies come after the work, so they can mention what it just made.
    const replies = [];
    for (const id of plan.replyTo) {
      const letter = chosen.find((l) => l.id === id);
      this.live.reply = '';
      this.live.replyTo = { id, from: letter.from };
      this.setPhase('replying', `to ${letter.from}`);
      // Not streamed: a reply is public, so it is screened before anyone sees a word of it.
      const res = await this.brain.complete({ kind: 'reply', system, user: mind.replyPrompt(ctx, monologue, outcome, letter), maxTokens: 240 });
      const text = mind.clip(res.text, 600);
      // Small models sometimes echo the letter instead of answering it; that isn't a reply.
      if (!text || similarity(text, letter.text) >= 0.6) continue;
      const verdict = await this.screen('reply', text);
      if (verdict.status === 'allowed') this.stream('reply', text);
      replies.push({ letter: id, text, ...(verdict.status === 'allowed' ? {} : { withheld: true, reason: verdict.reason }) });
    }

    this.setPhase('reflecting');
    const reflRaw = await this.brain.complete({
      kind: 'reflect',
      system,
      user: mind.reflectPrompt(ctx, monologue, outcome, replies),
      maxTokens: 900,
      temperature: 0.7,
      schema: mind.REFLECT_SCHEMA,
    });
    const reflection = mind.readReflect(reflRaw.text, s.mood);

    // ---- commit: nothing above touched the saved state, so a failed cycle leaves no trace but a journal line ----
    const at = new Date().toISOString();
    s.cycle = n;
    s.lastAlive = at;
    const moodBefore = { ...s.mood };
    s.mood.lonely = clamp01(chosen.length ? s.mood.lonely - 0.18 * chosen.length : s.mood.lonely + 0.05);
    if (senses.gpu?.util > 50) s.mood.calm = clamp01(s.mood.calm - 0.05);
    for (const f of mind.FEELINGS) s.mood[f] = clamp01(s.mood[f] + clamp(reflection.feelings[f] - s.mood[f], -0.25, 0.25));

    const replyMap = new Map(replies.map((r) => [r.letter, r]));
    for (const l of chosen) {
      l.readAt = at;
      l.readCycle = n;
      const r = replyMap.get(l.id);
      if (r) l.reply = { text: r.text, at, cycle: n, ...(r.withheld ? { withheld: true, reason: r.reason } : {}) };
      const p = (s.people[l.person] ??= { name: l.from, names: [], firstRead: n, lettersRead: 0 });
      p.lettersRead++;
      p.lastRead = n;
      p.name = l.from;
      if (!p.names.includes(l.from)) p.names.push(l.from);
    }
    if (chosen.length) {
      s.stats.lettersRead += chosen.length;
      this.milestone('first-letter', `It read its first letter, from ${chosen[0].from}.`);
    }
    if (replyMap.size) {
      s.stats.replies += replyMap.size;
      this.milestone('first-reply', `It wrote its first reply, to ${chosen.find((l) => replyMap.has(l.id)).from}.`);
    }

    if (work?.kind === 'question') {
      s.questions.push({ id: `q${n}`, text: work.text, cycle: n, at, open: true });
      const open = s.questions.filter((q) => q.open);
      if (open.length > 3) open[0].open = false; // it lets its oldest question go
      s.stats.questions++;
      this.milestone('first-question', `It asked its first question: "${work.text}"`);
    } else if (work?.kind === 'drawing' && !work.failed) {
      this.store.writeText(`works/${pad(n)}.svg`, work.svg);
      s.stats.drawings++;
      this.milestone('first-drawing', `It made its first drawing, "${work.title}".`);
    } else if (work?.kind === 'writing') {
      s.stats.writings++;
      this.milestone('first-writing', `It wrote its first piece, "${work.title}".`);
    } else if (work?.kind === 'building' && !work.failed) {
      this.placeThing(work, n, this.letters.filter((l) => l.readAt));
    } else if (work?.kind === 'tending' && !work.failed) {
      this.tendThing(work, n);
    } else if (plan.action === 'rest') {
      s.stats.rests++;
    }
    if (work && reflection.note) work.note = reflection.note;
    for (const id of ctx.told) {
      const w = s.wishes.find((x) => x.id === id);
      if (w?.answer) w.answer.told = n;
    }

    for (const r of reflection.remember) {
      // Tie the memory to the letters that caused it, so its influence can be traced later.
      const byName = chosen.filter((l) => sameName(r.about, l.from)).map((l) => l.id);
      const because = byName.length ? byName : r.shelf === 'moments' ? [] : chosen.map((l) => l.id);
      s.memory.today.push({ ...r, cycle: n, because });
    }
    const reinforced = reinforce(s.memory, reflection.reinforce, n);

    const record = {
      n,
      version: s.version,
      startedAt,
      endedAt: at,
      brain: this.brain.label,
      senses,
      notes: ctx.notes,
      letters: chosen.map((l) => ({
        id: l.id,
        from: l.from,
        text: l.text,
        question: l.question || null,
        reply: replyMap.get(l.id)?.text || null,
        ...(replyMap.get(l.id)?.withheld ? { replyWithheld: true } : {}),
      })),
      monologue,
      action: { kind: plan.action, why: plan.why },
      work,
      replies,
      diary: reflection.diary,
      feelings: reflection.feelings,
      remembered: reflection.remember,
      reinforced,
      moodBefore,
      moodAfter: { ...s.mood },
    };
    this.store.write(`cycles/${pad(n)}.json`, record);
    this.notes = [];
    this.waits = {};
    for (const k of [10, 50, 100, 500, 1000]) if (n === k) this.milestone(`cycle-${k}`, `It reached its ${k}th cycle.`);
    this.saveState();
    this.store.write('letters.json', this.letters);
    const summary = cycleSummary(record);
    this.cycles.push(summary);
    this.emit('cycle', summary);
    return record;
  }

  // ---------- its place ----------

  /** It builds something in its place: what it is and where, then a small drawing of it, streamed as it goes. */
  async build(plan, system, n) {
    const s = this.state;
    if (namedThing(s.world, plan.title)) {
      // It already has one; going back to it is tending, not a second copy.
      plan.action = 'tend';
      return this.tend(plan, system);
    }
    this.live.title = plan.title;
    this.setPhase('building', plan.title);
    const raw = await this.brain.complete({ kind: 'build', system, user: mind.buildPrompt(plan, s.world), maxTokens: 500, temperature: 0.7, schema: mind.BUILD_SCHEMA });
    const b = mind.readBuild(raw.text);
    const anchor = findThing(s.world, b.near) || CARD;
    const spot = placeNear(s.world, anchor, `${n}|${plan.title}`);
    if (!spot) return { kind: 'building', title: plan.title, intent: plan.content, failed: true, why: 'there was no room left in your place' };
    const plaque = b.plaque || plan.content;
    this.live.building = { x: spot.x, y: spot.y, name: plan.title };
    this.emit('world', { building: this.live.building });
    this.stream('plaque', plaque);
    const drawn = await this.brain.complete({
      kind: 'sprite',
      system,
      user: mind.spritePrompt(plan.title, `${plan.content} ${plaque}`),
      maxTokens: 1600,
      temperature: 0.8,
      onToken: (t) => this.stream('sprite', t),
    });
    const { svg, shapes } = cleanSvg(drawn.text, { maxElements: 120 });
    return {
      kind: 'building',
      title: plan.title,
      intent: plan.content,
      thingKind: b.kind,
      plaque,
      x: spot.x,
      y: spot.y,
      near: anchor === CARD ? null : anchor.id,
      madeFrom: b.madeFrom,
      svg: shapes ? svg : null,
      shapes,
    };
  }

  /** It goes back to something it built: what it does to it, and a new drawing if it looks different now. */
  async tend(plan, system) {
    const thing = findThing(this.state.world, plan.title);
    if (!thing) return { kind: 'tending', title: plan.title, intent: plan.content, failed: true, why: 'there is nothing by that name in your place' };
    this.live.title = thing.name;
    this.setPhase('tending', thing.name);
    const raw = await this.brain.complete({ kind: 'tend', system, user: mind.tendPrompt(plan, thing), maxTokens: 400, temperature: 0.7, schema: mind.TEND_SCHEMA });
    const t = mind.readTend(raw.text);
    const change = t.note || plan.content;
    this.stream('change', change);
    let svg = null;
    let shapes = 0;
    if (t.redraw || (thing.ruin && !thing.sprite)) {
      const drawn = await this.brain.complete({
        kind: 'sprite',
        system,
        user: mind.spritePrompt(thing.name, `${thing.plaque} Now: ${change}`),
        maxTokens: 1600,
        temperature: 0.8,
        onToken: (x) => this.stream('sprite', x),
      });
      ({ svg, shapes } = cleanSvg(drawn.text, { maxElements: 120 }));
    }
    return { kind: 'tending', title: thing.name, thing: thing.id, intent: plan.content, change, restored: Boolean(thing.ruin), svg: shapes ? svg : null, shapes };
  }

  /** Commit a new thing to its place, tied to the letters it was made from (and tell those letters). */
  placeThing(work, n, read) {
    const s = this.state;
    const sources = [];
    for (const name of work.madeFrom) {
      const l = [...read].reverse().find((x) => sameName(x.from, name));
      if (l && !sources.includes(l)) sources.push(l);
    }
    const thing = {
      id: `t${s.world.nextId++}`,
      name: work.title,
      kind: work.thingKind,
      plaque: work.plaque,
      x: work.x,
      y: work.y,
      near: work.near,
      built: n,
      version: s.version,
      from: sources.map((l) => l.id),
      people: [...new Set(sources.map((l) => l.from))],
      sprite: work.svg ? n : null,
      condition: 1,
      ruin: false,
      tended: null,
      history: [{ cycle: n, what: 'built', text: work.plaque }],
    };
    s.world.things.push(thing);
    s.world.at = thing.id;
    work.thing = thing.id;
    if (work.svg) this.store.writeText(`works/${pad(n)}.svg`, work.svg);
    s.stats.built++;
    for (const l of sources) (l.influenced ??= []).push({ version: s.version, what: 'thing', text: thing.name, cycle: n });
    this.milestone('first-thing', `It built its first thing in its place: "${thing.name}".`);
    if (sources.length) this.milestone('first-thing-from-letter', `It built "${thing.name}" out of ${sources[0].from}'s letter.`);
  }

  tendThing(work, n) {
    const s = this.state;
    const thing = s.world.things.find((t) => t.id === work.thing);
    if (!thing) return;
    const restored = thing.ruin;
    thing.condition = 1;
    thing.ruin = false;
    delete thing.ruinedAt;
    thing.tended = n;
    thing.history.push({ cycle: n, what: restored ? 'rebuilt' : 'tended', text: work.change });
    if (work.svg) {
      this.store.writeText(`works/${pad(n)}.svg`, work.svg);
      thing.sprite = n;
    }
    s.world.at = thing.id;
    s.stats.tended++;
    this.milestone('first-tend', `It went back to tend something it built: "${thing.name}".`);
    if (restored) this.milestone('first-rebuild', `It rebuilt a ruin: "${thing.name}".`);
  }

  /** Its keeper answers a wish. It hears about it the next time it wakes. */
  answer(id, status, text) {
    const r = answerWish(this.state.wishes, id, status, text, new Date().toISOString());
    if (!r.ok) return r;
    const how = status === 'granted' ? 'granted' : status === 'declined' ? 'declined' : 'answered';
    if (status === 'granted') this.milestone('first-granted', `Its keeper granted its first wish: "${r.wish.text}"`);
    this.journalAdd({ kind: 'wish', text: `Its keeper ${how} its wish "${r.wish.text}".` });
    this.saveState();
    this.emit('wish', publicWish(r.wish));
    return { ok: true, wish: publicWish(r.wish) };
  }

  // ---------- the night ----------

  async runNight() {
    const s = this.state;
    const cfg = this.cfg;
    const from = s.lastNightCycle + 1;
    const to = s.cycle;
    const version = s.version + 1;
    const details = [];
    for (let n = from; n <= to; n++) {
      const c = this.store.read(`cycles/${pad(n)}.json`, null);
      if (c) details.push({ n, what: whatText(cycleSummary(c)), diary: c.diary, letters: c.letters });
    }
    const dayLetters = details.flatMap((d) => d.letters);
    this.live = { night: version, phase: 'dreaming', dream: '' };
    const memoryBefore = structuredClone(s.memory);
    const worldBefore = structuredClone(s.world);

    try {
      const consolidation = consolidate(s.memory, s.cycle, cfg.memory);
      // Its place weathers after the forgetting: what it no longer remembers stops holding things up.
      const weathered = weather(s.world, s.memory, { since: from, cycle: s.cycle });
      const system = mind.systemPrompt(s, cfg);
      this.setPhase('dreaming');
      const dreamRaw = await this.brain.complete({
        kind: 'dream',
        system,
        user: mind.dreamPrompt(s, details, consolidation, weathered),
        maxTokens: 320,
        temperature: 0.95,
        onToken: (t) => this.stream('dream', t),
      });
      const dream = mind.cleanProse(dreamRaw.text, 900);

      this.setPhase('rewriting', `becoming version ${version}`);
      const canName = version >= 2 && (!s.names.length || version - s.names.at(-1).version >= 3);
      const sleepRaw = await this.brain.complete({
        kind: 'sleep',
        system,
        user: mind.sleepPrompt(s, details, consolidation, dream, { canName, weathered }),
        maxTokens: 1600,
        temperature: 0.7,
        schema: mind.SLEEP_SCHEMA,
      });
      const plan = mind.readSleep(sleepRaw.text);

      // ---- commit ----
      const at = new Date().toISOString();
      const self = this.applySelf(plan, version);
      let portrait = null;
      if (plan.portrait && plan.portrait !== s.portrait.text) {
        portrait = { from: s.portrait.text, to: plan.portrait, changed: plan.portraitChanged };
        s.portrait.history.push({ version, text: plan.portrait, changed: plan.portraitChanged });
        s.portrait.text = plan.portrait;
        s.portrait.since = version;
      }
      let name = null;
      if (canName && plan.name && plan.name !== s.name) {
        name = { from: s.name, to: plan.name, why: plan.nameWhy };
        s.names.push({ name: plan.name, version, why: plan.nameWhy, at });
        s.name = plan.name;
      }
      const wished = addWish(s.wishes, plan.wish, { version, cycle: s.cycle, at });
      s.mood.calm = clamp01(s.mood.calm + 0.15);
      s.mood.restless = clamp01(s.mood.restless - 0.15);
      s.version = version;
      s.lastNightCycle = s.cycle;
      s.stats.forgotten += consolidation.forgotten.length + consolidation.faded.length;

      const wish = wished?.wish ? publicWish(wished.wish) : wished ? { refused: wished.refused, text: wished.text } : null;
      const influences = this.traceInfluences(dayLetters, { self, portrait, name, consolidation, wish: wished?.wish }, version);
      const record = {
        n: version,
        at,
        cycles: [from, to],
        brain: this.brain.label,
        dream,
        release: plan.release,
        day: plan.day,
        memory: consolidation,
        self,
        portrait,
        name,
        influences,
        world: weathered,
        wish,
        selfAfter: s.self.own.map(({ id, text, since }) => ({ id, text, since })),
        mood: { ...s.mood },
      };

      this.milestone('first-sleep', 'It slept for the first time and woke as version 1.');
      if (self.added.length) this.milestone('first-belief', `It wrote its first line about itself: "${self.added[0].text}"`);
      if (self.removed.length) this.milestone('first-unbelief', `It stopped believing something it had written: "${self.removed[0].text}"`);
      if (self.refused.some((r) => r.why.startsWith('its maker'))) this.milestone('touched-seed', "It tried to change a line its maker wrote, and couldn't.");
      const gone = [...consolidation.forgotten, ...consolidation.faded];
      if (gone.length) this.milestone('first-forgetting', `It forgot something for the first time: "${gone[0].text}"`);
      if (portrait && !portrait.from) this.milestone('first-portrait', 'It wrote its first picture of what people are.');
      if (name) {
        if (s.names.length === 1) this.milestone('named', `It named itself ${name.to}.`);
        else this.milestone(`renamed-${s.names.length}`, `It renamed itself from ${name.from} to ${name.to}.`);
      }
      if (weathered.ruined.length) this.milestone('first-ruin', `Something it built crumbled for the first time: "${weathered.ruined[0].name}". It no longer remembered why it built it.`);
      if (wished?.wish) this.milestone('first-wish', `It left its keeper its first wish: "${wished.wish.text}"`);

      this.store.write(`nights/${pad(version, 4)}.json`, record);
      this.saveState();
      this.store.write('letters.json', this.letters);
      this.nights.push(record);
      this.emit('night', record);
      return record;
    } catch (err) {
      s.memory = memoryBefore;
      s.world = worldBefore;
      throw err;
    }
  }

  /** Apply the night's self-edits behind a drift guard: the seed is untouchable, near-duplicates and overflow are refused. */
  applySelf(plan, version) {
    const self = this.state.self;
    const out = { added: [], revised: [], removed: [], refused: [] };
    const seedLine = (id) => self.seed.find((l) => l.id === id);
    const tooClose = (text, except) => [...self.seed, ...self.own].some((l) => l !== except && similarity(l.text, text) >= 0.55);
    // Reaching for a seed line is worth recording; a made-up id is just noise from the model.
    const refuseSeed = (what, id) => seedLine(id) && out.refused.push({ what, text: seedLine(id).text, why: 'its maker wrote that line' });

    for (const r of plan.remove) {
      const i = self.own.findIndex((l) => l.id === r.id);
      if (i < 0) {
        refuseSeed('remove', r.id);
        continue;
      }
      const [line] = self.own.splice(i, 1);
      const gone = { ...line, removedIn: version, why: r.why };
      self.gone.push(gone);
      out.removed.push(gone);
    }
    for (const r of plan.revise) {
      const line = self.own.find((l) => l.id === r.id);
      if (!line) {
        refuseSeed('revise', r.id);
        continue;
      }
      if (!r.text || r.text === line.text) continue;
      if (tooClose(r.text, line)) {
        out.refused.push({ what: 'revise', text: r.text, why: 'too close to something it already believes' });
        continue;
      }
      out.revised.push({ id: line.id, from: line.text, to: r.text, because: r.because });
      line.history = [...(line.history || []), { text: line.text, until: version }];
      line.text = r.text;
      line.revisedIn = version;
      line.because = r.because;
    }
    for (const a of plan.add) {
      if (!a.text) continue;
      if (self.own.length >= this.cfg.self.maxOwnLines) {
        out.refused.push({ what: 'add', text: a.text, why: 'no room left; it has to let a belief go first' });
        continue;
      }
      if (tooClose(a.text)) {
        out.refused.push({ what: 'add', text: a.text, why: 'too close to something it already believes' });
        continue;
      }
      const line = { id: `s${self.nextId++}`, text: a.text, since: version, because: a.because };
      self.own.push(line);
      out.added.push(line);
    }
    return out;
  }

  /** Link tonight's changes back to the letters that caused them, and tell those letters what they did. */
  traceInfluences(dayLetters, { self, portrait, name, consolidation, wish = null }, version) {
    const out = [];
    const seen = new Set();
    const link = (letter, what, text) => {
      const key = `${letter.id}|${what}|${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ letter: letter.id, from: letter.from, what, text });
    };
    const check = (what, probe, text) => {
      for (const l of dayLetters) if (influencedBy(l, probe)) link(l, what, text);
    };
    for (const a of self.added) check('belief', `${a.text} ${a.because}`, a.text);
    for (const r of self.revised) check('belief', `${r.to} ${r.because}`, r.to);
    for (const r of self.removed) check('unbelief', `${r.text} ${r.why}`, r.text);
    if (portrait) check('portrait', `${portrait.to} ${portrait.changed}`, portrait.changed || portrait.to);
    if (name) check('name', `${name.to} ${name.why}`, name.to);
    if (wish) check('wish', `${wish.text} ${wish.why}`, wish.text);
    for (const m of consolidation.kept) {
      for (const id of m.because || []) {
        const l = dayLetters.find((x) => x.id === id);
        if (l) link(l, 'memory', m.text);
      }
    }
    for (const inf of out) {
      const letter = this.letters.find((l) => l.id === inf.letter);
      if (letter) (letter.influenced ??= []).push({ version, what: inf.what, text: inf.text });
    }
    if (out.length) this.milestone('first-influence', `Something ${out[0].from} wrote changed it for the first time.`);
    return out;
  }

  // ---------- moderation ----------

  /** Rules first, then the model. With moderation off everything is allowed; in "keeper" mode a person decides letters. */
  async screen(kind, text) {
    const mode = this.cfg.moderation.mode;
    if (mode === 'off') return { status: 'allowed', reason: '', by: 'off' };
    const rule = ruleReason(text);
    if (rule) return { status: 'held', reason: rule, by: 'rules' };
    if (mode === 'keeper' && kind === 'letter') return { status: 'held', reason: 'waiting for its keeper', by: 'keeper' };
    return { ...(await screenWithModel(this.brain, kind, text)), by: 'model' };
  }

  /** Screen letters that arrived since it last woke. Runs only when it can think; a failure leaves them pending. */
  async screenLetters() {
    const pending = this.letters.filter((l) => letterStatus(l) === 'pending').slice(0, 8);
    if (!pending.length) return;
    this.setPhase('waking', 'screening letters');
    for (const l of pending) {
      try {
        l.screen = { ...(await this.screen('letter', l.text)), at: new Date().toISOString() };
      } catch {
        break;
      }
      if (l.screen.status === 'allowed') this.emit('letter', publicLetter(l));
    }
    this.store.write('letters.json', this.letters);
  }

  /** Held and pending letters, and withheld replies, for its keeper. */
  keeperQueue() {
    return this.letters
      .filter((l) => ['held', 'pending'].includes(letterStatus(l)) || l.reply?.withheld)
      .map((l) => ({ ...publicLetter(l, { own: true }), heldReply: l.reply?.withheld ? { text: l.reply.text, reason: l.reply.reason } : null }))
      .reverse();
  }

  /** The keeper allows or rejects a held letter, or releases or drops a withheld reply. */
  decide(id, action) {
    const l = this.letters.find((x) => x.id === id);
    if (!l) return { ok: false, reason: 'no such letter' };
    const at = new Date().toISOString();
    if (action === 'allow' || action === 'reject') {
      if (letterStatus(l) === 'allowed') return { ok: false, reason: 'already allowed' };
      l.screen = { status: action === 'allow' ? 'allowed' : 'rejected', reason: 'its keeper decided', by: 'keeper', at };
    } else if (action === 'release-reply' || action === 'drop-reply') {
      if (!l.reply?.withheld) return { ok: false, reason: 'no withheld reply' };
      if (action === 'release-reply') {
        delete l.reply.withheld;
        delete l.reply.reason;
      } else l.reply = null;
    } else return { ok: false, reason: 'unknown action' };
    this.store.write('letters.json', this.letters);
    if (letterStatus(l) === 'allowed') this.emit('letter', publicLetter(l));
    return { ok: true };
  }

  // ---------- visitors ----------

  /** A new letter. Obvious problems are held at the door; the rest waits for the model's screen when it next wakes. */
  addLetter({ from, text, person, question }) {
    const asked = question ? this.state.questions.find((q) => q.id === question && q.open) : null;
    const mode = this.cfg.moderation.mode;
    const rule = mode === 'off' ? null : ruleReason(`${from}\n${text}`);
    const at = new Date().toISOString();
    const screen =
      mode === 'off'
        ? { status: 'allowed', reason: '', by: 'off', at }
        : rule
          ? { status: 'held', reason: rule, by: 'rules', at }
          : mode === 'keeper'
            ? { status: 'held', reason: 'waiting for its keeper', by: 'keeper', at }
            : { status: 'pending', reason: 'not screened yet', at };
    const letter = {
      id: `L${this.letters.length + 1}`,
      from,
      text,
      at,
      person,
      question: asked?.id ?? null,
      questionText: asked?.text ?? null,
      screen,
    };
    this.letters.push(letter);
    this.store.write('letters.json', this.letters);
    if (screen.status === 'allowed') this.emit('letter', publicLetter(letter));
    else this.emit('letter-queued', { id: letter.id });
    return publicLetter(letter, { own: true });
  }

  you(person) {
    const mine = this.letters.filter((l) => l.person === person);
    const ids = new Set(mine.map((l) => l.id));
    const names = new Set(mine.map((l) => l.from.trim().toLowerCase()));
    const mentions = (m) => (m.about && names.has(m.about.trim().toLowerCase())) || (m.because || []).some((id) => ids.has(id));
    const hl = this.cfg.memory.halfLifeCycles;
    const s = this.state;
    const p = s.people[person];
    return {
      letters: mine.map((l) => publicLetter(l, { own: true })).reverse(),
      known: p ? { lettersRead: p.lettersRead, firstRead: p.firstRead, lastRead: p.lastRead } : null,
      remembered: SHELVES.flatMap((shelf) =>
        s.memory.shelves[shelf].filter(mentions).map((m) => ({ id: m.id, text: m.text, shelf, strength: +strength(m, s.cycle, hl).toFixed(3) })),
      ),
      pending: s.memory.today.filter(mentions).map((m) => ({ text: m.text, shelf: m.shelf })),
      forgotten: s.memory.forgotten.filter(mentions).map((m) => ({ text: m.text, shelf: m.shelf, forgottenAt: m.forgottenAt, how: m.how })),
    };
  }

  // ---------- views ----------

  publicState() {
    const s = this.state;
    const hl = this.cfg.memory.halfLifeCycles;
    const shelf = (list) =>
      list
        .map((m) => ({ id: m.id, text: m.text, about: m.about, born: m.born, touches: m.touches, strength: +strength(m, s.cycle, hl).toFixed(3) }))
        .sort((a, b) => b.strength - a.strength);
    return {
      ...this.status(),
      born: s.born,
      mood: s.mood,
      brain: this.brain.label,
      backend: this.brain.kind,
      rhythm: {
        cycleMinutes: this.cfg.rhythm.cycleMinutes,
        nightEvery: this.cfg.rhythm.nightEvery,
        untilNight: this.cfg.rhythm.nightEvery - (s.cycle - s.lastNightCycle),
      },
      self: { seed: s.self.seed, own: s.self.own, gone: s.self.gone.slice(-30) },
      portrait: s.portrait,
      names: s.names,
      memory: {
        shelfSize: this.cfg.memory.shelfSize,
        halfLife: hl,
        shelves: Object.fromEntries(SHELVES.map((k) => [k, shelf(s.memory.shelves[k])])),
        today: s.memory.today.map((m) => ({ text: m.text, shelf: m.shelf })),
        forgotten: s.memory.forgotten.slice(-80).reverse(),
      },
      questions: s.questions
        .filter((q) => q.open)
        .map((q) => ({ ...q, answers: this.letters.filter((l) => l.question === q.id && letterStatus(l) === 'allowed').length }))
        .reverse(),
      stats: s.stats,
      milestones: s.milestones,
      letters: {
        total: this.letters.filter((l) => letterStatus(l) === 'allowed').length,
        unread: this.letters.filter((l) => !l.readAt && ['allowed', 'pending'].includes(letterStatus(l))).length,
      },
      moderation: this.cfg.moderation.mode,
      world: (() => {
        const things = s.world.things;
        const newest = [...things].sort((a, b) => b.built - a.built)[0];
        return {
          things: things.length,
          standing: things.filter((t) => !t.ruin).length,
          ruins: things.filter((t) => t.ruin).length,
          at: s.world.at,
          newest: newest ? { id: newest.id, name: newest.name, built: newest.built, sprite: newest.sprite ? `works/${pad(newest.sprite)}.svg` : null } : null,
        };
      })(),
      wishes: s.wishes.slice(-6).reverse().map(publicWish),
      wishIssues: this.cfg.wishes?.issuesUrl || null,
      live: this.live,
      senses: this.lastSenses,
      latest: this.cycles.at(-1) ?? null,
    };
  }

  journey() {
    return {
      born: this.state.born,
      cycles: this.cycles,
      nights: this.nights,
      letters: this.letters.filter((l) => letterStatus(l) === 'allowed').map((l) => publicLetter(l)),
      journal: this.journal,
      milestones: this.state.milestones,
    };
  }
}
