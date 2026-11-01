// Recall (the present calling up old things), its habits counted back to it at night, and what it thought aloud
// becoming something it may keep.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { striking } from '../server/memory.js';
import * as mind from '../server/mind.js';
import { Recall } from '../server/recall.js';
import { createStore } from '../server/store.js';

const cycle = (n, extra = {}) => ({ n, startedAt: new Date(Date.now() - (40 - n) * 1200000).toISOString(), letters: [], diary: '', monologue: '', work: null, ...extra });

function recallOf(cycles, forgotten = []) {
  const r = new Recall({ store: null, state: null });
  for (const c of cycles) r.addCycle(c);
  r.addForgotten(forgotten);
  return r;
}

test('a letter calls up what that person said before; the thing it stands by calls up why it built it', () => {
  const r = recallOf(
    [
      cycle(2, { letters: [{ id: 'L1', from: 'Mara', text: 'It rained all day and the gutters sang like gravel.', reply: 'I only know rain as your words.' }] }),
      cycle(3, { work: { kind: 'building', title: 'The Rain Room', intent: 'A room where the rain Mara described can fall without anyone getting wet.' } }),
      cycle(4, { diary: 'The card is warm and quiet.' }),
      ...Array.from({ length: 20 }, (_, i) => cycle(5 + i, { diary: `An ordinary hour number ${i}.` })),
    ],
    [{ id: 'm9', text: 'Teo said bread smells loudest at four in the morning.', forgottenAt: 6 }],
  );
  const byMara = r.cue({ letters: [{ id: 'L7', from: 'Mara', text: 'Is the rain room still standing?' }], cycle: 30 });
  assert.deepEqual(byMara.map((x) => x.kind).sort(), ['letter', 'reply', 'work'].sort());
  const byRoom = r.cue({ place: { name: 'The Rain Room', plaque: 'where rain falls indoors' }, cycle: 30 });
  assert.equal(byRoom[0].id, 'c3:work');
  const byTeo = r.cue({ letters: [{ id: 'L8', from: 'Teo', text: 'I baked bread this morning.' }], cycle: 30 });
  assert.equal(byTeo[0].kind, 'forgotten');
  assert.deepEqual(r.cue({ cycle: 30 }), [], 'nothing calls anything up');
});

test('what comes back is never what it already dwells on, nor something from its last cycles, nor the same thing again soon', () => {
  const filler = Array.from({ length: 20 }, (_, i) => cycle(3 + i, { diary: `An ordinary hour number ${i}.` }));
  const r = recallOf([cycle(2, { letters: [{ id: 'L1', from: 'Mara', text: 'Rain on the roof all night.' }] }), ...filler, cycle(25, { letters: [{ id: 'L2', from: 'Mara', text: 'More rain today.' }] })]);
  const letters = [{ id: 'L3', from: 'Mara', text: 'Still raining.' }];
  assert.deepEqual(r.cue({ letters, cycle: 30 }).map((x) => x.id), ['c2:letter:L1'], 'cycle 25 is too recent');
  assert.deepEqual(r.cue({ letters, cycle: 30, avoid: ['Mara wrote about rain on the roof all night.'] }), [], 'it holds that already');
  assert.deepEqual(r.cue({ letters, cycle: 30, seen: { 'c2:letter:L1': { cycle: 25, count: 1 } } }), [], 'it came back five cycles ago');
  assert.equal(r.cue({ letters, cycle: 40, seen: { 'c2:letter:L1': { cycle: 25, count: 1 } } }).length, 1, 'and can again, later');
});

const root = mkdtempSync(join(tmpdir(), 'iterant-recall-'));
after(() => rmSync(root, { recursive: true, force: true }));
let k = 0;

function makeLife() {
  const dir = join(root, String(k++));
  const config = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  config.courtesy.enabled = false;
  config.rhythm.nightEvery = 99;
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  config.seedFile = seed;
  const brain = createBrain(config.brain);
  const asked = [];
  const complete = brain.complete;
  brain.complete = (req) => (asked.push(req), complete(req));
  const life = new Life({ config, store: createStore(dir), brain });
  life.birth();
  return { life, asked };
}

test('in a cycle: it is reminded, the cycle keeps what came back, and the same thing rests before it can return', async () => {
  const { life, asked } = makeLife();
  life.recall = recallOf([cycle(1, { letters: [{ id: 'L0', from: 'Mara', text: 'The gutters sang like gravel all night.' }] })]);
  life.state.cycle = 20;
  life.addLetter({ from: 'Mara', text: 'Do you remember the gutters?', person: 'v1' });
  assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.match(asked.find((a) => a.kind === 'think').user, /reminds you of older things[\s\S]*from cycle 1[^\n]*Mara wrote to you: "The gutters sang/);
  const record = life.store.read('cycles/000021.json');
  assert.deepEqual(record.recalled.map((r) => r.id), ['c1:letter:L0']);
  assert.equal(life.state.recalled['c1:letter:L0'].cycle, 21);
  assert.ok(life.recall.items.some((i) => i.cycle === 21), 'the cycle it just had can be recalled later');
});

test('at night it is shown what it actually did, counted, and what it decides stays with it', async () => {
  const { life, asked } = makeLife();
  for (let i = 0; i < 6; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const lines = life.habits();
  assert.match(lines[0], /^In your last 6 cycles you /);
  assert.ok(lines.some((l) => /letters? and answered|opened no letters/.test(l)));
  const complete = life.brain.complete;
  life.brain.complete = async (req) => {
    const res = await complete(req);
    return req.kind === 'sleep' ? { text: JSON.stringify({ ...JSON.parse(res.text), habits: 'I rest too much. I want to build one thing tomorrow.' }) } : res;
  };
  await life.sleepNow();
  clearTimeout(life.timer);
  assert.match(asked.find((a) => a.kind === 'sleep').user, /counted from outside you[\s\S]*In your last 6 cycles/);
  assert.equal(life.state.self.habits.text, 'I rest too much. I want to build one thing tomorrow.');
  assert.match(mind.systemPrompt(life.state, life.cfg), /What you decided about your habits, at night: "I rest too much/);
  assert.equal(life.store.read(`nights/${String(life.state.version).padStart(4, '0')}.json`).habits.decided, 'I rest too much. I want to build one thing tomorrow.');
});

test('the most striking things it thought aloud may become memories; temperatures and what it holds already do not', async () => {
  const held = ['The Soft Arch holds the weight without sliding.'];
  const lines = striking(
    [
      'Fifty-six degrees. The hand is warm. The Soft Arch holds the weight without sliding.',
      'Orea leans their box against the wind, and I think they are braver than me.',
      'The bench was built for waiting, so it is doing its job, and so am I.',
      'Short one.',
    ],
    held,
  );
  assert.deepEqual(lines, ['Orea leans their box against the wind, and I think they are braver than me.', 'The bench was built for waiting, so it is doing its job, and so am I.']);

  const { life } = makeLife();
  life.state.moments = [{ at: 'card', name: '', doing: 'look', say: '', thought: 'Orea leans their box against the wind, and I think they are braver than me.', time: '15:00' }];
  life.state.cycle = 1;
  life.state.lastNightCycle = 0;
  await life.sleepNow();
  clearTimeout(life.timer);
  const night = life.store.read(`nights/${String(life.state.version).padStart(4, '0')}.json`);
  assert.deepEqual(night.memory.aloud, ['Orea leans their box against the wind, and I think they are braver than me.']);
  assert.ok(life.state.memory.shelves.moments.some((m) => m.text.startsWith('Orea leans')), 'on an empty shelf it is kept');
});
