// The atlas view over the recorded demo life: every thread and fate points at something real, and nothing private leaks.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

function demoAtlas() {
  const cfg = loadConfig(['--data', join(ROOT, 'examples', 'demo-life')]);
  const store = createStore(cfg.dataDir);
  const life = new Life({ config: cfg, store, brain: { label: 'recorded', kind: 'recorded' } });
  return { life, atlas: views.atlas(life, store) };
}

test('the atlas covers the whole life', () => {
  const { life, atlas } = demoAtlas();
  assert.equal(atlas.end, life.state.cycle);
  assert.equal(atlas.cycles.length, life.cycles.length);
  assert.equal(atlas.nights.length, life.nights.length);
  assert.equal(atlas.seed.length, life.state.self.seed.length);
  assert.equal(atlas.beliefs.length, life.state.self.own.length + life.state.self.gone.length);
  const shelved = Object.values(life.state.memory.shelves).flat().length;
  assert.equal(atlas.memories.length, shelved + life.state.memory.forgotten.length);
});

test('every thread and every fate points at something on the map', () => {
  const { atlas } = demoAtlas();
  const ids = new Set([...atlas.memories, ...atlas.beliefs, ...atlas.letters, ...atlas.things].map((x) => x.id).concat(['portrait', 'name']));
  assert.ok(atlas.threads.some((t) => t.kind === 'influence'), 'some letter changed something');
  assert.ok(atlas.threads.some((t) => t.kind === 'pushed'), 'some memory pushed another out');
  for (const t of atlas.threads) {
    assert.ok(ids.has(t.from), `thread from ${t.from}`);
    assert.ok(ids.has(t.to), `thread to ${t.to}`);
  }
  for (const s of atlas.sparks.filter((x) => x.fate === 'kept' || x.fate === 'merged')) assert.ok(ids.has(s.into), `spark into ${s.into}`);
  // A memory is shelved at a night, after it was noticed, and forgotten no earlier than it was shelved.
  const nights = new Set(atlas.nights.map((n) => n.cycle));
  for (const m of atlas.memories) {
    assert.ok(nights.has(m.kept) && m.kept >= m.born, `${m.id} shelved at a night`);
    if (m.gone != null) assert.ok(m.gone >= m.kept, `${m.id} forgotten after it was shelved`);
  }
  // Each wording of a belief follows the last.
  for (const b of atlas.beliefs) b.texts.forEach((x, i) => i && assert.equal(x.from, b.texts[i - 1].until));
});

test('the atlas never carries visitor keys', () => {
  const { life, atlas } = demoAtlas();
  const json = JSON.stringify(atlas);
  for (const l of life.letters) assert.ok(!json.includes(l.person), 'a visitor key leaked');
  assert.ok(atlas.people.every((p) => /^p\d+$/.test(p.id)));
});
