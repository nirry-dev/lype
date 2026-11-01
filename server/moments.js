// Between its cycles it is not gone: every minute or two it has a moment in its place. It goes somewhere (one of the
// things it built, or its card), does one small thing there, and may say a few words. A moment is a tiny ask of its
// own model, made only when that model is already on the card and nobody else is working the card hard; otherwise its
// body drifts on by itself, without a word, until it can think again. Its moments are told to it at its next cycle.
// A card that holds one model at a time is shared by taking turns: when a life it shares the house with has had the
// card for a while between cycles, it takes it back for its own moments (never from anyone else's model).
//
// Full power (off unless its keeper turns it on, for a few hours at a time): its moments come one after another, each
// begun with a short thought it thinks aloud, streamed to whoever is watching. Its own work on the card no longer
// counts against it, and it takes the card back from its household at once. If the card gets too hot it slows to its
// usual moments until the card has cooled.
import { similarity } from './memory.js';
import * as mind from './mind.js';
import { readSenses } from './senses.js';

const KEPT = 24; // moments kept between cycles (it is told the last few)
const DRIFT_AFTER = 4 * 60000; // with no moment for this long, its body moves on by itself
const STUCK = 3; // moments in a row in one place, after which it is asked to go somewhere else
const NEAR_WAKE = 45000; // no moment this close to a cycle (or a quarter of the time between them, when that is shorter)
const FULL_GAP = 1500; // at full power, the pause between one moment and the next
const COOL_BY = 5; // degrees under its ceiling the card comes back to before it goes on at full power

