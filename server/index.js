// HTTP server: the web pages, a JSON API, a live event stream, and the letter box.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { createBrain } from './brain.js';
import { cleanJpeg } from './errands.js';
import { exportLife } from './export.js';
import { ROOT, loadConfig } from './config.js';
import { Life, letterStatus } from './life.js';
import * as pals from './pals.js';
import { publish } from './publish.js';
import { RELAY_KEY, connectRelay } from './relay.js';
import { readSenses } from './senses.js';
import { createStore, pad } from './store.js';
import * as views from './views.js';

const cfg = loadConfig();
const store = createStore(cfg.dataDir);
const brain = createBrain(cfg.brain);
const life = new Life({ config: cfg, store, brain });

const adminToken = store.read('admin.json', null)?.token ?? randomBytes(18).toString('base64url');
if (!store.exists('admin.json')) store.write('admin.json', { token: adminToken });

const WEB = join(ROOT, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const PAGE_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// ---------- helpers ----------

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 16 * 1024) {
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('too large'), { status: 413 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('bad JSON'), { status: 400 });
  }
}

const visitorId = (key) => (typeof key === 'string' && /^[\w-]{16,64}$/.test(key) ? createHash('sha256').update(`iterant:${key}`).digest('hex').slice(0, 24) : null);
const tidy = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const want = Buffer.from(adminToken);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A request its relay passed on: counted by the visitor's hashed address the relay gives, not by this machine's. */
function fromRelay(req) {
  const given = Buffer.from(String(req.headers['x-relay-key'] || ''));
  const want = Buffer.from(RELAY_KEY);
  const client = String(req.headers['x-relay-client'] || '');
  return given.length === want.length && timingSafeEqual(given, want) && /^[0-9a-f]{8,64}$/.test(client) ? `relay:${client}` : null;
}

const recentLetters = new Map(); // ip or visitor -> timestamps
function rateLimited(keys) {
  const hour = Date.now() - 3600000;
  for (const key of keys) {
    const times = (recentLetters.get(key) || []).filter((t) => t > hour);
    recentLetters.set(key, times);
    if (times.length >= cfg.letters.perHour) return true;
  }
  for (const key of keys) recentLetters.get(key).push(Date.now());
  return false;
}

// ---------- live stream ----------

const clients = new Set();
let relay = null; // the outbound connection to a relay, when there is one
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
  relay?.send(event, data);
}
for (const event of ['status', 'stream', 'cycle', 'night', 'letter', 'letter-queued', 'journal', 'milestone', 'world', 'wish', 'errand', 'death']) life.on(event, (data) => broadcast(event, data));
// Each night's latest seal goes into the commit too, so public git history pins its record as it was.
life.on('night', (n) =>
  publish(
    cfg,
    n.will
      ? `${life.state.name || 'It'} died after ${n.n} nights: nobody wrote to it for ${n.mortality.quiet} nights. Its child was born.\n\nLast seal: ${life.chain.at(-1)?.hash || 'none'}`
      : `${life.state.name || 'It'} became version ${n.n}: ${n.release?.title || 'a night'}\n\nLatest seal: ${life.chain.at(-1)?.hash || 'none'}`,
  ),
);

// The lives that ended here, each a read-only page at /ancestors/<k>/ (the same static copy a published site gets).
function ancestorPage(a) {
  try {
    exportLife({ ...cfg, dataDir: join(cfg.dataDir, a.dir) }, store.path(`${a.dir}/page`));
  } catch (err) {
    console.error(`the page of ${a.name || 'an ancestor'} could not be made: ${err.message}`);
  }
}
life.on('death', ancestorPage);

