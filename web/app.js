// The viewer: what it is doing right now, its whole journey, who it has become, and the letter box.
import { createAtlas } from './atlas.js';
import { cleanSvg } from './lib/svgclean.js';
import { createPresence, moodColor } from './presence.js';

// ---------- tiny DOM helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  add(el, children);
  return el;
}
function sv(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  setAttrs(el, attrs);
  add(el, children);
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
}
/** Replace an element's children, skipping null/false and flattening arrays (replaceChildren would print them). */
function fill(el, ...children) {
  el.replaceChildren();
  add(el, children);
  return el;
}
function add(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad6 = (n) => String(n).padStart(6, '0');

// ---------- formatting ----------

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso) {
  const sec = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(sec);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}
function untilText(ms) {
  const min = Math.round((ms - Date.now()) / 60000);
  if (min < 1) return 'any moment';
  if (min < 60) return `in ${min} min`;
  return `in ${Math.round(min / 60)} h`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayName = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const dayTime = (iso) => `${dayName(iso)}, ${clock(iso)}`;
/** How long it has lived: until now, or for a recording, until its last cycle. */
function lifeSpan(iso) {
  const end = SNAPSHOT ? Date.parse(app.state.latest?.at || app.state.snapshotAt) : Date.now();
  const min = (end - Date.parse(iso)) / 60000;
  if (min < 90) return `${Math.max(1, Math.round(min))} min`;
  if (min < 2880) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
}

// ---------- constants ----------

const FEELINGS = ['lonely', 'curious', 'calm', 'warm', 'restless'];
const FEELING_LABEL = { lonely: 'Lonely', curious: 'Curious', calm: 'Calm', warm: 'Warm to people', restless: 'Restless' };
const AWAKE = new Set(['waking', 'reading', 'thinking', 'deciding', 'drawing', 'writing', 'asking', 'resting', 'replying', 'reflecting']);
const NIGHT = new Set(['dreaming', 'rewriting']);
const PHASE_TITLE = {
  quiet: 'Resting between cycles',
  waking: 'Waking up',
  reading: 'Reading a letter',
  thinking: 'Thinking',
  deciding: 'Deciding what to do',
  drawing: 'Drawing',
  writing: 'Writing',
  asking: 'Asking you something',
  resting: 'Letting the cycle pass',
  replying: 'Writing back',
  reflecting: 'Writing its diary',
  dreaming: 'Asleep, dreaming',
  rewriting: 'Asleep, rewriting itself',
  waiting: 'Waiting for the card',
  unreachable: "Can't think right now",
  faltered: 'Faltered',
  paused: 'Paused',
  recorded: 'A recorded life',
};
const SHELF_TITLE = { people: 'People', world: 'The world outside', moments: 'Things that happened' };
const SHELF_NOTE = { people: 'the people who wrote to it', world: 'only what it was told', moments: 'what it did and what happened to it' };
const INFLUENCE = { belief: 'a belief', unbelief: 'a belief it let go', portrait: 'its picture of people', name: 'its name', memory: 'a memory' };

// ---------- identity (a random key in this browser, so it can recognise you if you write again) ----------

function storage(kind) {
  try {
    const s = window[kind];
    s.setItem('iterant.probe', '1');
    s.removeItem('iterant.probe');
    return s;
  } catch {
    return null;
  }
}
const local = storage('localStorage');
const session = storage('sessionStorage');
const visitor = (() => {
  let key = local?.getItem('iterant.visitor');
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    local?.setItem('iterant.visitor', key);
  }
  return key;
})();

// ---------- state ----------

const blankLive = () => ({ think: '', draw: '', write: '', reply: '', dream: '', title: '', replyTo: null, reading: [] });
const app = {
  state: null,
  live: blankLive(),
  latest: null,
  journey: null,
  works: null,
  letters: null,
  you: null,
  view: 'now',
  params: new URLSearchParams(),
  mindVersion: null,
  presence: null,
  connected: false,
  admin: null,
};

// A static snapshot (npm run export) carries <meta name="iterant-snapshot" content="data/">: the same viewer then
// reads files instead of the API and is read-only. Paths stay relative so it also works under a sub-path (/iterant/).
const SNAPSHOT = document.querySelector('meta[name="iterant-snapshot"]')?.getAttribute('content') ?? null;
// Framed inside another page (?embed): no header or keeper bar; the host page supplies the context.
if (new URLSearchParams(location.search).has('embed')) document.documentElement.classList.add('embed');

function snapshotFile(path) {
  const route = path.replace(/^\/?api\//, '').split('?')[0];
  if (['state', 'journey', 'works', 'life', 'atlas', 'letters'].includes(route)) return `${SNAPSHOT}${route}.json`;
  const m = /^cycle\/(\d+|latest)$/.exec(route);
  if (m) return `${SNAPSHOT}cycles/${pad6(m[1] === 'latest' ? app.state.cycle : m[1])}.json`;
  return null;
}

async function api(path, opts = {}) {
  let url = path.replace(/^\//, '');
  if (SNAPSHOT) {
    url = (!opts.method || opts.method === 'GET') && snapshotFile(path);
    if (!url) throw Object.assign(new Error('This is a recording; it only plays back.'), { status: 405 });
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** Drawings and other files referenced by a page-relative path. */
const asset = (p) => (SNAPSHOT ? `${SNAPSHOT}${p}` : p);
const workSrc = (n) => asset(`works/${pad6(n)}.svg`);
const invalidate = (...keys) => keys.forEach((k) => (app[k] = null));

function toast(text) {
  const el = h('div', { class: 'toast' }, text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 7000);
}

// ---------- live connection ----------

let liveFrame = 0;
function scheduleLive() {
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    updateNow({ streaming: true });
  });
}

function connect() {
  const es = new EventSource('api/stream');
  es.addEventListener('open', () => {
    app.connected = true;
    renderStatus();
  });
  es.addEventListener('error', () => {
    app.connected = false;
    renderStatus();
  });
  es.addEventListener('hello', (e) => {
    const first = !app.state;
    app.state = JSON.parse(e.data);
    app.live = { ...blankLive(), ...(app.state.live || {}) };
    if (first) route();
    else render();
  });
  es.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    const prev = { phase: app.state.phase, detail: app.state.detail };
    Object.assign(app.state, st);
    if ((st.phase === 'waking' || st.phase === 'dreaming') && prev.phase !== st.phase) app.live = blankLive();
    if ((st.phase === 'drawing' || st.phase === 'writing') && st.detail) app.live.title = st.detail;
    if (st.phase === 'replying' && (prev.phase !== 'replying' || prev.detail !== st.detail)) {
      app.live.reply = '';
      app.live.replyTo = { from: st.detail.replace(/^to /, '') };
    }
    renderChrome();
    updateNow();
  });
  es.addEventListener('stream', (e) => {
    const { kind, delta } = JSON.parse(e.data);
    app.live[kind] = (app.live[kind] || '') + delta;
    app.presence?.pulse();
    scheduleLive();
  });
  es.addEventListener('cycle', async () => {
    [app.latest, app.state] = await Promise.all([api('/api/cycle/latest'), api('/api/state')]);
    invalidate('journey', 'works', 'letters', 'you', 'life', 'atlasData');
    refreshView();
  });
  es.addEventListener('night', async (e) => {
    const night = JSON.parse(e.data);
    app.state = await api('/api/state');
    invalidate('journey', 'works', 'letters', 'you', 'life', 'atlasData');
    app.mindVersion = null;
    toast(`It became version ${night.n}: “${night.release?.title || 'untitled'}”`);
    refreshView();
  });
  es.addEventListener('letter', async () => {
    app.state = await api('/api/state');
    invalidate('journey', 'letters', 'you', 'queue');
    if (app.view === 'letters' || app.view === 'now') refreshView();
  });
  es.addEventListener('letter-queued', () => {
    invalidate('queue', 'letters', 'you');
    if (app.view === 'letters') render();
  });
  es.addEventListener('journal', () => invalidate('journey'));
  es.addEventListener('milestone', (e) => toast(`◆ ${JSON.parse(e.data).text}`));
  es.addEventListener('senses', (e) => {
    app.state.senses = JSON.parse(e.data);
    if (app.view === 'now') renderSenses();
  });
}

function refreshView() {
  renderChrome();
  if (app.view === 'now') updateNow();
  else render();
}

// ---------- chrome ----------