const until = (ms) => (ms < 90000 ? 'in about a minute' : `in about ${Math.round(ms / 60000)} minutes`);
const since = (iso, now = Date.now()) => {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  return min < 2 ? 'a minute ago' : min < 90 ? `${min} minutes ago` : `${Math.round(min / 60)} hours ago`;
};
export const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export class Moments {
  constructor(life) {
    this.life = life;
    this.timer = null;
    this.running = false;
    this.heldSince = null; // since when a life it shares the house with has had the card while it had nothing to say
    this.musing = null; // the moment it is thinking aloud for right now, at full power
  }

  get every() {
    return (this.life.cfg.rhythm.momentSeconds || 0) * 1000;
  }

  get enabled() {
    return this.every > 0 && !this.life.cfg.recording;
  }

  /** Its full power, while its keeper has it on (cooling or not). */
  get power() {
    const p = this.life.state?.power;
    return this.enabled && p?.full ? p : null;
  }

  /** Whether it is thinking without pause right now: full power, and the card not too hot. */
  get full() {
    return Boolean(this.power) && !this.power.cooling;
  }

  start() {
    if (this.enabled) this.schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(ms) {
    clearTimeout(this.timer);
    const jitter = this.life.cfg.rhythm.jitter ?? 0.2;
    const base = this.full ? FULL_GAP : this.every;
    this.timer = setTimeout(() => this.tick(), ms ?? base * (1 + (Math.random() * 2 - 1) * jitter));
    this.timer.unref?.();
  }

  async tick() {
    try {
      if (this.power && Date.now() >= Date.parse(this.power.until)) this.life.setPower(false, { why: 'its time ran out' });
      await this.one();
    } catch (err) {
      // a moment that goes wrong is only a moment missed
      console.error(`a moment went wrong: ${err.message}`);
    } finally {
      if (this.enabled) this.schedule();
    }
  }

  /** At full power: too hot, and it slows to its usual moments; cool again, and it goes on. */
  heat(senses) {
    const p = this.power;
    const t = senses.gpu?.tempC;
    if (!p || !Number.isFinite(t)) return;
    const max = this.life.cfg.power.maxTempC;
    if (!p.cooling && t >= max) {
      p.cooling = true;
      this.life.journalAdd({ kind: 'power', text: `The card reached ${t}°, so it slowed to its usual moments until the card cooled.` });
    } else if (p.cooling && t <= max - COOL_BY) p.cooling = false;
    else return;
    this.life.saveState();
    this.life.emit('status', this.life.status());
  }

  /** Why it can't have a moment now (null when it can), from what it is doing and who else is on the card. */
  async blocked(senses) {
    const life = this.life;
    if (!life.state || life.busy || life.paused) return 'awake or paused';
    if (life.nextWakeAt && life.nextWakeAt - Date.now() < Math.min(NEAR_WAKE, life.cfg.rhythm.cycleMinutes * 15000)) return 'its cycle is near';
    const c = life.cfg.courtesy;
    if (!c.enabled) return null;
    const p = await life.brain.presence();
    if (!p.reachable) return 'unreachable';
    // at full power, the work on the card while its own model is there is its own
    if (senses.gpu && senses.gpu.util > c.maxGpuBusy && !(this.full && p.ownState === 'loaded')) return 'the card is busy';
    if (p.ownState === 'loaded') {
      this.heldSince = null;
      return null;
    }
    // Its model is not on the card. It never puts it on an empty card, or in place of anyone else's model; only in
    // place of a household life's, and (unless it is at full power) only once that life has had a turn of its own.
    const others = p.others.filter((m) => m !== life.cfg.brain.eyes);
    const household = new Set(c.household || []);
    if (!others.length || others.some((m) => !household.has(m))) {
      this.heldSince = null;
      return 'its model is not on the card';
    }
    this.heldSince ??= Date.now();
    if (!this.full && Date.now() - this.heldSince < (life.cfg.rhythm.momentTurnMinutes ?? 6) * 60000) return 'its household has the card';
    this.heldSince = null;
    return null;
  }

  /** One moment: thought, or (when it can't think now) drifted. Returns what it did, or null. */
  async one() {
    if (this.running || !this.life.state) return null;
    this.running = true;
    try {
      const senses = await readSenses();
      this.heat(senses);
      const why = await this.blocked(senses);
      if (!why) return await this.think(senses);
      if (why === 'awake or paused' || why === 'its cycle is near') return null;
      const last = this.life.state.about;
      if (!last || Date.now() - Date.parse(last.since) > DRIFT_AFTER) return this.drift();
      return null;
    } finally {
      this.running = false;
    }
  }

  async think(senses) {
    const life = this.life;
    const s = life.state;
    const told = (s.moments || []).filter((m) => !m.drift);
    // a few moments in a row in one place, and it is asked to go somewhere else
    const here = s.about?.at;
    const stuck = told.length >= STUCK && told.slice(-STUCK).every((m) => m.at === here) ? this.where(s.about).name || 'your card' : null;
    const all = mind.momentPlaces(s.world);
    const away = all.filter((p) => p !== stuck && p !== 'stay');
    const places = stuck && away.length ? away : all;
    const lastCycle = life.cycles.at(-1);
    const power = this.power;
    const ctx = {
      senses,
      about: s.about && this.where(s.about),
      thought: lastCycle?.diary || '',
      since: lastCycle ? since(lastCycle.at) : 'never',
      next: life.nextWakeAt ? until(life.nextWakeAt - Date.now()) : 'soon',
      moments: told,
      stuck,
      waiting: life.letters.filter((l) => !l.readAt && ['allowed', 'pending'].includes(l.screen?.status ?? 'allowed')).length,
      power: power ? { until: clock(new Date(power.until)), cooling: Boolean(power.cooling) } : null,
    };
    const system = mind.systemPrompt(s, life.cfg);
    try {
      // at full power, it thinks aloud first, and whoever is watching sees the words as they come
      if (this.full) {
        this.musing = (s.about?.n ?? 0) + 1;
        life.emit('status', life.status());
        const res = await life.brain.complete({ kind: 'muse', system, user: mind.musePrompt(ctx), maxTokens: 140, temperature: 0.85, onToken: (t) => life.emit('stream', { kind: 'muse', delta: t }) });
        ctx.mused = mind.cleanProse(res.text, 500);
        if (life.busy) return null;
      }
      const raw = await life.brain.complete({ kind: 'moment', system, user: mind.momentPrompt(ctx), maxTokens: 90, temperature: 0.9, schema: mind.momentSchema(places) });
      // the cycle may have begun while it thought: the cycle has the body now
      if (life.busy) return null;
      const read = mind.readMoment(raw.text, places);
      // what it already said lately, said again in other words, is left unsaid
      if (read.say && told.slice(-6).some((m) => m.say && similarity(m.say, read.say) >= 0.4)) read.say = '';
      const at = read.go === 'stay' ? (s.about?.at ?? 'card') : read.go === 'card' ? 'card' : s.world.things.find((t) => t.name === read.go)?.id ?? 'card';
      return this.record({ at, doing: read.doing, say: read.say, time: senses.time, thought: ctx.mused });
    } finally {
      this.musing = null;
    }
  }

  /** Its body moving on by itself while it can't think: to something it built (newer and more tended more often). */
  drift() {
    const s = this.life.state;
    const here = s.about?.at;
    const things = s.world.things.filter((t) => !t.ruin && t.id !== here);
    const newest = Math.max(1, ...things.map((t) => t.tended ?? t.built ?? 0));
    const choices = [...things.map((t) => ({ at: t.id, w: 1 + (2 * (t.tended ?? t.built ?? 0)) / newest })), ...(here === 'card' ? [] : [{ at: 'card', w: 0.8 }])];
    if (!choices.length) return null;
    let r = Math.random() * choices.reduce((a, c) => a + c.w, 0);
    const pick = choices.find((c) => (r -= c.w) <= 0) || choices.at(-1);
    return this.record({ at: pick.at, doing: 'look', say: '', time: clock(new Date()), drift: true });
  }

  record(m) {
    const s = this.life.state;
    const n = (s.about?.n ?? 0) + 1;
    s.about = { n, at: m.at, doing: m.doing, say: m.say, since: new Date().toISOString(), ...(m.thought ? { thought: m.thought } : {}), ...(m.drift ? { drift: true } : {}) };
    s.moments = [...(s.moments || []), { ...this.where(s.about), time: m.time }].slice(-KEPT);
    if (!m.drift) {
      s.stats.moments = (s.stats.moments ?? 0) + 1;
      this.life.milestone('first-moment', 'It had its first moment between cycles: it went about its place on its own.');
    }
    this.life.saveState();
    this.life.emit('status', this.life.status());
    return s.about;
  }

  /** A moment with the name of where it was, for telling it later (a thing it built may since have been renamed or gone). */
  where(about) {
    const thing = about.at !== 'card' && this.life.state.world.things.find((t) => t.id === about.at);
    return { at: thing ? thing.id : 'card', name: thing?.name ?? '', doing: about.doing, say: about.say, ...(about.thought ? { thought: about.thought } : {}), ...(about.drift ? { drift: true } : {}) };
  }

  /** After a cycle its body is where the cycle left it: by what it built or tended, or at its card. */
  afterCycle(action) {
    const s = this.life.state;
    const at = ['build', 'tend'].includes(action) && s.world.at ? s.world.at : 'card';
    s.moments = [];
    s.about = { n: (s.about?.n ?? 0) + 1, at, doing: action === 'rest' ? 'sit' : 'look', say: '', since: new Date().toISOString() };
  }
}
