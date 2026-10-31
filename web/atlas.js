// The atlas: its whole mind on one map, played through time. At the core, the lines its maker wrote; around them
// the beliefs it wrote itself; then three shelves of memory; then the dust of what it forgot; and on the rim, the
// people who wrote to it. Letters fall inward, nights rewrite it, and threads show which letter changed what.
// Nothing here is invented: every node and thread comes from its records (/api/atlas).
import { moodRGB } from './presence.js';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 0 before `a`, 1 after `b`, eased in between. */
const span = (t, a, b) => ease((t - a) / (b - a));
/** 0 → 1 → 0 across [a, b]. */
const bell = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));
const hash = (s) => {
  let x = 2166136261;
  for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return ((x >>> 0) % 10007) / 10007;
};
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const rgba = ([r, g, b], a) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(a)})`;

// Where each shelf lives on the dial, in degrees (0 is to the right, 90 is down).
const SECTORS = { people: [-68, 28], world: [42, 138], moments: [152, 270] };
const RING = { seed: 0.1, name: 0.18, today: 0.2, belief: 0.31, letGo: 0.39, memIn: 0.5, memOut: 0.61, dust: 0.79, thing: 0.825, letter: 0.86, person: 0.95 };
const UNIT_MS = 2400; // one cycle (or one night) at 1×

/** Timeline arithmetic: each cycle is one unit, and each night is one more unit after the cycle it follows. */
function timeline(d) {
  const nightAt = new Map(d.nights.map((n) => [n.cycle, n]));
  const sorted = d.nights.map((n) => n.cycle).sort((a, b) => a - b);
  const before = (c) => sorted.filter((x) => x < c).length;
  const cs = (c) => c - 1 + before(c);
  const ns = (c) => cs(c) + 1;
  const segments = [];
  for (const c of d.cycles) {
    segments.push({ a: cs(c.n), cycle: c.n, rec: c, night: null });
    if (nightAt.has(c.n)) segments.push({ a: ns(c.n), cycle: c.n, rec: c, night: nightAt.get(c.n) });
  }
  const end = d.end ? cs(d.end) + 1 + (nightAt.has(d.end) ? 1 : 0) : 0;
  const at = (t) => {
    let seg = null;
    for (const s of segments) if (s.a <= t) seg = s;
    return seg;
  };
  /** The cycle clock at timeline position t (fractional during a cycle, held still through a night). */
  const cycleTime = (t) => {
    const s = at(t);
    if (!s) return 0;
    return s.night ? s.cycle : s.cycle - 1 + clamp(t - s.a);
  };
  const versionAt = (t) => d.nights.filter((n) => ns(n.cycle) + 0.5 <= t).length;
  return { cs, ns, end, at, cycleTime, versionAt, nightAt };
}

/** Everything that happens, in order, for the caption feed. */
function narrate(d, tl) {
  const ev = [];
  // A quote that already ends a sentence needs no full stop after it.
  const push = (t, kind, text, ref) => ev.push({ t, kind, text: text.replace(/([.!?…])”\.$/, '$1”'), ref });
  const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const letterOf = new Map(d.letters.map((l) => [l.id, l]));
  push(0, 'born', 'It was switched on for the first time.', 'core');
  for (const c of d.cycles) {
    const a = tl.cs(c.n);
    for (const l of d.letters.filter((x) => x.cycle === c.n)) {
      push(a + 0.08, 'letter', `${l.from} wrote: “${short(l.text, 90)}”`, l.id);
      if (l.reply) push(a + 0.6, 'reply', `It wrote back to ${l.from}.`, l.id);
    }
    const w = c.work;
    if (w?.kind === 'drawing') push(a + 0.45, 'work', `It drew “${w.title}”.`, null);
    else if (w?.kind === 'writing') push(a + 0.45, 'work', `It wrote “${w.title}”.`, null);
    else if (w?.kind === 'question') push(a + 0.45, 'work', `It asked: “${short(w.text || '', 90)}”`, null);
    else if (w?.kind === 'errand') push(a + 0.45, 'work', `It sent people on an errand: “${short(w.text || '', 90)}”`, null);
    else if (w?.kind === 'building') push(a + 0.45, 'build', `It built “${w.title}” in its place.`, (d.things || []).find((t) => t.built === c.n)?.id ?? null);
    else if (w?.kind === 'tending') push(a + 0.45, 'build', `It ${w.restored ? 'rebuilt' : 'tended'} “${w.title}”.`, (d.things || []).find((t) => t.name === w.title)?.id ?? null);
    else push(a + 0.45, 'rest', 'It let the cycle pass.', null);
    for (const wish of (d.wishes || []).filter((x) => x.answer?.told === c.n)) {
      const how = { granted: 'granted', declined: 'declined', reply: 'answered' }[wish.answer.status];
      push(a + 0.04, 'wish', `Its keeper ${how} its wish “${short(wish.text, 70)}”.`, null);
    }
  }
  for (const t of d.things || []) for (const r of t.ruined) push(tl.ns(r) + 0.5, 'ruin', `“${t.name}” crumbled: it no longer remembered why it built it.`, t.id);
  for (const wish of d.wishes || []) if (wish.cycle != null) push(tl.ns(wish.cycle) + 0.9, 'wish', `It wished: “${short(wish.text, 90)}”`, null);
  for (const n of d.nights) {
    const a = tl.ns(n.cycle);
    push(a + 0.02, 'night', `Night ${n.v}: it slept.`, null);
    const sp = d.sparks.filter((s) => s.night === n.cycle);
    const k = (f) => sp.filter((s) => s.fate === f).length;
    if (sp.length) push(a + 0.36, 'memory', `Of ${sp.length} things it noticed: kept ${k('kept')}, folded ${k('merged')} into old memories, lost ${k('lost')}.`, null);
    for (const m of d.memories.filter((x) => x.gone === n.cycle)) {
      push(a + 0.48, 'forgot', `It forgot “${short(m.text, 80)}”${m.how === 'faded' ? ' (it faded)' : ''}.`, m.id);
    }
    for (const b of d.beliefs) {
      if (b.born === n.cycle) push(a + 0.72, 'belief', `A new belief: “${short(b.texts[0].text)}”`, b.id);
      b.texts.forEach((x, i) => i && x.from === n.cycle && push(a + 0.74, 'belief', `It rewrote a belief: “${short(x.text)}”`, b.id));
      if (b.gone === n.cycle) push(a + 0.76, 'unbelief', `It let go of “${short(b.texts.at(-1).text, 90)}”`, b.id);
    }
    d.portrait.forEach((p, i) => p.from === n.cycle && push(a + 0.78, 'portrait', i ? 'It redrew its picture of people.' : 'It wrote its first picture of people.', 'portrait'));
    for (const nm of d.names) if (nm.from === n.cycle) push(a + 0.8, 'name', `It named itself ${nm.name}.`, 'name');
    const byLetter = new Map();
    for (const th of d.threads) if (th.kind === 'influence' && th.at === n.cycle) (byLetter.get(th.from) ?? byLetter.set(th.from, []).get(th.from)).push(th);
    for (const [id, list] of byLetter) {
      const what = [...new Set(list.map((x) => WHAT[x.what]))];
      push(a + 0.88, 'influence', `${letterOf.get(id)?.from}'s letter changed ${listText(what)}.`, id);
    }
    push(a + 0.96, 'version', `It woke as version ${n.v}${n.title ? `: “${short(n.title, 80)}”` : ''}.`, null);
  }
  return ev.sort((x, y) => x.t - y.t);
}
const WHAT = { belief: 'a belief', unbelief: 'what it let go of', portrait: 'its picture of people', name: 'its name', memory: 'a memory' };
const listText = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Give every memory a seat on its shelf. A memory that pushes another out takes the seat it freed. */
function seatMemories(d) {
  const size = d.shelfSize || 12;
  const seats = { people: [], world: [], moments: [] };
  const rowOf = (m) => seats[m.shelf] || seats.moments;
  const nights = [...new Set([...d.nights.map((n) => n.cycle), ...d.memories.map((m) => m.kept)])].sort((a, b) => a - b);
  for (const night of nights) {
    const leaving = d.memories.filter((m) => m.gone === night);
    // Ones that faded leave first, as they do in consolidation; then newcomers sit down (any shelved and pushed out
    // the same night first, so whoever pushed them out can take their seat); then the pushed-out stand up.
    for (const g of leaving) if (g.how === 'faded' && rowOf(g)[g.seat] === g.id) rowOf(g)[g.seat] = null;
    const arriving = d.memories.filter((m) => m.kept === night).sort((a, b) => Number(b.gone === night) - Number(a.gone === night) || a.born - b.born);
    for (const m of arriving) {
      const row = rowOf(m);
      const out = leaving.find((g) => g.by === m.id && g.seat != null);
      if (out) m.seat = out.seat;
      else {
        m.seat = row.findIndex((x) => x == null);
        if (m.seat < 0) m.seat = row.length;
      }
      row[m.seat] = m.id;
    }
    for (const g of leaving) if (rowOf(g)[g.seat] === g.id) rowOf(g)[g.seat] = null;
  }
  // A very long life trims its oldest forgotten records; anything left without a seat gets a stable one.
  for (const m of d.memories) if (m.seat == null) m.seat = Math.floor(hash(m.id) * size);
  return Math.max(size, ...Object.values(seats).map((r) => r.length));
}

