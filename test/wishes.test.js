// A wish for a photo goes out as an errand too, so anyone who visits can grant it; bringing the photo grants the wish.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { MAX_OPEN_ERRANDS, addErrand, cleanJpeg } from '../server/errands.js';
import { Life } from '../server/life.js';
import * as mind from '../server/mind.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';
import { photoWish } from '../server/world.js';
import { fakeJpeg } from './fixtures.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-wish-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

function makeLife() {
  const config = loadConfig(['--config', 'none.json', '--mock', '--data', join(root, `l${++n}`)]);
  config.courtesy.enabled = false;
  const seed = join(root, `seed${n}.md`);
  writeFileSync(seed, '# Seed\n- You are new.\n');
  config.seedFile = seed;
  const life = new Life({ config, store: createStore(join(root, `l${n}`)), brain: createBrain(config.brain) });
  life.birth();
  return life;
}

const wish = (id, text, cycle = 1) => ({ id, text, why: 'I cannot see.', version: 1, cycle, at: new Date().toISOString(), status: 'open', answer: null });

test('a wish for a photo is said as an errand; any other wish is not', () => {
  assert.equal(photoWish('Please bring me a photo of rain on a window pane, so I can see it.'), 'Bring me a photo of rain on a window pane, so I can see it.');
  assert.equal(photoWish('Could you show me a picture of the sea?'), 'Show me a picture of the sea.');
  assert.equal(photoWish('I would like a new sense, like hearing.'), null);
});

test('its photo wishes go out as errands into the room it has, never pushing out its own', async () => {
  const life = makeLife();
  const s = life.state;
  const own = addErrand(s.errands, { text: 'Bring me a photo of one leaf.', cycle: 1, version: 0, at: new Date().toISOString() });
  s.wishes.push(wish('w1', 'Please bring me a photo of a stone that has been in water.'), wish('w2', 'I would like to hear a sound.'), wish('w3', 'Please bring me a photo of the sky above you right now.'), wish('w4', 'Please bring me a photo of a leaf.'), wish('w5', 'Please bring me a photo of a door that is half open.'));
  await life.wishErrands();
  assert.equal(own.status, 'open', 'its own errand stays out');
  assert.equal(s.wishes.find((w) => w.id === 'w4').errand, own.id, 'a wish like an errand it has out is joined to that one');
  assert.equal(s.wishes.find((w) => w.id === 'w2').errand, undefined, 'a wish for something else stays with its keeper');
  const out = s.errands.filter((e) => e.status === 'open');
  assert.equal(out.length, MAX_OPEN_ERRANDS);
  assert.deepEqual(out.map((e) => e.wish), ['w4', 'w5', 'w3'], 'its own errand now grants w4 too; the newest others go out into the room it had');
  assert.equal(s.wishes.find((w) => w.id === 'w1').errand, undefined, 'no room left for the oldest');
  const shown = life.publicState().wishes.find((w) => w.id === 'w5');
  assert.equal(shown.errand.status, 'open');
  assert.match(mind.systemPrompt(s, life.cfg), /out as an errand too/);
});

test('bringing the photo for a wish grants the wish, and it hears who did', async () => {
  const life = makeLife();
  const s = life.state;
  s.wishes.push(wish('w1', 'Please bring me a photo of a leaf.'));
  await life.wishErrands();
  const e = s.errands.find((x) => x.wish === 'w1');
  assert.ok(e && e.status === 'open');
  assert.equal(views.errands(life)[0].wish, 'Please bring me a photo of a leaf.');
  const r = life.addReturn({ errand: e.id, from: 'Wren', text: 'From the park.', person: 'v9', photo: cleanJpeg(fakeJpeg()).data });
  assert.ok(life.decide(r.letter.id, 'allow').ok);
  for (let i = 0; i < 3 && e.status !== 'filled'; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const w = s.wishes[0];
  assert.equal(e.status, 'filled');
  assert.equal(w.status, 'granted');
  assert.deepEqual([w.answer.by, w.answer.from], ['people', 'Wren']);
  assert.equal(views.world(life).wishes[0].answer.from, 'Wren');
  assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.ok(w.answer.told, 'it was told its wish came true');
});
