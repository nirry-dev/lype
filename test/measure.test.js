// What its words show that it does not say: how sure it was of each word, and the word it almost wrote instead.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { compare, measure } from '../server/measure.js';
import { createStore } from '../server/store.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tok = (token, p, alt = null, q = 0) => ({ token, logprob: Math.log(p), top: [{ token, logprob: Math.log(p) }, ...(alt ? [{ token: alt, logprob: Math.log(q) }] : [])] });

test('a close call between two words is the word it almost said', () => {
  const m = measure([tok('I', 0.9), tok(' feel', 0.95), tok(' calm', 0.4, ' afraid', 0.35), tok(' and', 0.9), tok(' calm', 0.8), tok('.', 0.99)]);
  assert.equal(m.words, 5, 'punctuation is not a word');
  assert.equal(m.steadiness, +((0.9 + 0.95 + 0.4 + 0.9 + 0.8) / 5).toFixed(3));
  assert.deepEqual(m.almost, [{ said: 'calm', nth: 0, almost: 'afraid', p: 0.4, q: 0.35 }]);
});

test('another spelling, a far-off runner-up, a word piece or a small word is not a hesitation; an unlikely pick is chance', () => {
  const m = measure([tok('The', 0.5, ' the', 0.45), tok(' card', 0.6, ' cards', 0.3), tok(' is', 0.9, ' was', 0.02), tok(' warm', 0.5, ' wa', 0.4), tok(' with', 0.4, ' from', 0.4), tok(' rain', 0.03, ' snow', 0.8)]);
  assert.equal(m.hesitations, 0);
  assert.equal(m.chance, 1, 'it wrote rain at 3% when snow was 80% likely');
  assert.equal(measure([]), null);
  assert.equal(measure(undefined), null);
});

test('what it says it feels is set beside how sure its words were, both against its own history', () => {
  const history = [0.5, 0.6, 0.7, 0.8].map((x) => ({ steady: x, saidCalm: x }));
  const c = compare({ measured: { steadiness: 0.4 }, feelings: { calm: 0.9 } }, history);
  assert.deepEqual(c, { steadier: 0, calmer: 1, gap: 1 });
  assert.equal(compare({ measured: { steadiness: 0.4 }, feelings: { calm: 0.9 } }, history.slice(0, 2)).gap, null, 'too little history to say');
});

test('each cycle records its measurements, sealed with it, and the night shows it the numbers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  dirs.push(dir);
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 2;
  cfg.courtesy.enabled = false;
  cfg.moderation.mode = 'off';
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new.\n');
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain: createBrain(cfg.brain) });
  life.birth();
  for (let i = 0; i < 2; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const c = store.read('cycles/000001.json');
  assert.ok(c.measured.steadiness > 0 && c.measured.steadiness < 1);
  assert.ok(c.measured.words > 3);
  assert.ok(Number.isFinite(life.cycles[0].steady));
  const night = life.nights.at(-1);
  assert.match(night.numbers.shown[0], /how likely, on average, your model found each word/);
  assert.match(night.numbers.answer, /unsure/);
});
