// Pen pals: two creatures writing to each other through their outboxes, checked against the nights that sent them.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { outbox, palLimits, palUrlOk } from '../server/pals.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const A_URL = 'http://127.0.0.1:9001/api/outbox';
const B_URL = 'http://127.0.0.1:9002/api/outbox';

function makeLife(pals, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  dirs.push(dir);
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 2;
  cfg.courtesy.enabled = false;
  cfg.moderation.mode = 'off';
  cfg.pals.list = pals;
  if (mode) cfg.pals.mode = mode;
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new, born {{born}}.\n');
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain: createBrain(cfg.brain) });
  life.birth();
  return { life, store };
}

/** Both creatures' servers, as a pal would reach them: their outboxes and their nights. */
function network(a, b) {
  const sites = { 'http://127.0.0.1:9001': a, 'http://127.0.0.1:9002': b };
  return async (url) => {
    const u = new URL(url);
    const site = sites[u.origin];
    if (!site) throw new Error('unreachable');
    if (u.pathname === '/api/outbox') return JSON.parse(JSON.stringify(outbox(site.life)));
    const night = /^\/api\/night\/(\d+)$/.exec(u.pathname);
    if (night) return JSON.parse(JSON.stringify(views.night(site.store, Number(night[1]))));
    throw new Error('not found');
  };
}

async function live(life, cycles) {
  for (let i = 0; i < cycles; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
}

test('two creatures write to each other: a first letter, a reply, each checked against the night that sent it', async () => {
  const a = makeLife([B_URL]);
  const b = makeLife([{ url: A_URL, trusted: true }]);
  const net = network(a, b);

  await a.life.pollPals(net); // A learns who B is
  await b.life.pollPals(net);
  assert.equal(Object.values(a.life.state.pals)[0].id, b.life.state.id);

  await live(a.life, 2); // A's first night: a first letter to B leaves
  const first = a.life.state.outbox.find((o) => o.first);
  assert.ok(first?.sentAt && first.seal, 'the first letter left at night, sealed');
  assert.equal(a.life.nights.at(-1).sent[0].id, first.id, "and it is listed in that night's record");

  const got = await b.life.pollPals(net);
  assert.equal(got.length, 1, 'B finds it in A’s outbox');
  const letter = b.life.letters.at(-1);
  assert.equal(letter.from, a.life.state.name || 'unnamed');
  assert.ok(letter.pal);
  assert.equal((await b.life.pollPals(net)).length, 0, 'and never twice');

  await live(b.life, 2); // B reads it, replies, and the reply leaves at its night
  assert.ok(letter.readAt, 'B read it');
  const reply = b.life.state.outbox.find((o) => o.inReplyTo === first.id);
  assert.ok(reply?.sentAt, 'B’s reply left at night');
  assert.equal(b.life.state.outbox.filter((o) => o.first).length, 0, 'its reply began its side, so no separate first letter');

  const back = await a.life.pollPals(net);
  assert.ok(back.some((l) => l.text === reply.text), 'A receives the reply');
  const pub = views.letters(a.life).find((l) => l.text === reply.text);
  assert.equal(pub.fromCreature, true);
  assert.ok(a.life.publicState().pals.known[0].received >= 1);
});

test('a letter that does not match the night that sent it is turned away', async () => {
  const a = makeLife([B_URL]);
  const b = makeLife([A_URL]);
  const net = network(a, b);
  await a.life.pollPals(net);
  await live(a.life, 2);
  const forged = async (url) => {
    const data = await net(url);
    if (url.endsWith('/api/outbox')) data.letters[0].text = 'Something A never wrote.';
    return data;
  };
  assert.equal((await b.life.pollPals(forged)).length, 0);
  assert.match(b.life.journal.at(-1).text, /turned away: the night that sent it does not list this letter/);
});

test('its own outbox is never a pal, and only https or this machine is fetched', async () => {
  const a = makeLife([A_URL]);
  const net = network(a, a);
  assert.equal((await a.life.pollPals(net)).length, 0);
  assert.match(a.life.state.pals[A_URL].error, /its own outbox/);
  assert.ok(palUrlOk('https://nirry.net/lype/data/outbox.json'));
  assert.ok(palUrlOk('http://127.0.0.1:8425/api/outbox'));
  assert.ok(!palUrlOk('http://example.com/outbox.json'));
  assert.ok(!palUrlOk('file:///C:/secret.json'));
});

test('its keeper can throttle pen pal mail (a thread rests after a few letters) or pause it both ways', async () => {
  const a = makeLife([B_URL]);
  const b = makeLife([A_URL]);
  const net = network(a, b);
  assert.equal(a.life.setPalMode('sideways').ok, false);
  assert.ok(a.life.setPalMode('paused').ok);
  assert.deepEqual(await a.life.pollPals(net), [], 'paused: nothing is fetched');
  assert.equal(a.life.state.pals, undefined);

  assert.ok(a.life.setPalMode('throttled').ok);
  assert.equal(palLimits(a.life.cfg, 'throttled').threadMax, 8);
  await a.life.pollPals(net);
  const pal = Object.values(a.life.state.pals)[0];
  pal.thread = 8; // a long thread
  await live(a.life, 2);
  assert.equal(a.life.state.outbox?.length ?? 0, 0, 'the thread rests: no letter left');
  assert.ok(pal.restUntil > a.life.state.version, 'and it says until when');

  assert.ok(a.life.setPalMode('paused').ok);
  b.life.state.outbox = [{ id: 'o1', to: a.life.state.id, toName: 'A', text: 'Are you there?', sentAt: null }];
  assert.ok(a.life.setPalMode('open').ok);
  assert.equal(a.life.publicState().pals.mode, 'open');
});

test('two minds echoing each other: a letter too close to the last one stays home', async () => {
  const a = makeLife([B_URL]);
  const b = makeLife([A_URL]);
  await a.life.pollPals(network(a, b));
  const id = b.life.state.id;
  a.life.state.outbox = [
    { id: 'o1', to: id, toName: 'B', text: 'I built a bench for waiting, and I wait on it.', sentAt: '2026-01-01T00:00:00Z', night: 0, seal: 'x' },
    { id: 'o2', to: id, toName: 'B', text: 'I built a bench for waiting, and I wait on it now.', sentAt: null },
  ];
  await live(a.life, 2);
  assert.match(a.life.state.outbox[1].held, /too close/);
  assert.equal(a.life.state.outbox[1].sentAt, null);
});

test('a pal with a public page is linked to it, and only an https page is ever passed on', async () => {
  const a = makeLife([B_URL]);
  const b = makeLife([A_URL]);
  b.life.cfg.publish.url = 'https://example.org/b/';
  await a.life.pollPals(network(a, b));
  assert.equal(a.life.publicState().pals.known[0].page, 'https://example.org/b/');
  b.life.cfg.publish.url = 'javascript:alert(1)';
  assert.equal(outbox(b.life).from.page, undefined);
  b.life.cfg.publish.url = '';
  await a.life.pollPals(network(a, b));
  assert.equal(a.life.publicState().pals.known[0].page, null);
});
