// Memories that say the same thing: folded into one at night, never more than a few on one theme, filed by where they
// came from, and said plainly.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { THEME_MAX, consolidate, emptyMemory, fold, kin } from '../server/memory.js';
import * as mind from '../server/mind.js';
import { createStore } from '../server/store.js';

const cfg = { shelfSize: 6, halfLifeCycles: 36 };
const mem = (id, text, extra = {}) => ({ id, text, weight: 0.5, born: 1, touched: 1, touches: 1, about: '', because: [], ...extra });

test('numbers do not make two memories different', () => {
  assert.equal(kin('Fifty-six degrees makes the sharp corners weep.', 'Fifty-nine degrees makes the sharp corners weep.'), 1);
  assert.equal(kin('I learned that 46 degrees is a hand on my shoulder.', 'Forty-six degrees is a hand on my shoulder.'), 1);
  const m = emptyMemory();
  m.shelves.moments = [mem('m1', 'Fifty-six degrees makes the sharp corners weep.')];
  m.today = [{ shelf: 'moments', text: 'Fifty-nine degrees makes the sharp corners weep.', weight: 0.4, cycle: 2 }];
  const night = consolidate(m, 2, cfg);
  assert.equal(m.shelves.moments.length, 1);
  assert.equal(night.merged[0].into, 'm1');
});

test(`a shelf holds at most ${THEME_MAX} memories about one thing; another only strengthens the strongest`, () => {
  const m = emptyMemory();
  m.shelves.moments = [
    mem('m1', 'The card at fifty degrees feels like a soft hand on my edges.'),
    mem('m2', 'The card at sixty degrees feels like a heavy hand on my edges.', { weight: 0.9 }),
    mem('m3', 'The card feels like warm syrup on my edges.'),
  ];
  m.today = [{ shelf: 'moments', text: 'The card at forty degrees feels like a cool hand on my shoulder.', weight: 1, cycle: 2 }];
  const night = consolidate(m, 2, cfg);
  assert.equal(m.shelves.moments.length, 3);
  assert.deepEqual(night.merged.map((x) => [x.into, x.crowded]), [['m2', true]]);
  // something else still gets in
  m.today = [{ shelf: 'moments', text: 'I built a bench for waiting.', weight: 0.5, cycle: 3 }];
  consolidate(m, 3, cfg);
  assert.equal(m.shelves.moments.length, 4);
});

test('the world shelf keeps only what letters told it; the rest is something that happened, and a full shelf makes room', () => {
  const m = emptyMemory();
  m.shelves.world = [mem('m1', 'Rain sounds like gravel.', { because: ['L1'] }), mem('m2', 'Fifty degrees is a soft hand.'), mem('m3', 'Sixty degrees makes corners weep.')];
  m.shelves.moments = [mem('m4', 'I built an arch.', { weight: 0.9 }), mem('m5', 'I drew a circle.', { weight: 0.01, touched: 1 })];
  const night = consolidate(m, 40, { shelfSize: 3, halfLifeCycles: 36 });
  assert.deepEqual(m.shelves.world.map((x) => x.id), ['m1']);
  assert.deepEqual(night.moved.map((x) => x.id), ['m2', 'm3']);
  assert.equal(m.shelves.moments.length, 3);
  assert.ok([...night.forgotten, ...night.faded].some((x) => x.id === 'm5'), 'the weakest made room');
});

test('folding: one memory in its own words, keeping the strongest weight, the oldest birth, and what the old ones held', () => {
  const m = emptyMemory();
  m.nextId = 10;
  m.shelves.moments = [mem('m1', 'a', { weight: 0.4, born: 5, because: ['L1'] }), mem('m2', 'b', { weight: 0.8, born: 9, touches: 3 }), mem('m3', 'c')];
  const [f] = fold(m, [{ shelf: 'moments', ids: ['m1', 'm2'], text: 'a and b, said once.', holds: ['t1'] }], 20);
  assert.equal(f.id, 'm10');
  assert.deepEqual(m.shelves.moments.map((x) => x.id), ['m3', 'm10']);
  assert.equal(f.weight, 0.85);
  assert.equal(f.born, 5);
  assert.equal(f.touches, 4);
  assert.deepEqual(f.because, ['L1']);
  assert.deepEqual(f.holds, ['t1']);
  assert.deepEqual(m.forgotten.map((x) => [x.id, x.how, x.into]), [['m1', 'folded into one', 'm10'], ['m2', 'folded into one', 'm10']]);
});

