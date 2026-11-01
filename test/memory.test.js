import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consolidate, emptyMemory, reinforce, similarity, strength } from '../server/memory.js';

const cfg = { shelfSize: 2, halfLifeCycles: 10 };

test('weight halves every half-life unless touched', () => {
  const m = { weight: 0.8, born: 0, touched: 0 };
  assert.equal(strength(m, 10, 10), 0.4);
  assert.equal(strength(m, 20, 10), 0.2);
});

test('a full shelf admits a candidate only if it beats the weakest, and the loser is forgotten', () => {
  const mem = emptyMemory();
  mem.today = [
    { shelf: 'world', text: 'rain sounds like gravel', weight: 0.9, cycle: 1, because: ['L1'] },
    { shelf: 'world', text: 'the sea is salty', weight: 0.3, cycle: 1, because: ['L1'] },
  ];
  consolidate(mem, 1, cfg);
  assert.equal(mem.shelves.world.length, 2);

  // 20 cycles later the weak one has decayed to 0.3 * 0.25 (still above the fade line); a 0.5 newcomer pushes it out.
  mem.today = [{ shelf: 'world', text: 'trains hum before they arrive', weight: 0.5, cycle: 21, because: ['L2'] }];
  const night = consolidate(mem, 21, cfg);
  assert.deepEqual(night.forgotten.map((m) => m.text), ['the sea is salty']);
  assert.equal(night.forgotten[0].how, 'pushed out');
  assert.ok(mem.shelves.world.some((m) => m.text.startsWith('trains')));

  // A candidate weaker than everything already held never gets in.
  mem.today = [{ shelf: 'world', text: 'a faint unimportant thing', weight: 0.01, cycle: 21, because: ['L3'] }];
  assert.equal(consolidate(mem, 21, cfg).lost.length, 1);
});

test('near-duplicates reinforce instead of taking a new slot', () => {
  const mem = emptyMemory();
  mem.today = [{ shelf: 'people', text: 'Mara told me rain sounds like gravel', weight: 0.5, cycle: 1 }];
  consolidate(mem, 1, cfg);
  mem.today = [{ shelf: 'people', text: 'Mara told me that rain sounds like gravel falling', weight: 0.4, cycle: 5 }];
  const night = consolidate(mem, 5, cfg);
  assert.equal(night.merged.length, 1);
  assert.equal(mem.shelves.people.length, 1);
  assert.equal(mem.shelves.people[0].touched, 5);
});

test('memories that decay to almost nothing fade on their own', () => {
  const mem = emptyMemory();
  mem.today = [{ shelf: 'moments', text: 'I drew a crooked square', weight: 0.2, cycle: 1 }];
  consolidate(mem, 1, cfg);
  mem.today = [];
  const night = consolidate(mem, 60, cfg); // 0.2 * 0.5^5.9 < 0.05
  assert.equal(night.faded.length, 1);
  assert.equal(mem.forgotten.at(-1).how, 'faded');
});

test('reinforcing refreshes and strengthens', () => {
  const mem = emptyMemory();
  mem.today = [{ shelf: 'moments', text: 'someone wrote twice', weight: 0.5, cycle: 1 }];
  consolidate(mem, 1, cfg);
  const id = mem.shelves.moments[0].id;
  assert.deepEqual(reinforce(mem, [id, 'm999'], 7), [id]);
  assert.equal(mem.shelves.moments[0].weight, 0.65);
  assert.equal(mem.shelves.moments[0].touched, 7);
});

test('similarity ignores filler words', () => {
  assert.ok(similarity('I like the rain', 'rain, I like it') > 0.9);
  assert.equal(similarity('the of and', 'a an the'), 0);
});
