// Things made from its words: asked for in a shape, made between cycles by scripts/make.py (here, a stand-in that
// writes a tiny mesh), and shown where it put them.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MAX_MADE, formSchema, readForm } from '../web/lib/form.js';
import { Maker } from '../server/maker.js';
import { createStore } from '../server/store.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const part = (over) => ({ shape: 'block', x: 0, z: 0, y: 0, w: 2, d: 2, h: 2, color: 'stone', glow: false, ...over });

/** A maker whose "python" is node, running a stand-in script that answers as scripts/make.py would. */
function makerIn(answer) {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-made-'));
  dirs.push(dir);
  const script = join(dir, 'fake-make.mjs');
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
const ok = ${JSON.stringify(answer)};
if (ok.ok) writeFileSync(out, Buffer.from('LYM1'));
console.log('progress, and then the answer');
console.log(JSON.stringify(ok));`,
  );
  return new Maker({ maker: { enabled: true, python: process.execPath, script, timeoutMinutes: 1 } }, createStore(join(dir, 'data')));
}

test('it can ask for things to be made, a few to a thing, in words the rules let through', () => {
  const maker = makerIn({ ok: true, dims: [1, 1, 1], faces: 4 });
  const made = (w) => maker.request(w, { cycle: 3 });
  const f = readForm(
    {
      parts: [
        part(),
        part({ shape: 'made', x: 4, describe: '  a copper   bell with a crack in its lip ' }),
        part({ shape: 'made', x: 7, describe: 'no' }), // too few words to make anything of
        part({ shape: 'made', x: 7, z: 4, describe: 'a lantern made of green glass' }),
        part({ shape: 'made', x: 0, z: 6, describe: 'a third thing it is not given' }),
      ],
    },
    { made },
  );
  const asked = f.parts.filter((p) => p.shape === 'made');
  assert.equal(asked.length, MAX_MADE, `${MAX_MADE} at most`);
  assert.equal(asked[0].describe, 'a copper bell with a crack in its lip');
  assert.match(asked[0].made, /^[0-9a-f]{12}$/);
  assert.equal(maker.request('A copper bell  with a crack in its lip'), asked[0].made, 'the same words, the same thing');
  assert.equal(maker.waiting().length, 2);
  assert.equal(maker.read(asked[0].made).cycle, 3);

  assert.ok(formSchema([], { made: true }).properties.parts.items.properties.shape.enum.includes('made'));
  assert.ok(!formSchema([]).properties.parts.items.properties.shape.enum.includes('made'), 'not offered unless it can be made');
  const off = new Maker({ maker: { enabled: false } }, createStore(join(dirs[0], 'off')));
  assert.equal(off.request('a copper bell'), null, 'nothing is made with the maker off');
  assert.equal(readForm({ parts: [part({ shape: 'made', describe: 'a bell' })] }, { made: (w) => off.request(w) }), null, 'and the part is not kept');
});

test('what it asked for is made between cycles, one thing at a time, and a failure is tried once more', async () => {
  const good = makerIn({ ok: true, dims: [0.4, 1, 0.3], faces: 12000 });
  const id = good.request('a tall white lighthouse');
  const done = await good.makeOne();
  assert.equal(done.status, 'made');
  assert.deepEqual(done.dims, [0.4, 1, 0.3]);
  assert.ok(existsSync(join(good.dir, `${id}.bin`)));
  assert.deepEqual(good.status([id])[id], { describe: 'a tall white lighthouse', status: 'made', dims: [0.4, 1, 0.3] });
  assert.equal(await good.makeOne(), null, 'nothing left waiting');

  const bad = makerIn({ ok: false, error: 'drawing failed' });
  bad.request('a bell');
  assert.equal((await bad.makeOne()).status, 'failed');
  assert.equal(bad.waiting().length, 1, 'tried again');
  await bad.makeOne();
  assert.equal(bad.waiting().length, 0, 'but not forever');
});