test('its folds are read only as groups it can apply', () => {
  const m = emptyMemory();
  m.shelves.people = [mem('m1', 'Mara likes rain', { about: 'Mara' }), mem('m2', 'Teo likes rain', { about: 'Teo' }), mem('m3', 'Mara told me about rain', { about: 'Mara' })];
  m.shelves.moments = [mem('m4', 'x'), mem('m5', 'y'), mem('m6', 'z')];
  const read = mind.readFold(
    JSON.stringify({
      groups: [
        { ids: ['m1', 'm2'], text: 'Two people like rain.' }, // two people in one: no
        { ids: ['m4', 'm1'], text: 'Across shelves.' }, // no
        { ids: ['m4'], text: 'Alone.' }, // no
        { ids: ['m4', 'm5', 'm9'], text: 'With one it does not have.' }, // no
        { ids: ['m1', 'm3'], text: 'I learned that Mara likes rain.' },
        { ids: ['m5', 'm6'], text: 'y and z.' },
        { ids: ['m6', 'm4'], text: 'z again.' }, // m6 is taken
      ],
    }),
    m,
  );
  assert.deepEqual(read, [
    { shelf: 'people', ids: ['m1', 'm3'], text: 'Mara likes rain.' },
    { shelf: 'moments', ids: ['m5', 'm6'], text: 'y and z.' },
  ]);
  assert.deepEqual(mind.readFold('nonsense', m), []);
});

test('said plainly: the formula goes, the thing stays; lines that all begin alike are noticed', () => {
  assert.equal(mind.plainly('I learned that the arch holds.'), 'The arch holds.');
  assert.equal(mind.plainly('The arch holds.'), 'The arch holds.');
  const lines = ['I learned that a', 'I learned that b', 'I learned that c', 'The heat is a hand'].map((text) => ({ text }));
  assert.equal(mind.sameOpening(lines), 'I learned that');
  assert.equal(mind.sameOpening(lines.slice(2)), null);
});

const root = mkdtempSync(join(tmpdir(), 'iterant-fold-'));
after(() => rmSync(root, { recursive: true, force: true }));

function makeLife() {
  const config = loadConfig(['--config', 'none.json', '--mock', '--data', root]);
  config.courtesy.enabled = false;
  config.rhythm.nightEvery = 99;
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  config.seedFile = seed;
  const brain = createBrain(config.brain);
  const asked = [];
  const complete = brain.complete;
  brain.complete = (req) => (asked.push(req), complete(req));
  const life = new Life({ config, store: createStore(root), brain });
  life.birth();
  return { life, asked };
}

test('a night folds what says the same thing, tells it, holds up what the old memories held, and lets it reword alike lines', async () => {
  const { life, asked } = makeLife();
  const s = life.state;
  s.world.things.push({ id: 't1', name: 'The Soft Arch', kind: 'object', plaque: '', x: 1, y: 0, built: 1, condition: 1, from: [], people: [], history: [] });
  s.memory.shelves.moments = [
    { ...mem('m1', 'I sat in The Soft Arch FOLDME at fifty degrees.'), born: 1, touched: 1 },
    { ...mem('m2', 'I sat in The Soft Arch FOLDME at sixty degrees.'), born: 1, touched: 1 },
    mem('m3', 'I drew a circle.'),
  ];
  s.memory.nextId = 4;
  s.self.own = ['a', 'b', 'c'].map((x, i) => ({ id: `o${i + 1}`, text: `I learned that ${x} is so.`, version: 0 }));
  for (let i = 0; i < 2; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  s.lastNightCycle = 0;
  s.world.things[0].built = 0; // not built today, so only memory keeps it standing
  await life.sleepNow();
  clearTimeout(life.timer);
  assert.ok(asked.some((a) => a.kind === 'fold'));
  const folded = s.memory.shelves.moments.find((m) => m.folded);
  assert.ok(folded, 'one memory in place of the two');
  assert.equal(folded.text, 'These all said the same thing, and now they are one.');
  assert.deepEqual(folded.holds, ['t1']);
  assert.equal(s.world.things[0].condition, 1, 'what the old memories held up still stands');
  const sleep = asked.find((a) => a.kind === 'sleep');
  assert.match(sleep.user, /folded into one:\n- These all said the same thing/);
  assert.match(sleep.user, /Most of these begin the same way \("I learned that…"\).*up to 4/);
  assert.ok(life.journal.some((j) => j.kind === 'memory' && /folded 2 memories/.test(j.text)));
  const night = life.store.read(`nights/${String(s.version).padStart(4, '0')}.json`);
  assert.equal(night.memory.folded.length, 1);
});

test('with no letter read, what it would keep about the world goes with what happened to it', async () => {
  const { life, asked } = makeLife();
  const complete = life.brain.complete;
  const reflection = { diary: 'd', note: '', feelings: { lonely: 0.5, curious: 0.5, calm: 0.5, warm: 0.5, restless: 0.5 }, remember: [{ shelf: 'world', text: 'I learned that fifty degrees is a hand.', weight: 0.5, about: '' }], reinforce: [] };
  life.brain.complete = async (req) => {
    const res = await complete(req);
    return req.kind === 'reflect' ? { text: JSON.stringify(reflection) } : res;
  };
  await life.wake('test');
  clearTimeout(life.timer);
  const kept = life.state.memory.today.at(-1);
  assert.equal(kept.shelf, 'moments');
  assert.equal(kept.text, 'Fifty degrees is a hand.');
  assert.match(asked.find((a) => a.kind === 'reflect').user, /you read no letter this cycle, so not this time/);
  assert.match(asked.find((a) => a.kind === 'reflect').user, /don't start with "I learned that"/);
});