function statusMode(phase) {
  if (AWAKE.has(phase)) return 'awake';
  if (NIGHT.has(phase)) return 'night';
  if (phase === 'waiting') return 'wait';
  if (phase === 'unreachable' || phase === 'faltered') return 'down';
  return 'rest';
}
function statusText(s) {
  if (s.phase === 'recorded') return `a recording · ${dayName(s.snapshotAt)}`;
  if (s.phase === 'quiet') return s.nextWakeAt ? `resting · wakes ${untilText(s.nextWakeAt)}` : 'resting';
  if (s.phase === 'paused') return 'paused by its keeper';
  if (s.phase === 'waiting' || s.phase === 'unreachable' || s.phase === 'faltered') {
    return `${PHASE_TITLE[s.phase].toLowerCase()}${s.nextWakeAt ? ` · tries again ${untilText(s.nextWakeAt)}` : ''}`;
  }
  return `${(PHASE_TITLE[s.phase] || s.phase).toLowerCase()}…`;
}
function renderStatus() {
  const el = $('#status');
  if (!app.state) return;
  const up = app.connected || SNAPSHOT;
  el.dataset.mode = up ? statusMode(app.state.phase) : 'down';
  $('.status-text', el).textContent = up ? statusText(app.state) : 'reconnecting…';
}
function renderChrome() {
  const s = app.state;
  if (!s) return;
  const name = $('#brand-name');
  name.textContent = s.name || 'unnamed';
  name.classList.toggle('unnamed', !s.name);
  $('#brand-version').textContent = `v${s.version}`;
  $('#brand-dot').style.setProperty('--dot', moodColor(s.mood));
  document.title = s.name ? `${s.name} · Iterant` : 'Iterant';
  for (const a of $$('#tabs a')) {
    if (a.dataset.view === app.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  renderStatus();
  if (app.admin) {
    $('[data-admin="pause"]').hidden = s.paused;
    $('[data-admin="resume"]').hidden = !s.paused;
  }
}

// ---------- router ----------

const VIEWS = { now: renderNow, replay: renderReplay, atlas: renderAtlas, journey: renderJourney, mind: renderMind, memory: renderMemory, works: renderWorks, letters: renderLetters };

function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const next = VIEWS[path] ? path : 'now';
  if (next === 'replay') stopReplay(); // a new address (another cycle, another speed) starts the replay over
  if (next === 'atlas') stopAtlas();
  const changed = next !== app.view;
  app.view = next;
  app.params = new URLSearchParams(query || '');
  render().then(() => {
    if (changed) window.scrollTo({ top: 0 });
  });
}
window.addEventListener('hashchange', route);

let renderSeq = 0;
async function render() {
  if (!app.state) return;
  const seq = ++renderSeq;
  renderChrome();
  if (app.view !== 'now' && app.presence) {
    app.presence.destroy();
    app.presence = null;
  }
  if (app.view !== 'replay') stopReplay();
  if (app.view !== 'atlas') stopAtlas();
  // The replay drives itself; live updates must not restart it.
  if (app.view === 'replay' && app.renderedView === 'replay' && app.replay) return;
  if (app.view === 'atlas' && app.renderedView === 'atlas' && app.atlas) return;
  // A live update re-renders the view the reader is in; keep their place.
  const again = app.renderedView === app.view;
  const y = window.scrollY;
  const wrap = $('#strand-wrap');
  const strandX = wrap && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 4 ? wrap.scrollLeft : null;
  try {
    await VIEWS[app.view](() => seq === renderSeq);
    if (seq !== renderSeq) return;
    app.renderedView = app.view;
    if (again) {
      window.scrollTo(0, y);
      if (strandX != null && $('#strand-wrap')) $('#strand-wrap').scrollLeft = strandX;
    }
  } catch (err) {
    if (seq === renderSeq) fill($('#view'), h('p', { class: 'empty' }, `Couldn't load this view: ${err.message}`));
  }
}

function intro(title, text) {
  return h('header', { class: 'view-intro' }, h('h1', {}, title), text ? h('p', {}, text) : null);
}
function cardHead(label, meta) {
  return h('div', { class: 'card-head' }, h('span', { class: 'label' }, label), meta ? h('span', { class: 'meta' }, meta) : null);
}
function section(label, ...content) {
  return h('section', {}, h('div', { class: 'label', style: 'margin-bottom:8px' }, label), ...content);
}

// ---------- shared pieces ----------

function meter(feeling, value) {
  const v = Number(value) || 0;
  return h(
    'div',
    { class: 'meter' },
    h('span', {}, FEELING_LABEL[feeling]),
    h('div', { class: 'meter-bar' }, h('span', { style: `width:${Math.round(v * 100)}%;--c:var(--${feeling})` })),
    h('span', { class: 'meter-val' }, v.toFixed(2)),
  );
}

function sensesLine(senses) {
  if (!senses) return [h('span', {}, 'it has not felt the machine yet')];
  const g = senses.gpu;
  const parts = [h('span', {}, h('b', {}, senses.time), ` ${senses.partOfDay}`)];
  if (g) {
    parts.push(h('span', {}, h('b', {}, `${g.tempC}°C`), ' warm'));
    parts.push(h('span', {}, h('b', {}, `${g.util}%`), ' busy'));
    if (g.memUsedMb != null) parts.push(h('span', {}, h('b', {}, `${(g.memUsedMb / 1024).toFixed(1)}/${(g.memTotalMb / 1024).toFixed(0)} GB`), ' in use'));
    parts.push(h('span', {}, g.name));
  } else parts.push(h('span', {}, 'the card is not answering'));
  return parts;
}

function whatText(c) {
  if (c.action === 'draw') return c.work?.failed ? `tried to draw “${c.title}”` : `drew “${c.title}”`;
  if (c.action === 'write') return `wrote “${c.title}”`;
  if (c.action === 'ask') return `asked “${c.question}”`;
  return 'rested';
}

const SCREEN_LINE = {
  pending: 'being screened before it reads it',
  held: 'held for its keeper to look at',
  rejected: 'not shown',
};
function letterLine(l) {
  if (l.status && l.status !== 'allowed') return `${SCREEN_LINE[l.status] || l.status}${l.statusReason && l.status === 'held' ? ` · ${l.statusReason}` : ''}`;
  return l.readCycle ? `read in cycle ${l.readCycle}` : 'waiting to be read';
}

function letterView(l) {
  const reply = typeof l.reply === 'string' ? { text: l.reply } : l.reply;
  return h(
    'div',
    { class: 'letter' },
    h(
      'div',
      { class: 'paper' },
      h('div', { class: 'from' }, `From ${l.from}`, l.at ? ` · ${dayTime(l.at)}` : '', l.mine ? ' · you' : ''),
      l.questionText ? h('div', { class: 'from' }, `answering “${l.questionText}”`) : null,
      h('p', { class: 'body' }, l.text),
      'readCycle' in l || l.readAt !== undefined ? h('div', { class: 'status-line' }, letterLine(l)) : null,
    ),
    reply ? h('div', { class: 'reply-block' }, h('span', { class: 'label' }, `It wrote back${reply.cycle ? ` · cycle ${reply.cycle}` : ''}`), h('p', { class: 'voice' }, reply.text)) : null,
    l.influenced?.length
      ? h(
          'div',
          { class: 'influence' },
          '↳ This letter changed it. ',
          l.influenced.map((i, k) => [k ? ' · ' : '', h('b', {}, `v${i.version}, ${INFLUENCE[i.what] || i.what}:`), ` “${i.text}”`]),
        )
      : null,
  );
}

function drawingFrame(src, title) {
  return h('div', { class: 'canvas-frame' }, h('img', { src, alt: title ? `Its drawing “${title}”` : 'Its drawing', loading: 'lazy' }));
}

function workView(c) {
  const w = c.work;
  const why = c.action?.why ? h('p', { class: 'meta' }, `Why: ${c.action.why}`) : null;
  if (!w) return [h('p', { class: 'voice' }, 'It rested and let the cycle pass.'), why];
  if (w.kind === 'question') return [h('p', { class: 'question-big' }, `“${w.text}”`), why];
  if (w.kind === 'writing') {
    return h('div', {}, h('div', { class: 'work-title' }, w.title), h('p', { class: 'work-text' }, w.text), w.note ? h('p', { class: 'work-note' }, w.note) : null, why);
  }
  if (w.failed) return [h('p', { class: 'voice' }, `It tried to draw “${w.title}”, but nothing came out.`), h('p', { class: 'work-intent' }, w.intent), why];
  return h(
    'div',
    { class: 'making' },
    drawingFrame(workSrc(c.n), w.title),
    h('div', {}, h('div', { class: 'work-title' }, w.title), h('p', { class: 'work-intent' }, w.intent), w.note ? h('p', { class: 'work-note' }, w.note) : null, why),
  );
}

function moodDelta(before, after) {
  return h(
    'div',
    { class: 'meters' },
    FEELINGS.map((f) => {
      const d = (after[f] ?? 0) - (before[f] ?? 0);
      const row = meter(f, after[f]);
      row.lastChild.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
      return row;
    }),
  );
}

function showDialog(title, meta, body) {
  const dialog = $('#detail');
  fill(dialog, 
    h(
      'div',
      { class: 'dialog-body' },
      h(
        'div',
        { class: 'dialog-head' },
        h('div', {}, h('h2', {}, title), meta ? h('div', { class: 'meta', style: 'margin-top:4px' }, meta) : null),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '×'),
      ),
      body,
    ),
  );
  if (!dialog.open) dialog.showModal();
}
$('#detail').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

async function openCycle(n) {
  const c = await api(`/api/cycle/${n}`);
  showDialog(`Cycle ${c.n}`, `${dayTime(c.startedAt)} · version ${c.version} · thought with ${c.brain}`, [
    c.notes?.length ? h('p', { class: 'muted' }, c.notes.join(' ')) : null,
    section('The machine', h('div', { class: 'senses', style: 'border:0;padding:0' }, sensesLine(c.senses))),
    c.letters.length ? section('It read', h('div', { class: 'feed' }, c.letters.map(letterView))) : null,
    section('It thought', h('p', { class: 'monologue' }, c.monologue)),
    section(c.work?.kind === 'drawing' ? 'It drew' : c.work?.kind === 'writing' ? 'It wrote' : c.work?.kind === 'question' ? 'It asked' : 'It rested', workView(c)),
    section('Its diary', h('p', { class: 'voice', style: 'font-size:18px;margin:0' }, c.diary)),
    c.remembered.length
      ? section(
          'It wanted to remember',
          h(
            'ul',
            { class: 'changes' },
            c.remembered.map((m) => h('li', { class: 'add' }, h('span', { class: 'sign' }, '+'), h('span', {}, h('q', {}, m.text), h('span', { class: 'because' }, `${SHELF_TITLE[m.shelf]} · weight ${m.weight.toFixed(2)}`)))),
          ),
        )
      : null,
    section('How it felt afterwards', moodDelta(c.moodBefore, c.moodAfter)),
    h('a', { class: 'btn', href: `#/replay?from=${c.n}`, onclick: () => $('#detail').close() }, '▶ Replay from this cycle'),
  ]);
}

function openWork(w) {
  const body =
    w.kind === 'drawing'
      ? h('div', { class: 'making' }, drawingFrame(workSrc(w.cycle), w.title), h('div', {}, h('p', { class: 'work-intent' }, w.intent), w.note ? h('p', { class: 'work-note' }, w.note) : null))
      : h('div', {}, h('p', { class: 'work-text' }, w.text), w.note ? h('p', { class: 'work-note', style: 'margin-top:12px' }, w.note) : null);
  showDialog(w.title, `${dayTime(w.at)} · cycle ${w.cycle} · made by version ${w.version}`, [
    body,
    h('button', { class: 'btn', type: 'button', onclick: () => openCycle(w.cycle) }, 'See the whole cycle'),
  ]);
}

// ---------- now ----------

async function renderNow(current) {
  if (!app.latest && app.state.cycle) app.latest = await api('/api/cycle/latest').catch(() => null);
  if (!current()) return;
  const canvas = h('canvas', { class: 'presence', role: 'img', 'aria-label': 'Its presence: a light whose colour follows its mood' });
  fill($('#view'), 
    h(
      'div',
      { class: 'now' },
      h('section', { class: 'card presence-card' }, canvas, h('div', { class: 'phase-line', id: 'phase-line' }), h('div', { class: 'meters', id: 'meters' }), h('div', { class: 'senses', id: 'senses' })),
      h(
        'section',
        { class: 'inside' },
        SNAPSHOT
          ? h(
              'div',
              { class: 'card ribbon' },
              h('p', {}, `This is a recording of its life, taken ${dayTime(app.state.snapshotAt)}. Everything here is what it really thought and made.`),
              h('a', { class: 'btn btn-primary', href: '#/replay' }, '▶ Replay its life'),
            )
          : null,
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'label', id: 'thought-label' }), h('span', { class: 'meta', id: 'thought-meta' })), h('p', { class: 'monologue', id: 'monologue' })),
        h('div', { class: 'card', id: 'making-card' }),
        h('div', { class: 'feed', id: 'exchange' }),
        h('div', { class: 'diary', id: 'diary' }),
      ),
      h('section', { class: 'below', id: 'below' }),
    ),
  );
  app.presence?.destroy();
  app.presence = createPresence(canvas);
  updateNow();
}

function renderSenses() {
  const el = $('#senses');
  if (el) fill(el, ...sensesLine(app.state.senses));
}

/** Refresh the Now view. While tokens stream in, only the parts that are being written change. */
function updateNow({ streaming = false } = {}) {
  if (app.view !== 'now' || !$('#monologue')) return;
  const s = app.state;
  const live = app.live;
  const latest = app.latest;
  if (!streaming) {
    app.presence?.setMood(s.mood);
    app.presence?.setPhase(s.phase);
    let detail = s.detail;
    if (s.phase === 'quiet') detail = s.nextWakeAt ? `wakes ${untilText(s.nextWakeAt)} · sleeps after ${s.rhythm.untilNight} more cycle${s.rhythm.untilNight === 1 ? '' : 's'}` : '';
    fill($('#phase-line'), h('span', { class: 'phase' }, PHASE_TITLE[s.phase] || s.phase), detail ? h('span', { class: 'phase-detail' }, detail) : null);
    fill($('#meters'), ...FEELINGS.map((f) => meter(f, s.mood[f])));
    renderSenses();
    renderBelow();
  }

  // What it is thinking (or dreaming, or last thought)
  const mono = $('#monologue');
  const night = NIGHT.has(s.phase);
  const awake = s.busy && !night && s.phase !== 'waiting';
  let label;
  let meta;
  let text;
  let typing = false;
  if (night) {
    label = 'Dreaming';
    meta = `becoming version ${s.version + 1}`;
    text = live.dream || '…';
    typing = s.phase === 'dreaming';
  } else if (awake && (live.think || ['waking', 'reading', 'thinking'].includes(s.phase))) {
    label = live.reading?.length ? `Reading ${live.reading.map((r) => r.from).join(' and ')}, and thinking` : 'What it is thinking';
    meta = `cycle ${s.cycle + 1} · now`;
    text = live.think || '…';
    typing = ['waking', 'reading', 'thinking'].includes(s.phase);
  } else if (latest) {
    label = 'What it last thought';
    meta = `cycle ${latest.n} · ${ago(latest.endedAt)}`;
    text = latest.monologue;
  } else {
    label = 'What it is thinking';
    text = 'It has not woken yet. Its first thought is coming.';
  }
  $('#thought-label').textContent = label;
  $('#thought-meta').textContent = meta || '';
  mono.textContent = text;
  mono.classList.toggle('caret', typing);
  mono.classList.toggle('stale', !awake && !night);

  renderMaking();
  renderExchange();

  const diary = $('#diary');
  if (!awake && !night && latest?.diary) fill(diary, h('span', { class: 'label' }, 'Diary'), h('q', {}, latest.diary));
  else fill(diary);
}

