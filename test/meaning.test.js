// Meaning: memories said in different words can still be one, and recall finds what a letter is about, not only its words.
// A stand-in for the embedding model: texts about the same topic point the same way.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Meanings, scaled } from '../server/meaning.js';
import { THEME, TWIN, consolidate, emptyMemory, kin, useMeaning } from '../server/memory.js';
import { Recall } from '../server/recall.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-meaning-'));
after(() => {
  useMeaning(null);
  rmSync(root, { recursive: true, force: true });
});

const TOPICS = [/weep|water|drip|wet|rain|gutter/i, /bread|bak|oven/i, /box|corner|square/i];
let calls = 0;
/** Texts on one topic point (almost) the same way; anything else points its own way. */
function vector(text) {
  const v = new Array(16).fill(0);
  const t = TOPICS.findIndex((re) => re.test(text));
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (t >= 0) v[t] = 1;
  v[3 + (h % 13)] += t >= 0 ? 0.15 : 1;
  return v;
}
const fakeFetch = async (url, { body }) => {
  calls++;
  const { input } = JSON.parse(body);
  return { ok: true, json: async () => ({ data: input.map((s, index) => ({ index, embedding: vector(s.replace(/^\w+: /, '')) })) }) };
};
const down = async () => {
  throw new Error('connect ECONNREFUSED');
};

test('likeness in meaning is put on the scale words use', () => {
  assert.equal(scaled(0.5), 0);
  assert.equal(scaled(0.86), THEME);
  assert.ok(Math.abs(scaled(0.93) - TWIN) < 1e-9);
  assert.equal(scaled(1), 1);
});

test('each text is read once and kept on disk; when the model is away, words alone decide', async () => {
  const file = join(root, 'cache', 'meanings.jsonl');
  const m = new Meanings({ url: 'http://model', file, fetchImpl: fakeFetch });
  calls = 0;
  assert.ok(await m.ensure(['The corners weep.', 'Water runs down the edges.']));
  assert.ok(await m.ensure(['The corners weep.']));
  assert.equal(calls, 1, 'read once');
  assert.ok(existsSync(file));
  const again = new Meanings({ url: 'http://model', file, fetchImpl: down });
  assert.ok(again.alike('The corners weep.', 'Water runs down the edges.') > TWIN, 'read back from disk, and alike');
  assert.equal(await again.ensure(['Something new.']), false);
  assert.equal(again.up, false, 'it waits before asking again');
  assert.equal(again.alike('Something new.', 'The corners weep.'), null);
  assert.equal(new Meanings({ url: '' }).enabled, false);
});

test('two memories said differently are one memory; without meaning they stay two', async () => {
  const m = new Meanings({ url: 'http://model', fetchImpl: fakeFetch });
  const a = 'The corners weep in the heat.';
  const b = 'Water drips down every edge.';
  await m.ensure([a, b, 'Teo bakes bread before dawn.']);
  const run = () => {
    const memory = emptyMemory();
    memory.shelves.moments.push({ id: 'm1', text: a, weight: 0.5, born: 1, touched: 1 });
    memory.today.push({ shelf: 'moments', text: b, weight: 0.4, cycle: 2 }, { shelf: 'moments', text: 'Teo bakes bread before dawn.', weight: 0.4, cycle: 2 });
    return consolidate(memory, 2, { shelfSize: 12, halfLifeCycles: 36 });
  };
  useMeaning(null);
  assert.equal(kin(a, b), 0);
  assert.equal(run().merged.length, 0, 'words alone: two memories');
  useMeaning(m);
  assert.ok(kin(a, b) >= TWIN);
  const r = run();
  assert.deepEqual(r.merged.map((x) => x.text), [b], 'by meaning: the same memory again, so the old one grows');
  assert.deepEqual(r.kept.map((x) => x.text), ['Teo bakes bread before dawn.']);
  useMeaning(null);
});

test('a letter calls up what it is about, even in other words', async () => {
  const m = new Meanings({ url: 'http://model', fetchImpl: fakeFetch });
  const r = new Recall({ store: null, state: null }, m);
  r.addCycle({ n: 2, startedAt: new Date().toISOString(), letters: [{ id: 'L1', from: 'Mara', text: 'The gutters sang like gravel all night.' }] });
  for (let i = 0; i < 30; i++) r.addCycle({ n: 3 + i, startedAt: new Date().toISOString(), diary: `An ordinary hour, number ${i}.` });
  const letters = [{ id: 'L9', from: 'Sol', text: 'It is wet out; everything drips.' }];
  assert.deepEqual(r.cue({ letters, cycle: 40 }), [], 'no words in common, and no meaning read yet');
  await r.prepare({ letters, avoid: [] });
  assert.deepEqual(r.cue({ letters, cycle: 40 }).map((x) => x.id), ['c2:letter:L1']);
  useMeaning(m);
  await r.prepare({ letters, avoid: ['Rain is loud on a roof.'] });
  assert.deepEqual(r.cue({ letters, cycle: 40, avoid: ['Rain is loud on a roof.'] }), [], 'not when it holds something about that already');
  useMeaning(null);
});
