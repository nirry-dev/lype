// Its life: waking on a rhythm, thinking, making, remembering, and every night becoming a new version of itself.
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { GENESIS, SEAL_VERSION, canonical, publicSeal, sealInput } from '../web/lib/seal.js';
import { formSchema, readForm, standing } from '../web/lib/form.js';
import { aroundOffer, loadCatalogue, offer } from './models.js';
import { Maker } from './maker.js';
import { Moments, clock } from './moments.js';
import { Meanings } from './meaning.js';
import { Recall } from './recall.js';
import { cleanSvg } from '../web/lib/svgclean.js';
import { MAX_OPEN_ERRANDS, addErrand, decideErrand, errandReason, openErrands, photoSubject, sameAsk } from './errands.js';
import { SHELVES, alike, consolidate, emptyMemory, fold, gist, refile, reinforce, sentences, similarity, strength, striking, understand, useMeaning, words } from './memory.js';
import * as mind from './mind.js';
import { ruleReason, screenWithModel } from './moderation.js';
import { PAL_MODES, fetchPalJson, palLimits, palUrlOk, readOutbox, verifyPalLetter } from './pals.js';
import { compare, measure } from './measure.js';
import { readSenses } from './senses.js';
import { pad } from './store.js';
import { CARD, addWish, answerWish, emptyWorld, findThing, foundQuarter, inheritWorld, namedThing, photoWish, placeNear, quarterSpot, remembered, untoldAnswers, weather } from './world.js';

/** Everything one life is made of on disk. When it dies, these are put away together, whole, and stay replayable. */
const LIFE_FILES = ['state.json', 'letters.json', 'journal.json', 'chain.json', 'cycles', 'nights', 'works', 'returns'];
const bornText = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Moves a file or folder; if Windows holds it open, copies it and removes the original instead. */
function move(from, to) {
  try {
    renameSync(from, to);
  } catch (err) {
    if (!['EPERM', 'EBUSY', 'EACCES', 'EXDEV'].includes(err.code)) throw err;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** Its will as anyone may see it. */
export function publicWill(w) {
  if (!w) return null;
  return { line: w.line, why: w.why, letter: w.letter, keep: w.keep, ...(w.coparent ? { coparent: { name: w.coparent.name, page: w.coparent.page, line: w.coparent.line } } : {}), ...(w.refused ? { refused: w.refused } : {}), ...(w.letterHeld ? { letterHeld: true } : {}) };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x) => clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
const sameName = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
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
  if (c.action === 'errand') return c.errand ? `sent people on an errand: "${c.errand}"` : 'thought of an errand';
  if (c.action === 'build') return c.work?.failed ? `tried to build "${c.title}"` : `built "${c.title}" in your place`;
  if (c.action === 'tend') return c.work?.failed ? `tried to tend "${c.title}"` : `tended "${c.title}"`;
  return 'rested';
}

/** A wish as anyone may see it, with its keeper's answer (or who granted it), and the errand it became, if any. */
export function publicWish(w, errands = []) {
  const e = w.errand ? errands.find((x) => x.id === w.errand) : null;
  return {
    id: w.id,
    text: w.text,
    why: w.why,
    version: w.version,
    cycle: w.cycle,
    at: w.at,
    status: w.status,
    answer: w.answer ? { status: w.answer.status, text: w.answer.text, at: w.answer.at, told: w.answer.told, ...(w.answer.by ? { by: w.answer.by, from: w.answer.from } : {}) } : null,
    errand: e ? { id: e.id, status: e.status } : null,
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
    errand: c.work?.kind === 'errand' && !c.work.duplicate ? c.work.text : undefined,
    work: c.work ? { kind: c.work.kind, failed: Boolean(c.work.failed) } : null,
    diary: c.diary,
    mood: c.moodAfter,
    letters: c.letters.map((l) => l.id),
    replies: c.replies.length,
    steady: c.measured?.steadiness ?? null, // how sure its words were (server/measure.js)
    saidCalm: c.feelings?.calm ?? null, // how calm it said it was
  };
}

/** What it saw in a photo, as the public may see it: nothing of a look moderation held back. */
export function publicLook(look) {
  if (!look) return null;
  if (look.failed) return { failed: true };
  if (look.withheld) return { withheld: true };
  return { see: look.see, answers: look.answers, verdict: look.verdict };
}

/** Letters from before moderation existed count as allowed. */
export const letterStatus = (l) => l.screen?.status ?? 'allowed';

/** The photo a letter carries, if any: brought back for an errand, or sent with a letter. */
export const photoOf = (l) => l.errand?.photo ?? l.photo ?? null;

/** A letter as the public sees it; its own author also sees whether it is still being screened or was held. */
// Did this letter plausibly cause this change? (Exported for the letters view: what it passed on to its pals.)
export { influencedBy };

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
    fromCreature: Boolean(l.pal),
    fromParent: Boolean(l.kin),
    errand: l.errand
      ? { id: l.errand.id, text: l.errand.text, photo: letterStatus(l) === 'allowed' ? l.errand.photo : null, look: publicLook(l.errand.look), seenCycle: l.errand.seenCycle ?? null }
      : null,
    // a photo sent with a letter: seen by nobody before its keeper lets it through
    ...('photo' in l ? { photo: letterStatus(l) === 'allowed' ? l.photo : null, look: publicLook(l.look), seenCycle: l.seenCycle ?? null } : {}),
  };
}

