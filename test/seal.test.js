// Its sealed record: sealed as it happens, checkable from what is published, and broken by any edit.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';
import { GENESIS, canonical, verifyChain } from '../web/lib/seal.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeLife() {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  dirs.push(dir);
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 3;
  cfg.courtesy.enabled = false;
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new, born {{born}}.\n');
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain: createBrain(cfg.brain) });
  life.birth();
  return { life, store, dir };
}
const published = (store) => (e) => (e.kind === 'cycle' ? views.cycle(store, e.n) : views.night(store, e.n));

test('every cycle and night is sealed as it happens, and checks out from what is published', async () => {
  const { life, store } = makeLife();
  for (let i = 0; i < 4; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const chain = views.chain(life);
  assert.deepEqual(chain.map((e) => `${e.kind}${e.n}`), ['cycle1', 'cycle2', 'cycle3', 'night1', 'cycle4']);
  assert.equal(chain[0].prev, GENESIS);
  assert.ok(chain.every((e) => !e.late));
  const r = await verifyChain(chain, published(store));
  assert.ok(r.ok, JSON.stringify(r.problem));
  assert.equal(r.checked, 5);
});

test('changing anything it did breaks the seal', async () => {
  const { life, store, dir } = makeLife();
  for (let i = 0; i < 2; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const file = join(dir, 'cycles', '000001.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.diary = `${record.diary} (edited)`;
  writeFileSync(file, JSON.stringify(record));
  const r = await verifyChain(views.chain(life), published(store));
  assert.equal(r.ok, false);
  assert.equal(r.problem.at.n, 1);
  assert.match(r.problem.why, /no longer matches/);

  const cut = views.chain(life).filter((e) => e.n !== 1 || e.kind !== 'cycle');
  assert.match((await verifyChain(cut, published(store))).problem.why, /does not link/, 'and so does removing it');
});

test('a held reply is sealed as a salted fingerprint that its keeper can later show matches', async () => {
  const { life, store } = makeLife();
  assert.ok((await life.wake('test')).ok);
  // A record with a reply held for the keeper, sealed the way a cycle is.
  const record = { ...store.read('cycles/000001.json'), n: 9, replies: [{ letter: 'L1', text: 'a held reply', withheld: true }] };
  delete record.seal;
  life.seal('cycle', 9, record);
  clearTimeout(life.timer);
  const pub = views.cycle({ read: () => record }, 9);
  assert.equal(pub.replies.length, 0, 'the held reply is not shown');
  assert.equal(pub.seal.salts, undefined, 'nor is its salt');
  assert.equal(pub.seal.withheld.length, 1);
  const { createHash } = await import('node:crypto');
  const shown = createHash('sha256').update(record.seal.salts[0] + canonical(record.replies[0])).digest('hex');
  assert.equal(shown, pub.seal.withheld[0]);
});

test('a life lived before sealing is sealed once, in order, and marked late', async () => {
  const { life, store, dir } = makeLife();
  for (let i = 0; i < 4; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  // Forget the seals, as a life from before sealing would be.
  rmSync(join(dir, 'chain.json'));
  for (const f of store.list('cycles')) store.write(`cycles/${f}`, { ...store.read(`cycles/${f}`), seal: undefined });
  for (const f of store.list('nights')) store.write(`nights/${f}`, { ...store.read(`nights/${f}`), seal: undefined });
  const again = new Life({ config: life.cfg, store, brain: life.brain });
  again.welcome();
  const chain = views.chain(again);
  assert.deepEqual(chain.map((e) => `${e.kind}${e.n}`), ['cycle1', 'cycle2', 'cycle3', 'night1', 'cycle4']);
  assert.ok(chain.every((e) => e.late));
  assert.ok((await verifyChain(chain, published(store))).ok);
  again.welcome();
  assert.equal(views.chain(again).length, 5, 'and only once');
});
