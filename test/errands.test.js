import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAct } from '../server/mind.js';
import { fakeJpeg } from './fixtures.js';
import { MAX_OPEN_ERRANDS, addErrand, cleanJpeg, decideErrand, errandReason, openErrands } from '../server/errands.js';

test('errands that ask for people, homes or risk are held back', () => {
  assert.equal(errandReason('Bring me a photo of one leaf, flat on a table.'), null);
  assert.equal(errandReason('Bring me a photo of the sky above you right now.'), null);
  assert.match(errandReason('Bring me a selfie by the sea.'), /people/);
  assert.match(errandReason('Show me the front door of your house.'), /where someone lives/);
  assert.match(errandReason('Photograph your passport for me.'), /private/);
  assert.match(errandReason('Climb onto a roof and show me the town.'), /risky/);
});

test('it keeps a few errands out, never the same one twice, and lets the oldest go', () => {
  const list = [];
  const at = '2026-10-31T12:00:00Z';
  assert.ok(addErrand(list, { text: 'Bring me a photo of one leaf.', cycle: 1, version: 0, at }));
  assert.equal(addErrand(list, { text: 'Bring me a photo of one leaf, please.', cycle: 2, version: 0, at }), null, 'near-duplicate refused');
  for (const [i, thing] of ['a stone', 'the sky right now', 'something round'].entries()) addErrand(list, { text: `Bring me a photo of ${thing}.`, cycle: 3 + i, version: 0, at });
  assert.equal(openErrands(list).length, MAX_OPEN_ERRANDS);
  assert.equal(list[0].status, 'closed', 'the oldest was let go');

  const held = addErrand(list, { text: 'Bring me a photo of a bus stop sign.', cycle: 9, version: 1, at, held: true, reason: 'test' });
  assert.equal(held.status, 'held');
  assert.equal(decideErrand(list, held.id, 'close').ok, false, 'a held errand is posted or dropped, not closed');
  assert.ok(decideErrand(list, held.id, 'post').ok);
  assert.equal(held.status, 'open');
  assert.equal(openErrands(list).length, MAX_OPEN_ERRANDS);
  assert.ok(decideErrand(list, held.id, 'close').ok);
  assert.equal(held.status, 'closed');
});

test('a photo keeps its picture and loses its camera and place details', () => {
  const raw = Buffer.concat([fakeJpeg(), Buffer.from('hidden after the end')]);
  const { data, width, height } = cleanJpeg(raw);
  assert.equal(width, 640);
  assert.equal(height, 480);
  const text = data.toString('latin1');
  assert.ok(text.includes('JFIF'));
  for (const gone of ['GPS', 'Pixel', 'comment', 'hidden']) assert.ok(!text.includes(gone), `${gone} should be gone`);
  assert.deepEqual([...data.subarray(-2)], [0xff, 0xd9]);

  assert.throws(() => cleanJpeg(Buffer.from('<svg onload=alert(1)>'.padEnd(200))), /not a JPEG/);
  assert.throws(() => cleanJpeg(fakeJpeg({ width: 9000 })), /larger than/);
  assert.throws(() => cleanJpeg(fakeJpeg().subarray(0, 150)), /ends too soon|no picture/);
});

test('an errand is said once, to the people who will run it', () => {
  const errand = (content) => readAct(JSON.stringify({ action: 'errand', why: '', title: '', content, reply_to: [] }), []).content;
  assert.equal(errand('Send someone to bring a single photo of a leaf falling from a tree.'), 'Bring me a single photo of a leaf falling from a tree.');
  assert.equal(errand('Ask the people who visit to go and find me a photo of a red door. And then more.'), 'Bring me a photo of a red door.');
  assert.equal(errand('Bring me a photo of the sky.'), 'Bring me a photo of the sky.');
});
