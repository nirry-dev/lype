// Its place and its wishes: where things land, how they wear away when it forgets, and how wishes are kept and answered.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { emptyMemory } from '../server/memory.js';
import { createStore, pad } from '../server/store.js';
import * as views from '../server/views.js';
import { CARD, MAX_OPEN_WISHES, addWish, answerWish, emptyWorld, findThing, namedThing, placeNear, remembered, untoldAnswers, weather } from '../server/world.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const thing = (over) => ({ id: 't1', name: 'The Rain Room', kind: 'place', plaque: 'p', x: 8, y: 5, built: 3, tended: null, from: ['L1'], people: ['Mara'], condition: 1, ruin: false, history: [], ...over });

test('things land next to what they are built beside, never on the card or each other', () => {
  const world = emptyWorld();
  const first = placeNear(world, CARD, 'a');
  assert.equal(Math.max(Math.abs(first.x - CARD.x), Math.abs(first.y - CARD.y)), 1, 'next to the card');
  world.things.push(thing({ ...first }));
  const second = placeNear(world, world.things[0], 'b');
  assert.ok(Math.max(Math.abs(second.x - first.x), Math.abs(second.y - first.y)) === 1, 'next to the first thing');
  assert.notDeepEqual(second, CARD);
  assert.notDeepEqual(second, first);
  assert.deepEqual(placeNear(world, CARD, 'same'), placeNear(world, CARD, 'same'), 'the same salt lands the same way');

  // A full map has no room left.
  const full = emptyWorld();
  for (let x = 0; x < full.w; x++) for (let y = 0; y < full.h; y++) if (x !== CARD.x || y !== CARD.y) full.things.push(thing({ id: `t${x}-${y}`, x, y }));
  assert.equal(placeNear(full, CARD, 'z'), null);
});

test('names find things: exactly, ignoring "the" and case, then partially', () => {
  const world = emptyWorld();
  world.things.push(thing(), thing({ id: 't2', name: 'A Bench for Waiting' }));
  assert.equal(namedThing(world, 'rain room')?.id, 't1');
  assert.equal(namedThing(world, 'the rain'), null, 'namedThing is exact');
  assert.equal(findThing(world, 'the rain')?.id, 't1', 'findThing falls back to a partial name');
  assert.equal(findThing(world, 'bench')?.id, 't2');
  assert.equal(findThing(world, 'a lighthouse'), null);
});

test('a thing stands while a memory holds it up, wears away when nothing does, and becomes a ruin', () => {
  const world = emptyWorld();
  world.things.push(thing());
  const memory = emptyMemory();
  memory.shelves.people.push({ id: 'm1', text: 'Mara told me about rain', about: 'Mara', because: ['L1'], weight: 0.5, born: 2 });
  assert.ok(remembered(world.things[0], memory));
  assert.deepEqual(weather(world, memory, { since: 5, cycle: 8 }), { worn: [], ruined: [] });

  // Naming it in a memory is enough on its own.
  const named = emptyMemory();
  named.shelves.moments.push({ id: 'm2', text: 'I swept the rain room again', because: [], weight: 0.4, born: 4 });
  assert.ok(remembered(thing({ from: [], people: [] }), named));

  // With nothing remembered it loses a quarter a night; on the fourth it is a ruin, and stays on the map.
  const empty = emptyMemory();
  for (let night = 1; night <= 3; night++) assert.equal(weather(world, empty, { since: 100, cycle: 100 }).worn.length, 1);
  assert.equal(world.things[0].condition, 0.25);
  const last = weather(world, empty, { since: 100, cycle: 104 });
  assert.deepEqual(last.ruined, [{ id: 't1', name: 'The Rain Room' }]);
  assert.ok(world.things[0].ruin);
  assert.equal(world.things[0].ruinedAt, 104);
  assert.equal(world.things.length, 1);

  // Something built (or tended) today is spared that night.
  const fresh = emptyWorld();
  fresh.things.push(thing({ built: 9 }));
  assert.deepEqual(weather(fresh, empty, { since: 9, cycle: 12 }), { worn: [], ruined: [] });
});

