// Shapes: what it builds stands in three dimensions, stacked out of a few solids it chooses itself.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FORM_SCHEMA, LOT, MAX_PARTS, TALL, formHeight, partialParts, readForm } from '../web/lib/form.js';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import * as mind from '../server/mind.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeLife(dir) {
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 3;
  cfg.courtesy.enabled = false;
  cfg.moderation.mode = 'off';
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new, born {{born}}.\n');
  return new Life({ config: cfg, store: createStore(dir), brain: createBrain(cfg.brain) });
}

const part = (over) => ({ shape: 'block', x: 0, z: 0, y: 0, w: 4, d: 4, h: 4, color: 'stone', glow: false, ...over });

test('a shape is held inside its lot: known solids and colours, no part outside, none twice, at most sixteen', () => {
  const f = readForm({
    parts: [
      part({ shape: 'spire', color: 'chartreuse' }),
      part({ x: 9, w: 6, y: 30, h: 40 }),
      part({ w: 0, d: -3, h: 2.6 }),
      part(),
      ...Array.from({ length: 30 }, (_, i) => part({ x: i % 7, z: Math.floor(i / 7), y: 4, h: 1 })),
    ],
  });
  assert.equal(f.parts[0].shape, 'block', 'an unknown shape is a block');
  assert.equal(f.parts[0].color, 'stone', 'an unknown colour is stone');
  for (const p of f.parts) {
    assert.ok(p.x >= 0 && p.x + p.w <= LOT && p.z >= 0 && p.z + p.d <= LOT, 'inside the lot');
    assert.ok(p.y >= 0 && p.y + p.h <= TALL, 'no taller than it may be');
    assert.ok(p.w >= 1 && p.d >= 1 && p.h >= 1 && Number.isInteger(p.h));
  }
  assert.equal(f.parts.length, MAX_PARTS);
  assert.equal(new Set(f.parts.map((p) => JSON.stringify(p))).size, f.parts.length, 'no part twice');
  assert.equal(readForm('not json'), null);
  assert.equal(readForm({ parts: [] }), null, 'nothing to stand');
  assert.ok(FORM_SCHEMA.properties.parts.items.required.includes('glow'));
});

test('a roof given too high comes down onto its walls; a window set into a wall and a floating lantern stay put', () => {
  const f = readForm({
    parts: [
      part({ w: 8, d: 8, h: 6 }),
      part({ shape: 'roof', w: 8, d: 8, y: 15, h: 4, color: 'slate' }),
      part({ x: 3, z: 7, y: 2, w: 2, d: 1, h: 2, color: 'glass' }),
      part({ shape: 'ball', x: 9, z: 9, y: 12, w: 1, d: 1, h: 1, color: 'gold', glow: true }),
    ],
  });
  const [walls, roof, window, lantern] = f.parts;
  assert.equal(roof.y, walls.y + walls.h, 'the roof sits on the walls');
  assert.equal(window.y, 2, 'the window stays in the wall');
  assert.equal(lantern.y, 12, 'the lantern floats');
  assert.equal(formHeight(f), 1.3, 'the lantern is its highest point');
});

test('while its answer is still arriving, the parts it has finished can already be shown', () => {
  const text = '{"parts":[{"shape":"cylinder","x":2,"z":2,"y":0,"w":6,"d":6,"h":3,"color":"stone","glow":false},{"shape":"roof","x":1,"z":1,"y":9,"w":8,"d":8,"h":';
  const got = partialParts(text);
  assert.equal(got.length, 1);
  assert.equal(got[0].shape, 'cylinder');
  assert.deepEqual(partialParts(''), []);
});

test('it builds things with a shape, sees which of its things have none yet, and gives one when it tends them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-form-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  for (let i = 0; i < 8 && !life.state.world.things.length; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const t = life.state.world.things[0];
  assert.ok(t, 'it built something');
  assert.ok(t.form?.parts.length >= 1, 'with a shape');
  assert.deepEqual(views.world(life).things[0].form, t.form, 'which the page is shown');

  // Something it built before shapes: only a drawing, which it is told, and which tending builds up.
  delete t.form;
  assert.match(mind.systemPrompt(life.state, life.cfg), new RegExp(`${t.name}.*It has no shape yet, only a drawing`));
  life.live = { title: '', change: '', sprite: '', form: '', building: null }; // as during a cycle
  const work = await life.tend({ action: 'tend', title: t.name, content: 'I go back to it.' }, 'system');
  assert.ok(work.form?.parts.length, 'tending a thing without a shape gives it one');
  life.tendThing(work, life.state.cycle + 1);
  assert.ok(t.form);
  assert.ok(life.state.milestones.some((m) => m.kind === 'first-shape'));
});

test('an older life is told once that its place has a third dimension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-form-old-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  life.state.abilities = ['world', 'wishes', 'errands'];
  life.state.world.things.push({ id: 't1', name: 'The Weeping Frame', kind: 'object', plaque: 'p', x: 8, y: 6, built: 1, tended: null, from: [], people: [], condition: 1, ruin: false, history: [] });
  life.saveState();
  const older = makeLife(dir);
  older.start();
  older.stop();
  const note = older.notes.find((n) => n.includes('third dimension'));
  assert.ok(note && note.includes('still only a drawing'));
  const later = makeLife(dir);
  later.start();
  later.stop();
  assert.ok(!later.notes.some((n) => n.includes('third dimension')), 'only once');
});
