// Shapes: what it builds stands in three dimensions, stacked out of a few solids it chooses itself.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FORM_SCHEMA, LOT, MAX_BORROWED, MAX_PARTS, TALL, formHeight, formSchema, partialParts, readForm, standing } from '../web/lib/form.js';
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
      ...Array.from({ length: 30 }, (_, i) => part({ x: i % 10, z: 5 + Math.floor(i / 10), y: 4, w: 1, d: 1, h: 1 })),
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

test('its parts are solid: what runs into another moves to the nearest place it fits, or is left out; a window, a door and a chimney stay set in', () => {
  const f = readForm({
    parts: [
      part({ w: 10, d: 10, h: 6, color: 'stone' }),
      part({ x: 3, z: 3, y: 4, w: 4, d: 4, h: 1, color: 'paper' }), // a box given inside the walls
      part({ shape: 'roof', y: 6, w: 10, d: 10, h: 3, color: 'slate' }),
      part({ x: 4, z: 9, y: 0, w: 2, d: 1, h: 3, color: 'wood' }), // a door set into the front
      part({ x: 0, z: 4, y: 3, w: 1, d: 2, h: 1, color: 'glass', glow: true }), // a window set into the side
      part({ shape: 'cylinder', x: 7, z: 2, y: 7, w: 1, d: 1, h: 4, color: 'brick' }), // a chimney up through the roof
    ],
  });
  const [walls, box, roof, door, window, chimney] = f.parts;
  assert.equal(f.solid, true);
  assert.equal(box.y, roof.y + roof.h, 'the box goes on top of the roof, not inside the walls');
  assert.equal(roof.y, walls.y + walls.h);
  assert.deepEqual([door.y, window.y, chimney.y], [0, 3, 7], 'set in where they were put');
  const setIn = [door, window, chimney];
  for (const p of f.parts)
    for (const q of f.parts)
      if (p !== q && p.x < q.x + q.w && q.x < p.x + p.w && p.z < q.z + q.d && q.z < p.z + p.d && p.y < q.y + q.h && q.y < p.y + p.h)
        assert.ok(setIn.includes(p) || setIn.includes(q), `${p.color} and ${q.color} share no space`);

  const full = readForm({ parts: [part({ w: 10, d: 10, h: TALL }), part({ shape: 'ball', x: 3, z: 3, y: 5, w: 2, d: 2, h: 2, color: 'gold' })] });
  assert.equal(full.parts.length, 1, 'a ball given inside something filling its lot, with no room above, is left out');
  const wide = readForm({
    parts: [part({ w: 10, d: 10, h: 20 }), part({ x: 2, z: 2, y: 20, w: 6, d: 6, h: 4, glow: true }), part({ shape: 'pyramid', y: 20, w: 10, d: 10, h: 4 })],
  });
  assert.deepEqual(wide.parts.map((p) => p.shape), ['block', 'pyramid'], 'where two start at the same height, the bigger stands');

  const posts = readForm({ parts: [part({ w: 2, d: 2, h: 5 }), part({ x: 1, w: 2, d: 2, h: 5, color: 'wood' })] });
  assert.equal(posts.parts[1].x, 2, 'a post given half inside another stands beside it');
  assert.equal(posts.parts[1].y, 0);

  // a lantern given by the door, half in the wall: up onto the step and along the wall, its space narrowed at the lot's edge
  const lamp = readForm({ parts: [part({ x: 1, z: 1, w: 8, d: 8, h: 1 }), part({ x: 2, z: 2, y: 1, w: 6, d: 6, h: 6 }), { ...part({ shape: 'model', x: 7, z: 7, w: 3, d: 3 }), model: 'lantern' }] });
  const { x, z, y, w, d } = lamp.parts[2];
  assert.deepEqual({ x, z, y, w, d }, { x: 8, z: 7, y: 1, w: 2, d: 3 });

  const before = { parts: [part({ w: 8, d: 8, h: 2 }), part({ x: 2, z: 2, y: 0, w: 2, d: 2, h: 1, color: 'gold' })] };
  const now = standing(before);
  assert.equal(now.parts[1].y, 2, 'a shape kept from before stands up when it is reshaped');
  assert.equal(before.parts[1].y, 0, 'and is left as it was built');
  assert.equal(standing(now), now);
});

