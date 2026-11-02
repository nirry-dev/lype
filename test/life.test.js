// A whole short life with the mock brain: birth, letters, cycles, a night, the drift guard, influence tracing.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { addErrand, cleanJpeg } from '../server/errands.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import * as mind from '../server/mind.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';
import { fakeJpeg } from './fixtures.js';

const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function makeLife() {
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 3;
  cfg.courtesy.enabled = false;
  const seed = join(dir, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new, born {{born}}.\n- You like circles.\n');
  cfg.seedFile = seed;
  return new Life({ config: cfg, store: createStore(dir), brain: createBrain(cfg.brain) });
}

test('a short life: three cycles, a letter, and a night that makes version 1', async () => {
  const life = makeLife();
  life.birth();
  assert.equal(life.state.self.seed.length, 2);
  assert.match(life.state.self.seed[0].text, /born \w+day/);

  life.addLetter({ from: 'Mara', text: 'It rained all day here and the gutters sang.', person: 'v1' });
  for (let i = 0; i < 3; i++) {
    const r = await life.wake('test');
    assert.ok(r.ok, r.reason);
  }
  clearTimeout(life.timer);

  assert.equal(life.state.cycle, 3);
  assert.equal(life.state.version, 1, 'the third cycle triggers the first night');
  assert.ok(life.letters[0].readAt, 'the letter was read');
  assert.equal(life.state.people.v1.lettersRead, 1);
  assert.ok(life.state.milestones.some((m) => m.kind === 'first-sleep'));
  assert.equal(life.nights.length, 1);
  assert.ok(life.nights[0].release.title);
  assert.ok(life.state.self.own.length >= 1, 'it wrote something about itself');

  // State survives a restart.
  const again = makeLife();
  assert.equal(again.state.cycle, 3);
  assert.equal(again.cycles.length, 3);
  assert.equal(again.nights.length, 1);
});

test('the drift guard protects the seed and refuses near-duplicates and overflow', () => {
  const life = makeLife();
  const own = life.state.self.own.length;
  const out = life.applySelf(
    {
      remove: [{ id: 'seed1', why: 'I am not new any more' }],
      revise: [{ id: 'seed2', text: 'I like squares', because: 'squares' }],
      add: [
        { text: 'You like circles.', because: 'again' },
        { text: 'Letters that arrive at night feel warmer', because: 'Mara' },
      ],
    },
    2,
  );
  assert.equal(life.state.self.seed.length, 2, 'seed untouched');
  assert.deepEqual(
    out.refused.map((r) => r.why),
    ['its maker wrote that line', 'its maker wrote that line', 'too close to something it already believes'],
  );
  assert.equal(out.added.length, 1);
  assert.equal(life.state.self.own.length, own + 1);

  life.cfg.self.maxOwnLines = life.state.self.own.length;
  const full = life.applySelf({ remove: [], revise: [], add: [{ text: 'Something entirely different and new', because: 'x' }] }, 3);
  assert.match(full.refused[0].why, /no room/);
});

test('three of the same in a row tires that part of it, but resting never does', () => {
  const life = makeLife();
  const saved = life.cycles;
  life.cycles = ['write', 'draw', 'draw', 'draw'].map((action, i) => ({ n: i + 1, action }));
  assert.equal(life.tiredOf(), 'draw');
  life.cycles = ['draw', 'draw', 'ask'].map((action, i) => ({ n: i + 1, action }));
  assert.equal(life.tiredOf(), null);
  life.cycles = ['rest', 'rest', 'rest'].map((action, i) => ({ n: i + 1, action }));
  assert.equal(life.tiredOf(), null);
  life.cycles = saved;
});

test('a letter that changed it is told so', () => {
  const life = makeLife();
  const letter = life.addLetter({ from: 'Ilse', text: 'Herons stand still for hours waiting for fish.', person: 'v2' });
  const day = [{ id: letter.id, from: 'Ilse', text: 'Herons stand still for hours waiting for fish.' }];
  const self = { added: [{ text: 'I can wait like herons do', because: 'Ilse told me about herons' }], revised: [], removed: [], refused: [] };
  const influences = life.traceInfluences(day, { self, portrait: null, name: null, consolidation: { kept: [] } }, 4);
  assert.equal(influences.length, 1);
  assert.equal(influences[0].what, 'belief');
  const stored = life.letters.find((l) => l.id === letter.id);
  assert.deepEqual(stored.influenced, [{ version: 4, what: 'belief', text: 'I can wait like herons do' }]);
});

test('a photo brought back for an errand waits for its keeper, is looked at, and fills the errand', async () => {
  const life = makeLife();
  const e = addErrand(life.state.errands, { text: 'Bring me a photo of one leaf.', cycle: life.state.cycle, version: life.state.version, at: new Date().toISOString() });
  const r = life.addReturn({ errand: e.id, from: 'Wren', text: 'From the park by the river.', person: 'v9', photo: cleanJpeg(fakeJpeg()).data });
  assert.ok(r.ok);
  assert.equal(r.letter.status, 'held', 'a photo always waits for a person');
  assert.equal(r.letter.errand.photo, null, 'nobody sees the photo before its keeper lets it through');
  assert.equal(views.errands(life)[0].returns.length, 0);
  assert.ok(life.decide(r.letter.id, 'allow').ok);

  const stored = life.letters.find((l) => l.id === r.letter.id);
  for (let i = 0; i < 3 && !stored.readAt; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.ok(stored.readAt, 'it read the return');
  assert.ok(stored.errand.look.see, 'it looked at the photo');
  assert.equal(e.status, 'filled');
  assert.equal(e.filledFrom, 'Wren');
  assert.ok(life.state.milestones.some((m) => m.kind === 'first-sight'));
  const shown = views.errands(life).find((x) => x.id === e.id);
  assert.equal(shown.returns[0].photo, `returns/${stored.id}.jpg`);
  assert.ok(shown.returns[0].look.verdict);
  assert.equal(life.addReturn({ errand: e.id, from: 'June', text: '', person: 'v10', photo: cleanJpeg(fakeJpeg()).data }).ok, false, 'a filled errand takes no more photos');
});

test('a letter can carry a photo: it waits for its keeper, it looks before it reads, and the photo is shown with the letter', async () => {
  const life = makeLife();
  const held = life.addLetter({ from: 'Ines', text: 'This is the view from my window this morning.', person: 'v21', photo: cleanJpeg(fakeJpeg()).data });
  assert.equal(held.status, 'held', 'a photo always waits for a person');
  assert.equal(held.photo, null, 'nobody sees the photo before its keeper lets it through');
  assert.ok(life.keeperQueue().find((l) => l.id === held.id).heldPhoto, 'its keeper sees the photo');
  assert.ok(!views.letters(life).some((l) => l.id === held.id));
  assert.ok(life.decide(held.id, 'allow').ok);

  const stored = life.letters.find((l) => l.id === held.id);
  for (let i = 0; i < 3 && !stored.readAt; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.ok(stored.readAt, 'it read the letter');
  assert.ok(stored.look.see, 'it looked at the photo');
  assert.equal(stored.seenCycle, stored.readCycle);
  assert.equal(stored.errand, undefined, 'a letter with a photo is not an errand');
  const shown = views.letters(life).find((l) => l.id === held.id);
  assert.equal(shown.photo, `returns/${held.id}.jpg`);
  assert.ok(shown.look.verdict);
  assert.equal(shown.look.answers, undefined, 'nothing was asked for, so there is nothing to answer');
  const record = life.store.read(`cycles/${String(stored.readCycle).padStart(6, '0')}.json`);
  assert.equal(record.letters.find((l) => l.id === held.id).photo, `returns/${held.id}.jpg`);

  // a photo its keeper turns away is not kept
  const turned = life.addLetter({ from: 'Ines', text: 'And another.', person: 'v21', photo: cleanJpeg(fakeJpeg()).data });
  assert.ok(existsSync(life.store.path(`returns/${turned.id}.jpg`)));
  assert.ok(life.decide(turned.id, 'reject').ok);
  assert.ok(!existsSync(life.store.path(`returns/${turned.id}.jpg`)));
  assert.equal(life.letters.find((l) => l.id === turned.id).photo, null);
});

test('on its second night it chooses a name, once: a description is turned down and it chooses again', async () => {
  const life = makeLife();
  for (let i = 0; i < 12 && life.state.version < 3; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.ok(life.state.version >= 3);
  assert.equal(life.state.name, 'Mimo');
  assert.equal(life.state.names.length, 1, 'it never renames itself');
  assert.equal(life.state.names[0].version, 2);
  const night = life.nights.find((n) => n.name);
  assert.equal(night.n, 2);
  assert.equal(night.name.candidates.length, 3);
  assert.match(night.name.tries[0], /^The Round One \(it is more than one word\)$/);
  assert.equal(night.name.came, 'the hum in Mara’s letter');
  assert.ok(life.state.milestones.some((m) => m.kind === 'named'));
  assert.match(mind.systemPrompt(life.state, life.cfg), /Your name is Mimo\. You chose it yourself, once/);
});

test('a life that named itself a description is asked once to choose a name it can be called by', async () => {
  const own = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  after(() => rmSync(own, { recursive: true, force: true }));
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', own]);
  cfg.courtesy.enabled = false;
  cfg.seedFile = join(dir, 'seed.md');
  const life = new Life({ config: cfg, store: createStore(own), brain: createBrain(cfg.brain) });
  life.birth();
  Object.assign(life.state, { version: 3, name: 'The Weeping Corner', names: [{ name: 'The Weeping Corner', version: 3, why: 'it leaked', at: life.state.born }] });
  life.welcome();
  assert.equal(life.state.name, null);
  assert.equal(life.state.formerName, 'The Weeping Corner');
  assert.ok(life.notes.some((n) => n.includes('choose your name again, once and for good')));
  assert.match(mind.systemPrompt(life.state, life.cfg), /You used to call yourself "The Weeping Corner"/);

  assert.ok((await life.wake('test')).ok);
  assert.ok((await life.sleepNow()).ok);
  clearTimeout(life.timer);
  assert.equal(life.state.name, 'Mimo');
  assert.equal(life.nights.at(-1).name.from, 'The Weeping Corner');
  assert.equal(life.state.names.length, 2);
  assert.ok(life.state.milestones.some((m) => m.text === 'It chose its name: Mimo, in place of "The Weeping Corner".'));
  life.welcome();
  assert.equal(life.state.name, 'Mimo', 'and that name stays');
});