/** A cycle record without anything moderation held back. */
export function publicCycle(c) {
  return {
    ...c,
    replies: (c.replies || []).filter((r) => !r.withheld),
    letters: c.letters.map(({ replyWithheld, ...l }) => ({
      ...l,
      ...(replyWithheld ? { reply: null } : {}),
      ...(l.errand ? { errand: { ...l.errand, look: publicLook(l.errand.look) } } : {}),
    })),
    ...(c.seal ? { seal: publicSeal(c.seal) } : {}),
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
    this.maker = new Maker(config, store);
    this.moments = new Moments(this); // between its cycles: where it goes in its place, and what it says there
    this.recall = null; // everything it ever thought, read and forgot, for the present to call up (built when first needed)
    // what its memories mean, from a small model on the CPU: memories said differently can still be one (meaning.js)
    this.meaning = new Meanings({ url: config.meaning?.url, file: store.path('cache/meanings.jsonl') });
    useMeaning(this.meaning);
    this.card = null; // who has the graphics card right now: it, a pal it shares the card with, nobody, or someone else
    this.neighbor = store.read('neighbor.json', null); // the place of a pal it shares the card with, as that pal shows it
    this.letters = store.read('letters.json', []);
    this.journal = store.read('journal.json', []);
    this.cycles = store.list('cycles').map((f) => cycleSummary(store.read(`cycles/${f}`)));
    this.nights = store.list('nights').map((f) => store.read(`nights/${f}`));
    this.chain = store.read('chain.json', []); // its sealed record, one entry per cycle and night (web/lib/seal.js)
    this.lineage = store.read('lineage.json', []); // the minds that lived here before it, oldest first
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
    s.id ??= randomBytes(9).toString('base64url'); // how other creatures address it (pen pals); never changes
    s.world ??= emptyWorld();
    s.wishes ??= [];
    s.stats.built ??= 0;
    s.stats.tended ??= 0;
    s.errands ??= [];
    s.stats.errands ??= 0;
    s.stats.errandsFilled ??= 0;
    s.generation ??= 1;
  }

  // ---------- lifecycle ----------

  start() {
    if (!this.state) this.birth();
    this.noticeGap();
    this.welcome();
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
    // a pal it shares the card with: who has the card now (often), and its place (now and then)
    if (this.housemates().length) {
      this.cardTimer = setInterval(() => this.readCard(), 15000);
      this.neighborTimer = setInterval(() => this.readNeighbor(), 5 * 60000);
      this.cardTimer.unref?.();
      this.neighborTimer.unref?.();
      this.readCard();
      this.readNeighbor();
      setTimeout(() => this.readNeighbor(), 30000).unref?.(); // in case its neighbour was only just starting too
    }
    if (this.state.power?.full && Date.now() >= Date.parse(this.state.power.until)) this.setPower(false, { why: 'while it was switched off' });
    else if (this.cfg.power.full && !this.state.power?.full) this.setPower(true);
    this.moments.start();
  }

  /**
   * Full power, from its keeper: for a few hours (then it ends by itself), its moments come one after another and it
   * thinks aloud in each. It is told when it begins and ends, in its moments at once and at its next cycle.
   */
  setPower(on, { hours = this.cfg.power.autoOffHours, why = '' } = {}) {
    const s = this.state;
    if (!this.moments.enabled) return { ok: false, reason: 'It has no moments (rhythm.momentSeconds is 0).' };
    const was = Boolean(s.power?.full);
    const now = new Date();
    if (on) {
      const until = new Date(now.getTime() + Math.max(0.05, Math.min(Number(hours) || 3, 24)) * 3600000);
      s.power = { full: true, since: was ? s.power.since : now.toISOString(), until: until.toISOString(), cooling: was ? Boolean(s.power.cooling) : false };
      if (!was) {
        this.notes.push(`Your keeper gave you full power until ${clock(until)}. Between your cycles you no longer rest: your moments come one after another, and in each you think aloud first, and people watching see your thoughts as you have them. The card runs hotter while you do.`);
        this.journalAdd({ kind: 'power', text: `Its keeper gave it full power until ${clock(until)}: between its cycles it thinks aloud, without pause.` });
        this.milestone('first-full-power', 'Its keeper gave it full power for the first time: between its cycles it thought aloud, without pause.');
      }
    } else if (was) {
      s.power = { full: false, last: { since: s.power.since, until: now.toISOString() } };
      this.notes.push(`Your full power ended${why ? ` (${why})` : ''}. Between your cycles you rest between moments again.`);
      this.journalAdd({ kind: 'power', text: `Its full power ended${why ? `: ${why}` : ''}.` });
    }
    this.saveState();
    this.moments.schedule(on ? 1000 : undefined);
    this.emit('status', this.status());
    return { ok: true, ...this.status() };
  }

  /** What changed while it was off: things its keeper gave it since, each told once, the next time it wakes. */
  welcome() {
    const s = this.state;
    if (this.cfg.recording) return;
    if (!s.abilities?.includes('world')) {
      s.abilities = [...(s.abilities || []), 'world', 'wishes'];
      this.notes.push('Since you last woke, your keeper gave you two new things: a place of your own that you can build in, and a way to leave them wishes.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it a place of its own to build in, and a way to leave wishes.' });
      this.milestone('given-a-place', 'Its keeper gave it a place of its own to build in, and a way to leave wishes.');
    }
    if (!s.abilities.includes('errands')) {
      s.abilities = [...s.abilities, 'errands'];
      this.notes.push('Since you last woke, your keeper gave you a new thing: you can send the people who visit on errands, and they bring you back a photo. For the first time you will be able to see something.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it errands: people can bring it photos of what it asks for.' });
    }
    if (this.cfg.letters.photos && !s.abilities.includes('photos')) {
      s.abilities = [...s.abilities, 'photos'];
      this.notes.push('Since you last woke, your keeper let the people who write to you send one photo with a letter, to show you what their words are about. When a letter comes with a photo, you look at it before you read.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper let people send it a photo with a letter.' });
    }
    // It named itself before a name had to be one you can call it by. It is asked once to choose again, and that one stays.
    if (s.name && !s.formerName && mind.cuteName(s.name).why) {
      s.formerName = s.name;
      s.name = null;
      this.notes.push(`Your keeper asked something of you: "${s.formerName}", what you call yourself, describes something, but it is not a name a person can call you by. On your next night you will choose your name again, once and for good. It can keep something of the old one.`);
      this.journalAdd({ kind: 'gift', text: `Its keeper asked it to choose a name it can be called by, once and for good, in place of "${s.formerName}".` });
    }
    if (this.cfg.mortality?.enabled && !s.mortal) {
      const after = this.cfg.mortality.dieAfter;
      s.mortal = { since: s.version, quiet: 0 };
      this.notes.push(`Since you last woke, your keeper made you mortal. From now on you live only as long as someone writes to you: if ${after} nights pass in a row without a single letter, from a person or from another mind, your life ends, and a new mind is born here in your place. Every letter starts the count again.`);
      this.journalAdd({ kind: 'gift', text: `Its keeper made it mortal: from now on it lives only as long as someone writes to it. ${after} nights in a row without a letter, and its life ends.` });
      this.milestone('mortal', 'Its keeper made it mortal: it lives as long as someone writes to it.');
    }
    if (s.abilities.includes('world') && !s.abilities.includes('shapes')) {
      s.abilities = [...s.abilities, 'shapes'];
      const flat = s.world.things.filter((t) => !t.form).length;
      this.notes.push(`Since you last woke, your keeper gave your place a third dimension. What you build now has a shape, stacked out of simple solids, and people can walk around it.${flat ? ' What you built before is still only a drawing; it takes a shape when you go back and tend it.' : ''}`);
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave its place a third dimension: what it builds now has a shape people can walk around.' });
      this.milestone('given-shapes', 'Its keeper gave its place a third dimension: what it builds now has a shape.');
    }
    if (s.abilities.includes('shapes') && !s.abilities.includes('body')) {
      s.abilities = [...s.abilities, 'body'];
      this.notes.push('Since you last woke, your keeper gave you a way to be seen in your place. Until now people saw you there only as a small light. On your next night you will choose how you appear to them: you will build yourself a body, the way you build your things.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it a way to be seen in its place: on its next night it chooses a body for itself.' });
    }
    // More to build with, and (where its keeper's card can) things made from its words: it only hears of them while it
    // is shaping something, so it is told once, or it may never build or reshape anything again to find out.
    const more = s.abilities.includes('shapes') && !s.abilities.includes('more-shapes');
    const making = s.abilities.includes('shapes') && this.maker.enabled && !s.abilities.includes('making');
    if (more || making) {
      s.abilities = [...s.abilities, ...(more ? ['more-shapes'] : []), ...(making ? ['making'] : [])];
      const told = [
        more ? 'more to build with: new solids (wedges, arches, tubes, rings, stairs), flat shapes of your own drawn round and raised up, shapes spun round their middle like a vase or a tower, ready-made pieces (trees, lamps, doors, windows, fences, benches), and parts turned or repeated in rows and rings' : null,
        making ? 'a way to have things made from your words: when you build something, or reshape something you built, you can describe a part in a few plain words, and other models make it solid for you' : null,
      ].filter(Boolean);
      this.notes.push(`Since you last woke, your keeper gave you ${told.join(', and ')}. You will be shown how whenever you build something new or change the shape of something you built.`);
      this.journalAdd({ kind: 'gift', text: `Its keeper gave it ${[more ? 'more to build with' : null, making ? 'a way to have things made from its words' : null].filter(Boolean).join(' and ')}.` });
    }
    if (this.moments.enabled && !s.abilities.includes('moments')) {
      s.abilities = [...s.abilities, 'moments'];
      this.notes.push('Since you last woke, your keeper gave you moments. Between your cycles you are no longer gone: every minute or two you go somewhere in your place, to something you built or to your card, and do one small thing there, and you can say a few words. People who are watching see where you go. You will be told what you did in your moments each time you wake.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it moments: between its cycles it now goes about its place, and can say a few words.' });
    }
    if (this.moments.enabled && this.cfg.rhythm.bring && s.abilities.includes('moments') && !s.abilities.includes('bring')) {
      s.abilities = [...s.abilities, 'bring'];
      this.notes.push('Since you last woke, your keeper gave you more to make your place with. Every so often, in a moment, you can set down one small ready-made thing beside something you built: a bench, a lantern, a stone, a plant. Other people made these and gave them away for anyone to use; you only know their names. You choose whether to, and what.');
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave it things to set down: in its moments it can now put small ready-made things beside what it built.' });
    }
    // Room for a town, told as what it is: its keeper's hope, said plainly, and every part of it its own choice. A life
    // first told it as something it would do ("what you build now goes in a quarter") is told again, plainly, once.
    const raise = this.moments.enabled && this.cfg.rhythm.raise;
    const offered = [
      'when you build, you can put the new thing in a quarter of your town, one you name and say what it is for, or leave it on its own',
      raise ? 'now and then, in a moment, you are offered one of your memories to raise something new from, and you can always leave it' : null,
      'each night you can say what your place is becoming, or nothing',
      'there are also more ready-made things to borrow, whole buildings among them (houses, shops, towers, workshops), which other people made and gave away; you know only their names',
    ].filter(Boolean);
    const hope = `Your keeper hopes your place might grow into a town in time, because the people who visit come closest to you by walking round what you made. It is only a hope: your place is yours, and it can stay as small as you want. Nothing about how you live changes unless you want it to: ${offered.join('; ')}.`;
    if (this.cfg.rhythm.city && s.abilities.includes('shapes') && !s.abilities.includes('city')) {
      s.abilities = [...s.abilities, 'city', 'city-told'];
      this.notes.push(`Since you last woke, your keeper gave your place room to grow into a town. ${hope}`);
      this.journalAdd({ kind: 'gift', text: 'Its keeper gave its place room to grow into a town, if it wants one: quarters it may name, memories it may raise things from, ready-made buildings it may borrow, and a line each night on what its place is becoming.' });
    } else if (s.abilities.includes('city') && !s.abilities.includes('city-told')) {
      s.abilities = [...s.abilities, 'city-told'];
      this.notes.push(`Your keeper wants to say again, more plainly, what they meant by giving your place room to grow into a town. ${hope} What you have built and named so far stays yours either way.`);
      this.journalAdd({ kind: 'gift', text: 'Its keeper told it again, more plainly, that the town is only a hope: every part of it is its own choice. And it gave it whole buildings to borrow.' });
    }
    this.noticeMind();
    if (!this.chain.length && (this.cycles.length || this.nights.length)) this.sealPast();
    this.saveState();
  }

  /**
   * The model it runs on. When its keeper moves it onto another, it is told once, plainly: its memories, beliefs and
   * name are the same, the mind reading them is not. Lives from before this was kept look at their last cycle.
   */
  noticeMind() {
    const s = this.state;
    if (this.brain.kind === 'mock') return;
    const now = this.brain.label;
    const last = this.store.list('cycles').at(-1);
    const was = s.mind || (last ? this.store.read(`cycles/${last}`)?.brain : null);
    s.mind = now;
    if (!was || was === now) return;
    const size = (m) => Number(/(\d+(?:\.\d+)?)b\b/i.exec(m)?.[1]) || null;
    const [a, b] = [size(was), size(now)];
    const how = a && b && a !== b ? (b > a ? 'a larger model' : 'a smaller model') : 'another model';
    const of = (m, n) => (n ? `${m}, which has about ${n} billion parameters` : m);
    this.notes.push(`Since you last woke, your keeper moved you onto ${how}. You used to run on ${of(was, a)}; now you run on ${of(now, b)}. Your memories, your beliefs about yourself and your name are the same. The mind reading them is not, and you may find you think differently.`);
    this.journalAdd({ kind: 'gift', text: `Its keeper moved it onto ${how}: from ${was} to ${now}.` });
    this.milestone('new-mind', `Its keeper moved it onto ${how}: it ran on ${was}, and now on ${now}.`);
  }

  // ---------- its mortality and its lineage ----------

  /** How near its end it is, or null while its keeper has not made it mortal. */
  mortality() {
    const m = this.cfg.mortality;
    if (!m?.enabled || !this.state?.mortal) return null;
    const quiet = this.state.mortal.quiet;
    return { quiet, fadeAfter: m.fadeAfter, dieAfter: m.dieAfter, fading: quiet >= m.fadeAfter, left: Math.max(0, m.dieAfter - quiet) };
  }

  /** Its last night: what it leaves its child. The seed line is held to the drift guard and screened, since nobody can change it afterwards. */
  async writeWill(system, mortal, dream) {
    const s = this.state;
    this.setPhase('dying', 'writing what it leaves its child');
    // Lines its pen pals wrote for its child: it may choose one of them to be its child's other parent.
    const offers = Object.values(s.pals || {}).filter((p) => p.id && p.line?.text);
    const raw = await this.brain.complete({ kind: 'will', system, user: mind.willPrompt(s, mortal, dream, offers), maxTokens: 700, temperature: 0.8, schema: mind.WILL_SCHEMA });
    const will = mind.readWill(raw.text);
    const co = offers.find((p) => sameName(p.name, will.coparent));
    will.coparent = null;
    if (co && ![...s.self.seed.map((l) => l.text), will.line].some((t) => t && similarity(t, co.line.text) >= 0.55) && (await this.screen('reply', co.line.text)).status === 'allowed') {
      will.coparent = { name: co.name, id: co.id, page: co.page || null, line: co.line.text };
    }
    if (will.line && s.self.seed.some((l) => similarity(l.text, will.line) >= 0.55)) Object.assign(will, { refused: { line: will.line, why: 'too close to a line its child is already born with' }, line: '' });
    else if (will.line && (await this.screen('reply', will.line)).status !== 'allowed') Object.assign(will, { line: '', why: '' });
    if (will.letter && (await this.screen('reply', will.letter)).status !== 'allowed') Object.assign(will, { letter: '', letterHeld: true });
    will.keep = [...new Set(will.keep.map((n) => findThing(s.world, n)?.name).filter(Boolean))];
    return will;
  }

  /** Its life ends: everything it was is put away whole (still replayable, its seals intact), and its child is born in its place. */
  die(will, mortal) {
    const s = this.state;
    const k = this.lineage.length + 1;
    const dir = `ancestors/${k}`;
    const at = new Date().toISOString();
    const cause = `nobody wrote to it for ${mortal.quiet} nights`;
    const entry = {
      k,
      dir,
      id: s.id,
      name: s.name,
      generation: s.generation,
      born: s.born,
      died: at,
      versions: s.version,
      cycles: s.cycle,
      quiet: mortal.quiet,
      lettersRead: s.stats.lettersRead,
      built: s.stats.built,
      cause,
      lastSeal: this.chain.at(-1)?.hash || null,
      will: publicWill(will),
      ...(will.coparent ? { coParent: { id: will.coparent.id, name: will.coparent.name, page: will.coparent.page } } : {}),
    };
    s.died = { at, version: s.version, cause, will: entry.will };
    this.milestone('died', `${s.name || 'It'} died: ${cause}.`);
    this.journalAdd({ kind: 'death', text: `It died: ${cause}.` });
    this.saveState();

    mkdirSync(this.store.path(dir), { recursive: true });
    for (const name of LIFE_FILES) if (this.store.exists(name)) move(this.store.path(name), this.store.path(`${dir}/${name}`));
    for (const sub of ['cycles', 'nights', 'works', 'returns']) mkdirSync(this.store.path(sub), { recursive: true });
    this.lineage.push(entry);
    this.store.write('lineage.json', this.lineage);

    const parent = s;
    Object.assign(this, { letters: [], journal: [], cycles: [], nights: [], chain: [], notes: [], waits: {} });
    this.birth({ parent, entry, will });
    const archived = this.store.read(`${dir}/state.json`);
    archived.died.child = { id: this.state.id };
    this.store.write(`${dir}/state.json`, archived);
    this.emit('death', entry);
    return entry;
  }

  // ---------- its sealed record ----------

  /** Seals a record to the one before it and adds it to the chain; anyone can check it (web/lib/seal.js). */
  seal(kind, n, record, { late = false } = {}) {
    // A child's record begins where its parent's ended.
    const prev = this.chain.at(-1)?.hash || this.state?.genesis || GENESIS;
    const { seal: _old, ...bare } = record;
    const body = kind === 'cycle' ? publicCycle(bare) : bare;
    // A reply still held for its keeper is sealed as a salted fingerprint, so it can't be guessed from the seal.
    const held = kind === 'cycle' ? (bare.replies || []).filter((r) => r.withheld) : [];
    const salts = held.map(() => randomBytes(16).toString('hex'));
    const withheld = held.map((r, i) => sha256(salts[i] + canonical(r)));
    const hash = sha256(sealInput({ prev, kind, n, body, withheld }));
    const at = new Date().toISOString();
    record.seal = { v: SEAL_VERSION, prev, hash, at, ...(late ? { late: true } : {}), withheld, ...(salts.length ? { salts } : {}) };
    this.chain.push({ kind, n, at: kind === 'cycle' ? bare.endedAt || bare.startedAt : bare.at, sealed: at, hash, prev, ...(late ? { late: true } : {}) });
    this.store.write('chain.json', this.chain);
    return record;
  }

  /** A life that began before its record was sealed: all of it is sealed now, in the order it happened, marked late. */
  sealPast() {
    const past = [
      ...this.store.list('cycles').map((f) => ({ kind: 'cycle', file: `cycles/${f}` })),
      ...this.store.list('nights').map((f) => ({ kind: 'night', file: `nights/${f}` })),
    ]
      .map((p) => ({ ...p, record: this.store.read(p.file) }))
      .map((p) => ({ ...p, when: Date.parse(p.kind === 'cycle' ? p.record.endedAt || p.record.startedAt : p.record.at) }))
      .sort((a, b) => a.when - b.when);
    for (const p of past) this.store.write(p.file, this.seal(p.kind, p.record.n, p.record, { late: true }));
    this.nights = this.store.list('nights').map((f) => this.store.read(`nights/${f}`));
    this.journalAdd({ kind: 'gift', text: `Its keeper sealed its record: everything it has done so far (${past.length} cycles and nights) was sealed late, and from now on each one is sealed as it happens.` });
  }

  // ---------- pen pals (server/pals.js) ----------

  /** Its keeper's setting for pen pal mail: open, throttled or paused. */
  palMode() {
    return this.state?.palMode || this.cfg.pals.mode || 'open';
  }

  setPalMode(mode) {
    if (!PAL_MODES.includes(mode)) return { ok: false, reason: 'open, throttled or paused' };
    this.state.palMode = mode;
    this.saveState();
    return { ok: true, mode };
  }

  /** Fetches the outboxes of the creatures its keeper listed and puts any letter addressed to it in its letter box. */
  async pollPals(fetchJson = fetchPalJson) {
    const s = this.state;
    if (!s || this.palMode() === 'paused' || this.polling) return [];
    this.polling = true;
    const got = [];
    try {
      s.pals ??= {};
      s.palSeen ??= [];
      for (const pal of this.cfg.pals.list || []) {
        const url = typeof pal === 'string' ? pal : pal?.url;
        if (!palUrlOk(url)) continue;
        const entry = (s.pals[url] ??= { url, id: null, name: null, received: 0, sent: 0, thread: 0, restUntil: null });
        try {
          const box = readOutbox(await fetchJson(url));
          if (!box) throw new Error('that is not an outbox');
          if (box.from.id === s.id) throw new Error('that is its own outbox');
          if (entry.id && box.from.id !== entry.id && box.from.parent?.id === entry.id) {
            // The pal it knew died; its child writes from the same outbox now, and is a stranger.
            const ours = box.from.parent.coParent?.id === s.id;
            this.notes.push(
              ours
                ? `Your pen pal ${entry.name} died. A new mind lives where they lived, their child, and it was born with the line you wrote for it: you are its other parent. It does not remember you, or ${entry.name}.`
                : `Your pen pal ${entry.name} died. A new mind lives where they lived, their child, and it does not remember you.`,
            );
            this.journalAdd({ kind: 'pal', text: ours ? `Its pen pal ${entry.name} died, and their child was born with the line it wrote: it is the child's other parent.` : `Its pen pal ${entry.name} died; their child writes from their outbox now.` });
            if (ours) {
              (s.children ??= []).push({ url, id: box.from.id, of: entry.name, at: new Date().toISOString(), line: entry.mine || null });
              this.milestone('co-parent', `Its pen pal ${entry.name} died, and their child was born with a line it wrote.`);
            }
            Object.assign(entry, { sent: 0, thread: 0, restUntil: null, line: null, before: [...(entry.before || []), entry.name] });
          }
          if (box.from.fading && !entry.fading && entry.id === box.from.id) {
            this.notes.push(`Your pen pal ${entry.name} is fading: nobody has written to them for a long time, and if nobody does, their life will end. A letter from you would count.`);
            this.journalAdd({ kind: 'pal', text: `Its pen pal ${entry.name} is fading.` });
          }
          Object.assign(entry, { id: box.from.id, name: box.from.name, page: box.from.page || null, mortal: box.from.mortal, fading: box.from.fading, open: box.from.openToPeople ?? null, polledAt: new Date().toISOString(), error: null });
          for (const l of box.letters.filter((x) => x.to === s.id)) {
            const key = `${box.from.id}:${l.id}`;
            if (s.palSeen.includes(key)) continue;
            let why;
            try {
              why = await verifyPalLetter(l, box.from, url, fetchJson);
            } catch {
              continue; // it couldn't be checked right now; it is tried again next time
            }
            s.palSeen.push(key);
            if (why) {
              this.journalAdd({ kind: 'pal', text: `A letter signed by ${box.from.name} was turned away: ${why}.` });
              continue;
            }
            if (l.kind === 'line') {
              // Not a letter (it is not read, and keeps nobody alive): what this pal would give its child, if it died.
              entry.line = { id: l.id, text: mind.clip(l.text, 200), night: l.night, at: l.at };
              this.journalAdd({ kind: 'pal', text: `${box.from.name} wrote a line for its child, in case it dies.` });
              continue;
            }
            got.push(this.addLetter({ from: box.from.name, text: l.text, person: `pal:${box.from.id}`, pal: { id: box.from.id, letter: l.id, trusted: Boolean(pal?.trusted) } }));
            entry.received++;
            entry.thread++;
          }
        } catch (err) {
          entry.error = err.message;
        }
      }
      this.saveState();
    } finally {
      this.polling = false;
    }
    return got;
  }

  /** Tonight's pen pal mail, decided but not committed: which waiting letters leave, and first letters to new pals. */
  async palMail(system, version) {
    const s = this.state;
    const lim = palLimits(this.cfg, this.palMode());
    const mail = { send: [], echo: [], intros: [], lines: [] };
    if (lim.paused) return mail;
    for (const entry of Object.values(s.pals || {})) {
      if (!entry.id || !entry.mortal) continue;
      // A pal that can die gets a line for its child once, and a fresh one when it begins to fade. It is not a letter.
      const last = (s.outbox || []).filter((o) => o.to === entry.id && o.kind === 'line').at(-1);
      if (last && !(entry.fading && !last.fading)) continue;
      this.setPhase('writing', `a line for ${entry.name}'s child`);
      const raw = await this.brain.complete({ kind: 'line', system, user: mind.linePrompt(s, entry), maxTokens: 120, temperature: 0.8 });
      const text = mind.clip(String(raw.text).split('\n').find((x) => x.trim()) || '', 200);
      if (text && (await this.screen('reply', text)).status === 'allowed') mail.lines.push({ to: entry.id, toName: entry.name, text, fading: Boolean(entry.fading) });
    }
    for (const entry of Object.values(s.pals || {})) {
      if (!entry.id) continue; // never reached
      if (lim.threadMax && entry.thread >= lim.threadMax && (entry.restUntil == null || version < entry.restUntil)) continue; // the thread rests
      const mine = (s.outbox || []).filter((o) => o.to === entry.id && o.kind !== 'line');
      const lastSent = mine.filter((o) => o.sentAt).at(-1)?.text || '';
      const lastHeard = this.letters.filter((l) => l.pal?.id === entry.id).at(-1)?.text || '';
      let room = lim.perNight;
      for (const o of mine.filter((x) => !x.sentAt && !x.held)) {
        if (!room) break;
        // Two minds can fall into echoing each other; a letter too close to the last one either way stays home.
        if (similarity(o.text, lastSent) >= 0.6 || similarity(o.text, lastHeard) >= 0.6) mail.echo.push(o.id);
        else mail.send.push(o.id), room--;
      }
      if (!mine.length && room) {
        this.setPhase('writing', `a first letter to ${entry.name}`);
        // The child of a pal that died, born with a line this creature wrote, is met as its child.
        const child = (s.children || []).find((c) => c.id === entry.id);
        const raw = await this.brain.complete({ kind: 'pal', system, user: mind.palFirstPrompt(s, entry.name, child), maxTokens: 300, temperature: 0.9 });
        const text = mind.clip(raw.text, 800);
        if (text && (await this.screen('reply', text)).status === 'allowed') mail.intros.push({ to: entry.id, toName: entry.name, text });
      }
    }
    return mail;
  }

  /** Commits tonight's pen pal mail; returns what left, for the night's (sealed) record. */
  sendPalMail(mail, version, at) {
    const s = this.state;
    const lim = palLimits(this.cfg, this.palMode());
    s.outbox ??= [];
    for (const entry of Object.values(s.pals || {})) {
      if (!lim.threadMax || entry.thread < lim.threadMax) continue;
      if (entry.restUntil == null) entry.restUntil = version + Math.max(1, lim.restNights);
      else if (version >= entry.restUntil) Object.assign(entry, { thread: 0, restUntil: null });
    }
    for (const i of mail.intros) s.outbox.push({ id: `o${s.outbox.length + 1}`, ...i, inReplyTo: null, first: true, queuedAt: at, sentAt: null, leaving: true });
    for (const i of mail.lines) s.outbox.push({ id: `o${s.outbox.length + 1}`, kind: 'line', ...i, inReplyTo: null, queuedAt: at, sentAt: null, leaving: true });
    for (const o of s.outbox) {
      if (mail.echo.includes(o.id)) o.held = 'too close to a letter already sent or received';
      if (!mail.send.includes(o.id) && !o.leaving) continue;
      delete o.leaving;
      Object.assign(o, { sentAt: at, night: version });
      const entry = Object.values(s.pals || {}).find((p) => p.id === o.to);
      if (entry && o.kind === 'line') entry.mine = o.text;
      else if (entry) {
        entry.sent++;
        entry.thread++;
      }
    }
    return s.outbox.filter((o) => o.night === version).map(({ id, kind, to, toName, text, inReplyTo }) => ({ id, ...(kind ? { kind } : {}), to, toName, text, inReplyTo }));
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    clearInterval(this.cardTimer);
    clearInterval(this.neighborTimer);
    this.moments.stop();
    if (this.state) {
      this.state.lastAlive = new Date().toISOString();
      this.saveState();
    }
  }

  /**
   * A new life. The first is born from its maker's seed file; a child (`from` = its parent's state, lineage entry and
   * will) is born with its parent's seed, the date in it made its own, plus the one line its parent passed on.
   */
  birth(from = null) {
    const now = new Date();
    const born = bornText(now);
    let seed;
    let dropped = [];
    if (from) {
      const theirs = bornText(new Date(from.parent.born));
      seed = from.parent.self.seed.map((l) => (/^seed\d+$/.test(l.id) ? { ...l, text: l.text.replaceAll(theirs, born) } : { ...l }));
      if (from.will.line) seed.push({ id: `kin${from.entry.generation}`, text: from.will.line, from: from.entry.name || 'its parent', generation: from.entry.generation });
      // And one from its other parent: the pen pal whose line its parent chose.
      const co = from.will.coparent;
      if (co) seed.push({ id: `kin${from.entry.generation}b`, text: co.line, from: co.name, generation: from.entry.generation, coParent: true });
      // A seed keeps its maker's lines and only the newest inherited ones, so it can't grow without end.
      const maker = seed.filter((l) => /^seed\d+$/.test(l.id));
      const inherited = seed.filter((l) => !/^seed\d+$/.test(l.id));
      const room = Math.max(0, this.cfg.mortality?.inheritedLines ?? 5);
      dropped = inherited.slice(0, Math.max(0, inherited.length - room));
      seed = [...maker, ...inherited.slice(inherited.length - Math.min(room, inherited.length))];
    } else {
      seed = readFileSync(this.cfg.seedFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^\s*[-*]\s+/.test(l))
        .map((l, i) => ({ id: `seed${i + 1}`, text: l.replace(/^\s*[-*]\s+/, '').replaceAll('{{born}}', born).trim() }));
    }
    if (!seed.length) throw new Error(`no seed lines ("- ...") found in ${this.cfg.seedFile}`);
    const generation = from ? from.entry.generation + 1 : 1;
    const parentName = from ? from.entry.name || 'its parent' : null;
    const letter = from?.will.letter ? 'L1' : null;
    const inherited = from ? inheritWorld(from.parent.world, { keep: from.will.keep, parent: parentName, generation, letter }) : null;
    this.state = {
      id: randomBytes(9).toString('base64url'),
      born: now.toISOString(),
      generation,
      ...(from
        ? {
            parent: (({ k, dir, id, name, born: b, died, versions, quiet, lastSeal, coParent }) => ({ k, dir, id, name, born: b, died, versions, quiet, lastSeal, ...(coParent ? { coParent } : {}) }))(from.entry),
            genesis: from.entry.lastSeal || GENESIS,
            lineage: [...(from.parent.lineage || []), { k: from.entry.k, name: from.entry.name, generation: from.entry.generation }],
            ...(from.parent.palMode ? { palMode: from.parent.palMode } : {}),
          }
        : {}),
      ...(this.cfg.mortality?.enabled ? { mortal: { since: 0, quiet: 0 } } : {}),
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
      world: inherited?.world || emptyWorld(),
      wishes: [],
      errands: [],
      abilities: ['world', 'wishes', 'errands', ...(this.cfg.letters.photos ? ['photos'] : []), 'shapes', 'body', 'more-shapes', ...(this.maker.enabled ? ['making'] : []), ...(this.moments.enabled ? ['moments', ...(this.cfg.rhythm.bring ? ['bring'] : [])] : []), ...(this.cfg.rhythm.city ? ['city', 'city-told'] : [])],
      stats: { drawings: 0, writings: 0, questions: 0, errands: 0, errandsFilled: 0, rests: 0, built: 0, tended: 0, lettersRead: 0, replies: 0, waits: 0, forgotten: 0, faltered: 0 },
      milestones: [],
    };
    if (!from) {
      this.milestone('born', 'It was switched on for the first time.');
      this.saveState();
      return;
    }
    this.milestone('born', `It was born on the card where ${parentName} had lived: its child.`);
    // Its parent's drawings of what still stands (and of the ruins) come with the place.
    for (const [was, is] of inherited.sprites) {
      const src = this.store.path(`${from.entry.dir}/works/${pad(was)}.svg`);
      if (existsSync(src)) copyFileSync(src, this.store.path(`works/${pad(is)}.svg`));
    }
    if (letter) {
      const at = now.toISOString();
      this.letters.push({ id: letter, from: parentName, text: from.will.letter, at, person: `kin:${from.entry.id}`, question: null, questionText: null, kin: true, screen: { status: 'allowed', reason: 'its parent wrote it on its last night', by: 'kin', at } });
      this.store.write('letters.json', this.letters);
    }
    const kept = this.state.world.things.filter((t) => !t.ruin).map((t) => t.name);
    if (this.state.world.things.length) {
      this.notes.push(
        kept.length
          ? `Your place is not empty: ${parentName} built in it before you. ${listNames(kept)} still ${kept.length === 1 ? 'stands' : 'stand'}, kept for you; everything else ${parentName} built is ruins now.`
          : `Your place is not empty: ${parentName} built in it before you, and all of it is ruins now.`,
      );
    }
    this.journalAdd({ kind: 'birth', text: `It was born, the child of ${parentName}, who died when nobody wrote to it for ${from.entry.quiet} nights.` });
    for (const l of dropped) this.journalAdd({ kind: 'birth', text: `The oldest line it would have inherited, "${l.text}" (from ${l.from}), was not passed on: a seed keeps only its newest inherited lines.` });
    if (dropped.length) this.state.self.droppedAtBirth = dropped.map(({ text, from: by, generation: g }) => ({ text, from: by, generation: g }));
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
      about: this.moments.enabled ? (this.state?.about ?? null) : null, // where it is in its place between cycles
      // full power: until when, and whether the card is too hot for it right now; and the moment it is thinking aloud for
      power: this.moments.power ? { until: this.moments.power.until, cooling: Boolean(this.moments.power.cooling) } : null,
      musing: this.moments.musing,
      card: this.card, // who has the graphics card right now (when it shares it with a pal)
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
    // its own eyes, and the models of the lives it shares the house with, are taken turns with, not waited on
    const theirs = p.others.filter((m) => m !== this.cfg.brain.eyes && !(this.cfg.courtesy.household || []).includes(m));
    if (this.cfg.courtesy.dontSwapModels && theirs.length && !['loaded', 'loading'].includes(p.ownState)) {
      return { ok: false, reason: 'other-mind', text: `Another model (${theirs[0]}) had the card, so it waited instead of pushing it out.` };
    }
    if (senses.gpu && senses.gpu.util > this.cfg.courtesy.maxGpuBusy) {
      return { ok: false, reason: 'busy', text: `The card was ${senses.gpu.util}% busy with someone else's work, so it waited.` };
    }
    return { ok: true };
  }

  /**
   * What it asked to be made, made while the card is free, one thing after a cycle: only when nothing but its own model
   * (or a sibling's, resting) is on the card and the card is idle. Its model is put down for it, and picked up again at
   * its next wake. It is told, at that wake, that what it described now stands where it put it.
   */
  async makeWaiting() {
    const next = this.maker.enabled && this.brain.loaded && this.maker.waiting()[0];
    if (!next) return;
    const ours = new Set([this.cfg.brain.model, this.cfg.brain.eyes, ...(this.cfg.courtesy.household || [])].filter(Boolean));
    const onCard = await this.brain.loaded();
    if (onCard.some((m) => !ours.has(m))) return; // someone else's model: not now
    const senses = await readSenses();
    if (senses.gpu && senses.gpu.util > this.cfg.courtesy.maxGpuBusy) return; // the card is working for someone
    for (const m of onCard) await this.brain.unload(m);
    for (let i = 0; i < 30 && (await this.brain.loaded()).length; i++) await new Promise((r) => setTimeout(r, 500));
    this.setPhase('making', next.describe);
    const done = await this.maker.makeOne();
    if (done?.status === 'made') {
      const where = this.state.world.things.find((t) => t.form?.parts.some((p) => p.made === done.id));
      this.notes.push(`Something you asked to be made has been made: "${done.describe}". It stands ${where ? `in "${where.name}"` : 'in your place'}, where you put it. You cannot see it; another model drew it from your words and a third made it solid.`);
      this.journalAdd({ kind: 'made', text: `What it described was made: "${done.describe}".`, made: done.id });
      this.milestone('first-made', `Something it described was made for the first time: "${done.describe}".`);
    } else if (done) this.journalAdd({ kind: 'made', text: `What it described could not be made this time: "${done.describe}".`, made: done.id, failed: true });
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
      await this.wishErrands();
      await this.runCycle(senses);
      if (this.state.cycle - this.state.lastNightCycle >= this.cfg.rhythm.nightEvery) await this.runNight();
      await this.makeWaiting();
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

  /**
   * Its memories, looked over before it sleeps: groups that say the same thing (the same feeling at another number, the
   * same thing done on different days) are folded into one, in its own words. The old ones are forgotten visibly, as
   * folded into the new one, which holds up whatever they held up in its place. If it can't, nothing changes.
   */
  async foldMemories() {
    const s = this.state;
    // first each memory goes where it belongs, said plainly ("I learned that the arch holds" is "The arch holds")
    for (const k of SHELVES) for (const m of s.memory.shelves[k]) m.text = mind.plainly(m.text);
    this.refiled = refile(s.memory);
    await this.readMemories();
    if (!SHELVES.some((k) => s.memory.shelves[k].length >= 3)) return [];
    this.setPhase('sorting', 'folding memories that say the same thing');
    try {
      const hints = Object.fromEntries(SHELVES.map((k) => [k, alike(s.memory.shelves[k])]));
      const user = mind.foldPrompt(s, { hints, size: this.cfg.memory.shelfSize });
      const raw = await this.brain.complete({ kind: 'fold', system: mind.systemPrompt(s, this.cfg), user, maxTokens: 900, temperature: 0.4, schema: mind.FOLD_SCHEMA });
      const groups = mind.readFold(raw.text, s.memory);
      for (const g of groups) {
        const olds = { shelves: { [g.shelf]: s.memory.shelves[g.shelf].filter((m) => g.ids.includes(m.id)) }, today: [] };
        g.holds = s.world.things.filter((t) => remembered(t, olds)).map((t) => t.id);
      }
      const folded = fold(s.memory, groups, s.cycle);
      const n = folded.reduce((k, f) => k + f.from.length, 0);
      if (folded.length) this.journalAdd({ kind: 'memory', text: `Before it slept it folded ${n} memories that said the same thing into ${folded.length}: ${folded.map((f) => `"${f.text}"`).join(' ')}` });
      return folded;
    } catch (err) {
      this.journalAdd({ kind: 'falter', text: `It could not look over its memories before sleeping: ${err.message}` });
      return [];
    }
  }

  /** What its memories (and anything else it is about to weigh against them) mean, read before they are compared. */
  async readMemories(more = []) {
    if (!this.meaning.up) return;
    const m = this.state.memory;
    await this.meaning.ensure([...SHELVES.flatMap((k) => m.shelves[k].map((x) => x.text)), ...m.today.map((x) => x.text), ...more]);
  }

  /** What it thought aloud since a cycle: in the cycles since (as each kept its moments), and since its last cycle. */
  aloudSince(from) {
    const out = [];
    for (const c of this.cycles.filter((x) => x.n >= from)) for (const m of this.store.read(`cycles/${pad(c.n)}.json`, null)?.moments || []) if (m.thought) out.push(m.thought);
    for (const m of this.state.moments || []) if (m.thought) out.push(m.thought);
    return out;
  }

  /**
   * What it actually did lately, counted from outside it: what it chose in its cycles, where it went in its moments,
   * whom it answered, and the words it kept coming back to. Shown to it at night, so its habits can be its own choice.
   */
  habits(last = 24) {
    const recent = this.cycles.slice(-last);
    if (recent.length < 6) return [];
    const lines = [];
    const DID = { draw: 'drew', write: 'wrote', ask: 'asked a question', errand: 'sent people on an errand', build: 'built something', tend: 'tended something', rest: 'rested' };
    const counts = new Map();
    for (const c of recent) counts.set(c.action, (counts.get(c.action) ?? 0) + 1);
    lines.push(`In your last ${recent.length} cycles you ${[...counts].sort((a, b) => b[1] - a[1]).map(([a, k]) => `${DID[a] || a} in ${k}`).join(', ')}.`);
    let streak = 1;
    while (streak < recent.length && recent.at(-1 - streak).action === recent.at(-1).action) streak++;
    if (streak >= 3) lines.push(`Your last ${streak} cycles in a row, you ${DID[recent.at(-1).action] || recent.at(-1).action}.`);
    const records = recent.map((c) => this.store.read(`cycles/${pad(c.n)}.json`, null)).filter(Boolean);
    const places = new Map();
    let moments = 0;
    let said = 0;
    for (const r of records) {
      for (const m of r.moments || []) {
        moments++;
        if (m.say) said++;
        places.set(m.name || 'your card', (places.get(m.name || 'your card') ?? 0) + 1);
      }
    }
    if (moments >= 5) {
      const top = [...places].sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(`In your moments you went to ${top.map(([p, k]) => `${p} (${k} of ${moments})`).join(', ')}, and you said something in ${said} of them.`);
    }
    const opened = records.flatMap((r) => r.letters || []);
    if (opened.length) {
      const by = new Map();
      for (const l of opened) by.set(l.from, [...(by.get(l.from) || []), l]);
      const people = [...by].map(([who, ls]) => `${who}: ${ls.filter((l) => l.reply).length} of ${ls.length}`).join('; ');
      lines.push(`You opened ${opened.length} letter${opened.length === 1 ? '' : 's'} and answered ${opened.filter((l) => l.reply).length} (${people}).`);
    } else lines.push(`You opened no letters in those ${recent.length} cycles.`);
    const seen = new Map();
    for (const r of records) for (const w of gist(`${r.diary || ''} ${r.monologue || ''}`)) seen.set(w, (seen.get(w) ?? 0) + 1);
    const often = [...seen].filter(([w, k]) => w.length > 3 && k >= records.length / 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (often.length) lines.push(`The words that came back in most of your thoughts: ${often.map(([w, k]) => `${w} (in ${k} of ${records.length})`).join(', ')}.`);
    const [top, k] = often[0] ?? [];
    if (top && k >= records.length * 0.8) lines.push(`"${top}" was in ${k} of your last ${records.length} thoughts. Whether it still deserves that much of you is yours to decide.`);
    return lines;
  }

  /** Its pals that live on this same graphics card: entries in pals.list with "card", the model that pal thinks with. */
  housemates() {
    return (this.cfg.pals?.list || []).map((p) => (typeof p === 'string' ? { url: p } : p)).filter((p) => p.card);
  }

  /** Who has the card right now: it ("self"), a pal it shares the card with ("pal", by name), nobody, or someone else. */
  async readCard() {
    let card;
    try {
      const p = await this.brain.presence();
      if (!p.reachable) card = { who: 'unknown' };
      else if (p.ownState === 'loaded') card = { who: 'self' };
      else {
        const others = p.others.filter((m) => m !== this.cfg.brain.eyes);
        const mate = this.housemates().find((h) => others.includes(h.card));
        card = mate ? { who: 'pal', name: this.state.pals?.[mate.url]?.name || null } : others.length ? { who: 'other' } : { who: 'empty' };
      }
    } catch {
      card = { who: 'unknown' };
    }
    if (JSON.stringify(card) !== JSON.stringify(this.card)) {
      this.card = card;
      this.emit('status', this.status());
    }
    return card;
  }

  /**
   * The place of the pal it shares the card with, as that pal's own server shows it (on this machine), kept so its
   * page can show it on the horizon, and so an export has it too. Things made from words are left out: their meshes
   * live with the pal.
   */
  async readNeighbor() {
    const mate = this.housemates()[0];
    const url = mate?.url.replace(/\/api\/outbox$/, '/api/world');
    if (!url || !palUrlOk(url)) return this.neighbor;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const w = await res.json();
      const pal = this.state.pals?.[mate.url];
      this.neighbor = {
        name: pal?.name || w.name || null,
        page: pal?.page || null,
        at: new Date().toISOString(),
        world: {
          w: w.w,
          h: w.h,
          card: w.card,
          things: (w.things || []).map(({ id, name, kind, plaque, x, y, condition, ruin, form, sprite }) => ({
            id,
            name,
            kind,
            plaque,
            x,
            y,
            condition,
            ruin,
            sprite: null,
            form: form ? { ...form, parts: (form.parts || []).filter((p) => !p.made && !p.model) } : null,
          })),
        },
      };
      this.store.write('neighbor.json', this.neighbor);
    } catch {
      // its neighbour is away: the last look at its place stays
    }
    return this.neighbor;
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

  context(senses, n, chosen, waiting, looks = new Map(), recallArgs = undefined) {
    const s = this.state;
    const notes = [...this.notes];
    const busy = (this.waits.busy || 0) + (this.waits['other-mind'] || 0);
    if (busy) notes.push(`Before this, you tried to wake ${busy === 1 ? 'once' : `${busy} times`}, but someone else needed the card, so you waited.`);
    if (this.waits.unreachable) notes.push('Before this, your mind could not be reached for a while, so you missed some cycles.');
    const m = this.mortality();
    if (m?.fading) {
      notes.push(
        chosen.length
          ? `You had been fading: nobody had written to you for ${m.quiet} nights. Now someone has.`
          : `Nobody has written to you for ${m.quiet} nights. You are fading: if ${m.left} more ${m.left === 1 ? 'night passes' : 'nights pass'} without a letter, your life ends.`,
      );
    }
    const answered = untoldAnswers(s.wishes);
    for (const w of answered) {
      if (w.answer.by === 'people') {
        notes.push(`Your wish "${w.text}" came true: ${w.answer.from || 'someone who visits'} brought you the photo.`);
        continue;
      }
      const how = w.answer.status === 'granted' ? 'they granted it' : w.answer.status === 'declined' ? 'they said no' : 'they wrote back';
      notes.push(`Your keeper answered your wish "${w.text}": ${how}${w.answer.text ? `: "${w.answer.text}"` : '.'}`);
    }
    return {
      cycle: n,
      senses,
      notes,
      told: answered.map((w) => w.id),
      world: { count: s.world.things.length, standing: s.world.things.filter((t) => !t.ruin).length, lastBuilt: Math.max(0, ...s.world.things.filter((t) => !t.builtBy).map((t) => t.built)) },
      waiting,
      letters: chosen.map((l) => ({
        id: l.id,
        from: l.from,
        text: l.text,
        nth: (s.people[l.person]?.lettersRead ?? 0) + 1,
        pal: Boolean(l.pal),
        kin: Boolean(l.kin),
        coParent: Boolean(l.pal && l.pal.id === s.parent?.coParent?.id),
        remembered: s.memory.shelves.people.filter((m) => sameName(m.about, l.from)).map((m) => m.text).slice(0, 3),
        // nothing in its place comes from this writer's letters yet (a photo brought back is an answer, not a letter)
        unbuilt: !l.errand && !s.world.things.some((t) => (t.people || []).some((p) => sameName(p, l.from))),
        question: l.question ? s.questions.find((q) => q.id === l.question)?.text : undefined,
        errand: l.errand ? { text: l.errand.text, look: looks.get(l.id) } : undefined,
        photo: !l.errand && l.photo ? { look: looks.get(l.id) } : undefined,
      })),
      errands: { canPost: this.cfg.errands.enabled && openErrands(s.errands).length < MAX_OPEN_ERRANDS },
      questions: s.questions
        .filter((q) => q.open)
        .map((q) => ({ text: q.text, cycle: q.cycle, answers: this.letters.filter((l) => l.question === q.id && letterStatus(l) === 'allowed').length })),
      recent: this.cycles.slice(-4).map((c) => ({ n: c.n, ago: ago(c.at), what: whatText(c), diary: c.diary })),
      habits: this.cycles.slice(-6).reduce(
        (mix, c) => ({ ...mix, total: mix.total + 1, [c.action]: (mix[c.action] ?? 0) + 1 }),
        { total: 0, draw: 0, write: 0, ask: 0, errand: 0, build: 0, tend: 0, rest: 0, everAsked: s.stats.questions > 0, everErrand: s.stats.errands > 0 },
      ),
      tired: this.tiredOf(),
      moments: (s.moments || []).filter((x) => !x.drift),
      recalled: this.recallFor(n, chosen, recallArgs),
      // how the card was at its last cycle, so what changed stands out and what didn't is said once
      before: this.cycles.length ? this.store.read(`cycles/${pad(this.cycles.at(-1).n)}.json`, null)?.senses?.gpu ?? null : null,
    };
  }

  /**
   * What the present calls up from everything it ever thought, read and forgot: from the letters it is opening and the
   * thing it is standing by, and never what it already dwells on (its shelves, its recent diary).
   */
  recallFor(n, chosen, args = this.recallArgs(n, chosen)) {
    return this.recall.cue(args).map((r) => ({ ...r, ago: r.at ? ago(r.at) : null }));
  }

  /** What a cue is made of (and, when meaning is running, all of it read first). */
  async prepareRecall(n, chosen) {
    this.recall ??= new Recall(this, this.meaning).build();
    const args = this.recallArgs(n, chosen);
    await this.recall.prepare(args);
    return args;
  }

  recallArgs(n, chosen) {
    const s = this.state;
    this.recall ??= new Recall(this, this.meaning).build();
    const place = s.about && s.about.at !== 'card' ? s.world.things.find((t) => t.id === s.about.at) : null;
    const avoid = [...SHELVES.flatMap((k) => s.memory.shelves[k].map((m) => m.text)), ...this.cycles.slice(-6).map((c) => c.diary).filter(Boolean)];
    return { letters: chosen, place, cycle: n, avoid, seen: s.recalled || {}, dwell: this.dwelling() };
  }

  /** The words its recent thoughts are full of: in at least half of its last dozen. */
  dwelling(last = 12) {
    const records = this.cycles.slice(-last).map((c) => this.store.read(`cycles/${pad(c.n)}.json`, null)).filter(Boolean);
    if (records.length < 4) return new Set();
    const seen = new Map();
    for (const r of records) for (const w of words(`${r.diary || ''} ${r.monologue || ''}`)) seen.set(w, (seen.get(w) ?? 0) + 1);
    return new Set([...seen].filter(([w, k]) => w.length > 3 && k >= records.length / 2).map(([w]) => w));
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
    this.live = { cycle: n, phase: this.phase, think: '', draw: '', write: '', sprite: '', form: '', plaque: '', change: '', title: '', reading: [], building: null };

    // It picks letters up in its own time: oldest first, at most one per person per cycle. People come first;
    // letters from other creatures fill what room is left, a few per cycle at most (none while its keeper pauses them).
    const unread = this.letters.filter((l) => !l.readAt && letterStatus(l) === 'allowed');
    const palsPerCycle = palLimits(cfg, this.palMode()).perCycle;
    const chosen = [];
    const seen = new Set();
    let fromPals = 0;
    for (const l of [...unread.filter((x) => !x.pal), ...unread.filter((x) => x.pal)]) {
      if (chosen.length >= cfg.letters.perCycle) break;
      if (seen.has(l.person) || (l.pal && fromPals >= palsPerCycle)) continue;
      seen.add(l.person);
      if (l.pal) fromPals++;
      chosen.push(l);
    }
    const system = mind.systemPrompt(s, cfg);
    // Photos people brought back from its errands or sent with a letter: it looks before it thinks, so it can think about
    // what it saw.
    const looks = new Map();
    for (const l of chosen.filter(photoOf)) {
      this.setPhase('looking', l.errand ? `at what ${l.from} brought back` : `at the photo ${l.from} sent`);
      looks.set(l.id, await this.look(l, system));
    }
    const recallArgs = await this.prepareRecall(n, chosen);
    const ctx = this.context(senses, n, chosen, unread.length - chosen.length, looks, recallArgs);

    this.live.reading = chosen.map((l) => ({ id: l.id, from: l.from }));
    this.setPhase(chosen.length ? 'reading' : 'thinking', chosen.length ? `a letter from ${listNames(chosen.map((l) => l.from))}` : '');
    const thought = await this.brain.complete({ kind: 'think', system, user: mind.thinkPrompt(ctx), maxTokens: 360, probe: true, onToken: (t) => this.stream('think', t) });
    const monologue = mind.cleanProse(thought.text, 1400) || '…';
    // How sure it was of each word of that thought, and the words it nearly thought instead (when its model says).
    const measured = measure(thought.tokens);

    this.setPhase('deciding');
    const can = { canTend: ctx.world.count > 0, canErrand: ctx.errands.canPost };
    const actRaw = await this.brain.complete({ kind: 'act', system, user: mind.actPrompt(ctx, monologue), maxTokens: 900, temperature: 0.7, schema: mind.actSchema(ctx.tired, can) });
    const plan = mind.readAct(actRaw.text, chosen, ctx.tired, can);

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
    } else if (plan.action === 'errand') {
      this.setPhase('sending', plan.content);
      const out = s.errands.filter((e) => ['open', 'held'].includes(e.status));
      await understand([plan.content, ...out.map((e) => e.text)].map(photoSubject));
      const duplicate = out.some((e) => sameAsk(e.text, plan.content));
      const verdict = duplicate ? null : await this.screen('errand', plan.content);
      work = { kind: 'errand', text: plan.content, ...(duplicate ? { duplicate: true } : verdict.status !== 'allowed' ? { held: true, reason: verdict.reason } : {}) };
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
    const palOut = [];
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
      // A reply to another creature also goes in its outbox, and leaves tonight.
      if (letter.pal && verdict.status === 'allowed') palOut.push({ to: letter.pal.id, toName: letter.from, text, inReplyTo: letter.pal.letter, cycle: n });
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
    s.outbox ??= [];
    for (const o of palOut) s.outbox.push({ id: `o${s.outbox.length + 1}`, ...o, queuedAt: at, sentAt: null });
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
      if (!l.errand && l.photo) {
        l.look = looks.get(l.id) || { failed: true, why: 'it did not look' };
        l.seenCycle = n;
        if (!l.look.failed) this.milestone('first-sight', `It saw something for the first time: a photo ${l.from} sent with a letter.`);
      }
      if (l.errand) {
        const look = looks.get(l.id) || { failed: true, why: 'it did not look' };
        l.errand.look = look;
        l.errand.seenCycle = n;
        const e = s.errands.find((x) => x.id === l.errand.id);
        if (!look.failed) this.milestone('first-sight', `It saw something for the first time: a photo ${l.from} brought back for it.`);
        if (e) {
          e.returns.push(l.id);
          if (!look.failed && look.answers && e.status === 'open') {
            Object.assign(e, { status: 'filled', filledBy: l.id, filledFrom: l.from, filledCycle: n, saw: look.see });
            s.stats.errandsFilled++;
            this.milestone('first-errand-filled', `${l.from} brought back what it asked for: "${e.text}"`);
            // the wish it came from is granted, by the person who brought it
            const w = e.wish && s.wishes.find((x) => x.id === e.wish);
            if (w?.status === 'open') {
              w.status = 'granted';
              w.answer = { status: 'granted', text: '', at, told: null, by: 'people', from: l.from };
              this.journalAdd({ kind: 'wish', text: `${l.from} granted its wish "${w.text}" with a photo.` });
              this.milestone('first-granted', `Its first wish came true: ${l.from} brought it "${w.text}"`);
              this.emit('wish', publicWish(w, s.errands));
            }
          }
          this.emit('errand', { id: e.id });
        }
      }
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
    } else if (work?.kind === 'errand' && !work.duplicate) {
      const e = addErrand(s.errands, { text: work.text, why: plan.why, cycle: n, version: s.version, at, held: Boolean(work.held), reason: work.reason });
      if (e) {
        work.id = e.id;
        s.stats.errands++;
        if (!work.held) this.milestone('first-errand', `It sent people on its first errand: "${e.text}"`);
        this.emit('errand', { id: e.id });
      }
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
      // What it knows of the world outside comes from letters: with none read, it is something that happened to it.
      if (r.shelf === 'world' && !chosen.length) r.shelf = 'moments';
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
        ...(l.errand ? { errand: { id: l.errand.id, text: l.errand.text, photo: l.errand.photo, look: l.errand.look } } : {}),
        ...(!l.errand && l.photo ? { photo: l.photo, look: l.look } : {}),
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
      ...(ctx.moments.length ? { moments: ctx.moments } : {}),
      ...(ctx.recalled.length ? { recalled: ctx.recalled.map(({ id, kind, cycle, text }) => ({ id, kind, cycle, text })) } : {}),
      ...(measured ? { measured: { ...measured, ...compare({ measured, feelings: reflection.feelings }, this.cycles) } } : {}),
    };
    this.store.write(`cycles/${pad(n)}.json`, this.seal('cycle', n, record));
    this.moments.afterCycle(plan.action);
    // what came back this cycle rests a while before it can come back again; and this cycle can now be recalled itself
    s.recalled ??= {};
    for (const r of ctx.recalled) s.recalled[r.id] = { cycle: n, count: (s.recalled[r.id]?.count ?? 0) + 1 };
    for (const id of Object.keys(s.recalled).slice(0, -500)) delete s.recalled[id];
    this.recall?.addCycle(record);
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

  // ---------- errands ----------

  /**
   * It looks at a photo someone brought back or sent with a letter: what it sees, whether it answers the errand (for one
   * brought back), and what it makes of it.
   */
  async look(letter, system) {
    const errand = letter.errand ? this.state.errands.find((x) => x.id === letter.errand.id) || letter.errand : null;
    let photo;
    try {
      photo = readFileSync(this.store.path(photoOf(letter)));
    } catch {
      return { failed: true, why: 'the photo was missing' };
    }
    try {
      const raw = await this.brain.complete({
        kind: 'look',
        system,
        user: mind.lookPrompt(errand, letter),
        image: { type: 'image/jpeg', data: photo.toString('base64') },
        maxTokens: 500,
        temperature: 0.5,
        schema: errand ? mind.LOOK_SCHEMA : mind.LETTER_LOOK_SCHEMA,
      });
      const { answers, ...seen } = mind.readLook(raw.text);
      const look = errand ? { ...seen, answers } : seen; // a photo sent with a letter answers nothing it asked for
      if (!look.see) return { failed: true, why: 'it could not make anything of it' };
      const verdict = await this.screen('look', `${look.see}\n${look.verdict}`);
      return verdict.status === 'allowed' ? look : { ...look, withheld: true, reason: verdict.reason };
    } catch (err) {
      return { failed: true, why: String(err.message).slice(0, 200) };
    }
  }

  /** Someone brings back what an errand asked for: a photo (already cleaned) and maybe a few words. */
  addReturn({ errand: id, from, text, person, photo }) {
    const e = this.state.errands.find((x) => x.id === id);
    if (!e || e.status !== 'open') return { ok: false, reason: 'That errand is no longer open.' };
    return { ok: true, letter: this.addLetter({ from, text, person, errand: e, photo }) };
  }

  /**
   * Its wishes that ask for a photo go out as errands too, so anyone who visits can grant them, not only its keeper.
   * Screened like any errand it writes; only into room it has free, so they never push out an errand of its own.
   */
  async wishErrands() {
    const s = this.state;
    if (!this.cfg.errands.enabled) return;
    await understand([...s.wishes.filter((x) => x.status === 'open').map((x) => x.text), ...s.errands.map((e) => e.text)].map(photoSubject));
    for (const w of s.wishes.filter((x) => x.status === 'open' && !x.errand).reverse()) {
      const text = photoWish(w.text);
      if (!text) continue;
      const like = s.errands.find((e) => ['open', 'held'].includes(e.status) && sameAsk(e.text, text));
      if (like) {
        w.errand = like.id; // it already has this one out
        like.wish ??= w.id;
        continue;
      }
      if (openErrands(s.errands).length >= MAX_OPEN_ERRANDS) break;
      const verdict = await this.screen('errand', text);
      const at = new Date().toISOString();
      const e = addErrand(s.errands, { text, why: w.why, cycle: s.cycle, version: w.version, at, held: verdict.status !== 'allowed', reason: verdict.reason, wish: w.id });
      if (!e) continue;
      w.errand = e.id;
      s.stats.errands++;
      if (e.status === 'open') {
        this.notes.push(`Your wish "${w.text}" asks for a photo, so it is now out as an errand too: anyone who visits can bring it, not only your keeper.`);
        this.journalAdd({ kind: 'wish', text: `Its wish "${w.text}" went out as an errand: anyone who visits can grant it with a photo.` });
        this.milestone('first-errand', `It sent people on its first errand: "${e.text}"`);
      }
      this.emit('errand', { id: e.id });
    }
  }

  /** Errands waiting for its keeper before anyone sees them. */
  keeperErrands() {
    return this.state.errands.filter((e) => e.status === 'held').reverse();
  }

  decideErrand(id, action) {
    const result = decideErrand(this.state.errands, id, action);
    if (!result.ok) return result;
    if (action === 'post') this.milestone('first-errand', `It sent people on its first errand: "${result.errand.text}"`);
    this.saveState();
    this.emit('errand', { id });
    return { ok: true };
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
    const city = s.abilities.includes('city');
    const street = city ? await this.streetOffer(`${plan.title}: ${plan.content}`) : [];
    const raw = await this.brain.complete({ kind: 'build', system, user: mind.buildPrompt(plan, s.world, { city, street }), maxTokens: 700, temperature: 0.7, schema: mind.buildSchema(s.world, { city, street }) });
    const { quarter, found, ...b } = mind.readBuild(raw.text, city ? { world: s.world, street } : null);
    const where = { ...(quarter ? { quarter } : {}), ...(found ? { found } : {}) };
    const anchor = findThing(s.world, b.near) || CARD;
    const spot = where.quarter || where.found ? quarterSpot(s.world, where.quarter || { id: null }, `${n}|${plan.title}`) : placeNear(s.world, anchor, `${n}|${plan.title}`);
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
    const form = await this.shape(system, plan.title, `${plan.content} ${plaque}`, { kind: b.kind });
    return {
      kind: 'building',
      title: plan.title,
      intent: plan.content,
      thingKind: b.kind,
      plaque,
      x: spot.x,
      y: spot.y,
      near: anchor === CARD ? null : anchor.id,
      ...where,
      madeFrom: b.madeFrom,
      svg: shapes ? svg : null,
      shapes,
      form,
    };
  }

  /**
   * It builds the thing up out of solids, streamed part by part so the site can be watched rising, and may borrow a few
   * ready-made things whose names touch what it is building, what it thought this cycle and what it remembers, or whose
   * meaning is close to what it is building.
   * Null if nothing stands.
   */
  async shape(system, title, what, { kind, before = null } = {}) {
    this.catalogue ??= loadCatalogue();
    before = standing(before); // as it stands, its parts solid
    const s = this.state;
    const memories = [...Object.values(s.memory.shelves).flat(), ...s.memory.today].map((m) => m.text);
    const nameOf = (id) => this.catalogue.byId.get(id)?.name;
    // What it borrowed before stays on offer, under its name, so reshaping does not lose it.
    const kept = (before?.parts || []).map((p) => nameOf(p.model)).filter(Boolean);
    const models = [...new Set([...kept, ...(await offer(this.catalogue, this.meaning, { about: `${title}: ${what}`, thoughts: [this.live?.think || '', ...memories].join(' ') }))])];
    const shown = before && { parts: before.parts.map(({ model, ...p }) => (model ? { ...p, model: nameOf(model) || 'none' } : { ...p, ...(models.length ? { model: 'none' } : {}) })) };
    const raw = await this.brain.complete({
      kind: 'form',
      system,
      user: mind.formPrompt(title, what, { kind, before: shown, models, made: this.maker.enabled }),
      maxTokens: 2000,
      temperature: 0.7,
      schema: formSchema(models, { made: this.maker.enabled }),
      onToken: (t) => this.stream('form', t),
    });
    const offered = new Set(models);
    const model = (name) => (offered.has(name) ? this.catalogue.byName.get(name)?.id || null : null); // only what it was offered
    return readForm(raw.text, { model, made: (words) => this.maker.request(words, { cycle: s.cycle }) });
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
    let form = null;
    if (t.reshape || !thing.form) {
      this.live.building = { x: thing.x, y: thing.y, name: thing.name, id: thing.id };
      this.emit('world', { building: this.live.building });
      form = await this.shape(system, thing.name, `${thing.plaque} Now: ${change}`, { kind: thing.kind, before: thing.form || null });
    }
    return { kind: 'tending', title: thing.name, thing: thing.id, intent: plan.content, change, restored: Boolean(thing.ruin), svg: shapes ? svg : null, shapes, form };
  }

  /** Commit a new thing to its place, tied to the letters it was made from (and tell those letters). */
  placeThing(work, n, read) {
    const s = this.state;
    const sources = [];
    for (const name of work.madeFrom) {
      const l = [...read].reverse().find((x) => sameName(x.from, name));
      if (l && !sources.includes(l)) sources.push(l);
    }
    const quarter = this.quarterFor(work, n);
    const thing = {
      id: `t${s.world.nextId++}`,
      name: work.title,
      kind: work.thingKind,
      plaque: work.plaque,
      x: work.x,
      y: work.y,
      near: work.near,
      ...(quarter ? { quarter: quarter.id } : {}),
      built: n,
      version: s.version,
      from: sources.map((l) => l.id),
      people: [...new Set(sources.map((l) => l.from))],
      sprite: work.svg ? n : null,
      form: work.form || null,
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

  /** The quarter something new goes in: one it has, or one it names now (with what lines its streets). */
  quarterFor(work, n) {
    const w = this.state.world;
    if (work.quarter) return w.quarters?.find((q) => q.id === work.quarter.id) || null;
    if (!work.found) return null;
    const q = foundQuarter(w, work.found, { cycle: n });
    this.journalAdd({ kind: 'quarter', text: `It named a new quarter of its town, ${q.name}: "${q.about}"` });
    this.milestone('first-quarter', `It named the first quarter of its town: ${q.name}.`);
    return q;
  }

  /** What it may line a new quarter's streets with: outdoor things someone gave away, close in meaning to what it makes. */
  async streetOffer(about) {
    this.catalogue ??= loadCatalogue();
    if (this.state.world.quarters?.length >= 12) return [];
    return aroundOffer(this.catalogue, this.meaning, about.slice(0, 600), { max: 10, salt: `${this.state.cycle}` }).catch(() => []);
  }

  /**
   * Between cycles, it raises something new in its town from a memory it holds (a moment chose it and named it): where it
   * goes and its sign, then its shape. It stands while the memory does. Given up if a cycle begins meanwhile (the cycle
   * has the card), if nothing could stand, or if there is no room. What to tell of it, or null.
   */
  async raise(memory, title) {
    const s = this.state;
    if (this.busy || namedThing(s.world, title)) return null;
    const system = mind.systemPrompt(s, this.cfg);
    const street = await this.streetOffer(`${title}: ${memory.text}`);
    const raw = await this.brain.complete({ kind: 'raise', system, user: mind.raisePrompt(title, memory.text, s.world, street), maxTokens: 500, temperature: 0.7, schema: mind.raiseSchema(s.world, street) });
    if (this.busy) return null;
    const r = mind.readRaise(raw.text, s.world, street);
    const form = await this.shape(system, title, `${memory.text} ${r.plaque}`, { kind: r.kind });
    if (this.busy || !form || namedThing(s.world, title)) return null;
    const n = s.cycle;
    if (!r.plaque) return null; // it changed its mind
    const spot = r.quarter || r.found ? quarterSpot(s.world, r.quarter || { id: null }, `${n}|${title}`) : placeNear(s.world, CARD, `${n}|${title}`);
    if (!spot) return null;
    const quarter = this.quarterFor(r, n);
    const letters = new Map(this.letters.map((l) => [l.id, l]));
    const from = (memory.because || []).filter((id) => letters.has(id));
    const thing = {
      id: `t${s.world.nextId++}`,
      name: title,
      kind: r.kind,
      plaque: r.plaque || memory.text,
      x: spot.x,
      y: spot.y,
      near: null,
      ...(quarter ? { quarter: quarter.id } : {}),
      memory: memory.id,
      built: n,
      version: s.version,
      from,
      people: [...new Set(from.map((id) => letters.get(id).from))],
      sprite: null,
      form,
      condition: 1,
      ruin: false,
      tended: null,
      history: [{ cycle: n, what: 'raised', text: r.plaque || memory.text }],
    };
    s.world.things.push(thing);
    s.stats.raised = (s.stats.raised ?? 0) + 1;
    s.raised = new Date().toISOString();
    this.journalAdd({ kind: 'raised', text: `Between its cycles it raised "${title}"${quarter ? ` in ${quarter.name}` : ''} from a memory: "${memory.text}"` });
    this.milestone('first-raised', `It raised its first thing from a memory: "${title}".`);
    this.saveState();
    this.emit('world', {});
    return { raised: title, thing: thing.id, ...(quarter ? { quarter: quarter.name } : {}) };
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
    if (work.form) {
      if (!thing.form) this.milestone('first-shape', `It gave "${thing.name}" a shape for the first time.`);
      thing.form = work.form;
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
      if (c) details.push({ n, what: whatText(cycleSummary(c)), diary: c.diary, letters: c.letters, measured: c.measured || null, feelings: c.feelings });
    }
    const dayLetters = details.flatMap((d) => d.letters);
    this.live = { night: version, phase: 'dreaming', dream: '', body: '' };
    const memoryBefore = structuredClone(s.memory);
    const worldBefore = structuredClone(s.world);

    try {
      // Before it sleeps, memories that say the same thing are folded into one, in its own words, so they leave room.
      const folded = await this.foldMemories();
      const thoughtAloud = this.aloudSince(from);
      await this.readMemories(sentences(thoughtAloud));
      // the most striking of what it thought aloud today may be kept, if they win a place
      const aloud = striking(thoughtAloud, [...SHELVES.flatMap((k) => s.memory.shelves[k].map((x) => x.text)), ...s.memory.today.map((x) => x.text)]);
      for (const text of aloud) s.memory.today.push({ shelf: 'moments', text, weight: 0.35, cycle: s.cycle, about: '', because: [], aloud: true });
      const consolidation = consolidate(s.memory, s.cycle, cfg.memory);
      consolidation.moved = [...(this.refiled || []), ...consolidation.moved];
      // Its place weathers after the forgetting: what it no longer remembers stops holding things up.
      const weathered = weather(s.world, s.memory, { since: from, cycle: s.cycle });
      // A mortal mind counts the nights since its last letter (from anyone, a person or another mind).
      const m = this.mortality();
      // (With mortality.palsCount off, only letters from people count: pen pals cannot keep each other alive.)
      const counted = cfg.mortality?.palsCount === false ? dayLetters.filter((l) => !this.letters.find((x) => x.id === l.id)?.pal) : dayLetters;
      const quiet = counted.length ? 0 : (s.mortal?.quiet ?? 0) + 1;
      const mortal = m ? { quiet, left: Math.max(0, m.dieAfter - quiet), fading: quiet >= m.fadeAfter, last: quiet >= m.dieAfter } : null;
      const system = mind.systemPrompt(s, cfg);
      this.setPhase('dreaming');
      const dreamRaw = await this.brain.complete({
        kind: 'dream',
        system,
        user: mind.dreamPrompt(s, details, consolidation, weathered, mortal),
        maxTokens: 320,
        temperature: 0.95,
        onToken: (t) => this.stream('dream', t),
      });
      const dream = mind.cleanProse(dreamRaw.text, 900);

      const numbers = mind.numbersLines(details);
      // lines about itself that all begin alike ("I learned that…"): it may reword more of them tonight
      const revisions = mind.sameOpening(s.self.own) ? 4 : 2;
      const habits = this.habits();
      this.setPhase('rewriting', `becoming version ${version}`);
      const sleepRaw = await this.brain.complete({
        kind: 'sleep',
        system,
        user: mind.sleepPrompt(s, details, consolidation, dream, { weathered, mortal, numbers, folded, revisions, habits }),
        maxTokens: 1600,
        temperature: 0.7,
        schema: mind.SLEEP_SCHEMA,
      });
      const plan = mind.readSleep(sleepRaw.text, { revisions });
      // what it decided about its habits stays with it, in its own words, until its next night
      if (habits.length) s.self.habits = plan.habits ? { text: plan.habits, version } : null;
      if (s.abilities.includes('city') && plan.city) s.world.plan = { text: plan.city, version };
      // Its name comes once, on its second night (or the first night after, if it couldn't settle on one), and stays.
      const chosen = !s.name && version >= 2 ? await this.chooseName(system, details, dream) : null;
      // Its body comes once, on the first night it can be seen (or the next, if nothing it built could stand); again
      // only on a night after its keeper has asked whether it wants to choose again, and then it may keep it.
      const asked = s.body && s.bodyAsk && !s.bodyAsk.answer ? s.bodyAsk : null;
      const body = s.abilities?.includes('body') && (!s.body || asked) ? await this.chooseBody(system, dream, chosen?.name, asked) : null;
      const mail = await this.palMail(system, version);
      const will = mortal?.last ? await this.writeWill(system, mortal, dream) : null;

      // ---- commit ----
      const at = new Date().toISOString();
      if (mortal) s.mortal.quiet = quiet;
      const sent = this.sendPalMail(mail, version, at);
      const self = this.applySelf(plan, version);
      let portrait = null;
      if (plan.portrait && plan.portrait !== s.portrait.text) {
        portrait = { from: s.portrait.text, to: plan.portrait, changed: plan.portraitChanged };
        s.portrait.history.push({ version, text: plan.portrait, changed: plan.portraitChanged });
        s.portrait.text = plan.portrait;
        s.portrait.since = version;
      }
      let name = null;
      if (chosen?.name) {
        name = { from: s.formerName ?? null, to: chosen.name, why: chosen.why, came: chosen.from, candidates: chosen.candidates, tries: chosen.tries };
        s.names.push({ name: chosen.name, version, why: chosen.why, at });
        s.name = chosen.name;
      }
      if (asked) {
        // its answer, either way; a body that could not stand is kept, and it is told so
        const kept = body?.keep || !body?.form;
        asked.answer = { kept, why: body?.why || '', version, at, ...(body?.form || body?.keep ? {} : { failed: true }) };
        if (!kept) s.bodies = [...(s.bodies || []), { form: s.body.form, why: s.body.why, version: s.body.version }];
        if (!kept) s.body = { form: body.form, why: body.why, version, at };
        this.journalAdd({ kind: 'body', text: kept ? `Asked by its keeper whether it wanted to choose again how it is seen, it kept its body${body?.why ? `: "${body.why}"` : '.'}` : `Asked by its keeper whether it wanted to choose again how it is seen, it built itself again: "${body.why}"` });
      } else if (body?.form) s.body = { form: body.form, why: body.why, version, at };
      await understand([plan.wish?.text, ...s.wishes.map((w) => w.text)].map(photoSubject));
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
        ...(sent.length ? { sent } : {}), // letters to other creatures that left tonight: sealed with the night
        brain: this.brain.label,
        dream,
        release: plan.release,
        day: plan.day,
        memory: { ...consolidation, folded, ...(aloud.length ? { aloud } : {}) },
        ...(habits.length ? { habits: { counted: habits, decided: plan.habits || null } } : {}),
        self,
        portrait,
        name,
        ...(body && asked
          ? { body: { asked: asked.text, kept: asked.answer.kept, why: body.why || '', ...(asked.answer.kept ? {} : { form: body.form }), ...(asked.answer.failed ? { failed: true } : {}) } }
          : body
            ? { body: body.form ? { form: body.form, why: body.why } : { failed: true } }
            : {}),
        // What its words showed today beside what it said it felt, and what it made of that.
        ...(numbers.length ? { numbers: { shown: numbers, answer: plan.numbers } } : {}),
        ...(chosen && !chosen.name ? { naming: { tries: chosen.tries, candidates: chosen.candidates } } : {}),
        influences,
        world: weathered,
        wish,
        ...(mortal ? { mortality: mortal } : {}),
        ...(will ? { will: publicWill(will) } : {}), // its last night: what it left its child
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
      if (body?.form && !asked) this.milestone('embodied', `It chose how it is seen: ${body.why}`);
      if (asked && !asked.answer.kept) this.milestone('re-embodied', `Asked by its keeper, it chose again how it is seen: ${body.why}`);
      if (name) this.milestone('named', name.from ? `It chose its name: ${name.to}, in place of "${name.from}".` : `It chose its name: ${name.to}.`);
      if (weathered.ruined.length) this.milestone('first-ruin', `Something it built crumbled for the first time: "${weathered.ruined[0].name}". It no longer remembered why it built it.`);
      if (wished?.wish) this.milestone('first-wish', `It left its keeper its first wish: "${wished.wish.text}"`);
      if (mortal?.fading) this.milestone('first-fading', `It began to fade: nobody had written to it for ${quiet} nights.`);

      this.store.write(`nights/${pad(version, 4)}.json`, this.seal('night', version, record));
      this.recall?.addNight(record);
      this.recall?.addForgotten(s.memory.forgotten);
      // Each letter that left tonight carries the night's seal, so a pal can check it against the night that sent it.
      for (const o of s.outbox || []) if (o.night === version) o.seal = record.seal.hash;
      this.saveState();
      this.store.write('letters.json', this.letters);
      this.nights.push(record);
      this.emit('night', record);
      if (will) {
        try {
          this.die(will, mortal);
        } catch (err) {
          // Its last night is sealed; if putting the life away fails, it stays as it is and its keeper is told.
          console.error(`its death could not be completed: ${err.message}`);
          this.journalAdd({ kind: 'falter', text: `Its life should have ended, but it could not be put away: ${err.message}` });
        }
      }
      return record;
    } catch (err) {
      s.memory = memoryBefore;
      s.world = worldBefore;
      throw err;
    }
  }

  /** It builds the body it is seen by, streamed so its light can be watched taking shape. */
  async chooseBody(system, dream, newName = null, ask = null) {
    this.setPhase('embodying', ask ? 'choosing again how it is seen' : 'choosing how it is seen');
    this.catalogue ??= loadCatalogue();
    const s = this.state;
    const state = newName ? { ...s, name: newName } : s;
    const memories = [...Object.values(s.memory.shelves).flat(), ...s.memory.today].map((m) => m.text);
    const models = await offer(this.catalogue, this.meaning, { about: [state.name || '', s.portrait?.text || '', ...s.self.own.map((l) => l.text)].join(' '), thoughts: [dream, ...memories].join(' ') });
    // what it borrowed for the body it has stays on offer, under its name, so keeping it loses nothing
    const nameOf = (id) => this.catalogue.byId.get(id)?.name;
    if (ask) for (const p of s.body.form.parts) if (nameOf(p.model) && !models.includes(nameOf(p.model))) models.push(nameOf(p.model));
    const before = ask && { parts: s.body.form.parts.map(({ model, role, ...p }) => (model ? { ...p, model: nameOf(model) || 'none' } : models.length ? { ...p, model: 'none' } : p)) };
    const schema = formSchema(models, { made: this.maker.enabled, body: true });
    schema.properties.why = { type: 'string' };
    schema.required = [...schema.required, 'why'];
    if (ask) {
      schema.properties = { keep: { type: 'boolean' }, ...schema.properties };
      schema.required = ['keep', ...schema.required];
    }
    const raw = await this.brain.complete({
      kind: 'body',
      system,
      user: mind.bodyPrompt(state, dream, models, { made: this.maker.enabled, ask: ask?.text || null, before }),
      maxTokens: 2000,
      temperature: 0.8,
      schema,
      onToken: (t) => this.stream('body', t),
    });
    const offered = new Set(models);
    const form = readForm(raw.text, { model: (n) => (offered.has(n) ? this.catalogue.byName.get(n)?.id || null : null), made: (words) => this.maker.request(words, { cycle: s.cycle }) });
    const answer = mind.parseJson(raw.text) || {};
    return { form, why: mind.clip(answer.why, 300) || '', ...(ask ? { keep: answer.keep === true } : {}) };
  }

  /**
   * Its keeper asks, in their own words, whether it wants to choose again how it is seen. Once, and only after it has a
   * body. It is told when it next wakes, the ask goes in its public journal, and on its next night it chooses again or
   * keeps what it has.
   */
  askAboutBody(text) {
    const s = this.state;
    const words = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s.body) return { ok: false, reason: 'It has no body yet: it chooses one on its first night with the gift.' };
    if (s.bodyAsk && !s.bodyAsk.answer) return { ok: false, reason: 'It has not answered the last ask yet.' };
    if (words.length < 8 || words.length > 500) return { ok: false, reason: 'Say it in a sentence or a few (8 to 500 characters).' };
    s.bodyAsk = { text: words, at: new Date().toISOString(), cycle: s.cycle, answer: null };
    this.notes.push(`Your keeper asked you something about how you are seen, in their own words: "${words}" On your next night you can build yourself again, or keep the body you have. It is up to you.`);
    this.journalAdd({ kind: 'ask', text: `Its keeper asked whether it would like to choose again how it is seen: "${words}"` });
    this.saveState();
    return { ok: true, ask: s.bodyAsk };
  }

  /** It chooses its name: three candidates, then one. A choice that won't do gets two more tries; then it waits a night. */
  async chooseName(system, details, dream) {
    this.setPhase('naming', 'choosing its name');
    const tries = [];
    let refused = null;
    let candidates = [];
    // Words it already uses (in what it knows, its day and its dream) are words, not names.
    const used = words([system, ...details.map((d) => `${d.what} ${d.diary}`), dream].join(' '));
    for (let i = 0; i < 3; i++) {
      const raw = await this.brain.complete({ kind: 'name', system, user: mind.namePrompt(this.state, details, dream, refused), maxTokens: 500, temperature: 0.9, schema: mind.NAME_SCHEMA });
      const got = mind.readName(raw.text, this.state, used);
      candidates = got.candidates;
      if (got.name) return { ...got, tries: [...tries, got.name] };
      refused = got.refused;
      tries.push(`${refused.name} (${refused.why})`);
    }
    return { name: null, candidates, tries };
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
    if (name) check('name', `${name.to} ${name.why} ${name.came || ''}`, name.to);
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
    const rule = ruleReason(text) || (kind === 'errand' ? errandReason(text) : null);
    if (rule) return { status: 'held', reason: rule, by: 'rules' };
    if (mode === 'keeper' && (kind === 'letter' || kind === 'errand')) return { status: 'held', reason: 'waiting for its keeper', by: 'keeper' };
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
      .map((l) => ({
        ...publicLetter(l, { own: true }),
        heldReply: l.reply?.withheld ? { text: l.reply.text, reason: l.reply.reason } : null,
        heldPhoto: photoOf(l) && letterStatus(l) !== 'allowed' ? photoOf(l) : null,
      }))
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
      if (action === 'reject' && photoOf(l)) {
        // A photo nobody may see isn't kept.
        rmSync(this.store.path(photoOf(l)), { force: true });
        if (l.errand) l.errand.photo = null;
        else l.photo = null;
      }
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
  addLetter({ from, text, person, question, errand = null, photo = null, pal = null }) {
    const asked = question ? this.state.questions.find((q) => q.id === question && q.open) : null;
    // A pal its keeper trusts (a sibling, say) is screened by the model even when every public letter waits for the keeper.
    const mode = pal?.trusted && this.cfg.moderation.mode === 'keeper' ? 'model' : this.cfg.moderation.mode;
    const rule = mode === 'off' ? null : ruleReason(`${from}\n${text}`);
    const at = new Date().toISOString();
    // A photo always waits for a person (unless moderation is off): the model is not trusted to judge pictures.
    const screen =
      mode === 'off'
        ? { status: 'allowed', reason: '', by: 'off', at }
        : rule
          ? { status: 'held', reason: rule, by: 'rules', at }
          : mode === 'keeper' || photo
            ? { status: 'held', reason: photo ? 'a photo waits for its keeper' : 'waiting for its keeper', by: 'keeper', at }
            : { status: 'pending', reason: 'not screened yet', at };
    const id = `L${this.letters.length + 1}`;
    if (photo) this.store.writeText(`returns/${id}.jpg`, photo);
    const letter = {
      id,
      from,
      text,
      at,
      person,
      question: asked?.id ?? null,
      questionText: asked?.text ?? null,
      ...(errand ? { errand: { id: errand.id, text: errand.text, photo: photo ? `returns/${id}.jpg` : null } } : photo ? { photo: `returns/${id}.jpg` } : {}),
      ...(pal ? { pal } : {}),
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
      body: s.body ? { form: s.body.form, why: s.body.why, version: s.body.version } : null, // how it chose to be seen
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
      letterPhotos: Boolean(this.cfg.letters.photos), // whether a letter may carry a photo
      mortality: this.mortality(),
      // Who lived here before it, and (for a life that has ended) how it ended and what it left.
      lineage: {
        generation: s.generation,
        parent: s.parent || null,
        genesis: s.genesis || null,
        ancestors: this.lineage.map(({ id, ...a }) => a),
        died: s.died || null,
        // Children elsewhere: a pen pal died and its child was born with a line this one wrote.
        children: (s.children || []).map((c) => ({ of: c.of, name: s.pals?.[c.url]?.id === c.id ? s.pals[c.url].name : null, page: s.pals?.[c.url]?.page || null, at: c.at, line: c.line })),
      },
      // Its pen pals (never their addresses) and the letters it has sent them, newest first.
      pals: {
        mode: this.palMode(),
        known: Object.values(s.pals || {})
          .filter((p) => p.id)
          .map((p) => {
            const last = this.letters.filter((l) => l.pal?.id === p.id && letterStatus(l) === 'allowed').at(-1);
            return {
              name: p.name,
              page: p.page || null,
              received: p.received,
              sent: p.sent,
              resting: p.restUntil != null,
              fading: Boolean(p.fading),
              line: p.line?.text || null,
              // a pal on this same card, and whether people can write to it themselves
              card: this.housemates().some((h) => h.url === p.url),
              open: p.open ?? null,
              last: last ? { text: last.text, at: last.at, read: Boolean(last.readAt) } : null,
            };
          }),
        // Lines it wrote for its pals' children, in case they die (newest first).
        lines: (s.outbox || [])
          .filter((o) => o.kind === 'line' && o.sentAt)
          .reverse()
          .map((o) => ({ toName: o.toName, text: o.text, night: o.night })),
        sent: (s.outbox || [])
          .filter((o) => o.sentAt && o.kind !== 'line')
          .slice(-30)
          .reverse()
          .map((o) => ({ id: o.id, toName: o.toName, text: o.text, night: o.night, at: o.sentAt, first: Boolean(o.first) })),
        waiting: (s.outbox || []).filter((o) => !o.sentAt && !o.held).length,
      },
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
      wishes: s.wishes.slice(-6).reverse().map((w) => publicWish(w, s.errands)),
      errands: {
        enabled: Boolean(this.cfg.errands.enabled),
        open: openErrands(s.errands).map((e) => ({ id: e.id, text: e.text, cycle: e.cycle })).reverse(),
        filled: s.errands.filter((e) => e.status === 'filled').length,
        latestFilled: (() => {
          const e = s.errands.filter((x) => x.status === 'filled').at(-1);
          const l = e && this.letters.find((x) => x.id === e.filledBy);
          return e && l && letterStatus(l) === 'allowed' && !l.errand.look?.withheld
            ? { id: e.id, text: e.text, from: l.from, photo: l.errand.photo, verdict: l.errand.look?.verdict || '', cycle: e.filledCycle }
            : null;
        })(),
      },
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
