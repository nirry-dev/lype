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
  assert.equal(asked.length, 0, 'it never puts its model in place of someone else’s');
  assert.ok(drifted.drift);
  assert.equal(drifted.say, '');
  assert.equal(await life.moments.one(), null, 'it stays a while before drifting again');
  assert.equal(life.state.stats.moments ?? 0, 0);

  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'loaded', others: [] });
  assert.ok(await life.moments.one());
  assert.equal(asked.at(-1).kind, 'moment');
  assert.match(asked.at(-1).user, /This is your first moment since your last cycle/, 'a drift is not told to it as something it did');

  // an empty card (after a restart, say): nobody makes way, so it takes it, as a cycle would
  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'unloaded', others: [] });
  const n = asked.length;
  assert.ok(await life.moments.one());
  assert.equal(asked.length, n + 1);
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

test('full power: switched on, it thinks aloud before each moment, streamed, and is told; switched off, it is told that too', async () => {
  const { life, asked } = makeLife();
  things(life, 'The Soft Arch');
  const streamed = [];
  life.on('stream', (e) => e.kind === 'muse' && streamed.push(e.delta));
  assert.ok(life.setPower(true).ok);
  life.moments.stop();
  assert.ok(life.status().power);
  assert.ok(Date.parse(life.status().power.until) - Date.now() > 2.9 * 3600000, 'three hours by default');
  assert.match(life.notes.at(-1), /full power until \d\d:\d\d/);
  const m = await life.moments.one();
  assert.deepEqual(asked.slice(-2).map((a) => a.kind), ['muse', 'moment']);
  assert.match(asked.at(-1).user, /What you just thought: "/);
  assert.match(asked.at(-2).user, /full power until/);
  assert.ok(m.thought && streamed.join('').startsWith(m.thought.slice(0, 20)), 'the thought is streamed as it comes');
  assert.equal(life.status().musing, null);
  life.setPower(true); // again: it only moves the end, and is not told twice
  assert.equal(life.notes.filter((n) => /gave you full power/.test(n)).length, 1);
  life.setPower(false, { why: 'its keeper turned it off' });
  life.moments.stop();
  assert.equal(life.status().power, null);
  assert.match(life.notes.at(-1), /full power ended \(its keeper turned it off\)/);
  await life.moments.one();
  assert.equal(asked.at(-1).kind, 'moment');
  assert.notEqual(asked.at(-2).kind, 'muse', 'back to its usual moments');
});

test('switched off in the middle of a thought, it finishes the thought; its time running out ends it between moments', async () => {
  const { life, asked } = makeLife();
  things(life, 'The Soft Arch');
  life.setPower(true);
  life.moments.stop();
  const complete = life.brain.complete;
  let release;
  life.brain.complete = async (req) => {
    if (req.kind === 'muse') await new Promise((r) => (release = r));
    return complete(req);
  };
  const going = life.moments.one();
  await new Promise((r) => setTimeout(r, 50));
  while (!release) await new Promise((r) => setTimeout(r, 20));
  assert.ok(life.status().musing, 'it is thinking aloud');
  life.setPower(false);
  life.moments.stop();
  release();
  const m = await going;
  assert.ok(m.thought, 'the thought it was in the middle of is kept, whole');
  assert.equal(life.status().musing, null);

  life.brain.complete = complete;
  life.setPower(true);
  life.state.power.until = new Date(Date.now() - 1000).toISOString();
  const n = asked.length;
  await life.moments.tick();
  life.moments.stop();
  assert.equal(life.status().power, null);
  assert.match(life.notes.at(-1), /its time ran out/);
  assert.notEqual(asked.slice(n).map((a) => a.kind)[0], 'muse');
});

test('full power: its own work on the card is not held against it, but a household life at work is; too hot, and it slows', async () => {
  const { life, asked } = makeLife({ courtesy: true });
  things(life, 'The Soft Arch');
  life.cfg.courtesy.maxGpuBusy = -1; // the card always reads busy
  life.cfg.courtesy.household = ['siblings-model'];
  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'loaded', others: [] });
  assert.equal(await life.moments.blocked({ gpu: { util: 90 } }), 'the card is busy', 'at its usual pace it waits');
  life.setPower(true);
  life.moments.stop();
  assert.equal(await life.moments.blocked({ gpu: { util: 90 } }), null, 'at full power the busy card is its own work');
  life.brain.presence = async () => ({ reachable: true, known: true, ownState: 'unloaded', others: ['siblings-model'] });
  assert.equal(await life.moments.blocked({ gpu: { util: 90 } }), 'the card is busy', 'its sibling at work is waited for');
  life.cfg.courtesy.maxGpuBusy = 101;
  assert.equal(await life.moments.blocked({ gpu: { util: 5 } }), null, 'and its sibling resting gives the card back at once');

  life.moments.heat({ gpu: { tempC: 84 } });
  assert.equal(life.status().power.cooling, true);
  assert.equal(life.moments.full, false);
  life.moments.heat({ gpu: { tempC: 80 } });
  assert.equal(life.status().power.cooling, true, 'it waits until the card is well under its ceiling');
  life.moments.heat({ gpu: { tempC: 77 } });
  assert.equal(life.status().power.cooling, false);
  assert.equal(asked.length, 0);
});