test('it builds with more than boxes: ready-made pieces, patterns, turned parts and shapes from its own points', () => {
  const f = readForm({
    parts: [
      part({ shape: 'tree', x: 0, z: 0, w: 4, d: 4, h: 8, color: 'leaf' }),
      part({ shape: 'column', x: 0, z: 6, w: 1, d: 1, h: 4, pattern: 'row', repeat: 4, dx: 2, dz: 0 }),
      part({ shape: 'block', x: 6, z: 0, w: 3, d: 1, h: 2, turn: 45 }),
      part({ shape: 'outline', x: 5, z: 3, w: 4, d: 2, h: 1, points: [0, 0, 10, 0, 5, 10] }),
      part({ shape: 'lathe', x: 8, z: 8, w: 2, d: 2, h: 3, points: [3, 0, 5, 4, 2, 10] }),
      part({ shape: 'outline', x: 0, z: 0, w: 2, d: 2, h: 1, y: 20, points: [1, 2] }), // too few points: a block
      part({ shape: 'window', x: 3, z: 0, w: 2, d: 1, h: 3, y: 10 }),
    ],
  });
  const shapes = f.parts.map((p) => p.shape);
  assert.deepEqual(shapes.slice(0, 2), ['cylinder', 'ball'], 'a tree is a trunk and a crown');
  assert.equal(f.parts[0].color, 'bark');
  assert.equal(shapes.filter((x) => x === 'cylinder').length, 1 + 4, 'four columns in a row, each a shaft');
  const cols = f.parts.filter((p) => p.shape === 'cylinder' && p.z > 5).map((p) => p.x);
  assert.deepEqual(cols, [0.2, 2.2, 4.2, 6.2], 'two steps apart');
  assert.ok(f.parts.some((p) => p.turn === 45), 'turned as it said');
  assert.deepEqual(f.parts.find((p) => p.shape === 'outline').points, [0, 0, 10, 0, 5, 10]);
  assert.ok(f.parts.find((p) => p.shape === 'lathe').points.length === 6);
  const pane = f.parts.find((p) => p.color === 'glass');
  assert.ok(pane && pane.glow && pane.d === 1, 'a window is a wall with a pane set into it');
  for (const p of f.parts) assert.ok(!('pattern' in p) && !('repeat' in p), 'patterns are laid out, not kept');

  const ring = readForm({ parts: [part({ shape: 'lamp', x: 0, z: 4, w: 2, d: 2, h: 4, pattern: 'ring', repeat: 4 })] });
  assert.equal(ring.parts.filter((p) => p.glow).length, 4, 'four lamps round the middle');
  const mirrored = readForm({ parts: [part({ x: 0, z: 0, w: 2, d: 2, h: 2, pattern: 'mirror' })] });
  assert.deepEqual(mirrored.parts.map((p) => p.x), [0, 8]);
  const off = readForm({ parts: [part({ x: 6, w: 2, d: 2, h: 1, pattern: 'row', repeat: 5, dx: 2 })] });
  assert.equal(off.parts.length, 2, 'copies that would leave the lot are left out');

  // a turned part takes the room its turned footprint needs
  const tw = readForm({ parts: [part({ x: 3, z: 3, w: 4, d: 4, h: 2 }), part({ x: 3, z: 3, w: 4, d: 1, h: 2, turn: 45, color: 'wood' })] });
  assert.ok(tw.parts[1].y >= 2 || tw.parts[1].x !== 3 || tw.parts[1].z !== 3, 'it does not pass through what stands there');
  assert.equal(tw.parts[1].turn, 45);
  assert.ok(FORM_SCHEMA.properties.parts.items.properties.shape.enum.includes('tree'));
  assert.ok(!FORM_SCHEMA.properties.parts.items.required.includes('turn'), 'what it does not use, it need not write');
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

test('it is offered ready-made things whose names touch what it builds and thinks, and borrows only those, six at most', async () => {
  const { loadCatalogue, shortlist, borrowed } = await import('../server/models.js');
  const cat = loadCatalogue();
  assert.ok(cat.models.length > 500, 'the catalogue is built');
  assert.ok(cat.credit.includes('CC0'));
  const names = shortlist(cat, { about: 'A lantern for the bench by the well', thoughts: 'I remember the snow and a pumpkin.' });
  assert.ok(names.some((n) => n.startsWith('lantern')) && names.some((n) => n.startsWith('bench')), names.join(', '));
  assert.ok(names.length <= 16 && names.length >= 8);
  assert.ok(shortlist(cat, { about: 'zzzz qqqq' }).length >= 1, 'with nothing matching, plain things are offered');

  const lantern = names.find((n) => n.startsWith('lantern'));
  const offered = new Set(names);
  const model = (n) => (offered.has(n) ? cat.byName.get(n)?.id : null) || null;
  const f = readForm(
    {
      parts: [
        part(),
        { ...part({ shape: 'model', x: 6, w: 3, h: 6 }), model: lantern },
        { ...part({ shape: 'model' }), model: 'a spaceship it was never shown' },
        ...Array.from({ length: 10 }, (_, i) => ({ ...part({ shape: 'model', x: i, z: 9, w: 1, d: 1, h: 2 }), model: lantern })),
      ],
    },
    { model },
  );
  const lent = f.parts.filter((p) => p.shape === 'model');
  assert.equal(lent.length, MAX_BORROWED, 'six borrowed things at most');
  assert.ok(lent.every((p) => cat.byId.has(p.model)), 'kept by id');
  assert.deepEqual(borrowed(cat, f), [lantern]);
  assert.ok(formSchema(names).properties.parts.items.properties.model.enum.includes('none'));
  assert.ok(!FORM_SCHEMA.properties.parts.items.properties.model, 'nothing offered, nothing to borrow');
});

test('a mock life borrows what it is offered, its page names it, and an export carries the model', async () => {
  const { exportLife } = await import('../server/export.js');
  const dir = mkdtempSync(join(tmpdir(), 'iterant-borrow-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  for (let i = 0; i < 8 && !life.state.world.things.length; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const t = life.state.world.things[0];
  const lent = t.form.parts.find((p) => p.shape === 'model');
  assert.ok(lent, 'it borrowed something');
  const view = views.world(life).things[0];
  assert.equal(view.borrowed.length, 1);
  assert.match(views.world(life).credit, /Kenney/);

  // Reshaping keeps what it borrowed on offer under its name.
  life.live = { title: '', change: '', sprite: '', form: '', building: null, think: '' };
  const again = await life.shape('system', t.name, 'I add to it.', { kind: t.kind, before: t.form });
  assert.ok(again.parts.some((p) => p.model === lent.model), 'still borrowed after reshaping');

  const out = join(dir, 'site');
  exportLife({ ...life.cfg }, out, { allModels: false });
  assert.ok(existsSync(join(out, 'models', `${lent.model}.bin`)), 'its model is published with it');
  assert.ok(existsSync(join(out, 'models', 'catalogue.json')));
});

test('on its first night it chooses the body it is seen by, once, says why, and the night is sealed with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-body-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  assert.equal(life.publicState().body, null, 'only a light at first');
  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok); // three cycles: its first night
  clearTimeout(life.timer);
  const night = life.nights.at(-1);
  assert.ok(night?.body?.form?.parts.length, 'the night records its body');
  assert.ok(night.body.why.length > 10);
  const body = life.publicState().body;
  assert.deepEqual(body.form, night.body.form);
  assert.equal(body.version, night.n);
  assert.ok(life.state.milestones.some((m) => m.kind === 'embodied'));

  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok); // its next night: chosen once, it stays
  clearTimeout(life.timer);
  assert.ok(!life.nights.at(-1).body, 'not chosen again');
  assert.deepEqual(life.publicState().body.form, body.form);
});

test('an older life is told its next night is when it chooses how it is seen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-body-old-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  life.state.abilities = ['world', 'wishes', 'errands', 'shapes'];
  life.saveState();
  const older = makeLife(dir);
  older.start();
  older.stop();
  assert.ok(older.notes.some((n) => n.includes('choose how you appear')));
  assert.ok(older.state.abilities.includes('body'));
});

