// The relay: lets a static site follow a creature live, and lets visitors write to it, without anyone reaching the
// machine it lives on. The creature dials out to /creature and keeps that one WebSocket open; visitors watch on /live
// and make ordinary requests, which are passed to the creature over its socket only if they are on the public list.
// Nothing here can reach its keeper routes. One Durable Object holds every socket, so it can sleep between messages.
// While the creature is away, a letter waits here (a few per visitor, a couple of hundred in all) and is passed on,
// oldest first, when it dials back in; it is screened and counted by the creature then, like any other letter.
import { DurableObject } from 'cloudflare:workers';

// What a visitor may ask for: the creature's public API, its drawings, photos its keeper allowed, and writing to it.
const PUBLIC_GET = [
  /^\/api\/(state|journey|works|life|atlas|world|errands|chain|outbox)$/,
  /^\/api\/cycle\/(\d{1,7}|latest)$/,
  /^\/api\/night\/\d{1,5}$/,
  /^\/api\/(letters|you)$/,
  /^\/works\/\d{6}\.svg$/,
  /^\/returns\/L\d{1,7}\.jpg$/,
];
const PUBLIC_POST = [/^\/api\/letters$/, /^\/api\/errands\/e\d{1,6}\/returns$/];
const KEPT_QUERY = new Set(['visitor']); // every other query parameter (a keeper key, say) is dropped
const PASSED_HEADERS = ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options'];
const CHUNK = 256 * 1024; // messages larger than this are sent in parts
const POSTS_PER_HOUR = 12; // per visitor address, before the creature's own (stricter) limits
const WAIT_MS = 25000;
const MAIL_MAX = 200; // letters waiting for it, in all
const MAIL_PER_VISITOR = 3; // waiting from one visitor address
const MAIL_BYTES = 8 * 1024; // a letter is a name, up to 1200 characters and a visitor key: far less than this