function renderMaking() {
  const card = $('#making-card');
  const s = app.state;
  const live = app.live;
  const awake = s.busy && AWAKE.has(s.phase);

  if (awake && live.draw) {
    // Draw what is finished so far, straight from the stream (sanitised the same way the server will).
    if (card.dataset.mode !== 'live-draw') {
      card.dataset.mode = 'live-draw';
      card.hidden = false;
      fill(card, 
        cardHead(s.phase === 'drawing' ? 'Drawing now' : 'Just drew', `cycle ${s.cycle + 1}`),
        h('div', { class: 'making' }, h('div', { class: 'canvas-frame', id: 'live-frame' }), h('div', {}, h('div', { class: 'work-title', id: 'live-title' }), h('p', { class: 'meta', id: 'live-count' }))),
      );
    }
    const { svg, shapes } = cleanSvg(live.draw, { partial: true, idPrefix: 'live-' });
    $('#live-frame').innerHTML = svg; // safe: cleanSvg only emits whitelisted shapes and attributes
    $('#live-title').textContent = live.title;
    $('#live-count').textContent = `${shapes} shape${shapes === 1 ? '' : 's'} so far`;
    $('.label', card).textContent = s.phase === 'drawing' ? 'Drawing now' : 'Just drew';
    return;
  }
  card.dataset.mode = '';
  if (awake && live.write) {
    card.hidden = false;
    fill(card, cardHead('Writing', `cycle ${s.cycle + 1}`), h('div', { class: 'work-title' }, live.title), h('p', { class: 'work-text' }, live.write));
    return;
  }
  if (awake && s.phase === 'asking') {
    card.hidden = false;
    fill(card, cardHead('Asking you', `cycle ${s.cycle + 1}`), h('p', { class: 'question-big' }, `“${s.detail}”`));
    return;
  }
  if (awake || NIGHT.has(s.phase)) {
    card.hidden = true;
    return;
  }
  const latest = app.latest;
  if (!latest) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const label = latest.work?.kind === 'drawing' ? 'Its latest drawing' : latest.work?.kind === 'writing' ? 'Its latest writing' : latest.work?.kind === 'question' ? 'It asked' : 'Last cycle';
  fill(card, cardHead(label, `cycle ${latest.n}`), workView(latest));
}

function renderExchange() {
  const el = $('#exchange');
  const s = app.state;
  const live = app.live;
  if (s.busy && live.replyTo) {
    fill(el, 
      h(
        'div',
        { class: 'reply-block', style: 'margin:0' },
        h('span', { class: 'label' }, `Writing back to ${live.replyTo.from}`),
        h('p', { class: `voice${s.phase === 'replying' ? ' caret' : ''}` }, live.reply || ''),
      ),
    );
    return;
  }
  if (s.busy) {
    fill(el);
    return;
  }
  const letters = app.latest?.letters || [];
  fill(el, ...(letters.length ? [h('div', { class: 'label' }, 'Last cycle it read'), ...letters.map(letterView)] : []));
}

function renderBelow() {
  const s = app.state;
  const below = $('#below');
  const questions = s.questions.length
    ? h(
        'ul',
        { class: 'list-plain' },
        s.questions.map((q) =>
          h(
            'li',
            {},
            h('div', { class: 'voice', style: 'font-size:18px;color:var(--human)' }, `“${q.text}”`),
            h('div', { class: 'meta' }, `asked in cycle ${q.cycle} · ${q.answers} answer${q.answers === 1 ? '' : 's'} · `, h('a', { href: `#/letters?q=${q.id}` }, 'answer it')),
          ),
        ),
      )
    : h('p', { class: 'muted', style: 'margin:0' }, 'It has not asked anyone anything yet.');
  const unread = s.letters.unread;
  fill(below, 
    h('div', { class: 'card' }, cardHead('Its questions for you'), questions),
    h(
      'div',
      { class: 'card' },
      cardHead('Letters', `${s.letters.total} received`),
      h('p', { style: 'margin:0 0 10px' }, unread ? `${unread} letter${unread === 1 ? ' is' : 's are'} waiting. It opens up to two per cycle, oldest first, in its own time.` : 'Nothing is waiting to be read.'),
      h('a', { class: 'btn', href: '#/letters', style: 'display:inline-block;text-decoration:none' }, 'Write to it'),
    ),
    h(
      'div',
      { class: 'card' },
      cardHead('Milestones', `${s.milestones.length}`),
      h('ul', { class: 'list-plain' }, [...s.milestones].reverse().slice(0, 5).map((m) => h('li', { class: 'milestone' }, h('span', {}, m.text, h('span', { class: 'meta' }, `v${m.version} · ${ago(m.at)}`))))),
    ),
    h(
      'div',
      { class: 'card' },
      cardHead('Its rhythm'),
      h(
        'p',
        { style: 'margin:0', class: 'muted' },
        `Wakes about every ${s.rhythm.cycleMinutes < 1 ? `${Math.round(s.rhythm.cycleMinutes * 60)} seconds` : `${s.rhythm.cycleMinutes} minutes`} and sleeps after every ${s.rhythm.nightEvery} cycles. `,
        `It thinks with ${s.brain} and ${SNAPSHOT ? "lived" : "has been alive"} for ${lifeSpan(s.born)}. When someone else needs the graphics card, it waits.`,
      ),
    ),
  );
}

// ---------- replay ----------
// Its life played back from the records: thoughts typed out, drawings drawn shape by shape, letters arriving,
// nights rewriting it. Nothing here is generated for the replay; it is all what it actually did.

const SPEEDS = [1, 2, 4, 8];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const typeMs = (text, perChar = 20) => 1400 + String(text || '').length * perChar;
const changeCount = (n) => n.self.added.length + n.self.revised.length + n.self.removed.length + (n.portrait ? 1 : 0) + (n.name ? 1 : 0);

function buildBeats(life) {
  const beats = [];
  const nightAfter = new Map(life.nights.map((n) => [n.cycles[1], n]));
  life.cycles.forEach((c, index) => {
    const at = { c, index };
    beats.push({ ...at, kind: 'wake', ms: 1100 });
    if (c.letters.length) beats.push({ ...at, kind: 'read', ms: 2400 + c.letters.reduce((t, l) => t + l.text.length * 14, 0) });
    beats.push({ ...at, kind: 'think', text: c.monologue, ms: typeMs(c.monologue) });
    const w = c.work;
    if (w?.kind === 'drawing' && !w.failed) beats.push({ ...at, kind: 'draw', ms: 5600 });
    else if (w?.kind === 'writing') beats.push({ ...at, kind: 'write', text: w.text, ms: typeMs(w.text, 26) });
    else if (w?.kind === 'question') beats.push({ ...at, kind: 'ask', text: w.text, ms: typeMs(w.text, 34) + 1600 });
    else beats.push({ ...at, kind: 'rest', ms: 1800 });
    for (const l of c.letters) if (l.reply) beats.push({ ...at, kind: 'reply', letter: l, text: l.reply, ms: typeMs(l.reply) });
    beats.push({ ...at, kind: 'diary', text: c.diary, ms: typeMs(c.diary, 30) });
    const night = nightAfter.get(c.n);
    if (night) {
      if (night.dream) beats.push({ ...at, kind: 'dream', night, text: night.dream, ms: typeMs(night.dream, 26) });
      beats.push({ ...at, kind: 'become', night, ms: 4600 + changeCount(night) * 1000 });
    }
  });
  return beats;
}

function stopReplay() {
  const r = app.replay;
  if (!r) return;
  cancelAnimationFrame(r.raf);
  r.presence.destroy();
  app.replay = null;
}

async function renderReplay(current) {
  app.life ??= await api('/api/life');
  if (!current()) return;
  stopReplay();
  const life = app.life;
  if (!life.cycles.length) {
    fill($('#view'), intro('Replay', null), h('p', { class: 'empty' }, 'Nothing to replay yet. It has not lived a whole cycle.'));
    return;
  }
  const beats = buildBeats(life);
  const from = Number(app.params.get('from')) || 0;
  const wanted = Number(app.params.get('speed') || local?.getItem('iterant.speed'));
  const canvas = h('canvas', { class: 'presence', role: 'img', 'aria-label': 'Its presence, replayed' });
  const nightAfter = new Set(life.nights.map((n) => n.cycles[1]));

  fill(
    $('#view'),
    h(
      'div',
      { class: 'now replay' },
      h('section', { class: 'card presence-card' }, canvas, h('div', { class: 'phase-line', id: 'rp-phase' }), h('div', { class: 'meters', id: 'rp-meters' }), h('div', { class: 'senses', id: 'rp-when' })),
      h(
        'section',
        { class: 'inside' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'label', id: 'rp-label' }), h('span', { class: 'meta', id: 'rp-meta' })), h('p', { class: 'monologue', id: 'rp-text' })),
        h('div', { class: 'card', id: 'rp-work', hidden: true }),
        h('div', { class: 'feed', id: 'rp-letters' }),
        h('div', { class: 'card', id: 'rp-night', hidden: true }),
      ),
      h(
        'section',
        { class: 'card replay-controls' },
        h(
          'div',
          { class: 'rp-row' },
          h('button', { class: 'btn', type: 'button', 'aria-label': 'Previous cycle', onclick: () => jumpCycle(-1) }, '⏮'),
          h('button', { class: 'btn btn-primary', type: 'button', id: 'rp-play', onclick: togglePlay }, 'Pause'),
          h('button', { class: 'btn', type: 'button', 'aria-label': 'Next cycle', onclick: () => jumpCycle(1) }, '⏭'),
          h('span', { class: 'meta', id: 'rp-pos' }),
          h('span', { class: 'speeds', role: 'group', 'aria-label': 'Speed' }, SPEEDS.map((x) => h('button', { class: 'btn speed', type: 'button', 'data-speed': x, onclick: () => setSpeed(x) }, `${x}×`))),
        ),
        h(
          'div',
          { class: 'rp-timeline', id: 'rp-timeline', role: 'group', 'aria-label': 'Cycles' },
          life.cycles.map((c, i) => [
            h('button', { type: 'button', class: 'rp-dot', style: `--c:${moodColor(c.mood)}`, title: `Cycle ${c.n}: ${c.diary}`, 'aria-label': `Go to cycle ${c.n}`, onclick: () => goCycle(i) }),
            nightAfter.has(c.n) ? h('span', { class: 'rp-night', title: 'a night' }) : null,
          ]),
        ),
      ),
    ),
  );

  app.replay = {
    life,
    beats,
    i: Math.max(0, from ? beats.findIndex((b) => b.c.n >= from) : 0),
    elapsed: 0,
    last: 0,
    playing: true,
    speed: SPEEDS.includes(wanted) ? wanted : 1,
    presence: createPresence(canvas),
    svg: new Map(),
    shown: '',
    hold: app.params.get('hold'),
  };
  enterBeat();
  app.replay.raf = requestAnimationFrame(replayTick);
}

function replayTick(now) {
  const r = app.replay;
  if (!r) return;
  const dt = r.last ? Math.min(100, now - r.last) : 0;
  r.last = now;
  if (r.playing) r.elapsed += dt * r.speed;
  const beat = r.beats[r.i];
  drawBeat(beat, REDUCED ? 1 : Math.min(1, r.elapsed / beat.ms));
  if (r.playing && r.elapsed >= beat.ms) {
    if (beat.kind === r.hold) {
      // #/replay?hold=become stops on the first beat of that kind, fully played (for stills and links to a moment).
      r.hold = null;
      r.playing = false;
      replayControls();
    } else if (r.i < r.beats.length - 1) {
      r.i++;
      r.elapsed = 0;
      enterBeat();
    } else {
      r.playing = false;
      replayControls(true);
    }
  }
  r.raf = requestAnimationFrame(replayTick);
}