export function createAtlas(canvas, data, { onTime = () => {}, onHover = () => {}, onSelect = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = data;
  const tl = timeline(d);
  const events = narrate(d, tl);
  const seatsPerShelf = seatMemories(d);

  // ----- colours, from the page's own tokens -----
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => {
    const v = css.getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : fallback;
  };
  const C = {
    mind: tok('--mind', [169, 204, 255]),
    human: tok('--human', [242, 181, 107]),
    paper: tok('--paper', [239, 228, 208]),
    night: tok('--night', [155, 140, 240]),
    gone: tok('--gone', [224, 154, 148]),
    kept: tok('--kept', [143, 209, 165]),
    text: tok('--text-2', [189, 182, 170]),
    dim: tok('--dim', [133, 128, 119]),
    faint: tok('--faint', [93, 90, 85]),
    world: tok('--curious', [111, 209, 198]),
  };
  const SHELF_RGB = { people: C.human, world: C.world, moments: C.mind };

  // ----- graph, for highlighting what a node is connected to -----
  const letterById = new Map(d.letters.map((l) => [l.id, l]));
  const personById = new Map(d.people.map((p) => [p.id, p]));
  const memById = new Map(d.memories.map((m) => [m.id, m]));
  const beliefById = new Map(d.beliefs.map((b) => [b.id, b]));
  const things = d.things || [];
  const thingById = new Map(things.map((t) => [t.id, t]));
  const adj = new Map();
  const link = (a, b) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)).add(a);
  };
  for (const l of d.letters) link(l.id, l.person);
  for (const th of d.threads) link(th.from, th.to);
  const personByName = new Map(d.people.map((p) => [p.name.trim().toLowerCase(), p.id]));
  for (const m of d.memories) if (m.about && personByName.has(m.about.trim().toLowerCase())) link(m.id, personByName.get(m.about.trim().toLowerCase()));
  function related(id) {
    const out = new Set([id]);
    for (const n of adj.get(id) || []) {
      out.add(n);
      if (letterById.has(n) || letterById.has(id)) for (const m of adj.get(n) || []) out.add(m);
    }
    return out;
  }

  // ----- layout -----
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;
  let R = 1;
  let sx = 1; // horizontal stretch, so a wide stage is used as an ellipse
  const P = (deg, r) => ({ x: cx + Math.cos(deg * RAD) * r * R * sx, y: cy + Math.sin(deg * RAD) * r * R });
  const stars = Array.from({ length: 150 }, (_, i) => ({ x: hash(`sx${i}`), y: hash(`sy${i}`), r: 0.4 + hash(`sr${i}`) * 0.9, a: 0.08 + hash(`sa${i}`) * 0.3, p: hash(`sp${i}`) * TAU }));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cx = W / 2;
    cy = H / 2;
    R = Math.max(20, Math.min(H / 2 - 26, W / 2 - 20));
    sx = clamp((W / 2 - 46) / R, 1, 1.55);
  }

  const beliefAngle = (i) => -90 + ((i + 1) * 360) / (d.beliefs.length + 1);
  const personAngle = (i) => -90 + (360 * (i + 0.5)) / Math.max(d.people.length, 4) + 12;
  const seatAngle = (m) => {
    const [a0, a1] = SECTORS[m.shelf] || SECTORS.moments;
    return a0 + ((m.seat + 0.5) / seatsPerShelf) * (a1 - a0);
  };
  const seatRing = (m) => (m.seat % 2 ? RING.memOut : RING.memIn) + (hash(m.id) - 0.5) * 0.025;
  // A thing sits under the person whose letter it was made from, beside their other things; one made from
  // nothing but itself gets an angle of its own.
  const thingAngle = new Map();
  for (const t of things) {
    const letter = t.from.map((id) => letterById.get(id)).find(Boolean);
    const i = letter ? d.people.findIndex((p) => p.id === letter.person) : -1;
    if (i < 0) {
      thingAngle.set(t.id, hash(t.id) * 360);
      continue;
    }
    const siblings = things.filter((x) => x.from.some((id) => letterById.get(id)?.person === letter.person));
    thingAngle.set(t.id, personAngle(i) + (siblings.indexOf(t) - (siblings.length - 1) / 2) * 5);
  }
  /** Whether a thing lies in ruins at timeline position T: from the night it crumbled until a cycle that rebuilt it. */
  const ruinedAt = (thing, T) => {
    const fell = thing.ruined.filter((c) => tl.ns(c) + 0.5 <= T).at(-1);
    return fell != null && !thing.rebuilt.some((c) => c > fell && tl.cs(c) + 0.45 <= T);
  };
  const letterRest = (l) => {
    const p = personById.get(l.person);
    const i = d.people.indexOf(p);
    const j = p.letters.indexOf(l.id);
    return P(personAngle(i) + (j - (p.letters.length - 1) / 2) * 4.2, RING.letter);
  };

  // A memory's strength at a moment: its weight, halved every half-life since it was last brought back.
  function strengthAt(m, ct) {
    let last = m.born;
    for (const x of m.touches) if (x <= ct && x > last) last = x;
    return clamp(m.weight * 0.5 ** (Math.max(0, ct - last) / (d.halfLife || 36)), 0.05, 1);
  }

  /** Where everything is at timeline position t, and how it looks. */
  function scene(t) {
    const nodes = [];
    const ct = tl.cycleTime(t);
    const core = { id: 'core', kind: 'core', x: cx, y: cy, r: Math.max(10, R * 0.055), alpha: 1 };

    d.seed.forEach((s, i) => {
      const p = P(-60 + i * (360 / Math.max(d.seed.length, 1)), RING.seed);
      nodes.push({ id: s.id, kind: 'seed', ...p, r: 3, alpha: 1, data: s });
    });

    d.beliefs.forEach((b, i) => {
      const born = tl.ns(b.born);
      const grow = span(t, born + 0.5, born + 0.8);
      if (grow <= 0) return;
      const slot = P(beliefAngle(i), RING.belief);
      const out = b.gone != null ? span(t, tl.ns(b.gone) + 0.55, tl.ns(b.gone) + 0.85) : 0;
      const away = P(beliefAngle(i), RING.letGo);
      const x = lerp(lerp(cx, slot.x, grow), away.x, out);
      const y = lerp(lerp(cy, slot.y, grow), away.y, out);
      const rev = b.texts.slice(1).reduce((m, tx) => Math.max(m, bell(t, tl.ns(tx.from) + 0.55, tl.ns(tx.from) + 0.95)), 0);
      const text = [...b.texts].reverse().find((tx) => tx.from <= ct || tx === b.texts[0])?.text ?? b.texts[0].text;
      nodes.push({ id: b.id, kind: 'belief', x, y, r: lerp(2, 5.5, grow), alpha: lerp(1, 0.55, out), letGo: out, pulse: rev, data: b, text });
    });

    if (d.portrait.length) {
      const first = tl.ns(d.portrait[0].from);
      const grow = span(t, first + 0.55, first + 0.85);
      if (grow > 0) {
        const p = P(-90, RING.belief);
        const pulse = d.portrait.slice(1).reduce((m, x) => Math.max(m, bell(t, tl.ns(x.from) + 0.6, tl.ns(x.from) + 0.98)), 0);
        nodes.push({ id: 'portrait', kind: 'portrait', x: lerp(cx, p.x, grow), y: lerp(cy, p.y, grow), r: lerp(2, 7, grow), alpha: 1, pulse });
      }
    }
    if (d.names.length) {
      const grow = span(t, tl.ns(d.names[0].from) + 0.7, tl.ns(d.names[0].from) + 0.95);
      if (grow > 0) {
        const p = P(-90, RING.name);
        nodes.push({ id: 'name', kind: 'name', x: lerp(cx, p.x, grow), y: lerp(cy, p.y, grow), r: lerp(2, 5, grow), alpha: 1 });
      }
    }

    for (const m of d.memories) {
      const appear = tl.ns(m.kept) + 0.38;
      const a = span(t, appear - 0.02, appear + 0.12);
      if (a <= 0) continue;
      const s = strengthAt(m, ct);
      const ang = seatAngle(m);
      const home = P(ang, seatRing(m) + (1 - s) * 0.05);
      const fall = m.gone != null ? span(t, tl.ns(m.gone) + 0.3, tl.ns(m.gone) + 0.62) : 0;
      const dust = P(ang + (hash(`${m.id}a`) - 0.5) * 7, RING.dust + (hash(`${m.id}r`) - 0.5) * 0.05);
      nodes.push({
        id: m.id,
        kind: 'memory',
        x: lerp(home.x, dust.x, fall),
        y: lerp(home.y, dust.y, fall),
        r: lerp(1.8 + 4.2 * s, 1.6, fall),
        alpha: a * lerp(0.45 + 0.55 * s, 0.6, fall),
        rgb: mix(SHELF_RGB[m.shelf] || C.mind, C.dim, fall),
        forgotten: fall > 0.5,
        strength: s,
        data: m,
      });
    }

    d.people.forEach((p, i) => {
      const first = tl.cs(p.first) + 0.05;
      const a = span(t, first, first + 0.25);
      if (a <= 0) return;
      const pos = P(personAngle(i), RING.person);
      const count = d.letters.filter((l) => l.person === p.id && tl.cs(l.cycle) + 0.35 <= t).length;
      nodes.push({ id: p.id, kind: 'person', ...pos, r: 4.5 + Math.min(5, count * 1.2), alpha: a, data: p, ang: personAngle(i) });
    });
    for (const l of d.letters) {
      const a = span(t, tl.cs(l.cycle) + 0.33, tl.cs(l.cycle) + 0.45);
      if (a <= 0) continue;
      nodes.push({ id: l.id, kind: 'letter', ...letterRest(l), r: 2.6, alpha: a, data: l });
    }
    for (const th of things) {
      const appear = tl.cs(th.built) + 0.5;
      const a = span(t, appear, appear + 0.2);
      if (a <= 0) continue;
      const ruin = ruinedAt(th, t);
      const tended = th.tended.reduce((m, c) => Math.max(m, bell(t, tl.cs(c) + 0.4, tl.cs(c) + 0.9)), 0);
      nodes.push({ id: th.id, kind: 'thing', ...P(thingAngle.get(th.id), RING.thing), r: lerp(2, 4.6, a), alpha: a, ruin, pulse: tended, data: th });
    }
    return { nodes, core, ct };
  }

  // ----- drawing -----
  let state = { t: 0, playing: false, speed: 1, hover: null, selected: null };
  let last = 0;
  let raf = 0;
  let drawn = { nodes: [] };

  function ring(r, alpha, dash = []) {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.ellipse(cx, cy, r * R * sx, r * R, 0, 0, TAU);
    ctx.strokeStyle = rgba(C.dim, alpha);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function label(text, x, y, { color = C.dim, alpha = 0.8, size = 10, align = 'center', font = 'mono' } = {}) {
    ctx.font = font === 'mono' ? `500 ${size}px 'IBM Plex Mono', ui-monospace, monospace` : font === 'serif' ? `italic ${size}px 'Newsreader', Georgia, serif` : `500 ${size}px 'IBM Plex Sans', system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = font === 'mono' ? '1.5px' : '0px';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillText(text, x, y);
  }
  function glow(x, y, r, rgb, alpha) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(r > 0)) return; // never let one bad point stop the whole frame
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(rgb, alpha));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function dot(x, y, r, rgb, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fillStyle = rgba(rgb, alpha);
    ctx.fill();
  }
  /** A thread curves through the middle of the mind, toward the core, on its way. */
  function curve(a, b, bendToCore = 0.42) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return { a, b, c: { x: lerp(mx, cx, bendToCore), y: lerp(my, cy, bendToCore) } };
  }
  const bez = (q, u) => ({
    x: (1 - u) * (1 - u) * q.a.x + 2 * (1 - u) * u * q.c.x + u * u * q.b.x,
    y: (1 - u) * (1 - u) * q.a.y + 2 * (1 - u) * u * q.c.y + u * u * q.b.y,
  });
  function strokeCurve(q, upto, rgb, alpha, width) {
    if (upto <= 0 || alpha <= 0.003) return;
    ctx.beginPath();
    ctx.moveTo(q.a.x, q.a.y);
    const steps = 28;
    for (let i = 1; i <= steps; i++) {
      const p = bez(q, (i / steps) * upto);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = rgba(rgb, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function comet(q, u, rgb, alpha) {
    if (u <= 0 || u >= 1) return;
    for (let k = 9; k >= 0; k--) {
      const p = bez(q, clamp(u - k * 0.025));
      dot(p.x, p.y, 2.6 - k * 0.2, rgb, alpha * (1 - k / 10) * 0.9);
    }
    const head = bez(q, u);
    glow(head.x, head.y, 12, rgb, alpha * 0.5);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 0;
    last = now;
    if (state.playing) {
      state.t = Math.min(tl.end, state.t + (dt / UNIT_MS) * state.speed);
      if (state.t >= tl.end) state.playing = false;
      onTime(state.t, state.playing);
    }
    draw(now / 1000);
  }

  function draw(sec) {
    if (W < 60 || H < 60) return; // not laid out (or no longer on the page)
    const t = state.t;
    const sc = scene(t);
    drawn = sc;
    const seg = tl.at(t);
    const nightF = seg?.night ? clamp(t - seg.a) : -1;
    const mood = seg?.rec?.mood;
    const focus = state.selected || state.hover;
    const lit = focus ? related(focus) : null;
    const fade = (id) => (!lit || lit.has(id) ? 1 : 0.16);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // the room: a few stars, and a violet wash while it sleeps
    for (const s of stars) {
      const tw = reduced ? 1 : 0.7 + 0.3 * Math.sin(sec * 0.8 + s.p);
      dot(s.x * W, s.y * H, s.r, C.text, s.a * tw * 0.6);
    }
    if (nightF >= 0) {
      const w = Math.sin(nightF * Math.PI);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * sx * 1.1);
      g.addColorStop(0, rgba(C.night, 0.16 * w));
      g.addColorStop(1, rgba(C.night, 0.03 * w));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // guides and their names
    ring(RING.belief, 0.16, [2, 5]);
    ring((RING.memIn + RING.memOut) / 2, 0.08, [1, 7]);
    ring(RING.dust, 0.1, [1, 9]);
    ring(RING.person, 0.12, []);
    const labelR = RING.memOut + 0.085;
    for (const [shelf, [a0, a1]] of Object.entries(SECTORS)) {
      const p = P((a0 + a1) / 2, labelR);
      label({ people: 'PEOPLE', world: 'THE WORLD OUTSIDE', moments: 'WHAT HAPPENED' }[shelf], p.x, p.y, { color: SHELF_RGB[shelf], alpha: 0.42, size: 9 });
    }
    const fl = P(232, RING.dust + 0.045);
    label('FORGOTTEN', fl.x, fl.y, { alpha: 0.38, size: 9 });

    // sleep ripples outward from the core
    if (nightF >= 0) {
      for (const off of [0, 0.22]) {
        const f = clamp((nightF - off) / 0.75);
        if (f <= 0 || f >= 1) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, f * R * sx, f * R, 0, 0, TAU);
        ctx.strokeStyle = rgba(C.night, (1 - f) * 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    const pos = new Map(sc.nodes.map((n) => [n.id, n]));
    pos.set('core', sc.core);

    // influence threads: drawn once, at night, then kept faintly as the map of what people did to it
    for (const th of d.threads) {
      const from = pos.get(th.from);
      const to = pos.get(th.to);
      if (!from || !to) continue;
      const q = curve(from, to, th.kind === 'pushed' ? 0.08 : th.what === 'thing' ? 0.05 : 0.42);
      // Things are built during a cycle; everything else a letter changes, it changes at night.
      const start = th.what === 'thing' ? tl.cs(th.at) + 0.5 : tl.ns(th.at) + (th.kind === 'pushed' ? 0.25 : 0.62);
      const grow = span(t, start, start + 0.3);
      if (grow <= 0) continue;
      const on = lit && lit.has(th.from) && lit.has(th.to) && (th.from === focus || th.to === focus || lit.has(focus));
      if (th.kind === 'pushed') {
        const flash = bell(t, start, start + 0.55);
        strokeCurve(q, grow, C.gone, lit ? (on ? 0.75 : 0.03) : 0.06 + flash * 0.7, 1 + flash);
      } else {
        const fresh = bell(t, start, start + 0.7);
        strokeCurve(q, grow, C.human, lit ? (on ? 0.85 : 0.04) : 0.18 + fresh * 0.6, on ? 1.6 : 1 + fresh);
        if (grow < 1) glow(bez(q, grow).x, bez(q, grow).y, 10, C.human, 0.7);
      }
    }

    // memories, dust first so the living ones sit on top
    const mems = sc.nodes.filter((n) => n.kind === 'memory').sort((a, b) => Number(b.forgotten) - Number(a.forgotten));
    for (const n of mems) {
      const a = n.alpha * fade(n.id);
      if (!n.forgotten) glow(n.x, n.y, n.r * 3.2, n.rgb, a * 0.22);
      dot(n.x, n.y, n.r, n.rgb, a);
    }

    // the lines its maker wrote: fixed, small, steady
    for (const n of sc.nodes.filter((x) => x.kind === 'seed')) {
      const a = fade(n.id);
      dot(n.x, n.y, n.r, C.paper, 0.75 * a);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3, 0, TAU);
      ctx.strokeStyle = rgba(C.paper, 0.22 * a);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // beliefs it wrote itself
    for (const n of sc.nodes.filter((x) => x.kind === 'belief' || x.kind === 'portrait' || x.kind === 'name')) {
      const a = n.alpha * fade(n.id);
      const rgb = n.kind === 'portrait' ? C.human : n.kind === 'name' ? C.paper : mix(C.night, C.faint, n.letGo || 0);
      if (n.pulse) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4 + n.pulse * 14, 0, TAU);
        ctx.strokeStyle = rgba(rgb, n.pulse * 0.6 * a);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (n.letGo > 0.5) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, TAU);
        ctx.strokeStyle = rgba(rgb, 0.7 * a);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        glow(n.x, n.y, n.r * 4, rgb, 0.35 * a);
        dot(n.x, n.y, n.r, rgb, a);
      }
      if (n.kind === 'portrait') {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3.5, 0, TAU);
        ctx.strokeStyle = rgba(C.human, 0.35 * a);
        ctx.stroke();
      }
    }

    // things it built, just inside the letters they were made from: little houses, hollow once they are ruins
    for (const n of sc.nodes.filter((x) => x.kind === 'thing')) {
      const a = n.alpha * fade(n.id);
      const rgb = n.ruin ? C.dim : C.world;
      const s = n.r;
      if (n.pulse) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, s + 4 + n.pulse * 10, 0, TAU);
        ctx.strokeStyle = rgba(C.world, n.pulse * 0.6 * a);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (!n.ruin) glow(n.x, n.y, s * 3.2, rgb, 0.3 * a);
      ctx.beginPath();
      ctx.moveTo(n.x - s, n.y + s * 0.9);
      ctx.lineTo(n.x - s, n.y - s * 0.1);
      ctx.lineTo(n.x, n.y - s * 1.1);
      ctx.lineTo(n.x + s, n.y - s * 0.1);
      ctx.lineTo(n.x + s, n.y + s * 0.9);
      ctx.closePath();
      if (n.ruin) {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = rgba(rgb, 0.85 * a);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = rgba(rgb, 0.92 * a);
        ctx.fill();
      }
    }

    // people on the rim, their letters just inside
    for (const n of sc.nodes.filter((x) => x.kind === 'letter')) {
      const a = n.alpha * fade(n.id);
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(Math.atan2(n.y - cy, n.x - cx));
      ctx.fillStyle = rgba(C.paper, 0.85 * a);
      ctx.fillRect(-3.2, -2.3, 6.4, 4.6);
      ctx.restore();
    }
    const showNames = d.people.length <= 24;
    for (const n of sc.nodes.filter((x) => x.kind === 'person')) {
      const a = n.alpha * fade(n.id);
      glow(n.x, n.y, n.r * 3, C.human, 0.3 * a);
      dot(n.x, n.y, n.r, C.human, 0.95 * a);
      if (showNames || focus === n.id) {
        const out = P(n.ang, RING.person + 0.065);
        const c = Math.cos(n.ang * RAD);
        label(n.data.name, out.x, out.y, { color: C.human, alpha: 0.9 * a, size: 11, font: 'sans', align: Math.abs(c) < 0.3 ? 'center' : c > 0 ? 'left' : 'right' });
      }
    }

    // letters falling in to be read, and replies going back out
    let reading = 0;
    for (const l of d.letters) {
      const a0 = tl.cs(l.cycle);
      const p = pos.get(l.person);
      if (!p) continue;
      const inQ = curve(p, sc.core, 0.0);
      const u = (t - (a0 + 0.06)) / 0.3;
      if (u > 0 && u < 1) comet(inQ, ease(u), C.paper, 1);
      reading = Math.max(reading, bell(t, a0 + 0.3, a0 + 0.5));
      if (l.reply) {
        const v = (t - (a0 + 0.58)) / 0.28;
        if (v > 0 && v < 1) comet(curve(sc.core, p, 0.0), ease(v), C.mind, 0.95);
      }
    }

    // today: things noticed during the day, circling until the night decides what to keep
    for (const s of d.sparks) {
      const born = tl.cs(s.cycle) + 0.82;
      const a = span(t, born, born + 0.1);
      if (a <= 0) continue;
      // Not slept on yet (today, while it lives): it keeps circling. (span over an infinite night would be NaN.)
      const nightA = s.night != null ? tl.ns(s.night) + 0.05 : Infinity;
      const go = s.night != null ? span(t, nightA, nightA + 0.33) : 0;
      if (go >= 1) continue;
      const k = hash(`${s.cycle}${s.text}`);
      const spin = (reduced ? 0 : sec * 14) + k * 360;
      const orbit = P(spin, RING.today + (k - 0.5) * 0.05);
      let target = orbit;
      let alpha = a;
      if (go > 0) {
        const into = pos.get(s.into);
        // A memory it merged into may not be on the map yet (or any more): then it fades like a lost one.
        if (s.fate === 'lost' || !into || !Number.isFinite(into.x) || !Number.isFinite(into.y)) {
          target = P(spin, RING.today + go * 0.25);
          alpha = a * (1 - go);
        } else target = into;
      }
      const x = lerp(orbit.x, target.x, go);
      const y = lerp(orbit.y, target.y, go);
      const rgb = SHELF_RGB[s.shelf] || C.mind;
      glow(x, y, 7, rgb, alpha * 0.5);
      dot(x, y, 1.8, rgb, alpha);
    }

    // the core: its presence, coloured by how it felt in this cycle, swelling as it reads
    const rgb = moodRGB(mood);
    const breathe = reduced ? 0 : Math.sin(sec * 1.4) * 0.06;
    const cr = sc.core.r * (1 + breathe + reading * 0.35) * (nightF >= 0 ? 0.92 : 1);
    const tint = nightF >= 0 ? mix(rgb, C.night, 0.55 * Math.sin(nightF * Math.PI)) : rgb;
    glow(cx, cy, cr * 4.5, tint, 0.28);
    glow(cx, cy, cr * 1.6, tint, 0.85);
    dot(cx, cy, cr * 0.55, mix(tint, [255, 255, 255], 0.6), 0.95);
    const v = tl.versionAt(t);
    const named = d.names.filter((nm) => tl.ns(nm.from) + 0.8 <= t).at(-1)?.name;
    label(named || 'unnamed', cx, cy + cr * 1.9 + 10, { color: C.text, alpha: 0.85, size: 14, font: 'serif' });
    if (R >= 220) label(`V${v}`, cx, cy + cr * 1.9 + 26, { color: C.night, alpha: 0.8, size: 9 });

    // the focused node: a ring, so it can be found again
    const f = focus && (pos.get(focus) || null);
    if (f) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, (f.r || 4) + 6, 0, TAU);
      ctx.strokeStyle = rgba(C.text, state.selected === focus ? 0.9 : 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // ----- pointer -----
  function hit(x, y) {
    let best = null;
    let bestD = Infinity;
    const list = [...drawn.nodes, drawn.core].filter(Boolean);
    for (const n of list) {
      if (n.alpha < 0.25) continue;
      const dd = Math.hypot(n.x - x, n.y - y);
      const reach = (n.r || 4) + (n.kind === 'memory' && n.forgotten ? 4 : 8);
      if (dd < reach && dd < bestD) {
        best = n;
        bestD = dd;
      }
    }
    return best;
  }
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  function onMove(e) {
    const [x, y] = local(e);
    const n = hit(x, y);
    const id = n?.id ?? null;
    canvas.style.cursor = n ? 'pointer' : 'default';
    if (id !== state.hover) {
      state.hover = id;
      onHover(n ? describeNode(n) : null, x, y);
    } else if (n) onHover(describeNode(n), x, y);
    if (!raf) draw(performance.now() / 1000);
  }
  function onLeave() {
    state.hover = null;
    onHover(null);
  }
  function onClick(e) {
    const [x, y] = local(e);
    const n = hit(x, y);
    api.select(n ? n.id : null);
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  /** What a hovered node is, in a line: for the tooltip. */
  function describeNode(n) {
    const ct = drawn.ct;
    switch (n.kind) {
      case 'core':
        return { kind: 'Itself', text: `Version ${tl.versionAt(state.t)}, cycle ${Math.max(1, Math.ceil(ct))}.` };
      case 'seed':
        return { kind: 'A line its maker wrote', text: n.data.text };
      case 'belief':
        return { kind: n.letGo > 0.5 ? 'A belief it let go of' : 'A belief it wrote', text: n.text };
      case 'portrait': {
        const p = [...d.portrait].reverse().find((x) => x.from <= ct) || d.portrait[0];
        return { kind: 'Its picture of people', text: p.text };
      }
      case 'name':
        return { kind: 'Its name', text: d.names.at(-1).name };
      case 'memory':
        return { kind: n.forgotten ? 'Forgotten' : `Memory · ${n.data.shelf} · ${Math.round(n.strength * 100)}%`, text: n.data.text };
      case 'person':
        return { kind: `Wrote ${n.data.letters.length} letter${n.data.letters.length === 1 ? '' : 's'}`, text: n.data.name };
      case 'letter':
        return { kind: `Letter from ${n.data.from}`, text: n.data.text };
      case 'thing':
        return { kind: n.ruin ? 'A ruin it built' : n.data.kind === 'place' ? 'A place it built' : 'Something it built', text: `${n.data.name}: ${n.data.plaque}` };
      default:
        return null;
    }
  }

  const ro = new ResizeObserver(() => {
    resize();
    draw(performance.now() / 1000);
  });
  ro.observe(canvas);
  resize();

  const api = {
    data: d,
    events,
    end: tl.end,
    timeline: tl,
    get t() {
      return state.t;
    },
    get playing() {
      return state.playing;
    },
    get speed() {
      return state.speed;
    },
    get selected() {
      return state.selected;
    },
    /** Where in its life a timeline position falls. */
    where(t = state.t) {
      const seg = tl.at(t);
      return { cycle: seg?.cycle ?? 0, night: seg?.night ?? null, rec: seg?.rec ?? null, version: tl.versionAt(t), cycleTime: tl.cycleTime(t) };
    },
    lookup: { letter: letterById, person: personById, memory: memById, belief: beliefById, thing: thingById },
    /** Whether a thing is a ruin at the current moment. */
    ruined(id) {
      const th = thingById.get(id);
      return th ? ruinedAt(th, state.t) : false;
    },
    /** A memory's strength at the current moment, 0..1. */
    strength(id) {
      const m = memById.get(id);
      return m ? strengthAt(m, tl.cycleTime(state.t)) : 0;
    },
    play() {
      if (state.t >= tl.end) state.t = 0;
      state.playing = true;
      last = 0;
      onTime(state.t, true);
    },
    pause() {
      state.playing = false;
      onTime(state.t, false);
    },
    seek(t) {
      state.t = clamp(t, 0, tl.end);
      onTime(state.t, state.playing);
    },
    setSpeed(x) {
      state.speed = x;
    },
    select(id) {
      state.selected = id && id === state.selected ? null : id;
      onSelect(state.selected);
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
    },
  };
  raf = requestAnimationFrame(frame);
  return api;
}
