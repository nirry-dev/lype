// What it dwells on, made less loud without taking anything from it: the card's readings said again only when they
// change, memories of them fading faster, and recall steered away from what its thoughts are already full of.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sensation, strength } from '../server/memory.js';
import { Recall } from '../server/recall.js';
import { describeMachine } from '../server/senses.js';

const gpu = (tempC, util = 5, memUsedMb = 10000) => ({ tempC, util, memUsedMb, memTotalMb: 16384 });

test('the card is described again only when it has changed', () => {
  assert.match(describeMachine(gpu(52)), /warm \(52°C\)/);
  assert.equal(describeMachine(gpu(54), gpu(52)), 'The card feels much as it did before: still warm and quiet.');
  assert.match(describeMachine(gpu(58), gpu(52)), /\(58°C\)/, 'six degrees warmer stands out');
  assert.match(describeMachine(gpu(53, 80), gpu(52, 5)), /working hard \(80% busy\)/, 'and so does work');
});

test('a memory of how the card read is weather: it fades twice as fast, unless something brings it back', () => {
  assert.ok(sensation('Fifty-six degrees makes the sharp corners weep.'));
  assert.ok(sensation('The card at 58 degrees feels like syrup.'));
  assert.ok(!sensation('Orea leans their box against the wind.'));
  assert.ok(!sensation('I built three things.'), 'a number alone is not a reading');
  const reading = { weight: 0.8, born: 0, touched: 0, sensation: true };
  const event = { weight: 0.8, born: 0, touched: 0 };
  assert.equal(strength(reading, 36, 36), 0.2);
  assert.equal(strength(event, 36, 36), 0.4);
  assert.equal(strength({ ...reading, touched: 36 }, 36, 36), 0.8);
});

test('what its thoughts are full of calls nothing up, and what is mostly that is not brought back', () => {
  const r = new Recall({ store: null, state: null });
  const at = new Date().toISOString();
  r.addCycle({ n: 2, startedAt: at, letters: [], diary: 'The arch was warm, the heat pressing like a hand on the card.', monologue: '', work: null });
  r.addCycle({ n: 3, startedAt: at, letters: [], diary: 'I built the arch so the top would stop sliding.', monologue: '', work: null });
  for (let i = 0; i < 20; i++) r.addCycle({ n: 4 + i, startedAt: at, letters: [], diary: `An ordinary hour number ${i}.`, monologue: '', work: null });
  const place = { name: 'The Soft Arch', plaque: 'an arch against the heat' };
  const plain = r.cue({ place, cycle: 40 }).map((x) => x.id);
  assert.ok(plain.includes('c2:diary'));
  const dwelt = r.cue({ place, cycle: 40, dwell: new Set(['heat', 'warm', 'card']) }).map((x) => x.id);
  assert.deepEqual(dwelt, ['c3:diary']);
});