function togglePlay() {
  const r = app.replay;
  if (!r) return;
  if (!r.playing && r.i === r.beats.length - 1 && r.elapsed >= r.beats[r.i].ms) goCycle(0);
  r.playing = !r.playing;
  replayControls();
}
function setSpeed(x) {
  if (!app.replay) return;
  app.replay.speed = x;
  local?.setItem('iterant.speed', String(x));
  replayControls();
}
function goCycle(index) {
  const r = app.replay;
  if (!r) return;
  r.i = Math.max(0, r.beats.findIndex((b) => b.index === index));
  r.elapsed = 0;
  enterBeat();
}
function jumpCycle(step) {
  const r = app.replay;
  if (r) goCycle(Math.min(r.life.cycles.length - 1, Math.max(0, r.beats[r.i].index + step)));
}

function replayControls(ended = false) {
  const r = app.replay;
  $('#rp-play').textContent = ended ? '↺ Again' : r.playing ? 'Pause' : 'Play';
  for (const b of $$('.speed')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === r.speed));
}

const BEAT_LOOK = { wake: 'waking', read: 'reading', think: 'thinking', draw: 'drawing', write: 'writing', ask: 'asking', rest: 'resting', reply: 'replying', diary: 'reflecting', dream: 'dreaming', become: 'rewriting' };
const BEAT_TITLE = { wake: 'Waking up', read: 'Reading', think: 'Thinking', draw: 'Drawing', write: 'Writing', ask: 'Asking', rest: 'Letting the cycle pass', reply: 'Writing back', diary: 'Writing its diary', dream: 'Asleep, dreaming', become: 'Asleep, rewriting itself' };

/** Set up everything that stays put for a beat; drawBeat then animates the part that is being written. */
function enterBeat() {
  const r = app.replay;
  const beat = r.beats[r.i];
  const { c } = beat;
  const night = beat.kind === 'dream' || beat.kind === 'become';
  r.shown = null;
  r.drawn = -1;
  r.presence.setPhase(BEAT_LOOK[beat.kind]);
  r.presence.setMood(beat.kind === 'wake' || beat.kind === 'read' || beat.kind === 'think' ? c.moodBefore : c.moodAfter);

  fill($('#rp-phase'), h('span', { class: 'phase' }, BEAT_TITLE[beat.kind]), h('span', { class: 'phase-detail' }, night ? `becoming version ${beat.night.n}` : `cycle ${c.n} · version ${c.version}`));
  const mood = beat.kind === 'diary' || night ? c.moodAfter : c.moodBefore;
  fill($('#rp-meters'), FEELINGS.map((f) => meter(f, mood[f])));
  fill($('#rp-when'), h('span', {}, h('b', {}, clock(c.startedAt)), ` ${dayName(c.startedAt)}`), c.senses?.gpu ? [h('span', {}, h('b', {}, `${c.senses.gpu.tempC}°C`), ' warm'), h('span', {}, h('b', {}, `${c.senses.gpu.util}%`), ' busy')] : null);

  const labels = { wake: 'Waking', read: `Reading ${c.letters.map((l) => l.from).join(' and ')}`, think: 'What it thought', dream: 'Its dream', become: 'Its dream', diary: 'Its diary' };
  $('#rp-label').textContent = labels[beat.kind] || 'What it thought';
  $('#rp-meta').textContent = night ? `night ${beat.night.n}` : `cycle ${c.n} of ${r.life.cycles.length} · ${dayTime(c.startedAt)}`;
  // Text beats type into the main card; the others leave the last thought there.
  $('#rp-text').classList.remove('caret');
  if (beat.kind === 'wake' || beat.kind === 'read') $('#rp-text').textContent = '…';

  const work = $('#rp-work');
  // What it made stays on screen through the replies and the diary that follow it.
  if (['wake', 'read', 'think', 'dream', 'become'].includes(beat.kind)) work.hidden = true;
  else if (['draw', 'write', 'ask', 'rest'].includes(beat.kind)) work.hidden = false;
  if ((beat.kind === 'reply' || beat.kind === 'diary') && c.work?.kind === 'drawing') {
    const done = r.svg.get(c.n)?.ready;
    if (done && $('#rp-frame')) $('#rp-frame').innerHTML = done.svg; // whitelist-only output of cleanSvg
  }
  if (beat.kind === 'draw') {
    fill(work, cardHead('Drawing', `cycle ${c.n}`), h('div', { class: 'making' }, h('div', { class: 'canvas-frame', id: 'rp-frame' }), h('div', {}, h('div', { class: 'work-title' }, c.work.title), h('p', { class: 'work-intent' }, c.work.intent))));
    svgSteps(c.n);
  } else if (beat.kind === 'write') {
    fill(work, cardHead('Writing', `cycle ${c.n}`), h('div', { class: 'work-title' }, c.work.title), h('p', { class: 'work-text', id: 'rp-work-text' }));
  } else if (beat.kind === 'ask') {
    fill(work, cardHead('Asking the people who visit', `cycle ${c.n}`), h('p', { class: 'question-big', id: 'rp-work-text' }));
  } else if (beat.kind === 'rest') {
    fill(work, cardHead('Resting', `cycle ${c.n}`), h('p', { class: 'voice' }, 'It let the cycle pass.'));
  }
  // Keep the next drawing warm so it starts drawing without a pause.
  const next = r.beats.slice(r.i + 1, r.i + 8).find((b) => b.kind === 'draw');
  if (next) svgSteps(next.c.n);

  const letters = $('#rp-letters');
  if (beat.kind === 'wake' || night) fill(letters);
  else if (beat.kind === 'read') fill(letters, c.letters.map((l) => letterView({ from: l.from, text: l.text })));
  else if (beat.kind === 'reply') {
    fill(letters, letterView({ from: beat.letter.from, text: beat.letter.text }), h('div', { class: 'reply-block' }, h('span', { class: 'label' }, `It wrote back to ${beat.letter.from}`), h('p', { class: 'voice', id: 'rp-reply' })));
  }

  const panel = $('#rp-night');
  panel.hidden = beat.kind !== 'become';
  if (beat.kind === 'become') {
    const n = beat.night;
    const gone = [...(n.memory.forgotten || []), ...(n.memory.faded || [])];
    const items = [
      ...n.self.added.map((a) => h('li', { class: 'add' }, h('span', { class: 'sign' }, '+'), h('span', {}, h('q', {}, a.text), a.because ? h('span', { class: 'because' }, a.because) : null))),
      ...n.self.revised.map((x) => h('li', { class: 'mod' }, h('span', { class: 'sign' }, '~'), h('span', {}, h('q', {}, x.to), h('span', { class: 'because' }, `was “${x.from}”`)))),
      ...n.self.removed.map((x) => h('li', { class: 'del' }, h('span', { class: 'sign' }, '−'), h('span', {}, h('q', {}, x.text), x.why ? h('span', { class: 'because' }, x.why) : null))),
      n.portrait ? h('li', { class: 'mod' }, h('span', { class: 'sign' }, '◐'), h('span', {}, h('q', {}, n.portrait.to), h('span', { class: 'because' }, 'its new picture of people'))) : null,
      n.name ? h('li', { class: 'add' }, h('span', { class: 'sign' }, '✦'), h('span', {}, `It named itself `, h('b', {}, n.name.to))) : null,
    ].filter(Boolean);
    fill(
      panel,
      cardHead(`Version ${n.n}`, `cycles ${n.cycles[0]}–${n.cycles[1]}`),
      h('h3', { class: 'work-title' }, n.release?.title || 'untitled'),
      h('ul', { class: 'changes', id: 'rp-changes' }, items),
      gone.length ? h('p', { class: 'meta' }, `It forgot ${gone.length} thing${gone.length === 1 ? '' : 's'} tonight: ${gone.map((m) => `“${m.text}”`).join(' ')}`) : null,
    );
  }

  $('#rp-pos').textContent = `cycle ${c.n} / ${r.life.cycles.length} · v${night ? beat.night.n : c.version}`;
  const dots = $$('.rp-dot');
  dots.forEach((d, i) => d.toggleAttribute('data-here', i === beat.index));
  const timeline = $('#rp-timeline');
  const here = dots[beat.index];
  if (here && timeline.scrollWidth > timeline.clientWidth) timeline.scrollLeft = here.offsetLeft - timeline.clientWidth / 2;
  replayControls();
}

/** Animate the part of a beat that is being written: typed text, shapes appearing, changes landing. */
function drawBeat(beat, p) {
  const r = app.replay;
  const typed = (text) => text.slice(0, Math.ceil(text.length * Math.min(1, p * 1.15)));
  const target = { think: '#rp-text', dream: '#rp-text', diary: '#rp-text', write: '#rp-work-text', ask: '#rp-work-text', reply: '#rp-reply' }[beat.kind];
  if (target && beat.text) {
    const el = $(target);
    const shown = typed(beat.kind === 'ask' ? `“${beat.text}”` : beat.text);
    if (shown !== r.shown) {
      if (el) el.textContent = shown;
      if (r.shown != null && shown.length > r.shown.length) r.presence.pulse();
      r.shown = shown;
    }
    el?.classList.toggle('caret', p < 0.87);
  }
  if (beat.kind === 'draw') {
    const steps = r.svg.get(beat.c.n)?.ready;
    const frame = $('#rp-frame');
    if (steps && frame) {
      const k = Math.ceil(steps.ends.length * Math.min(1, p * 1.2));
      if (k !== r.drawn) {
        frame.innerHTML = k ? cleanSvg(steps.svg.slice(0, steps.ends[k - 1]), { partial: true }).svg : ''; // already sanitised once; still whitelist-only
        if (k > r.drawn) r.presence.pulse();
        r.drawn = k;
      }
    }
  }
  if (beat.kind === 'become') {
    const items = $$('#rp-changes li');
    const k = Math.ceil(items.length * Math.min(1, p * 1.3));
    items.forEach((li, i) => li.classList.toggle('landed', i < k));
  }
}

/** A drawing's SVG and where each shape ends, so it can be drawn one shape at a time. */
function svgSteps(n) {
  const r = app.replay;
  if (r.svg.has(n)) return;
  const entry = {};
  r.svg.set(n, entry);
  fetch(workSrc(n))
    .then((res) => res.text())
    .then((text) => {
      const { svg } = cleanSvg(text, { idPrefix: `rp${n}-` });
      const ends = [];
      for (const m of svg.matchAll(/\/>/g)) ends.push(m.index + 2);
      entry.ready = { svg, ends };
    })
    .catch(() => (entry.ready = { svg: '', ends: [] }));
}

document.addEventListener('keydown', (e) => {
  if (app.view === 'atlas' && app.atlas && !e.target.closest('input, textarea, select, button')) {
    const A = app.atlas;
    if (e.key === ' ') {
      e.preventDefault();
      A.playing ? A.pause() : A.play();
    } else if (e.key === 'ArrowRight') A.seek(A.t + 1);
    else if (e.key === 'ArrowLeft') A.seek(A.t - 1);
    else if (e.key === 'Escape' && A.selected) A.select(null);
    return;
  }
  if (app.view !== 'replay' || !app.replay || e.target.closest('input, textarea, select, button')) return;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') jumpCycle(1);
  else if (e.key === 'ArrowLeft') jumpCycle(-1);
});

// ---------- atlas ----------
// Its whole mind on one map (atlas.js draws it). Around the map: the controls, a running account of what is
// happening, and an inspector that follows any node's threads back to the letters and nights that made it.