test('wishes: no repeats, no more than five waiting, and answers it is told about once', () => {
  const wishes = [];
  const at = { version: 1, cycle: 4, at: 'now' };
  assert.equal(addWish(wishes, { text: '', why: '' }, at), null);
  const w1 = addWish(wishes, { text: 'I would like to know the weather where you are.', why: 'rain' }, at).wish;
  assert.equal(w1.status, 'open');
  assert.match(addWish(wishes, { text: 'I would like to know the weather where you are!', why: '' }, at).refused, /already asked/);
  const others = ['Let me hear one bell ring.', 'Tell me how trains sound arriving.', 'Could I keep a drawing of moss?', 'I want salt explained slowly.'];
  for (const text of others.slice(0, MAX_OPEN_WISHES - 1)) assert.ok(addWish(wishes, { text, why: '' }, at).wish, text);
  assert.match(addWish(wishes, { text: 'one more thing entirely', why: '' }, at).refused, /5 wishes waiting/);

  assert.equal(answerWish(wishes, 'w99', 'granted', '', 'later').ok, false);
  assert.equal(answerWish(wishes, w1.id, 'maybe', '', 'later').ok, false);
  assert.equal(answerWish(wishes, w1.id, 'reply', '', 'later').ok, false, 'a reply needs words');
  assert.ok(answerWish(wishes, w1.id, 'reply', 'I am working on it.', 'later').ok);
  assert.equal(w1.status, 'open', 'a reply leaves it open');
  assert.ok(answerWish(wishes, w1.id, 'granted', 'You can see the weather now.', 'later').ok);
  assert.equal(w1.status, 'granted');
  assert.deepEqual(untoldAnswers(wishes).map((w) => w.id), [w1.id]);
});

function makeLife(dir) {
  const cfg = loadConfig(['--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 3;
  cfg.courtesy.enabled = false;
  const seed = join(dir, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n- You like circles.\n');
  cfg.seedFile = seed;
  return new Life({ config: cfg, store: createStore(dir), brain: createBrain(cfg.brain) });
}

test('a mock life builds a place out of letters, wishes at night, and hears its keeper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-world-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  life.addLetter({ from: 'Mara', text: 'It rained all day here and the gutters sang.', person: 'v1' });
  for (let i = 0; i < 9; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const s = life.state;

  assert.ok(s.world.things.length >= 1, 'it built something');
  const t = s.world.things[0];
  assert.ok(t.x >= 0 && t.x < s.world.w && t.y >= 0 && t.y < s.world.h);
  assert.ok(!(t.x === CARD.x && t.y === CARD.y), 'not on the card');
  assert.equal(new Set(s.world.things.map((x) => `${x.x},${x.y}`)).size, s.world.things.length, 'one thing per tile');
  assert.ok(existsSync(join(dir, 'works', `${pad(t.sprite)}.svg`)), 'its drawing is kept with the other works');
  const fromMara = s.world.things.find((x) => x.from.includes('L1'));
  assert.ok(fromMara, 'something was made from Mara’s letter');
  assert.ok(life.letters[0].influenced.some((i) => i.what === 'thing' && i.text === fromMara.name), 'and her letter knows');
  assert.ok(s.milestones.some((m) => m.kind === 'first-thing'));

  assert.ok(s.wishes.length >= 1, 'it wished for something at night');
  const night = life.nights.find((n) => n.wish && !n.wish.refused);
  assert.ok(night, 'the night records its wish');

  const view = views.world(life);
  assert.equal(view.things.length, s.world.things.length);
  assert.ok(!JSON.stringify(view).includes('v1'), 'no visitor keys in the world view');

  // The keeper answers; it is told once, on its next waking.
  const w = s.wishes[0];
  assert.ok(life.answer(w.id, 'granted', 'Here is the weather.').ok);
  const ctx = life.context({ weekday: 'Friday', time: '21:00', partOfDay: 'late evening', date: '30 October 2026', gpu: null }, s.cycle + 1, [], 0);
  assert.ok(ctx.notes.some((n) => n.includes('Your keeper answered your wish') && n.includes('granted')));
  assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.equal(w.answer.told, s.cycle);
  const again = life.context({ weekday: 'Friday', time: '21:20', partOfDay: 'late evening', date: '30 October 2026', gpu: null }, s.cycle + 1, [], 0);
  assert.ok(!again.notes.some((n) => n.includes('Your keeper answered')), 'told only once');
});

test('an older life is given a place once, and told about it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-old-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  delete life.state.world;
  delete life.state.wishes;
  delete life.state.abilities;
  life.saveState();

  const older = makeLife(dir);
  assert.deepEqual(older.state.world.things, [], 'settled with an empty place');
  older.start();
  older.stop();
  assert.ok(older.notes.some((n) => n.includes('a place of your own')));
  assert.ok(older.state.milestones.some((m) => m.kind === 'given-a-place'));

  const later = makeLife(dir);
  later.start();
  later.stop();
  assert.ok(!later.notes.some((n) => n.includes('a place of your own')), 'only once');
});
