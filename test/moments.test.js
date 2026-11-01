// Moments between cycles: where it goes in its place, what it says, when it may ask its model, and how it is told.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import * as mind from '../server/mind.js';
import { createStore } from '../server/store.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-moments-'));
after(() => rmSync(root, { recursive: true, force: true }));
let k = 0;

function makeLife({ courtesy = false } = {}) {
  const dir = join(root, String(k++));
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.courtesy.enabled = courtesy;
  cfg.courtesy.maxGpuBusy = 101; // what the real card is doing while the tests run is not theirs to wait on
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  cfg.seedFile = seed;
  const brain = createBrain(cfg.brain);
  const asked = [];
  const complete = brain.complete;
  brain.complete = (req) => (asked.push(req), complete(req));
  const life = new Life({ config: cfg, store: createStore(dir), brain });
  life.birth();
  life.welcome();
  return { life, asked };
}

const things = (life, ...names) => {
  for (const [i, name] of names.entries()) life.state.world.things.push({ id: `T${i + 1}`, name, kind: 'object', plaque: '', x: i + 1, y: 0, built: 1, condition: 1, from: [], people: [] });
};

test('it is born with moments, and goes about its place between cycles, the same for everyone who watches', async () => {
  const { life, asked } = makeLife();
  assert.ok(life.state.abilities.includes('moments'));
  assert.match(mind.systemPrompt(life.state, life.cfg), /Between cycles you are not gone/);
  things(life, 'The Soft Arch', 'A Bench for Waiting');

  const first = await life.moments.one();
  assert.ok(first, 'a moment');
  assert.equal(asked.at(-1).kind, 'moment');
  assert.deepEqual(asked.at(-1).schema.properties.go.enum, ['The Soft Arch', 'A Bench for Waiting', 'your card', 'stay']);
  assert.ok(['T1', 'T2', 'card'].includes(first.at));
  assert.ok(mind.DOINGS.includes(first.doing));
  assert.deepEqual(life.status().about, first); // viewers are told where it is
  for (let i = 0; i < 3; i++) await life.moments.one();
  assert.equal(life.state.about.n, 4);
  assert.equal(life.state.moments.length, 4);
  assert.equal(life.state.stats.moments, 4);
  assert.ok(life.state.milestones.some((m) => m.kind === 'first-moment'));
});

test('its next cycle is told what it did in its moments, keeps them, and leaves its body where the cycle did', async () => {
  const { life, asked } = makeLife();
  things(life, 'The Soft Arch');
  for (let i = 0; i < 2; i++) await life.moments.one();
  const r = await life.wake('test');
  clearTimeout(life.timer);
  assert.ok(r.ok, r.reason);
  const think = asked.find((a) => a.kind === 'think');
  assert.match(think.user, /Since your last cycle you had 2 moments in your place/);
  const record = life.store.read('cycles/000001.json');
  assert.equal(record.moments.length, 2);
  assert.deepEqual(life.state.moments, []);
  assert.equal(life.state.about.n, 3);
  assert.ok(['card', life.state.world.at].includes(life.state.about.at));
});

test('no moment while it is awake, nor when its model is not already on the card; then its body drifts on by itself', async () => {
  const { life, asked } = makeLife({ courtesy: true });
  things(life, 'The Soft Arch', 'A Bench for Waiting');
  life.busy = true;
  assert.equal(await life.moments.one(), null);
  life.busy = false;

  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'unloaded', others: ['someone-elses-model'] });
  const drifted = await life.moments.one();
  assert.equal(asked.length, 0, 'it never loads its model for a moment');
  assert.ok(drifted.drift);
  assert.equal(drifted.say, '');
  assert.equal(await life.moments.one(), null, 'it stays a while before drifting again');
  assert.equal(life.state.stats.moments ?? 0, 0);

  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'loaded', others: [] });
  assert.ok(await life.moments.one());
  assert.equal(asked.at(-1).kind, 'moment');
  assert.match(asked.at(-1).user, /This is your first moment since your last cycle/, 'a drift is not told to it as something it did');
});

test('its answer is read as one of the places it was offered', () => {
  const places = mind.momentPlaces({ things: [{ name: 'The Soft Arch' }, { name: 'The Soft Arch' }, { name: 'Bench' }] });
  assert.deepEqual(places, ['The Soft Arch', 'Bench', 'your card', 'stay']);
  assert.deepEqual(mind.readMoment('{"go":"your card","do":"sit","say":"Quiet here!"}', places), { go: 'card', doing: 'sit', say: 'Quiet here.' });
  assert.deepEqual(mind.readMoment('{"go":"The Moon","do":"dance","say":"..."}', places), { go: 'stay', doing: 'look', say: '' });
  assert.deepEqual(mind.readMoment('not json', places), { go: 'stay', doing: 'look', say: '' });
});

test('on a card that holds one model, it takes the card back from its household only after a turn, never from anyone else', async () => {
  const { life, asked } = makeLife({ courtesy: true });
  things(life, 'The Soft Arch');
  life.cfg.courtesy.household = ['siblings-model'];
  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'unloaded', others: ['siblings-model'] });
  await life.moments.one();
  assert.equal(asked.length, 0, 'its sibling has only just had the card');
  life.moments.heldSince = Date.now() - 7 * 60000;
  assert.ok(await life.moments.one());
  assert.equal(asked.at(-1).kind, 'moment', 'its turn: it asks its own model, which takes the card');
  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'unloaded', others: ['siblings-model', 'a-strangers-model'] });
  life.moments.heldSince = Date.now() - 60 * 60000;
  const n = asked.length;
  await life.moments.one();
  assert.equal(asked.length, n, 'never in place of a model that is not the household’s');
});

test('a few moments in one place and it is asked to go elsewhere; long or repeated words are cut', async () => {
  const { life, asked } = makeLife();
  things(life, 'The Soft Arch', 'Bench');
  life.state.about = { n: 3, at: 'T1', doing: 'touch', say: '', since: new Date().toISOString() };
  life.state.moments = [1, 2, 3].map(() => ({ at: 'T1', name: 'The Soft Arch', doing: 'touch', say: '', time: '15:00' }));
  await life.moments.one();
  assert.deepEqual(asked.at(-1).schema.properties.go.enum, ['Bench', 'your card']);
  assert.match(asked.at(-1).user, /You have stayed by The Soft Arch for your last few moments/);
  assert.notEqual(life.state.about.at, 'T1');

  const places = ['your card', 'stay'];
  assert.equal(mind.readMoment('{"go":"stay","do":"look","say":"It leans like a tired leg. Does it hold the dot or just press on empty space?"}', places).say, 'It leans like a tired leg.');
  assert.equal(
    mind.readMoment('{"go":"stay","do":"look","say":"the card burns at fifty five and my memory feels like wet paper again and again"}', places).say,
    'the card burns at fifty five and my memory feels like wet…',
  );
});