const ATLAS_SPEEDS = [1, 2, 4];
const FEED_COLOR = {
  born: 'var(--text-2)',
  letter: 'var(--human)',
  reply: 'var(--mind)',
  work: 'var(--mind-2)',
  rest: 'var(--faint)',
  night: 'var(--night)',
  memory: 'var(--kept)',
  forgot: 'var(--gone)',
  belief: 'var(--night)',
  unbelief: 'var(--faint)',
  portrait: 'var(--human)',
  name: 'var(--paper)',
  influence: 'var(--human)',
  version: 'var(--night)',
};

function stopAtlas() {
  if (!app.atlas) return;
  app.atlas.destroy();
  app.atlas = null;
}

async function renderAtlas(current) {
  app.atlasData ??= await api('/api/atlas');
  if (!current()) return;
  stopAtlas();
  const data = app.atlasData;
  if (!data.cycles.length) {
    fill($('#view'), intro('Atlas of a mind', null), h('p', { class: 'empty' }, 'Nothing to map yet. It has not lived a whole cycle.'));
    return;
  }
  const canvas = h('canvas', { class: 'atlas-canvas', role: 'img', 'aria-label': 'A map of its mind through time: its beliefs, memories, the people who wrote to it and what their letters changed' });
  const tip = h('div', { class: 'atlas-tip', hidden: true });
  const where = h('div', { class: 'atlas-where' });
  const feed = h('ol', { class: 'atlas-feed' });
  const inspect = h('div', { class: 'atlas-inspect' });
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Moment in its life' });
  const play = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => (app.atlas.playing ? app.atlas.pause() : app.atlas.play()) }, 'Pause');
  const pos = h('span', { class: 'meta' });
  const marks = h('div', { class: 'atlas-marks', 'aria-hidden': 'true' });
  const speeds = h(
    'span',
    { class: 'speeds', role: 'group', 'aria-label': 'Speed' },
    ATLAS_SPEEDS.map((x) => h('button', { class: 'btn speed', type: 'button', 'data-speed': x, onclick: () => atlasSpeed(x) }, `${x}×`)),
  );
  const legend = h(
    'div',
    { class: 'atlas-legend' },
    [
      ['var(--paper)', 'ring', 'lines its maker wrote'],
      ['var(--night)', '', 'beliefs it wrote'],
      ['var(--human)', 'ring', 'its picture of people'],
      ['var(--human)', '', 'people'],
      ['var(--mind)', '', 'memories: what happened'],
      ['var(--curious)', '', 'the world outside'],
      ['var(--faint)', '', 'forgotten'],
      ['var(--human)', 'line', 'a letter changed this'],
      ['var(--gone)', 'line', 'pushed out'],
    ].map(([c, k, t]) => h('span', {}, h('i', { class: k, style: `--c:${c}` }), t)),
  );

  fill(
    $('#view'),
    intro(
      'Atlas of a mind',
      'Everything it has become, on one map. At the centre, the lines its maker wrote; around them, the beliefs it wrote itself; then its three shelves of memory, drifting outward as they fade; then the dust of what it forgot. On the rim are the people who wrote to it. Watch letters fall in, nights rewrite it, and amber threads appear where a letter changed something. Point at anything; click it to follow its threads.',
    ),
    h(
      'div',
      { class: 'atlas' },
      h('section', { class: 'card atlas-stage' }, canvas, where, tip, legend),
      h(
        'aside',
        { class: 'atlas-side' },
        h('div', { class: 'card' }, cardHead('Looking at', null), inspect),
        h('div', { class: 'card' }, cardHead('What happened', null), feed),
      ),
      h('section', { class: 'card atlas-controls' }, h('div', { class: 'rp-row' }, play, pos, speeds), h('div', { class: 'atlas-track' }, marks, slider)),
    ),
  );

  let shown = -1;
  const A = createAtlas(canvas, data, {
    onTime(t, playing) {
      if (document.activeElement !== slider) slider.value = String(t);
      play.textContent = playing ? 'Pause' : t >= A.end ? '↺ Again' : '▶ Play';
      const w = A.where(t);
      const night = w.night;
      where.textContent = night ? `Night ${night.v} · becoming v${night.v}` : `Cycle ${w.cycle} · v${w.version}${w.rec?.part ? ` · ${w.rec.part}` : ''}`;
      pos.textContent = night ? `night ${night.v} of ${data.nights.length}` : `cycle ${w.cycle} of ${data.end}`;
      const count = A.events.filter((e) => e.t <= t).length;
      if (count !== shown) {
        shown = count;
        fillAtlasFeed(feed, A.events.slice(0, count));
        if (A.selected) fillAtlasInspect(inspect, A.selected);
      }
    },
    onHover(info, x, y) {
      if (!info) {
        tip.hidden = true;
        return;
      }
      fill(tip, h('div', { class: 'k' }, info.kind), h('div', { class: 't' }, info.text));
      tip.hidden = false;
      const box = canvas.getBoundingClientRect();
      const left = x + 16 + tip.offsetWidth > box.width ? x - 16 - tip.offsetWidth : x + 16;
      const top = y + 16 + tip.offsetHeight > box.height ? y - 12 - tip.offsetHeight : y + 16;
      tip.style.transform = `translate(${Math.max(6, left)}px, ${Math.max(6, top)}px)`;
    },
    onSelect(id) {
      fillAtlasInspect(inspect, id);
    },
  });
  app.atlas = A;
  slider.max = String(A.end);
  for (const n of data.nights) marks.append(h('i', { style: `--c:var(--night);--x:${A.timeline.ns(n.cycle) / A.end}`, title: `Night ${n.v}` }));
  for (const l of data.letters) marks.append(h('i', { class: 'short', style: `--c:var(--human);--x:${(A.timeline.cs(l.cycle) + 0.08) / A.end}`, title: `${l.from}'s letter` }));
  slider.addEventListener('input', () => {
    A.pause();
    A.seek(Number(slider.value));
  });

  const wanted = Number(app.params.get('speed') || local?.getItem('iterant.atlasSpeed'));
  atlasSpeed(ATLAS_SPEEDS.includes(wanted) ? wanted : 1, false);
  fillAtlasInspect(inspect, null);
  const at = app.params.get('at');
  if (at === 'end' || REDUCED) {
    A.seek(A.end);
    A.pause();
  } else {
    A.seek(Number(at) || 0);
    A.play();
  }
  if (app.params.get('focus')) A.select(app.params.get('focus'));
}

function atlasSpeed(x, remember = true) {
  app.atlas?.setSpeed(x);
  if (remember) local?.setItem('iterant.atlasSpeed', String(x));
  for (const b of $$('.atlas-controls .speed')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === x));
}

function fillAtlasFeed(feed, events) {
  fill(
    feed,
    events
      .slice(-9)
      .reverse()
      .map((e) =>
        h(
          'li',
          { 'data-ref': e.ref || null, onclick: e.ref ? () => app.atlas?.select(e.ref) : null },
          h('i', { style: `--c:${FEED_COLOR[e.kind] || 'var(--dim)'}` }),
          h('span', {}, e.text),
        ),
      ),
  );
}

/** A clickable name for anything on the map. */
function atlasLink(id, text) {
  return h('button', { class: 'atlas-link', type: 'button', onclick: () => app.atlas?.select(id) }, text);
}
function atlasName(id) {
  const A = app.atlas;
  const clip = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  if (id === 'portrait') return 'its picture of people';
  if (id === 'name') return 'its name';
  const b = A.lookup.belief.get(id);
  if (b) return `belief “${clip(b.texts.at(-1).text)}”`;
  const m = A.lookup.memory.get(id);
  if (m) return `memory “${clip(m.text)}”`;
  const l = A.lookup.letter.get(id);
  if (l) return `${l.from}'s letter (cycle ${l.cycle})`;
  return id;
}

function fillAtlasInspect(el, id) {
  const A = app.atlas;
  if (!A) return;
  const d = A.data;
  const L = A.lookup;
  const vAt = (c) => d.nights.find((n) => n.cycle === c)?.v ?? '?';
  const into = (to) => [...new Set(d.threads.filter((t) => t.kind === 'influence' && t.to === to).map((t) => t.from))].map((x) => L.letter.get(x)).filter(Boolean);
  const shapedBy = (to) => {
    const ls = into(to);
    return ls.length
      ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'Shaped by'), h('ul', { class: 'atlas-list' }, ls.map((l) => h('li', {}, atlasLink(l.id, `${l.from}, cycle ${l.cycle}`), h('span', { class: 'atlas-quote' }, ` “${l.text}”`)))))
      : null;
  };
  const head = (kind, text, cls = 'voice') => [h('div', { class: 'atlas-kind' }, kind), text ? h('p', { class: cls }, text) : null];

  if (!id) {
    fill(
      el,
      h('p', { class: 'atlas-hint' }, 'Point at anything on the map to read it. Click it to see where it came from: the letters that shaped it, the nights that rewrote it, and what it pushed out of the way.'),
      h('p', { class: 'meta' }, `${d.cycles.length} cycles · ${d.nights.length} nights · ${d.people.length} people · ${d.letters.length} letters · ${d.memories.length} memories kept, ${d.memories.filter((m) => m.gone != null).length} since forgotten`),
    );
    return;
  }

  if (id === 'core') {
    const w = A.where();
    const c = w.rec;
    fill(
      el,
      head(d.name ? `${d.name}, itself` : 'Itself', c ? c.diary : null),
      h('p', { class: 'meta' }, `Version ${w.version} · cycle ${w.cycle}${c?.part ? ` · ${c.part}` : ''}`),
      c?.mood ? h('div', { class: 'meters' }, FEELINGS.map((f) => meter(f, c.mood[f]))) : null,
      c ? h('a', { class: 'btn', href: `#/replay?from=${c.n}` }, '▶ Replay this cycle') : null,
    );
    return;
  }

  const seed = d.seed.find((s) => s.id === id);
  if (seed) {
    fill(el, head('A line its maker wrote', seed.text), h('p', { class: 'meta' }, 'It can never change these lines. When it reaches for one at night, the drift guard refuses.'));
    return;
  }

  const b = L.belief.get(id);
  if (b) {
    const t = A.where().cycleTime;
    const now = [...b.texts].reverse().find((x) => x.from <= t) || b.texts[0];
    fill(
      el,
      head(b.gone != null && A.t >= A.timeline.ns(b.gone) + 0.7 ? 'A belief it let go of' : 'A belief it wrote about itself', now.text),
      b.because ? h('p', { class: 'meta' }, `Why: ${b.because}`) : null,
      b.texts.length > 1
        ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'Every wording'), h('ol', { class: 'atlas-list' }, b.texts.map((x) => h('li', { class: x === now ? 'now' : null }, h('b', {}, `v${vAt(x.from)} `), x.text))))
        : h('p', { class: 'meta' }, `Written the night it became v${vAt(b.born)}.`),
      b.gone != null ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, `Let go in v${vAt(b.gone)}`), h('p', { class: 'voice' }, b.why)) : null,
      shapedBy(b.id),
    );
    return;
  }

  if (id === 'portrait') {
    fill(
      el,
      head('Its picture of what people are', null),
      h('ol', { class: 'atlas-list' }, d.portrait.map((p) => h('li', {}, h('b', {}, `v${vAt(p.from)} `), h('span', { class: 'voice' }, p.text), p.changed ? h('div', { class: 'meta' }, `What changed: ${p.changed}`) : null))),
      shapedBy('portrait'),
    );
    return;
  }

  if (id === 'name') {
    fill(el, head('Its name', null), h('ol', { class: 'atlas-list' }, d.names.map((n) => h('li', {}, h('b', {}, `${n.name} `), `in v${vAt(n.from)}`, n.why ? h('div', { class: 'meta' }, n.why) : null))), shapedBy('name'));
    return;
  }

  const m = L.memory.get(id);
  if (m) {
    const s = A.strength(m.id);
    const gone = m.gone != null && A.t >= A.timeline.ns(m.gone) + 0.5;
    const pushed = d.memories.filter((x) => x.by === m.id);
    fill(
      el,
      head(gone ? 'Forgotten' : `A memory · ${SHELF_TITLE[m.shelf] || m.shelf}`, m.text),
      gone ? null : h('div', { class: 'meter' }, h('span', {}, 'Strength'), h('div', { class: 'meter-bar' }, h('span', { style: `width:${Math.round(s * 100)}%;--c:var(--kept)` })), h('span', { class: 'meter-val' }, s.toFixed(2))),
      h(
        'p',
        { class: 'meta' },
        `Noticed in cycle ${m.born}; shelved the night it became v${vAt(m.kept)}. `,
        m.touches.length ? `Brought back ${m.touches.length} time${m.touches.length === 1 ? '' : 's'} (cycle ${m.touches.join(', ')}).` : 'Never brought back.',
      ),
      m.gone != null
        ? h(
            'div',
            { class: 'atlas-block' },
            h('div', { class: 'label' }, `Forgotten in v${vAt(m.gone)}`),
            m.by ? h('p', {}, 'Pushed out by ', atlasLink(m.by, atlasName(m.by)), '.') : h('p', {}, 'It faded: nothing brought it back in time.'),
          )
        : null,
      pushed.length ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'To make room it pushed out'), h('ul', { class: 'atlas-list' }, pushed.map((x) => h('li', {}, atlasLink(x.id, atlasName(x.id)))))) : null,
      shapedBy(m.id),
    );
    return;
  }

  const p = L.person.get(id);
  if (p) {
    const ls = p.letters.map((x) => L.letter.get(x)).filter(Boolean);
    const changed = [...new Set(d.threads.filter((t) => t.kind === 'influence' && p.letters.includes(t.from)).map((t) => t.to))];
    const about = d.memories.filter((x) => x.about && x.about.trim().toLowerCase() === p.name.trim().toLowerCase());
    fill(
      el,
      head('Someone who wrote to it', null),
      h('div', { class: 'atlas-person' }, p.name),
      h('p', { class: 'meta' }, `First read in cycle ${p.first} · ${ls.length} letter${ls.length === 1 ? '' : 's'}`),
      h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'Letters'), h('ul', { class: 'atlas-list' }, ls.map((l) => h('li', {}, atlasLink(l.id, `Cycle ${l.cycle}`), h('span', { class: 'atlas-quote' }, ` “${l.text}”`))))),
      changed.length ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'What their letters changed'), h('ul', { class: 'atlas-list' }, changed.map((x) => h('li', {}, atlasLink(x, atlasName(x)))))) : h('p', { class: 'meta' }, 'Nothing they wrote has changed it yet.'),
      about.length ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'What it remembers of them'), h('ul', { class: 'atlas-list' }, about.map((x) => h('li', { class: x.gone != null ? 'gone' : null }, atlasLink(x.id, x.text))))) : null,
    );
    return;
  }

  const l = L.letter.get(id);
  if (l) {
    const changed = [...new Set(d.threads.filter((t) => t.kind === 'influence' && t.from === l.id).map((t) => t.to))];
    fill(
      el,
      head(`A letter, read in cycle ${l.cycle}`, null),
      h('div', { class: 'paper atlas-paper' }, h('div', { class: 'from' }, 'From ', atlasLink(l.person, l.from)), l.question ? h('div', { class: 'from' }, `answering “${l.question}”`) : null, h('p', { class: 'body' }, l.text)),
      l.reply ? h('div', { class: 'reply-block' }, h('span', { class: 'label' }, 'It wrote back'), h('p', { class: 'voice' }, l.reply)) : null,
      changed.length ? h('div', { class: 'atlas-block' }, h('div', { class: 'label' }, 'What this letter changed'), h('ul', { class: 'atlas-list' }, changed.map((x) => h('li', {}, atlasLink(x, atlasName(x)))))) : null,
    );
    return;
  }
  fill(el, h('p', { class: 'meta' }, 'Nothing here.'));
}