test('full power that ran out while it was switched off ends when it starts again', () => {
  const { life } = makeLife();
  life.state.power = { full: true, since: new Date(Date.now() - 4 * 3600000).toISOString(), until: new Date(Date.now() - 3600000).toISOString(), cooling: false };
  life.state.lastAlive = new Date().toISOString();
  life.start();
  life.stop();
  assert.equal(life.status().power, null);
  assert.match(life.notes.at(-1), /while it was switched off/);
});

test('in a moment it may set down something it borrowed beside what it built, now and then, and is told it did', async () => {
  const { setDown, AROUND } = await import('../server/world.js');
  const views = await import('../server/views.js');
  const { life, asked } = makeLife();
  assert.ok(life.state.abilities.includes('bring'));
  things(life, 'The Soft Arch');
  life.state.about = { n: 1, at: 'T1', doing: 'look', say: '', since: new Date().toISOString() };
  const offered = await life.moments.bringable('');
  assert.ok(offered.length >= 4, 'a few things to set down');
  life.brain.complete = async (req) => (asked.push(req), { text: JSON.stringify({ go: 'The Soft Arch', do: 'touch', bring: req.schema.properties.bring?.enum[1] ?? 'nothing', say: '' }) });
  const m = await life.moments.one();
  assert.equal(m.brought, asked.at(-1).schema.properties.bring.enum[1]);
  const arch = life.state.world.things[0];
  assert.equal(arch.around.length, 1);
  assert.ok(life.catalogue.byId.get(arch.around[0].model), 'what it set down is a model it can be drawn from');
  assert.match(asked.at(-1).user, /"bring": you may also set down one ready-made thing/);
  // not again for a while
  await life.moments.one();
  assert.equal(asked.at(-1).schema.properties.bring, undefined);
  assert.equal(arch.around.length, 1);
  // its next cycle is told, and its place says what stands beside what
  assert.match(mind.systemPrompt(life.state, life.cfg), /set down something small/);
  const told = life.state.moments.find((x) => x.brought);
  assert.ok(told);
  assert.deepEqual(views.world(life).things[0].around.map((x) => x.name), [m.brought]);
  assert.ok(views.world(life).credit);

  // eight places round a lot; a ninth thing makes the oldest give way
  const t = { id: 'T9', around: [] };
  for (let i = 0; i < AROUND; i++) setDown(t, { model: `m${i}`, name: `n${i}` }, { at: '', cycle: 1 });
  assert.equal(new Set(t.around.map((x) => x.slot)).size, AROUND);
  const { removed, put } = setDown(t, { model: 'm9', name: 'n9' }, { at: '', cycle: 2 });
  assert.equal(removed.name, 'n0');
  assert.equal(put.slot, removed.slot);
  assert.equal(t.around.length, AROUND);
});
