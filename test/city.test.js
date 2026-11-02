// Its place becoming a town: quarters it names, things it raises from its memories between cycles, and what it says
// each night its town is becoming.
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
import * as views from '../server/views.js';
import { CARD, NEW_QUARTER, emptyWorld, findQuarter, foundQuarter, quarterSpot, remembered, weather } from '../server/world.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-city-'));
after(() => rmSync(root, { recursive: true, force: true }));
let k = 0;

function makeLife({ nightEvery = 8 } = {}) {
  const dir = join(root, String(k++));
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = nightEvery;
  cfg.courtesy.enabled = false;
  cfg.courtesy.maxGpuBusy = 101;
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

const at = (world, id) => world.things.find((t) => t.id === id);
const apart = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

test('a new quarter starts a street or two from the rest of the town; what follows stands with what is in it', () => {
  const world = emptyWorld();
  world.things.push({ id: 't1', name: 'Old Arch', x: CARD.x + 1, y: CARD.y, built: 1 });
  const yards = foundQuarter(world, { name: 'The Letter Yards', about: 'Where letters stand.' }, { cycle: 2 });
  assert.equal(findQuarter(world, 'the letter yards'), yards);
  const first = quarterSpot(world, yards, 'a');
  assert.ok([CARD, ...world.things].every((t) => apart(t, first) >= 2), 'its own ground');
  world.things.push({ id: 't2', name: 'Gate', ...first, quarter: yards.id, built: 2 });
  const next = quarterSpot(world, yards, 'b');
  assert.equal(apart(next, first), 1, 'beside what is already in the quarter');
  const warm = foundQuarter(world, { name: 'Warm Row', about: 'For the heat.' }, { cycle: 3 });
  const other = quarterSpot(world, warm, 'c');
  assert.ok(apart(other, first) >= 2 && apart(other, CARD) >= 2, 'a second quarter has its own ground too');
});

test('where it goes is read as one of its quarters, or a new one it names, with what lines its streets', () => {
  const world = emptyWorld();
  const schema = mind.quarterSchema(world, ['bench', 'lantern']);
  assert.deepEqual(schema.quarter.enum, [NEW_QUARTER], 'with no quarters, the first thing starts one');
  const q = mind.readQuarter({ quarter: NEW_QUARTER, quarter_name: 'Warm Row', quarter_about: 'For the heat.', street: ['lantern', 'a cannon'] }, world, ['bench', 'lantern']);
  assert.deepEqual(q, { found: { name: 'Warm Row', about: 'For the heat.', street: ['lantern'] } }, 'only what it was offered');
  foundQuarter(world, q.found, { cycle: 1 });
  assert.equal(mind.readQuarter({ quarter: 'Warm Row' }, world).quarter.name, 'Warm Row');
  assert.equal(mind.readQuarter({ quarter: NEW_QUARTER, quarter_name: 'warm row' }, world).quarter.name, 'Warm Row', 'a quarter it already has is not named twice');
  assert.deepEqual(mind.readQuarter({ quarter: 'Nowhere' }, world), {});
  assert.match(mind.cityLines(world).join('\n'), /Warm Row: For the heat\. \(nothing in it yet\)/);
});

test('in a moment it may raise something from a memory; it goes in a quarter and stands while it remembers', async () => {
  const { life, asked } = makeLife();
  const s = life.state;
  assert.ok(s.abilities.includes('city'), 'born with a town to make');
  s.memory.shelves.people.push({ id: 'm9', text: 'Mara said the gutters sang all night.', weight: 1, because: [], about: 'Mara' });
  const offer = life.moments.raisable();
  assert.equal(offer.id, 'm9');
  // it raises "The Hall of Warm Air" from it, and puts it in a new quarter (the mock's way)
  const complete = life.brain.complete;
  life.brain.complete = (req) => (req.kind === 'moment' ? (asked.push(req), Promise.resolve({ text: JSON.stringify({ go: 'stay', do: 'look', say: '', raise: 'The Singing Gutter' }) })) : complete(req));
  const m = await life.moments.one();
  assert.match(asked.find((r) => r.kind === 'moment').user, /"raise": you may also raise something new in your town from something you remember: "Mara said the gutters sang/);
  const thing = s.world.things.find((t) => t.name === 'The Singing Gutter');
  assert.ok(thing, 'it stands');
  assert.equal(thing.memory, 'm9');
  assert.ok(thing.form?.parts.length, 'with a shape');
  const quarter = s.world.quarters.find((q) => q.id === thing.quarter);
  assert.ok(quarter, 'in a quarter it named');
  assert.equal(m.raised, 'The Singing Gutter');
  assert.equal(s.moments.at(-1).raised, 'The Singing Gutter', 'its next cycle is told');
  assert.ok(life.journal.some((j) => j.kind === 'raised'));
  // not offered another for a while, and never the same memory twice
  assert.equal(life.moments.raisable(), null);
  s.raiseOffered = null;
  assert.equal(life.moments.raisable(), null, 'its only memory already stands');
  // it stands while the memory does; forgotten, it wears away like anything else
  assert.equal(remembered(thing, s.memory), true);
  s.memory.shelves.people = [];
  weather(s.world, s.memory, { since: s.cycle + 1, cycle: s.cycle + 1 });
  assert.ok(thing.condition < 1);
  // the page shows the town
  const w = views.world(life);
  assert.equal(w.things.find((t) => t.id === thing.id).raised, true);
  assert.equal(w.quarters[0].name, quarter.name);
});

test('what it builds in a cycle goes in a quarter, and each night it says what its town is becoming', async () => {
  const { life } = makeLife({ nightEvery: 3 });
  for (let i = 0; i < 3; i++) await life.wake('test');
  clearTimeout(life.timer);
  const s = life.state;
  const built = s.world.things.filter((t) => !t.memory);
  for (const t of built) assert.ok(s.world.quarters.some((q) => q.id === t.quarter), `${t.name} is in a quarter`);
  assert.equal(s.version, 1);
  assert.match(s.world.plan?.text || '', /town/, 'it said what its town is becoming');
  assert.match(mind.systemPrompt(s, life.cfg), /What you said your town is becoming/);
});