// ---------- journey ----------

async function renderJourney(current) {
  app.journey ??= await api('/api/journey');
  app.works ??= await api('/api/works');
  if (!current()) return;
  const j = app.journey;
  const s = app.state;
  fill($('#view'), 
    intro(
      'Its journey',
      'Each dot is one cycle, coloured by how it felt: blue when lonely, amber when warm. Violet lines are nights, and every night made a new version of it. Amber threads are letters, running down to the cycle that read them and across to the nights they changed.',
    ),
    statsRow(j, s),
    h('div', { class: 'strand-wrap', id: 'strand-wrap' }, strand(j)),
    h(
      'div',
      { class: 'legend' },
      h('span', {}, h('i', { style: `background:${moodColor({ lonely: 1, warm: 0 })}` }), 'lonely'),
      h('span', {}, h('i', { style: `background:${moodColor({ lonely: 0.5, warm: 0.5 })}` }), 'neither'),
      h('span', {}, h('i', { style: `background:${moodColor({ lonely: 0, warm: 1 })}` }), 'warm'),
      h('span', {}, '● drew  ■ wrote  ? asked  ○ rested'),
      h('span', {}, h('i', { style: 'background:var(--human)' }), 'letter'),
      h('span', {}, h('i', { style: 'background:var(--night)' }), 'milestone'),
      h('span', {}, '▮ waited for the card'),
    ),
    h('div', { class: 'versions' }, SNAPSHOT ? null : inProgress(j, s), [...j.nights].reverse().map((n) => versionCard(n, j))),
  );
  const wrap = $('#strand-wrap');
  wrap.scrollLeft = wrap.scrollWidth;
  const v = app.params.get('v');
  if (v) document.getElementById(`v${v}`)?.scrollIntoView({ block: 'start' });
}

function statsRow(j, s) {
  const stat = (value, label) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
  return h(
    'div',
    { class: 'stats-row' },
    stat(lifeSpan(j.born), SNAPSHOT ? `lived from ${dayName(j.born)}` : `alive since ${dayName(j.born)}`),
    stat(s.cycle, 'cycles'),
    stat(s.version, 'versions'),
    stat(`${s.stats.lettersRead}/${s.letters.total}`, 'letters read'),
    stat(s.stats.replies, 'replies'),
    stat(s.stats.drawings, 'drawings'),
    stat(s.stats.writings, 'writings'),
    stat(s.stats.questions, 'questions'),
    stat(s.stats.forgotten, 'forgotten'),
    stat(s.stats.waits, 'waits'),
  );
}