async function serveAncestor(res, path) {
  const m = /^\/ancestors\/(\d+)\/(.*)$/.exec(path);
  const a = m && life.lineage.find((x) => String(x.k) === m[1]);
  if (!a) return json(res, 404, { error: 'not found' });
  const root = store.path(`${a.dir}/page`);
  const file = join(root, normalize(decodeURIComponent(m[2] || 'index.html')).replace(/^([/\\])+/, ''));
  if (!file.startsWith(root + sep)) return json(res, 403, { error: 'no' });
  try {
    const body = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      ...(type.startsWith('text/html') ? { 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer' } : {}),
      ...(type.startsWith('image/svg') ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}
setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n');
}, 25000).unref();
setInterval(async () => {
  if ((!clients.size && !relay) || life.busy) return;
  life.lastSenses = await readSenses(new Date(), { sample: false });
  broadcast('senses', life.lastSenses);
}, 20000).unref();

// ---------- routes ----------

async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/stream' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify(life.publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (path === '/api/state' && method === 'GET') return json(res, 200, life.publicState());
  if (path === '/api/journey' && method === 'GET') return json(res, 200, life.journey());

  let m = /^\/api\/cycle\/(\d+|latest)$/.exec(path);
  if (m && method === 'GET') {
    const record = views.cycle(store, m[1] === 'latest' ? life.state.cycle : Number(m[1]));
    return record ? json(res, 200, record) : json(res, 404, { error: 'no such cycle' });
  }
  m = /^\/api\/night\/(\d+)$/.exec(path);
  if (m && method === 'GET') {
    const record = views.night(store, Number(m[1]));
    return record ? json(res, 200, record) : json(res, 404, { error: 'no such night' });
  }
  if (path === '/api/chain' && method === 'GET') return json(res, 200, views.chain(life));
  if (path === '/api/outbox' && method === 'GET') return json(res, 200, pals.outbox(life));

  if (path === '/api/works' && method === 'GET') return json(res, 200, views.works(life, store));
  if (path === '/api/life' && method === 'GET') return json(res, 200, views.replay(life, store));
  if (path === '/api/atlas' && method === 'GET') return json(res, 200, views.atlas(life, store));
  if (path === '/api/world' && method === 'GET') return json(res, 200, views.world(life));

  if (path === '/api/letters' && method === 'GET') {
    return json(res, 200, views.letters(life, visitorId(url.searchParams.get('visitor'))));
  }
  if (path === '/api/letters' && method === 'POST') {
    const body = await readBody(req);
    const text = tidy(body.text, cfg.letters.maxLength);
    const from = tidy(body.from, 40).replace(/\n/g, ' ') || 'someone';
    const vid = visitorId(body.visitor);
    if (!text) return json(res, 400, { error: 'A letter needs some words.' });
    const ip = fromRelay(req) || req.socket.remoteAddress || 'unknown';
    if (rateLimited([`ip:${ip}`, ...(vid ? [`v:${vid}`] : [])])) return json(res, 429, { error: 'That is a lot of letters for one hour. It reads slowly; give it time.' });
    const letter = life.addLetter({ from, text, person: vid || `name:${from.toLowerCase()}`, question: typeof body.question === 'string' ? body.question : null });
    return json(res, 201, letter);
  }
  if (path === '/api/errands' && method === 'GET') return json(res, 200, views.errands(life));
  const brought = /^\/api\/errands\/(e\d+)\/returns$/.exec(path);
  if (brought && method === 'POST') {
    if (!cfg.errands.enabled) return json(res, 403, { error: 'It is not sending anyone on errands.' });
    const maxBytes = cfg.errands.maxPhotoMb * 1024 * 1024;
    const body = await readBody(req, Math.ceil(maxBytes * 1.4) + 8192); // base64 is a third larger
    const raw = Buffer.from(String(body.photo || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    if (!raw.length) return json(res, 400, { error: 'An errand is answered with a photo.' });
    if (raw.length > maxBytes) return json(res, 413, { error: `That photo is larger than ${cfg.errands.maxPhotoMb} MB.` });
    const photo = cleanJpeg(raw).data;
    const from = tidy(body.from, 40).replace(/\n/g, ' ') || 'someone';
    const vid = visitorId(body.visitor);
    const ip = fromRelay(req) || req.socket.remoteAddress || 'unknown';
    if (rateLimited([`ip:${ip}`, ...(vid ? [`v:${vid}`] : [])])) return json(res, 429, { error: 'That is a lot for one hour. It reads slowly; give it time.' });
    const result = life.addReturn({ errand: brought[1], from, text: tidy(body.note, 400), person: vid || `name:${from.toLowerCase()}`, photo });
    return result.ok ? json(res, 201, result.letter) : json(res, 409, { error: result.reason });
  }
  if (path === '/api/you' && method === 'GET') {
    const me = visitorId(url.searchParams.get('visitor'));
    return me ? json(res, 200, life.you(me)) : json(res, 400, { error: 'no visitor key' });
  }

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return json(res, 403, { error: 'not allowed' });
    const action = path.slice('/api/admin/'.length);
    if (action === 'check' && method === 'GET') return json(res, 200, { ok: true });
    if (action === 'letters' && method === 'GET') return json(res, 200, life.keeperQueue());
    if (action === 'errands' && method === 'GET') return json(res, 200, life.keeperErrands());
    if (method !== 'POST') return json(res, 405, { error: 'POST only' });
    const decision = /^letters\/(L\d+)$/.exec(action);
    if (decision) {
      const result = life.decide(decision[1], String((await readBody(req)).action || ''));
      return json(res, result.ok ? 200 : 409, result.ok ? result : { error: result.reason });
    }
    const errand = /^errands\/(e\d+)$/.exec(action);
    if (errand) {
      const result = life.decideErrand(errand[1], String((await readBody(req)).action || ''));
      return json(res, result.ok ? 200 : 409, result.ok ? result : { error: result.reason });
    }
    const wish = /^wishes\/(w\d+)$/.exec(action);
    if (wish) {
      const body = await readBody(req);
      const result = life.answer(wish[1], String(body.status || ''), tidy(body.text, 600));
      return json(res, result.ok ? 200 : 409, result.ok ? result : { error: result.reason });
    }
    if (action === 'wake') {
      if (life.busy) return json(res, 409, { error: 'It is already awake.' });
      life.wake('visitor', { force: true }); // runs in the background; viewers follow it on the stream
      return json(res, 202, { ok: true });
    }
    if (action === 'sleep') {
      if (life.busy) return json(res, 409, { error: 'It is awake right now.' });
      if (life.state.cycle === life.state.lastNightCycle) return json(res, 409, { error: 'Nothing has happened since it last slept.' });
      life.sleepNow();
      return json(res, 202, { ok: true });
    }
    if (action === 'pals') {
      // Pen pal mail: open, throttled (strict limits) or paused (none either way); takes effect at once.
      const result = life.setPalMode(String((await readBody(req)).mode || ''));
      return json(res, result.ok ? 200 : 400, result.ok ? result : { error: result.reason });
    }
    if (action === 'pause') return life.pause(), json(res, 200, life.status());
    if (action === 'resume') return life.resume(), json(res, 200, life.status());
    return json(res, 404, { error: 'unknown action' });
  }
  return json(res, 404, { error: 'not found' });
}

/** Something made from its words, once it is made. */
async function serveMade(res, path) {
  const m = /^\/made\/([0-9a-f]{12})\.bin$/.exec(path);
  if (!m || life.maker.read(m[1])?.status !== 'made') return json(res, 404, { error: 'not found' });
  try {
    const bin = await readFile(store.path(`made/${m[1]}.bin`));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400' });
    res.end(bin);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

async function serveWork(res, path) {
  const m = /^\/works\/(\d{6})\.svg$/.exec(path);
  if (!m) return json(res, 404, { error: 'not found' });
  try {
    const svg = await readFile(store.path(`works/${m[1]}.svg`));
    res.writeHead(200, {
      'content-type': 'image/svg+xml',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=86400',
    });
    res.end(svg);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

/** A photo someone brought back: public once its keeper allowed it; before that, only to its keeper. */
async function servePhoto(res, url) {
  const m = /^\/returns\/(L\d+)\.jpg$/.exec(url.pathname);
  const letter = m && life.letters.find((l) => l.id === m[1] && l.errand?.photo);
  const key = Buffer.from(url.searchParams.get('key') || '');
  const keeper = key.length === adminToken.length && timingSafeEqual(key, Buffer.from(adminToken));
  if (!letter || (letterStatus(letter) !== 'allowed' && !keeper)) return json(res, 404, { error: 'not found' });
  try {
    const body = await readFile(store.path(letter.errand.photo));
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
      'cache-control': keeper ? 'no-store' : 'public, max-age=86400',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

async function serveStatic(res, path) {
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^([/\\])+/, '');
  const file = join(WEB, rel);
  if (!file.startsWith(WEB + sep)) return json(res, 403, { error: 'no' });
  try {
    const body = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      ...(type.startsWith('text/html') ? { 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer' } : {}),
    });
    res.end(body);
  } catch {
    // Unknown paths fall back to the app shell so #routes and reloads always work.
    if (!extname(file)) return serveStatic(res, '/');
    json(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/works/')) return await serveWork(res, url.pathname);
    if (url.pathname.startsWith('/made/')) return await serveMade(res, url.pathname);
    if (url.pathname.startsWith('/returns/')) return await servePhoto(res, url);
    if (url.pathname.startsWith('/ancestors/')) return await serveAncestor(res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    return await serveStatic(res, url.pathname);
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'something went wrong' });
    if (!err.status) console.error(err);
  }
});

server.listen(cfg.port, cfg.host, () => {
  life.start();
  for (const a of life.lineage) ancestorPage(a); // made afresh, so they follow the viewer as it changes
  const base = `http://${cfg.host}:${cfg.port}`;
  console.log(`${life.state.name || 'An unnamed creature'} is alive at ${base}`);
  console.log(`  mind:   ${brain.label} (${brain.kind}${cfg.brain.backend === 'openai' ? ` via ${cfg.brain.baseUrl}` : ''})`);
  console.log(`  rhythm: wakes every ~${cfg.rhythm.cycleMinutes} min, sleeps every ${cfg.rhythm.nightEvery} cycles`);
  console.log(`  data:   ${cfg.dataDir}`);
  if (cfg.publish.dir) console.log(`  publish: after each night to ${cfg.publish.dir}${cfg.publish.git ? ' (commit and push)' : ''}`);
  console.log(`  admin:  ${base}/?admin=${adminToken}  (wake it, put it to sleep, pause it)`);
  if (cfg.pals.list.length) {
    // Its pals' outboxes are fetched now and then (never in the middle of a thought); what it writes leaves at night.
    console.log(`  pals:   ${cfg.pals.list.length} (pen pal mail ${life.palMode()})`);
    const poll = () => (life.busy ? setTimeout(poll, 120000) : life.pollPals().catch((err) => console.error(`pen pals: ${err.message}`)));
    setTimeout(poll, 30000);
    setInterval(poll, cfg.pals.pollMinutes * 60000).unref();
  }
  if (cfg.relay.connect) {
    console.log(`  relay:  ${cfg.relay.url} (outbound only)`);
    relay = connectRelay(cfg, { local: base });
  }
  if (process.argv.includes('--open')) openPage(base);
});

// Opens the page in the default browser once the server is listening (start.cmd uses this).
function openPage(url) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function shutdown() {
  life.stop();
  relay?.close();
  for (const res of clients) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
