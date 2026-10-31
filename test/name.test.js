// The name it chooses must be one it can be called by.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cuteName, readName } from '../server/mind.js';

test('a name is one short, soft word', () => {
  for (const ok of ['Pimi', 'mimo', 'Lune.', 'Tobo', 'Ollo', 'Bryony']) assert.ok(cuteName(ok).name, ok);
  assert.equal(cuteName('mimo').name, 'Mimo');
  assert.match(cuteName('Pond').why, /ends hard/);
  assert.equal(cuteName('LUNE').name, 'Lune');
  assert.match(cuteName('The Weeping Corner').why, /more than one word/);
  assert.match(cuteName('Pixel').why, /a thing, not a name/);
  assert.match(cuteName('Pino').why, /a thing, not a name/, 'not the creature that inspired it');
  assert.match(cuteName('Marmalademoon').why, /two to eight letters/);
  assert.match(cuteName('Tamarina').why, /too long to say/);
  assert.match(cuteName('R2D2').why, /other than letters/);
  assert.match(cuteName('').why, /empty/);
});

test('it may not take the name of someone who wrote to it', () => {
  const state = { people: { a: { name: 'Mara' } } };
  const got = readName(JSON.stringify({ candidates: [{ name: 'Mara', from: 'her letter' }], choice: 'Mara', why: 'she was first' }), state);
  assert.equal(got.name, undefined);
  assert.match(got.refused.why, /someone who wrote to you/);
  const ok = readName(JSON.stringify({ candidates: [{ name: 'Mimo', from: 'her rain' }], choice: 'mimo', why: 'it is soft' }), state);
  assert.deepEqual([ok.name, ok.from], ['Mimo', 'her rain']);
});