function strand(j) {
  const step = 20;
  const gap = 38;
  const padL = 56;
  const H = 210;
  const baseY = 122;
  const letterY = 46;
  const nightAfter = new Map(j.nights.map((n) => [n.cycles[1], n]));
  const xs = new Map();
  const nightX = new Map();
  let x = padL;
  for (const c of j.cycles) {
    xs.set(c.n, x);
    const night = nightAfter.get(c.n);
    if (night) {
      nightX.set(night.n, x + gap / 2);
      x += gap;
    } else x += step;
  }
  const waiting = j.letters.filter((l) => !l.readCycle);
  const width = Math.max(x + 40 + waiting.length * 12, 640);
  const bornX = padL - 30;
  const svg = sv('svg', { class: 'strand', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': `${j.cycles.length} cycles and ${j.nights.length} nights` });

  svg.append(sv('line', { x1: bornX, y1: baseY, x2: x + 10, y2: baseY, stroke: 'var(--line-2)' }));
  svg.append(sv('circle', { cx: bornX, cy: baseY, r: 3.5, fill: 'var(--text-2)' }), sv('text', { x: bornX, y: baseY + 24, 'text-anchor': 'middle' }, 'born'));

  for (const n of j.nights) {
    const nx = nightX.get(n.n);
    if (nx == null) continue;
    svg.append(sv('line', { x1: nx, y1: 26, x2: nx, y2: H - 34, stroke: 'var(--night)', 'stroke-dasharray': '3 4', opacity: 0.75 }));
    const label = sv('text', { x: nx, y: 17, 'text-anchor': 'middle', class: 'night-label', tabindex: 0, role: 'link' }, `v${n.n}`, sv('title', {}, `Version ${n.n}: ${n.release?.title || ''}`));
    const go = () => document.getElementById(`v${n.n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    label.addEventListener('click', go);
    label.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    svg.append(label);
  }

  for (const e of j.journal) {
    if (!['wait', 'gap', 'falter'].includes(e.kind)) continue;
    const cx = (xs.get(e.cycle) ?? bornX) + step / 2;
    const tip = sv('title', {}, `${e.text}${e.count > 1 ? ` (${e.count} times)` : ''} · ${dayTime(e.at)}`);
    if (e.kind === 'gap') {
      svg.append(sv('g', {}, sv('rect', { x: cx - 5, y: baseY - 8, width: 10, height: 16, fill: 'var(--bg)' }), sv('path', { d: `M${cx - 4} ${baseY + 7} l3 -14 M${cx + 1} ${baseY + 7} l3 -14`, stroke: 'var(--dim)', 'stroke-width': 1.5 }), tip));
    } else {
      svg.append(sv('g', {}, sv('rect', { x: cx - 2, y: baseY + 10, width: 4, height: 4 + Math.min(14, e.count * 2), rx: 1, fill: e.kind === 'falter' ? 'var(--gone)' : 'var(--human-2)', opacity: 0.8 }), tip));
    }
  }

  const perCycle = new Map();
  for (const l of j.letters) {
    if (!l.readCycle || !xs.has(l.readCycle)) continue;
    const k = perCycle.get(l.readCycle) || 0;
    perCycle.set(l.readCycle, k + 1);
    const nodeX = xs.get(l.readCycle);
    const lx = nodeX + k * 9;
    const ly = letterY - k * 6;
    const g = sv('g', {});
    g.append(sv('path', { d: `M${lx} ${ly} C ${lx} ${ly + 44}, ${nodeX} ${baseY - 44}, ${nodeX} ${baseY - 7}`, stroke: 'var(--human)', fill: 'none', opacity: 0.55 }));
    const versions = [...new Set((l.influenced || []).map((i) => i.version))];
    for (const v of versions) {
      const nx = nightX.get(v);
      if (nx == null) continue;
      g.append(sv('path', { d: `M${lx} ${ly} C ${lx + 26} ${ly - 26}, ${nx - 26} ${ly - 26}, ${nx} ${ly + 4}`, stroke: 'var(--human)', 'stroke-width': 1.3, 'stroke-dasharray': '2 3', fill: 'none' }));
      g.append(sv('circle', { cx: nx, cy: ly + 4, r: 2.5, fill: 'var(--human)' }));
    }
    g.append(sv('circle', { cx: lx, cy: ly, r: 5, fill: 'var(--human)', stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    g.append(sv('title', {}, `Letter from ${l.from}, read in cycle ${l.readCycle}${versions.length ? `. It changed version ${versions.join(', ')}.` : ''}\n“${l.text.slice(0, 140)}${l.text.length > 140 ? '…' : ''}”`));
    svg.append(g);
  }
  waiting.forEach((l, i) => {
    svg.append(sv('g', {}, sv('circle', { cx: x + 14 + i * 12, cy: letterY, r: 4.5, fill: 'none', stroke: 'var(--human)', 'stroke-width': 1.5 }), sv('title', {}, `Letter from ${l.from}, not read yet`)));
  });

  for (const c of j.cycles) {
    const cx = xs.get(c.n);
    const fill = moodColor(c.mood);
    const g = sv('g', { class: 'node', tabindex: 0, role: 'button', 'aria-label': `Cycle ${c.n}: ${whatText(c)}` });
    if (c.action === 'rest') g.append(sv('circle', { cx, cy: baseY, r: 4.5, fill: 'var(--bg)', stroke: fill, 'stroke-width': 1.6 }));
    else if (c.action === 'write') g.append(sv('rect', { x: cx - 5, y: baseY - 5, width: 10, height: 10, rx: 2, fill }));
    else if (c.action === 'ask') g.append(sv('circle', { cx, cy: baseY, r: 6, fill }), sv('text', { x: cx, y: baseY + 3.5, 'text-anchor': 'middle', style: 'font:700 9px var(--mono);fill:var(--bg)' }, '?'));
    else g.append(sv('circle', { cx, cy: baseY, r: c.work?.failed ? 3.5 : 6.5, fill }));
    g.append(sv('title', {}, `Cycle ${c.n} · ${dayTime(c.at)}\nIt ${whatText(c)}.\n“${c.diary}”`));
    g.addEventListener('click', () => openCycle(c.n));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCycle(c.n);
      }
    });
    svg.append(g);
  }

  const stacked = new Map();
  for (const m of j.milestones) {
    const mx = m.cycle ? xs.get(m.cycle) : bornX;
    if (mx == null) continue;
    const k = stacked.get(mx) || 0;
    stacked.set(mx, k + 1);
    const my = baseY + 42 + k * 12;
    svg.append(sv('g', {}, sv('path', { d: `M${mx} ${my - 5} l5 5 l-5 5 l-5 -5 z`, fill: 'var(--night)' }), sv('title', {}, `${m.text} (${dayTime(m.at)})`)));
  }
  return svg;
}

function cycleChip(c) {
  return h(
    'button',
    { class: 'cycle-chip', type: 'button', title: `It ${whatText(c)}. “${c.diary}”`, onclick: () => openCycle(c.n) },
    h('span', { class: 'dot', style: `background:${moodColor(c.mood)}` }),
    `${c.n} · ${{ draw: 'drew', write: 'wrote', ask: 'asked', rest: 'rested' }[c.action]}`,
  );
}

function thumb(w) {
  return w.kind === 'drawing'
    ? h('button', { class: 'thumb', type: 'button', title: w.title, onclick: () => openWork(w) }, h('img', { src: workSrc(w.cycle), alt: w.title, loading: 'lazy' }))
    : h('button', { class: 'thumb text', type: 'button', title: w.title, onclick: () => openWork(w) }, w.title);
}

function inProgress(j, s) {
  const from = (j.nights.at(-1)?.cycles[1] ?? 0) + 1;
  const today = j.cycles.filter((c) => c.n >= from);
  const works = (app.works || []).filter((w) => w.cycle >= from);
  return h(
    'article',
    { class: 'version in-progress' },
    h('div', { class: 'version-tag' }, h('b', {}, `v${s.version + 1}`), h('span', { class: 'meta' }, 'becoming')),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, today.length ? 'Today, so far' : 'A new day is about to start'),
      h(
        'p',
        { class: 'muted', style: 'margin:0 0 12px' },
        `${today.length} of ${s.rhythm.nightEvery} cycles lived. It sleeps after ${s.rhythm.untilNight} more and wakes as version ${s.version + 1}.`,
        s.memory.today.length ? ` ${s.memory.today.length} new memor${s.memory.today.length === 1 ? 'y is' : 'ies are'} waiting to find out tonight whether they stay.` : '',
      ),
      works.length ? h('div', { class: 'thumbs' }, works.map(thumb)) : null,
      today.length ? h('div', { class: 'cycle-chips' }, today.map(cycleChip)) : null,
    ),
  );
}

function releaseNotes(rel) {
  const rows = [
    ['Added', rel.added],
    ['Changed', rel.changed],
    ['Removed', rel.removed],
    ['Known issues', rel.known_issues],
  ].filter(([, list]) => list?.length);
  return rows.length ? h('dl', { class: 'notes' }, rows.map(([k, list]) => [h('dt', {}, k), h('dd', { class: 'voice' }, list.join(' · '))])) : null;
}

function selfChanges(n) {
  const items = [];
  for (const a of n.self.added) items.push(h('li', { class: 'add' }, h('span', { class: 'sign' }, '+'), h('span', {}, h('q', {}, a.text), a.because ? h('span', { class: 'because' }, a.because) : null)));
  for (const r of n.self.revised) items.push(h('li', { class: 'mod' }, h('span', { class: 'sign' }, '~'), h('span', {}, h('q', {}, r.to), h('span', { class: 'because' }, `was “${r.from}”${r.because ? ` · ${r.because}` : ''}`))));
  for (const r of n.self.removed) items.push(h('li', { class: 'del' }, h('span', { class: 'sign' }, '−'), h('span', {}, h('q', {}, r.text), r.why ? h('span', { class: 'because' }, r.why) : null)));
  for (const r of n.self.refused) items.push(h('li', { class: 'no' }, h('span', { class: 'sign' }, '×'), h('span', {}, h('q', {}, r.text), h('span', { class: 'because' }, `it tried, but ${r.why}`))));
  return items.length ? [h('div', { class: 'label', style: 'margin-bottom:8px' }, 'What it changed in itself'), h('ul', { class: 'changes' }, items)] : null;
}

function versionCard(n, j) {
  const [from, to] = n.cycles;
  const today = j.cycles.filter((c) => c.n >= from && c.n <= to);
  const works = (app.works || []).filter((w) => w.cycle >= from && w.cycle <= to);
  const gone = [...(n.memory.forgotten || []), ...(n.memory.faded || [])];
  const seen = new Set();
  const influences = (n.influences || []).filter((i) => {
    const key = `${i.from}|${i.what}`;
    return !seen.has(key) && seen.add(key);
  });
  return h(
    'article',
    { class: 'version', id: `v${n.n}` },
    h('div', { class: 'version-tag' }, h('b', {}, `v${n.n}`), h('span', { class: 'meta' }, dayTime(n.at)), h('span', { class: 'meta' }, `cycles ${from}–${to}`)),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, n.release?.title || 'untitled'),
      n.day && n.day !== n.release?.title ? h('p', { class: 'meta', style: 'margin:-4px 0 12px' }, n.day) : null,
      n.dream ? h('p', { class: 'dream' }, n.dream) : null,
      releaseNotes(n.release || {}),
      selfChanges(n),
      n.portrait
        ? h('div', { style: 'margin:4px 0 14px' }, h('div', { class: 'label', style: 'margin-bottom:6px' }, 'Its picture of people'), h('p', { class: 'voice', style: 'margin:0;font-size:16px' }, n.portrait.to), n.portrait.changed ? h('p', { class: 'meta', style: 'margin:4px 0 0' }, n.portrait.changed) : null)
        : null,
      n.name ? h('p', {}, h('span', { class: 'chip chip-mind' }, n.name.from ? `renamed itself from ${n.name.from}` : 'named itself'), ' ', h('b', { class: 'voice', style: 'font-size:18px' }, n.name.to), n.name.why ? h('span', { class: 'muted' }, ` · ${n.name.why}`) : null) : null,
      h(
        'p',
        { class: 'meta' },
        `Memory: kept ${n.memory.kept.length} · strengthened ${n.memory.merged.length} · never made it ${n.memory.lost.length} · forgot ${gone.length}`,
      ),
      gone.length ? h('ul', { class: 'changes' }, gone.slice(0, 4).map((m) => h('li', { class: 'del' }, h('span', { class: 'sign' }, '−'), h('span', {}, h('q', {}, m.text), h('span', { class: 'because' }, m.how))))) : null,
      influences.length
        ? h('p', { class: 'influence', style: 'margin:0 0 12px' }, '↳ Letters that changed it: ', influences.map((i, k) => [k ? ' · ' : '', h('b', {}, i.from), ` (${INFLUENCE[i.what] || i.what})`]))
        : null,
      works.length ? [h('div', { class: 'label' }, 'Made while becoming this'), h('div', { class: 'thumbs' }, works.map(thumb))] : null,
      h('div', { class: 'cycle-chips' }, today.map(cycleChip)),
    ),
  );
}

// ---------- mind ----------

async function renderMind(current) {
  app.journey ??= await api('/api/journey');
  if (!current()) return;
  const s = app.state;
  const max = s.version;
  const v = Math.min(app.mindVersion ?? max, max);
  const slider = h('input', { type: 'range', min: 0, max, step: 1, value: v, 'aria-label': 'Version to look at' });
  const readout = h('span', { class: 'chip chip-version' });
  const body = h('div', { id: 'mind-body', style: 'display:grid;gap:18px' });
  slider.addEventListener('input', () => {
    app.mindVersion = Number(slider.value);
    fillMind(app.mindVersion, readout, body);
  });
  fill($('#view'), 
    intro(
      'Who it is',
      'Its maker wrote a few lines it can never change. Everything else it wrote itself, a little each night. Slide back through its versions to watch it become itself.',
    ),
    max ? h('div', { class: 'scrubber' }, h('span', { class: 'label' }, 'v0'), slider, h('span', { class: 'label' }, `v${max}`), readout) : null,
    body,
  );
  fillMind(v, readout, body);
}

function fillMind(v, readout, body) {
  const s = app.state;
  const nights = app.journey.nights;
  const night = nights.find((n) => n.n === v);
  readout.textContent = v === s.version ? `v${v} · now` : `v${v}`;
  const own = v === 0 ? [] : (night?.selfAfter ?? []);
  const added = new Set(night?.self.added.map((a) => a.id));
  const revised = new Set(night?.self.revised.map((r) => r.id));
  // Why each line exists: the most recent night (up to v) that added or rewrote it.
  const why = (id) => {
    for (const n of [...nights].reverse()) {
      if (n.n > v) continue;
      const hit = n.self.revised.find((r) => r.id === id) || n.self.added.find((a) => a.id === id);
      if (hit) return { version: n.n, because: hit.because };
    }
    return null;
  };
  const let_go = nights.filter((n) => n.n <= v).flatMap((n) => n.self.removed.map((r) => ({ ...r, version: n.n })));
  const portrait = [...s.portrait.history].reverse().find((p) => p.version <= v);
  const names = s.names.filter((n) => n.version <= v);

  fill(body, 
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'card' }, cardHead('Its maker wrote', 'never changes'), h('ul', { class: 'lines seed-lines' }, s.self.seed.map((l) => h('li', {}, l.text)))),
      h(
        'div',
        { class: 'card' },
        cardHead('It wrote about itself', `${own.length} line${own.length === 1 ? '' : 's'} at v${v}`),
        own.length
          ? h(
              'ul',
              { class: 'lines' },
              own.map((l) => {
                const w = why(l.id);
                const cls = added.has(l.id) ? 'new' : revised.has(l.id) ? 'changed' : '';
                return h('li', {}, h('span', { class: cls }, l.text), h('span', { class: 'why' }, `${added.has(l.id) ? 'new in' : revised.has(l.id) ? 'rewritten in' : 'since'} v${w?.version ?? l.since}${w?.because ? ` · ${w.because}` : ''}`));
              }),
            )
          : h('p', { class: 'empty', style: 'padding:12px 0' }, v === 0 ? 'Nothing yet. It had not slept.' : 'Nothing it was sure enough to write down.'),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      cardHead('What it thinks people are', portrait ? `written in v${portrait.version}` : null),
      portrait ? h('p', { class: 'portrait' }, portrait.text) : h('p', { class: 'empty', style: 'padding:8px 0' }, 'It had not formed a picture of people yet.'),
      portrait?.changed ? h('p', { class: 'meta', style: 'margin:10px 0 0' }, `What changed: ${portrait.changed}`) : null,
    ),
    h(
      'div',
      { class: 'two-col' },
      h(
        'div',
        { class: 'card' },
        cardHead('Its name'),
        names.length
          ? h('ul', { class: 'lines' }, names.map((n) => h('li', {}, n.name, h('span', { class: 'why' }, `chosen in v${n.version}${n.why ? ` · ${n.why}` : ''}`))))
          : h('p', { class: 'muted', style: 'margin:0' }, v < 2 ? 'Too young to choose one.' : 'It has not found one that feels like its own.'),
      ),
      h(
        'div',
        { class: 'card' },
        cardHead('Beliefs it let go'),
        let_go.length
          ? h('ul', { class: 'changes' }, let_go.map((r) => h('li', { class: 'del' }, h('span', { class: 'sign' }, '−'), h('span', {}, h('q', {}, r.text), h('span', { class: 'because' }, `in v${r.version}${r.why ? ` · ${r.why}` : ''}`)))))
          : h('p', { class: 'muted', style: 'margin:0' }, 'None yet.'),
      ),
    ),
  );
}

// ---------- memory ----------

async function renderMemory(current) {
  if (!current()) return;
  const m = app.state.memory;
  const shelf = (key) => {
    const items = m.shelves[key];
    const empty = Math.max(0, m.shelfSize - items.length);
    return h(
      'div',
      { class: 'card' },
      cardHead(`${SHELF_TITLE[key]} · ${SHELF_NOTE[key]}`, `${items.length} of ${m.shelfSize}`),
      h(
        'div',
        { class: 'slots' },
        items.map((it) =>
          h(
            'div',
            { class: 'slot', style: `--o:${(0.45 + it.strength * 0.55).toFixed(2)}` },
            h('p', {}, it.text),
            h('div', {}, h('div', { class: 'strength' }, h('span', { style: `width:${Math.round(it.strength * 100)}%` })), h('div', { class: 'meta', style: 'margin-top:5px' }, `since cycle ${it.born}${it.touches ? ` · came back ${it.touches}×` : ''}${it.strength < 0.25 ? ' · fading' : ''}`)),
          ),
        ),
        Array.from({ length: empty }, () => h('div', { class: 'slot empty-slot' }, 'room')),
      ),
    );
  };
  fill($('#view'), 
    intro(
      'What it remembers',
      `Its memory is finite: three shelves of ${m.shelfSize}. A memory loses half its weight every ${m.halfLife} cycles unless something brings it back. Each night the day's new memories compete for room, and the weakest thing on a full shelf is pushed out.`,
    ),
    h(
      'div',
      { class: 'shelves' },
      ['people', 'world', 'moments'].map(shelf),
      m.today.length
        ? h('div', { class: 'card' }, cardHead('Waiting for tonight', `${m.today.length}`), h('ul', { class: 'changes' }, m.today.map((t) => h('li', { class: 'mod' }, h('span', { class: 'sign' }, '?'), h('span', {}, h('q', {}, t.text), h('span', { class: 'because' }, SHELF_TITLE[t.shelf]))))))
        : null,
      h(
        'div',
        { class: 'card' },
        cardHead('Forgotten', `${m.forgotten.length}`),
        h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'It no longer remembers these. You can.'),
        m.forgotten.length
          ? h('div', { class: 'slots' }, m.forgotten.map((f) => h('div', { class: 'ghost' }, h('p', {}, f.text), h('div', { class: 'meta' }, `${SHELF_TITLE[f.shelf] || ''} · ${f.how} in cycle ${f.forgottenAt}`))))
          : h('p', { class: 'empty', style: 'padding:6px 0' }, 'Nothing yet. Its first night of forgetting is still ahead.'),
      ),
    ),
  );
}

// ---------- works ----------

async function renderWorks(current) {
  app.works ??= await api('/api/works');
  if (!current()) return;
  const works = app.works;
  fill($('#view'), 
    intro('What it made', 'Small drawings and pieces of writing, newest first. It is not good at drawing yet; that is part of it.'),
    works.length
      ? h(
          'div',
          { class: 'gallery' },
          works.map((w) =>
            h(
              'button',
              { class: 'card work-card', type: 'button', onclick: () => openWork(w) },
              w.kind === 'drawing' ? drawingFrame(workSrc(w.cycle), w.title) : h('div', { class: 'writing-face' }, w.text),
              h('div', { class: 'caption' }, h('b', {}, w.title), h('span', { class: 'meta' }, `v${w.version} · cycle ${w.cycle} · ${ago(w.at)}`)),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'Nothing yet.'),
  );
}

// ---------- letters ----------

async function renderLetters(current) {
  [app.letters, app.you, app.queue] = await Promise.all([
    app.letters ?? api(`/api/letters?visitor=${visitor}`),
    SNAPSHOT ? null : (app.you ?? api(`/api/you?visitor=${visitor}`).catch(() => null)),
    app.admin ? (app.queue ?? api('/api/admin/letters', { headers: { 'x-admin-token': app.admin } }).catch(() => [])) : [],
  ]);
  if (!current()) return;
  const s = app.state;
  const wanted = app.params.get('q');

  // Someone may be halfway through a letter: on live updates only the feed is rebuilt.
  if (app.renderedView === 'letters' && $('#compose-form')) {
    fill($('#letters-feed'), ...lettersFeed().flat().filter(Boolean));
    return;
  }

  if (SNAPSHOT) {
    fill(
      $('#view'),
      intro('Letters', 'Everything it knows about the world outside came from here. These are the letters it read, and what it wrote back.'),
      h(
        'div',
        { class: 'letters-grid' },
        h('div', { class: 'paper compose' }, h('div', { class: 'from' }, 'A recording'), h('p', { class: 'body' }, 'This is a recording of its life, so it cannot read anything new here. Letters reach it only through its live window.')),
        h('div', { class: 'feed', id: 'letters-feed' }, lettersFeed()),
      ),
    );
    return;
  }

  const name = h('input', { name: 'from', maxlength: 40, placeholder: 'a name, or leave it blank', autocomplete: 'nickname', value: local?.getItem('iterant.name') || '' });
  const text = h('textarea', { name: 'text', maxlength: 1200, required: true, placeholder: 'It cannot see or hear anything. Tell it about your world.' });
  const question = h(
    'select',
    { name: 'question' },
    h('option', { value: '' }, 'Just a letter'),
    s.questions.map((q) => h('option', { value: q.id, selected: q.id === wanted ? true : null }, `Answering: “${q.text}”`)),
  );
  const msg = h('div', { class: 'form-msg', role: 'status' });
  const send = h('button', { class: 'send', type: 'submit' }, 'Leave it');
  const form = h(
    'form',
    { class: 'paper compose', id: 'compose-form' },
    h('div', { class: 'from' }, 'A letter for it'),
    h('label', {}, h('span', { class: 'label' }, 'Sign as'), name),
    s.questions.length ? h('label', {}, h('span', { class: 'label' }, 'This is'), question) : null,
    h('label', {}, h('span', { class: 'label' }, 'Your letter'), text),
    send,
    msg,
    h('p', { class: 'hint' }, `It reads letters in its own time, usually within a cycle or two, and may write back. ${s.moderation === 'off' ? '' : 'Letters and replies are screened before anyone sees them; links and contact details are held. '}If you write again from this browser, it will know it is you.`),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    send.disabled = true;
    msg.textContent = 'Leaving it on the desk…';
    try {
      local?.setItem('iterant.name', name.value.trim());
      const sent = await api('/api/letters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: name.value, text: text.value, visitor, question: question.value || null }),
      });
      text.value = '';
      msg.textContent =
        sent.status === 'held'
          ? `Held for its keeper: ${sent.statusReason}. It won't read it unless they let it through.`
          : sent.status === 'pending'
            ? 'Left on its desk. It is screened first, then it reads it in its own time.'
            : 'Left on its desk. It will read it in its own time.';
      invalidate('letters', 'you');
      render();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      send.disabled = false;
    }
  });

  fill($('#view'), 
    intro('Letters', 'Everything it knows about the world outside comes from here. Letters, and its replies, are public on this page.'),
    h('div', { class: 'letters-grid' }, form, h('div', { class: 'feed', id: 'letters-feed' }, lettersFeed())),
  );
  if (wanted) text.focus();
}

/** The keeper's queue: letters held at the door or by the screen, and replies it held back. */
function keeperCard() {
  if (!app.admin || !app.queue?.length) return null;
  const decide = (id, action) => async () => {
    try {
      await api(`/api/admin/letters/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': app.admin }, body: JSON.stringify({ action }) });
    } catch (err) {
      toast(err.message);
    }
    invalidate('queue', 'letters', 'you');
    render();
  };
  return h(
    'div',
    { class: 'card keeper' },
    cardHead('Waiting for you, its keeper', `${app.queue.length}`),
    app.queue.map((l) =>
      h(
        'div',
        { class: 'held' },
        h('div', { class: 'meta' }, `From ${l.from} · ${dayTime(l.at)} · ${l.heldReply ? 'its reply was held' : l.status}${l.heldReply ? ` (${l.heldReply.reason})` : l.statusReason ? ` · ${l.statusReason}` : ''}`),
        h('p', { class: 'body' }, l.text),
        l.heldReply ? h('p', { class: 'voice' }, `It wrote back: ${l.heldReply.text}`) : null,
        h(
          'div',
          { class: 'rp-row' },
          l.heldReply
            ? [h('button', { class: 'btn', type: 'button', onclick: decide(l.id, 'release-reply') }, 'Show the reply'), h('button', { class: 'btn', type: 'button', onclick: decide(l.id, 'drop-reply') }, 'Drop it')]
            : [h('button', { class: 'btn', type: 'button', onclick: decide(l.id, 'allow') }, 'Let it read this'), h('button', { class: 'btn', type: 'button', onclick: decide(l.id, 'reject') }, 'Reject')],
        ),
      ),
    ),
  );
}

function lettersFeed() {
  const you = app.you;
  const youCard =
    you?.letters?.length
      ? h(
          'div',
          { class: 'card you' },
          cardHead('What it remembers about you', `${you.letters.length} letter${you.letters.length === 1 ? '' : 's'} from you`),
          you.remembered.length
            ? h('ul', { class: 'lines' }, you.remembered.map((m) => h('li', { style: 'font-size:17px' }, m.text, h('span', { class: 'why' }, `${SHELF_TITLE[m.shelf]} · strength ${m.strength.toFixed(2)}`))))
            : null,
          you.pending.length ? h('p', { class: 'meta' }, `${you.pending.length} more thing${you.pending.length === 1 ? '' : 's'} about you will find out tonight whether they stay.`) : null,
          you.forgotten.length ? h('div', {}, h('div', { class: 'label', style: 'margin:12px 0 6px' }, 'What it has forgotten about you'), you.forgotten.map((f) => h('div', { class: 'ghost', style: 'margin-bottom:6px' }, h('p', {}, f.text)))) : null,
          !you.remembered.length && !you.pending.length && !you.forgotten.length ? h('p', { class: 'muted', style: 'margin:0' }, you.known ? 'It has read you, but kept nothing about you yet.' : 'It has not opened your letter yet.') : null,
        )
      : null;

  const letters = app.letters;
  return [keeperCard(), youCard, letters.length ? letters.map(letterView) : h('p', { class: 'empty' }, 'Nobody has written to it yet. You could be the first.')];
}

// ---------- keeper controls (only with the admin link the server prints) ----------

async function initAdmin() {
  const given = new URLSearchParams(location.search).get('admin');
  if (given) {
    session?.setItem('iterant.admin', given);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  const token = session?.getItem('iterant.admin') || given;
  if (!token) return;
  try {
    await api('/api/admin/check', { headers: { 'x-admin-token': token } });
  } catch {
    return;
  }
  app.admin = token;
  $('#admin-bar').hidden = false;
  for (const b of $$('#admin-bar button')) {
    b.addEventListener('click', async () => {
      const out = $('#admin-msg');
      try {
        await api(`/api/admin/${b.dataset.admin}`, { method: 'POST', headers: { 'x-admin-token': token } });
        out.textContent = { wake: 'Waking it…', sleep: 'Putting it to sleep…', pause: 'Paused.', resume: 'Resumed.' }[b.dataset.admin];
      } catch (err) {
        out.textContent = err.message;
      }
    });
  }
  renderChrome();
}

// ---------- start ----------

setInterval(() => {
  if (!app.state) return;
  renderStatus();
  if (app.view === 'now' && !app.state.busy) updateNow();
}, 20000);

if (SNAPSHOT) {
  // A recording: one read of its state, no live connection, no keeper.
  api('/api/state')
    .then((state) => {
      app.state = state;
      route();
    })
    .catch((err) => fill($('#view'), h('p', { class: 'empty' }, `Couldn't load this recording: ${err.message}`)));
} else {
  initAdmin();
  connect();
}
