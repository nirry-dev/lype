// A pen pal on the same graphics card: who has the card, their letters as one thread, and a person's words passed on.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { outbox, readOutbox } from '../server/pals.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-mate-'));
after(() => rmSync(root, { recursive: true, force: true }));
const URL_ = 'http://127.0.0.1:9/api/outbox';

function makeLife() {
  const config = loadConfig(['--config', 'none.json', '--mock', '--data', root]);
  config.courtesy.enabled = false;
  config.pals.list = [{ url: URL_, trusted: true, card: 'pal-model' }];
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  config.seedFile = seed;
  const life = new Life({ config, store: createStore(root), brain: createBrain(config.brain) });
  life.birth();
  life.state.pals = { [URL_]: { url: URL_, id: 'p1', name: 'Orea', received: 1, sent: 1, page: 'https://example.org/orea/', open: false } };
  return life;
}

test('who has the card: it, the pal it shares the card with (by name), nobody, or someone else', async () => {
  const life = makeLife();
  const at = (ownState, others) => (life.brain.presence = async () => ({ reachable: true, known: true, ownState, others }));
  at('loaded', []);
  assert.deepEqual(await life.readCard(), { who: 'self' });
  at('unloaded', ['pal-model']);
  assert.deepEqual(await life.readCard(), { who: 'pal', name: 'Orea' });
  assert.deepEqual(life.status().card, { who: 'pal', name: 'Orea' });
  at('unloaded', []);
  assert.deepEqual(await life.readCard(), { who: 'empty' });
  at('unloaded', ['a-strangers-model']);
  assert.deepEqual(await life.readCard(), { who: 'other' });
  const known = life.publicState().pals.known[0];
  assert.equal(known.card, true);
  assert.equal(known.open, false);
});

test('their letters as one thread, oldest first, with what each reader did next; a person’s words passed on are marked', async () => {
  const life = makeLife();
  life.addLetter({ from: 'Mara', text: 'Mara here: the gutters sang like gravel all night long.', person: 'v1' });
  assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const t0 = Date.now();
  life.letters.push({ id: 'L50', from: 'Orea', text: 'My box leans.', at: new Date(t0 + 1000).toISOString(), person: 'pal:p1', pal: { id: 'p1', letter: 'o7' }, screen: { status: 'allowed' } });
  life.state.outbox = [
    { id: 'o1', to: 'p1', toName: 'Orea', text: 'Someone called Mara told me the gutters sang like gravel.', cycle: 1, sentAt: new Date(t0).toISOString(), night: 1, first: true },
    { id: 'o2', to: 'p1', toName: 'Orea', text: 'Not sent yet.', cycle: 1 },
  ];
  const [t] = views.thread(life);
  assert.equal(t.name, 'Orea');
  assert.equal(t.card, true);
  assert.deepEqual(t.items.map((i) => [i.dir, i.id]), [['out', 'o1'], ['in', 'L50']]);
  assert.equal(t.items[0].wrote.cycle, 1);
  assert.equal(t.items[1].read, null, 'not opened yet');
  const mara = views.letters(life).find((l) => l.from === 'Mara');
  assert.deepEqual(mara.passedOn, [{ to: 'Orea', night: 1 }]);
  assert.equal(outbox(life).from.openToPeople, false, 'nobody can write to it but its pals');
  assert.equal(readOutbox(outbox(life)).from.openToPeople, false, 'and its pals hear so');
});
