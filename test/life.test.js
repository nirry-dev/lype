// A whole short life with the mock brain: birth, letters, cycles, a night, the drift guard, influence tracing.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { createStore } from '../server/store.js';

const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function makeLife() {
  const cfg = loadConfig(['--mock', '--data', dir]);
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