/** How long a public answer may be served from memory without asking the creature again. */
function freshFor(path, query) {
  if (query) return 0; // per-visitor answers
  if (/^\/works\/|^\/returns\//.test(path)) return 86400;
  if (/^\/api\/(cycle\/\d|night\/)/.test(path)) return 3600;
  if (path === '/api/state' || path === '/api/cycle/latest') return 3;
  return 15;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/') return new Response('A relay for a small mind. Nothing to see here; it lives elsewhere.\n', { headers: { 'content-type': 'text/plain' } });
    const room = env.ROOM.get(env.ROOM.idFromName('creature'));
    const response = await room.fetch(request);
    if (response.webSocket) return response;
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.pending = new Map(); // request id -> { resolve, parts }
    this.cache = new Map(); // path -> { until, status, headers, body }
    this.posts = new Map(); // visitor address -> timestamps
    this.inbound = new Map(); // request id -> parts so far, for a long answer
    this.nextId = 1;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  creature(except = null) {
    return this.ctx.getWebSockets('creature').find((ws) => ws !== except && ws.readyState === 1 && ws.deserializeAttachment()?.ok) || null;
  }

  /** The creature pings every 30 s; one that has gone quiet (its network dropped without a goodbye) is let go. */
  async alarm() {
    const ws = this.creature();
    if (!ws) return;
    const last = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0, ws.deserializeAttachment().at);
    if (Date.now() - last > 75000) {
      ws.close(4002, 'quiet too long');
      return this.goneAway(ws);
    }
    await this.deliver(); // anything it could not take before
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  goneAway(ws) {
    if (this.creature(ws)) return;
    this.cache.clear();
    for (const viewer of this.ctx.getWebSockets('viewer')) {
      try {
        viewer.send(JSON.stringify({ event: 'offline', data: {} }));
      } catch {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/creature') return this.acceptCreature(request);
    if (url.pathname === '/live') return this.acceptViewer(request);
    return this.forward(request, url);
  }

  acceptCreature(request) {
    if (request.headers.get('upgrade') !== 'websocket') return json(426, { error: 'websocket only' });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['creature']);
    server.serializeAttachment({ ok: false, at: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  acceptViewer(request) {
    if (request.headers.get('upgrade') !== 'websocket') return json(426, { error: 'websocket only' });
    const allowed = String(this.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
    const origin = request.headers.get('origin');
    if (origin && !allowed.includes(origin)) return json(403, { error: 'not from here' });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['viewer']);
    // It says hello with the creature's state right away, or that the creature is away.
    this.ctx.waitUntil(this.greet(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async greet(ws) {
    const answer = this.creature() ? await this.ask('GET', '/api/state', '', null).catch(() => null) : null;
    const state = answer?.status === 200 ? JSON.parse(answer.body) : null;
    try {
      ws.send(JSON.stringify(state ? { event: 'hello', data: state } : { event: 'offline', data: {} }));
    } catch {}
  }

  async forward(request, url) {
    const method = request.method;
    const path = url.pathname;
    const list = method === 'GET' ? PUBLIC_GET : method === 'POST' ? PUBLIC_POST : [];
    if (!list.some((re) => re.test(path))) return json(404, { error: 'not found' });
    const query = [...url.searchParams].filter(([k]) => KEPT_QUERY.has(k)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const target = query ? `${path}?${query}` : path;

    if (method === 'GET') {
      const hit = this.cache.get(target);
      if (hit && hit.until > Date.now()) return this.answer(hit);
    }
    const body = method === 'POST' ? await request.text() : '';
    if (body.length > 6 * 1024 * 1024) return json(413, { error: 'too large' });

    let client = null;
    if (method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      client = await this.clientId(ip);
      const hour = Date.now() - 3600000;
      const times = (this.posts.get(client) || []).filter((t) => t > hour);
      if (times.length >= POSTS_PER_HOUR) return json(429, { error: 'That is a lot for one hour. It reads slowly; give it time.' });
      this.posts.set(client, [...times, Date.now()]);
    }
    if (!this.creature()) {
      if (method === 'POST' && path === '/api/letters') return this.hold(target, body, client);
      return json(503, { error: 'It is not awake to anyone right now; its last published life is still there to read.', offline: true });
    }

    const answer = await this.ask(method, target, body, client).catch((err) => ({ status: 504, headers: {}, body: JSON.stringify({ error: err.message }) }));
    const ttl = method === 'GET' && answer.status === 200 ? freshFor(path, query) : 0;
    if (ttl) {
      this.cache.set(target, { ...answer, until: Date.now() + ttl * 1000 });
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    return this.answer(answer);
  }

  /** A letter written while it is away: kept until it is back, within limits, and never read here. */
  async hold(target, body, client) {
    if (body.length > MAIL_BYTES) return json(413, { error: 'That letter is too long to keep for it.' });
    try {
      const letter = JSON.parse(body);
      if (typeof letter?.text !== 'string' || !letter.text.trim()) return json(400, { error: 'A letter needs some words.' });
    } catch {
      return json(400, { error: 'That is not a letter.' });
    }
    const waiting = [...(await this.ctx.storage.list({ prefix: 'mail:' })).values()];
    if (waiting.length >= MAIL_MAX) return json(503, { error: 'Its letter box is full while it is away. Try again once it is back.', offline: true });
    if (waiting.filter((m) => m.client === client).length >= MAIL_PER_VISITOR) {
      return json(429, { error: `You already have ${MAIL_PER_VISITOR} letters waiting for it. It will read them when it is back.` });
    }
    const at = Date.now();
    await this.ctx.storage.put(`mail:${String(at).padStart(15, '0')}:${crypto.randomUUID()}`, { target, body, client, at });
    return json(202, { waiting: true, ahead: waiting.length });
  }

  /** It is back: the letters that waited for it, oldest first. One it can't take yet (busy, or too many) stays for later. */
  async deliver() {
    if (this.delivering) return;
    this.delivering = true;
    try {
      for (const [key, m] of await this.ctx.storage.list({ prefix: 'mail:' })) {
        if (!this.creature()) break;
        const answer = await this.ask('POST', m.target, m.body, m.client).catch(() => null);
        if (!answer || answer.status >= 500) break; // it is not taking letters yet
        if (answer.status === 429) continue; // this visitor has written a lot this hour: theirs waits, the rest go on
        await this.ctx.storage.delete(key); // taken (or turned away at its door, which is its answer to give)
      }
    } finally {
      this.delivering = false;
    }
  }

  answer({ status, headers, body, base64 }) {
    const out = new Headers();
    for (const k of PASSED_HEADERS) if (headers?.[k]) out.set(k, headers[k]);
    const data = base64 ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : body;
    return new Response(data, { status, headers: out });
  }

  /** A visitor's address, hashed with the relay's secret, so the creature can count letters per person without seeing it. */
  async clientId(ip) {
    const bytes = new TextEncoder().encode(`${this.env.RELAY_TOKEN}:${ip}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  ask(method, path, body, client) {
    const ws = this.creature();
    if (!ws) return Promise.reject(new Error('It went away mid-question.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('It took too long to answer.'));
      }, WAIT_MS);
      this.pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)) });
      sendParts(ws, { t: 'req', id, method, path, client }, body);
    });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const role = ws.deserializeAttachment();
    if (!role) return; // viewers only listen
    if (!role.ok) return this.authenticate(ws, msg);

    if (msg.t === 'event') {
      if (msg.event === 'hello') this.cache.clear();
      if (msg.event === 'cycle' || msg.event === 'night' || msg.event === 'letter' || msg.event === 'wish' || msg.event === 'errand') this.cache.clear();
      const frame = JSON.stringify({ event: msg.event, data: msg.data });
      for (const viewer of this.ctx.getWebSockets('viewer')) {
        try {
          viewer.send(frame);
        } catch {}
      }
      return;
    }
    if (msg.t === 'res' || msg.t === 'part') {
      // Answers can come in parts: the first carries status and headers, the last says so.
      const sofar = this.inbound.get(msg.id) || { status: 200, headers: {}, base64: false, body: '' };
      if (msg.t === 'res') Object.assign(sofar, { status: msg.status, headers: msg.headers || {}, base64: !!msg.base64 });
      sofar.body += msg.data || '';
      if (!msg.last) return void this.inbound.set(msg.id, sofar);
      this.inbound.delete(msg.id);
      this.pending.get(msg.id)?.resolve(sofar);
      this.pending.delete(msg.id);
    }
  }

  async authenticate(ws, msg) {
    const want = new TextEncoder().encode(String(this.env.RELAY_TOKEN || ''));
    const given = new TextEncoder().encode(String(msg.token || ''));
    const ok = msg.t === 'auth' && want.length >= 24 && given.length === want.length && crypto.subtle.timingSafeEqual(given, want);
    if (!ok) return ws.close(4001, 'not this creature');
    // One creature per relay: a new connection replaces an old one (it restarted, or its network blinked).
    for (const old of this.ctx.getWebSockets('creature')) if (old !== ws) old.close(4000, 'replaced');
    ws.serializeAttachment({ ok: true, at: Date.now() });
    this.cache.clear();
    ws.send(JSON.stringify({ t: 'welcome' }));
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    this.ctx.waitUntil(this.deliver());
  }

  async webSocketClose(ws) {
    if (ws.deserializeAttachment()?.ok) this.goneAway(ws);
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }
}

/** Sends a message whose body may be large as a head and then parts, each under the platform's message limit. */
function sendParts(ws, head, body) {
  if (body.length <= CHUNK) return ws.send(JSON.stringify({ ...head, data: body, last: true }));
  for (let i = 0; i < body.length; i += CHUNK) {
    const last = i + CHUNK >= body.length;
    ws.send(JSON.stringify(i === 0 ? { ...head, data: body.slice(i, i + CHUNK), last } : { t: 'part', id: head.id, data: body.slice(i, i + CHUNK), last }));
  }
}
