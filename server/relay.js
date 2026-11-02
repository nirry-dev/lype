// Dials out to a relay (relay/) and keeps one WebSocket open, so a static site can follow it live and visitors can
// write to it without anyone reaching this machine. Nothing listens here for the relay: it only answers on the socket
// it opened, and only the public routes. Its own server does the answering, so every rule (screening, limits) holds.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expandHome } from './config.js';

// The same public list the relay keeps; checked again here so a mistaken or hostile relay can't ask for more.
const PUBLIC_GET = [
  /^\/api\/(state|journey|works|life|atlas|world|errands|chain|outbox|thread|neighbor)$/,
  /^\/api\/cycle\/(\d{1,7}|latest)$/,
  /^\/api\/night\/\d{1,5}$/,
  /^\/api\/(letters|you)(\?visitor=[\w-]{1,64})?$/,
  /^\/works\/\d{6}\.svg$/,
  /^\/returns\/L\d{1,7}\.jpg$/,
];
const PUBLIC_POST = [/^\/api\/letters$/, /^\/api\/errands\/e\d{1,6}\/returns$/];
const CHUNK = 256 * 1024;
const TEXT = /^(application\/json|text\/|image\/svg)/;

/** Whether a request passed on by a relay is one of the public ones. */
export function relayMayAsk(method, path) {
  const list = method === 'GET' ? PUBLIC_GET : method === 'POST' ? PUBLIC_POST : [];
  return list.some((re) => re.test(path));
}

/** A secret its own server checks, so only this connection can say which visitor a request came from. */
export const RELAY_KEY = randomBytes(18).toString('base64url');

export function relayToken(cfg) {
  if (process.env.LYPE_RELAY_TOKEN) return process.env.LYPE_RELAY_TOKEN.trim();
  try {
    return readFileSync(expandHome(cfg.relay.tokenFile), 'utf8').trim();
  } catch {
    return '';
  }
}

export function connectRelay(cfg, { local, log = console.log }) {
  const url = `${cfg.relay.url.replace(/\/$/, '').replace(/^http/, 'ws')}/creature`;
  const token = relayToken(cfg);
  if (!token) {
    log(`  relay:  no token (${cfg.relay.tokenFile}); not connecting`);
    return { send() {}, close() {} };
  }
  let ws = null;
  let ready = false;
  let closed = false;
  let delay = 2000;
  let ping = null;
  let stream = null; // stream deltas waiting to go out together
  const requests = new Map(); // id -> head + body parts so far

  const sendRaw = (msg) => {
    if (ready && ws?.readyState === 1) ws.send(JSON.stringify(msg));
  };

  let heard = 0; // when the relay last said anything; a silent socket is treated as gone

  function open() {
    const socket = new WebSocket(url);
    ws = socket;
    heard = Date.now();
    // A connection that never opens (the relay was starting, a network that swallows it) is given up and retried.
    const giveUp = setTimeout(() => socket.readyState !== 1 && drop(socket), 15000);
    socket.addEventListener('open', () => {
      clearTimeout(giveUp);
      socket.send(JSON.stringify({ t: 'auth', token }));
    });
    socket.addEventListener('message', (e) => {
      heard = Date.now();
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        ready = true;
        delay = 2000;
        log(`relay: connected to ${cfg.relay.url}`);
        return void answer({ id: 0, method: 'GET', path: '/api/state' }, '', (state) => sendRaw({ t: 'event', event: 'hello', data: JSON.parse(state.body) }));
      }
      if (msg.t === 'req' || msg.t === 'part') {
        const req = requests.get(msg.id) || { ...msg, body: '' };
        req.body += msg.data || '';
        if (!msg.last) return void requests.set(msg.id, req);
        requests.delete(msg.id);
        answer(req, req.body, (res) => reply(msg.id, res));
      }
    });
    socket.addEventListener('close', (e) => {
      clearTimeout(giveUp);
      if (e.code === 4001) log('relay: it did not accept the token; check relay.tokenFile');
      drop(socket);
    });
    socket.addEventListener('error', () => drop(socket));
    clearInterval(ping);
    ping = setInterval(() => {
      if (ws !== socket) return;
      if (Date.now() - heard > 75000) return drop(socket); // two pings unanswered
      if (socket.readyState === 1) socket.send('ping');
    }, 30000);
  }

  /** Lets go of a socket that closed, failed or went quiet, and tries again a little later (once per socket). */
  function drop(socket) {
    if (socket.dropped) return;
    socket.dropped = true;
    try {
      socket.close();
    } catch {}
    if (ws !== socket) return;
    ready = false;
    clearInterval(ping);
    if (closed) return;
    setTimeout(open, delay);
    delay = Math.min(delay * 2, 60000);
  }

  async function answer(req, body, done) {
    if (!relayMayAsk(req.method, req.path)) return done({ status: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"not found"}' });
    try {
      const res = await fetch(`${local}${req.path}`, {
        method: req.method,
        headers: { 'content-type': 'application/json', 'x-relay-key': RELAY_KEY, ...(req.client ? { 'x-relay-client': String(req.client).slice(0, 64) } : {}) },
        body: req.method === 'POST' ? body : undefined,
      });
      const type = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      const headers = {};
      for (const k of ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options']) if (res.headers.get(k)) headers[k] = res.headers.get(k);
      done(TEXT.test(type) ? { status: res.status, headers, body: buf.toString('utf8') } : { status: res.status, headers, body: buf.toString('base64'), base64: true });
    } catch (err) {
      done({ status: 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: `It couldn't answer: ${err.message}` }) });
    }
  }

  function reply(id, { status, headers, body, base64 }) {
    const head = { t: 'res', id, status, headers, base64: !!base64 };
    if (body.length <= CHUNK) return sendRaw({ ...head, data: body, last: true });
    for (let i = 0; i < body.length; i += CHUNK) {
      const last = i + CHUNK >= body.length;
      sendRaw(i === 0 ? { ...head, data: body.slice(i, i + CHUNK), last } : { t: 'part', id, data: body.slice(i, i + CHUNK), last });
    }
  }

  /**
   * Its public events, as its own page gets them; streamed words go out a few times a second rather than one by one
   * (what it thinks aloud at full power, which can go on for hours, twice a second).
   */
  function send(event, data) {
    if (!ready) return;
    if (event === 'stream') {
      if (stream && stream.kind === data.kind) stream.delta += data.delta;
      else {
        flush();
        stream = { ...data };
        setTimeout(flush, data.kind === 'muse' ? 500 : 150);
      }
      return;
    }
    flush();
    sendRaw({ t: 'event', event, data });
  }
  function flush() {
    if (!stream) return;
    const s = stream;
    stream = null;
    sendRaw({ t: 'event', event: 'stream', data: s });
  }

  open();
  return {
    send,
    close() {
      closed = true;
      clearInterval(ping);
      ws?.close();
    },
  };
}