test('a life from before the new solids and the maker is told of them once, when it wakes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-tools-old-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  assert.ok(life.state.abilities.includes('more-shapes'), 'born knowing');
  assert.ok(!life.state.abilities.includes('making'), 'no maker here');
  life.state.abilities = ['world', 'wishes', 'errands', 'shapes', 'body'];
  life.saveState();
  const older = makeLife(dir);
  Object.defineProperty(older.maker, 'enabled', { value: true });
  older.start();
  older.stop();
  const told = older.notes.filter((n) => n.includes('more to build with'));
  assert.equal(told.length, 1);
  assert.match(told[0], /made from your words/);
  assert.ok(older.state.abilities.includes('more-shapes') && older.state.abilities.includes('making'));
  const again = makeLife(dir);
  Object.defineProperty(again.maker, 'enabled', { value: true });
  again.start();
  again.stop();
  assert.ok(!again.notes.some((n) => n.includes('more to build with')), 'told once');
});

test('with the meaning model, what is close in meaning is offered too, put in among what matches by words', async () => {
  const { loadCatalogue, offer, aroundOffer, furnishings, docOf } = await import('../server/models.js');
  const cat = loadCatalogue();
  // a stand-in for the meaning model: stones and curved fences are close to an arch, everything else is the crowd
  const close = (doc) => (/^(rock|stone|fence curved)/.test(doc) ? 0.6 : 0.45 + (doc.length % 7) / 200);
  const meaning = { up: true, ensure: async () => true, closeness: (q, d) => close(d) };
  const names = await offer(cat, meaning, { about: 'The Soft Arch: a small arch to rest on', thoughts: '' });
  assert.ok(names.length <= 16 && names.length >= 8);
  assert.ok(names.some((n) => /^(rock|stone)/.test(n)), names.join(', '));
  assert.ok(names.some((n) => n.startsWith('arch')) || names.some((n) => /fence curved/.test(n)));
  // off: words alone, as before
  assert.deepEqual(await offer(cat, null, { about: 'zzzz qqqq' }), (await import('../server/models.js')).shortlist(cat, { about: 'zzzz qqqq' }));

  // what it can set down: small, outdoors, never a train or a slice of bacon
  const pool = furnishings(cat);
  assert.ok(pool.length > 100);
  assert.ok(pool.every((m) => !/^(food|trains|harbour|space|holiday)\//.test(m.id) && Math.max(...m.dims) <= 1.8));
  const near = await aroundOffer(cat, meaning, 'The Soft Arch', { salt: '3' });
  assert.equal(near.length, 8);
  assert.ok(near.some((n) => /^(rock|stone|fence curved)/.test(n)));
  assert.ok(near.every((n) => pool.some((m) => m.name === n)));
  assert.match(docOf(cat, cat.byName.get('bench (graveyard)')), /^bench \(graveyard\): graveyard, graveyard, grave/);
});

test('a body can have the parts of a creature, which hold on where they are set and are known to the page by role', async () => {
  const { readForm: read, formSchema: schemaOf, FEATURES } = await import('../web/lib/form.js');
  assert.ok(schemaOf([], { body: true }).properties.parts.items.properties.shape.enum.includes('eye'));
  assert.ok(!schemaOf([]).properties.parts.items.properties.shape.enum.includes('eye'), 'not offered for what it builds');
  const f = read({
    parts: [
      { shape: 'ball', x: 1, z: 1, y: 0, w: 8, d: 8, h: 8, color: 'gold', glow: false },
      { shape: 'eye', x: 2, z: 7, y: 4, w: 2, d: 2, h: 2, color: 'stone', glow: false, pattern: 'mirror' },
      { shape: 'beak', x: 4, z: 8, y: 3, w: 2, d: 2, h: 2, color: 'stone', glow: false },
      { shape: 'wing', x: 0, z: 3, y: 2, w: 1, d: 4, h: 3, color: 'sand', glow: false, pattern: 'mirror' },
    ],
  });
  const eyes = f.parts.filter((p) => p.role === 'eye');
  assert.equal(eyes.length, 6, 'two eyes, each a white, a pupil and a glint');
  assert.ok(eyes.every((p) => p.z >= 7 && p.y >= 4), 'set into the head, where it was put, not pushed out of it');
  assert.ok(eyes.some((p) => p.color === 'night'), 'a dark pupil when no colour was given');
  assert.equal(f.parts.filter((p) => p.role === 'beak')[0].color, 'gold');
  assert.equal(f.parts.filter((p) => p.role === 'wing').length, 2);
  assert.deepEqual(FEATURES, ['eye', 'beak', 'wing', 'foot', 'ear', 'tail']);
});

test('its keeper can ask, once, in their own words, whether it wants to choose again how it is seen; it decides at night', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-body-ask-'));
  dirs.push(dir);
  const life = makeLife(dir);
  life.birth();
  assert.equal(life.askAboutBody('Would you like to look like a small animal?').ok, false, 'not before it has a body');
  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  const first = structuredClone(life.state.body);
  assert.equal(life.askAboutBody('hm').ok, false, 'in a sentence');
  const asked = life.askAboutBody('People feel closer to a small creature they can recognise. Would you like to choose again how you look?');
  assert.ok(asked.ok);
  assert.equal(life.askAboutBody('And another thing, while you think about it.').ok, false, 'one at a time');
  assert.ok(life.notes.some((n) => n.includes('small creature they can recognise')));
  assert.ok(life.journal.some((j) => j.kind === 'ask' && j.text.includes('small creature')), 'in its public journal');

  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok); // its next night: it chooses again
  clearTimeout(life.timer);
  const night = life.nights.at(-1);
  assert.equal(night.body.kept, false);
  assert.match(night.body.asked, /small creature/);
  assert.ok(life.publicState().body.form.parts.some((p) => p.role === 'eye'), 'a bird, with eyes');
  assert.deepEqual(life.state.bodies.at(-1).form, first.form, 'the body it had is kept in its history');
  assert.ok(life.state.milestones.some((m) => m.kind === 're-embodied'));

  // asked again, it may keep what it has
  assert.ok(life.askAboutBody('KEEPME: is this still how you want to look?').ok);
  const now = structuredClone(life.state.body);
  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.equal(life.nights.at(-1).body.kept, true);
  assert.deepEqual(life.state.body, now, 'kept as it was');
  assert.ok(life.journal.some((j) => j.kind === 'body' && j.text.includes('kept its body')));
  for (let i = 0; i < 3; i++) assert.ok((await life.wake('test')).ok); // no ask, no choosing
  clearTimeout(life.timer);
  assert.ok(!life.nights.at(-1).body);
});
