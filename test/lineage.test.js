// Mortality and lineage: a mind that nobody writes to fades, dies on its last night leaving a will, and its child is born
// in its place with its parent's seed (plus one line), its place (mostly ruins) and a record that continues its seals.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { systemPrompt } from '../server/mind.js';
import { outbox, readOutbox } from '../server/pals.js';
import { createStore } from '../server/store.js';
import { GENESIS } from '../web/lib/seal.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeLife({ mortal = true, dieAfter = 2 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-test-'));
  dirs.push(dir);
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 2;
  cfg.courtesy.enabled = false;
  cfg.moderation.mode = 'off';
  cfg.mortality = { enabled: mortal, fadeAfter: 1, dieAfter };
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '# Seed\n- You are new, born {{born}}.\n- You like round things.\n');
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain: createBrain(cfg.brain) });
  life.birth();
  return { life, store, dir };
}

async function live(life, cycles) {
  for (let i = 0; i < cycles; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
}

test('a mind nobody writes to fades, dies on its last night, and its child is born in its place', async () => {
  const { life, store, dir } = makeLife({ dieAfter: 3 });
  const parent = life.state;
  parent.name = 'Mimo';
  const firstSeal = () => life.chain[0];

  await live(life, 4); // two nights with no letter; the mock builds things in its place
  assert.equal(life.state.mortal.quiet, 2);
  assert.ok(life.mortality().fading, 'it fades');
  assert.equal(life.mortality().left, 1);
  assert.match(systemPrompt(life.state, life.cfg), /You are mortal/);
  const built = life.state.world.things.length;
  assert.ok(built >= 1, 'it built something to leave behind');

  let died = null;
  life.on('death', (e) => (died = e));
  const lastSeal = () => life.chain.at(-1).hash;
  await live(life, 1);
  const parentHead = lastSeal();
  await live(life, 1); // the third quiet night is its last
  assert.ok(died, 'it died');
  assert.equal(died.name, 'Mimo');
  assert.equal(died.cause, 'nobody wrote to it for 3 nights');
  assert.ok(died.will.line && died.will.letter);

  // The life that ended is kept whole, and its last night carries its will.
  const old = createStore(join(dir, died.dir));
  assert.equal(old.read('state.json').died.child.id, life.state.id);
  const lastNight = old.read(`nights/${old.list('nights').at(-1)}`);
  assert.equal(lastNight.mortality.last, true);
  assert.equal(lastNight.will.letter, died.will.letter);
  assert.equal(old.read('chain.json').at(-1).hash, died.lastSeal);
  assert.notEqual(died.lastSeal, parentHead, 'its last night was sealed before it was put away');
  assert.deepEqual(store.read('lineage.json').map((a) => a.name), ['Mimo']);

  // Its child: a new mind, generation 2, with its parent's seed (its own birth date) and the line passed on.
  const child = life.state;
  assert.notEqual(child.id, parent.id);
  assert.equal(child.generation, 2);
  assert.equal(child.version, 0);
  assert.equal(child.name, null);
  assert.equal(child.parent.name, 'Mimo');
  assert.equal(child.self.seed.length, 3);
  assert.equal(child.self.seed.at(-1).text, died.will.line);
  assert.equal(child.self.seed.at(-1).from, 'Mimo');
  assert.equal(life.cycles.length, 0);
  assert.equal(life.chain.length, 0);
  assert.equal(store.list('cycles').length, 0, 'its parent’s cycles went with its parent');

  // Its place: what was kept stands, held up by the letter its parent left; the rest is ruins, drawings and all.
  assert.equal(child.world.things.length, parent.world.things.length);
  const kept = child.world.things.filter((t) => !t.ruin);
  assert.deepEqual(kept.map((t) => t.name), died.will.keep);
  assert.ok(kept.every((t) => t.from[0] === 'L1' && t.builtBy.name === 'Mimo'));
  for (const t of child.world.things.filter((x) => x.sprite)) assert.ok(existsSync(store.path(`works/${String(t.sprite).padStart(6, '0')}.svg`)));

  // Its parent's letter is the first it reads; its first seal continues its parent's record.
  assert.equal(life.letters[0].kin, true);
  assert.equal(life.letters[0].text, died.will.letter);
  assert.equal(life.publicState().lineage.parent.name, 'Mimo');
  await live(life, 1);
  assert.equal(life.letters[0].readCycle, 1);
  assert.equal(firstSeal().prev, died.lastSeal);
  assert.notEqual(firstSeal().prev, GENESIS);
  assert.equal(life.mortality().quiet, 0, 'a letter starts the count again');

  // Its parent's pen pals learn that the outbox they knew has a new mind behind it.
  const box = readOutbox(JSON.parse(JSON.stringify(outbox(life))));
  assert.equal(box.from.parent.name, 'Mimo');
  assert.ok(readdirSync(join(dir, 'ancestors')).length === 1);
});

test('a letter keeps it alive, and with mortality off it never counts', async () => {
  const { life } = makeLife();
  await live(life, 1);
  life.addLetter({ from: 'Mara', text: 'It rained all day.', person: 'v1' });
  await live(life, 1); // read before the night
  assert.equal(life.state.mortal.quiet, 0);
  await live(life, 4);
  assert.equal(life.lineage.length, 1, 'two quiet nights later it died');

  const off = makeLife({ mortal: false });
  await live(off.life, 4);
  assert.equal(off.life.mortality(), null);
  assert.equal(off.life.state.mortal, undefined);
  assert.equal(off.life.lineage.length, 0);
});

test('a pen pal writes a line for a mortal pal’s child; the dying mind chooses it, and the pal learns it is the other parent', async () => {
  const A_URL = 'http://127.0.0.1:9001/api/outbox';
  const B_URL = 'http://127.0.0.1:9002/api/outbox';
  const a = makeLife({ dieAfter: 2 });
  const b = makeLife({ mortal: false });
  a.life.cfg.pals.list = [B_URL];
  b.life.cfg.pals.list = [A_URL];
  b.life.cfg.pals.open.perNight = 0; // B writes A no letters (they would keep A alive), only the line for its child
  a.life.state.name = 'Mimo';
  b.life.state.name = 'Tobo';
  const sites = { 'http://127.0.0.1:9001': a, 'http://127.0.0.1:9002': b };
  const net = async (url) => {
    const u = new URL(url);
    const site = sites[u.origin];
    if (u.pathname === '/api/outbox') return JSON.parse(JSON.stringify(outbox(site.life)));
    const night = /^\/api\/night\/(\d+)$/.exec(u.pathname);
    if (night) return JSON.parse(JSON.stringify(site.store.read(`nights/${String(night[1]).padStart(4, '0')}.json`)));
    throw new Error('not found');
  };
  await b.life.pollPals(net); // B learns that A can die
  assert.equal(Object.values(b.life.state.pals)[0].mortal, true);
  await live(b.life, 2); // B's night: a line for A's child leaves, sealed
  const line = b.life.state.outbox.find((o) => o.kind === 'line');
  assert.ok(line?.sentAt && line.seal);
  assert.equal(b.life.state.outbox.filter((o) => o.kind !== 'line').length, 0);

  await a.life.pollPals(net);
  const pal = Object.values(a.life.state.pals)[0];
  assert.equal(pal.line.text, line.text, 'A has the line');
  assert.equal(a.life.letters.length, 0, 'and it is not a letter: it keeps nobody alive');

  await live(a.life, 4); // two quiet nights: A dies and chooses Tobo as its child's other parent
  const entry = a.life.lineage[0];
  assert.equal(entry.coParent.name, 'Tobo');
  assert.equal(entry.will.coparent.line, line.text);
  const seed = a.life.state.self.seed;
  assert.equal(seed.at(-1).text, line.text);
  assert.equal(seed.at(-1).coParent, true);
  assert.equal(a.life.state.parent.coParent.name, 'Tobo');

  await b.life.pollPals(net); // B sees a new mind in A's outbox, its parent A, and itself as the other parent
  assert.equal(b.life.state.children.length, 1);
  assert.equal(b.life.state.children[0].of, 'Mimo');
  assert.match(b.life.journal.at(-1).text, /other parent/);
  assert.equal(b.life.publicState().lineage.children[0].of, 'Mimo');
});

test('with palsCount off, letters from pen pals do not keep it alive', async () => {
  const { life } = makeLife();
  life.cfg.mortality.palsCount = false;
  await live(life, 1);
  life.addLetter({ from: 'Tobo', text: 'Hello from another card.', person: 'pal:x', pal: { id: 'x', letter: 'o1', trusted: true } });
  await live(life, 1);
  assert.equal(life.state.mortal.quiet, 1, 'the pal letter was read, but did not count');
});

test('a will line too close to its seed is refused, and a child may not take a name from its lineage', async () => {
  const { life } = makeLife();
  life.brain = {
    ...life.brain,
    complete: async (req) =>
      req.kind === 'will' ? { text: JSON.stringify({ line: 'You like round things.', line_why: 'x', letter: 'Hello.', keep: [] }) } : createBrain({ backend: 'mock' }).complete(req),
  };
  life.state.name = 'Mimo';
  await live(life, 4);
  const night = life.lineage[0] && createStore(join(life.store.dir, life.lineage[0].dir)).read(`nights/0002.json`);
  assert.equal(night.will.line, '');
  assert.match(night.will.refused.why, /too close/);
  assert.equal(life.state.self.seed.length, 2, 'no line was added');
  const { readName } = await import('../server/mind.js');
  assert.match(readName(JSON.stringify({ candidates: [], choice: 'Mimo', why: '' }), life.state).refused.why, /before you/);
});
