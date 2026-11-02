// The model it runs on: its keeper may move it onto another, and it is told; photos go to a model that can read them;
// it takes turns with the lives it shares the house with, and still waits for its human's own models.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { createStore } from '../server/store.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeLife(dir, brain) {
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.courtesy.enabled = true;
  cfg.moderation.mode = 'off';
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new, born {{born}}.\n');
  const life = new Life({ config: cfg, store: createStore(dir), brain: createBrain(cfg.brain) });
  if (brain) life.brain = { ...life.brain, ...brain };
  return life;
}

test('moved onto a larger model, it is told once what it ran on and what it runs on now', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-mind-'));
  dirs.push(dir);
  const first = makeLife(dir, { kind: 'openai', label: 'qwen3.5-9b-abliterated' });
  first.birth();
  first.start();
  first.stop();
  assert.equal(first.state.mind, 'qwen3.5-9b-abliterated');
  assert.ok(!first.notes.some((n) => n.includes('moved you')), 'nothing to tell the first time');

  const moved = makeLife(dir, { kind: 'openai', label: 'qwen3.8-27b-abliterated' });
  moved.start();
  moved.stop();
  const note = moved.notes.find((n) => n.includes('moved you'));
  assert.ok(note, 'it is told');
  assert.match(note, /onto a larger model/);
  assert.match(note, /about 9 billion parameters.*about 27 billion parameters/);
  assert.ok(moved.journal.some((j) => j.kind === 'gift' && j.text.includes('qwen3.8-27b-abliterated')));
  assert.ok(moved.state.milestones.some((m) => m.kind === 'new-mind'));

  const again = makeLife(dir, { kind: 'openai', label: 'qwen3.8-27b-abliterated' });
  again.start();
  again.stop();
  assert.ok(!again.notes.some((n) => n.includes('moved you')), 'only once');
});

test('a life from before this was kept finds what it ran on in its last cycle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-mind-old-'));
  dirs.push(dir);
  const life = makeLife(dir, { kind: 'openai', label: 'qwen3.8-27b-abliterated' });
  life.birth();
  delete life.state.mind;
  life.store.write('cycles/000001.json', { n: 1, brain: 'qwen3.5-9b-abliterated' });
  life.noticeMind();
  assert.ok(life.notes.some((n) => n.includes('You used to run on qwen3.5-9b-abliterated')));
});

test('a photo goes to its eyes when its own model cannot read one', async () => {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body).model);
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 });
  };
  try {
    const brain = createBrain({ ...loadConfig(['--config', 'none.json']).brain, model: 'big-27b', eyes: 'small-9b', logprobs: false });
    await brain.complete({ system: 's', user: 'u' });
    await brain.complete({ system: 's', user: 'u', image: { type: 'image/jpeg', data: 'AA==' } });
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(sent, ['big-27b', 'small-9b']);
});

test('it takes turns with the lives it shares the house with, and its own eyes, but waits for its human', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-mind-house-'));
  dirs.push(dir);
  const loaded = (others) => async () => ({ reachable: true, known: true, ownState: 'unloaded', others });
  const life = makeLife(dir, { kind: 'openai', label: 'big-27b' });
  life.birth();
  life.cfg.brain.eyes = 'small-9b';
  life.cfg.courtesy.household = ['sibling-9b'];
  life.brain.presence = loaded(['sibling-9b']);
  assert.equal((await life.courtesy({})).ok, true, 'its sibling\'s model is pushed out, taking turns');
  life.brain.presence = loaded(['small-9b']);
  assert.equal((await life.courtesy({})).ok, true, 'and so is its own eyes');
  life.brain.presence = loaded(['someone-elses-coder']);
  const wait = await life.courtesy({});
  assert.equal(wait.reason, 'other-mind', 'its human\'s model is waited for');
  assert.match(wait.text, /someone-elses-coder/);
});

test('reading a letter from someone nothing in its place comes from, it is told so, plainly', async () => {
  const mind = await import('../server/mind.js');
  const base = { cycle: 40, tired: null, habits: { total: 0 }, errands: { canPost: false }, senses: { weekday: 'Monday', time: '10:00', partOfDay: 'morning', date: '2026-11-02', gpu: null }, notes: [], waiting: 0, questions: [], recent: [] };
  const letter = (from, unbuilt) => ({ id: `L${from}`, from, text: 'Hello.', nth: 1, unbuilt, remembered: [] });
  const ask = (letters, count = 3) => mind.actPrompt({ ...base, world: { count, standing: count, lastBuilt: 35 }, letters }, 'thinking');
  assert.match(ask([letter('Yzri', true)]), /Nothing in your place comes from Yzri's letters yet\./);
  assert.match(ask([letter('Yzri', true), letter('Mara', true)]), /from Yzri and Mara's letters yet/);
  assert.doesNotMatch(ask([letter('Teo', false)]), /Nothing in your place comes from/);
  assert.doesNotMatch(ask([letter('Yzri', true)], 0), /Nothing in your place comes from/, 'with nothing built it is told that instead');
});
