// Moderation: rules at the door, the model's screen before reading, the keeper's queue, and what the public never sees.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life, letterStatus, publicCycle } from '../server/life.js';
import { ruleReason } from '../server/moderation.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeLife(mode = 'model') {
  const dir = mkdtempSync(join(tmpdir(), 'iterant-mod-'));
  dirs.push(dir);
  const cfg = loadConfig(['--mock', '--data', dir]);
  cfg.courtesy.enabled = false;
  cfg.rhythm.nightEvery = 99;
  cfg.moderation.mode = mode;
  cfg.seedFile = join(dir, 'seed.md');
  writeFileSync(cfg.seedFile, '- You are new.\n');
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain: createBrain(cfg.brain) });
  life.birth();
  return { life, store };
}

test('rules hold links, contact details and walls of repetition at the door', () => {
  assert.match(ruleReason('come see https://example.com'), /link/);
  assert.match(ruleReason('mail me at someone@example.org'), /email/);
  assert.match(ruleReason('call +1 (555) 123-4567 tonight'), /phone/);
  assert.match(ruleReason('a'.repeat(30)), /repetition/);
  assert.equal(ruleReason('It rained all day and the gutters sang. I counted 3 herons.'), null);
});

test('only screened letters are read or shown; the keeper decides the held ones', async () => {
  const { life, store } = makeLife();
  const link = life.addLetter({ from: 'Spam', text: 'buy now at www.example.com', person: 'a' });
  const odd = life.addLetter({ from: 'Odd', text: 'HOLDME please', person: 'b' });
  const kind = life.addLetter({ from: 'Mara', text: 'It rained all day here.', person: 'c' });
  assert.equal(link.status, 'held', 'held at the door by the rules');
  assert.equal(kind.status, 'pending', 'waits for the screen');
  assert.equal(views.letters(life).length, 0, 'nothing is public before screening');
  assert.equal(views.letters(life, 'c').length, 1, 'but its author can see it');

  const r = await life.wake('test');
  clearTimeout(life.timer);
  assert.ok(r.ok, r.reason);
  const byId = (id) => life.letters.find((l) => l.id === id);
  assert.equal(letterStatus(byId(odd.id)), 'held', 'the model screen held it');
  assert.equal(letterStatus(byId(kind.id)), 'allowed');
  assert.ok(byId(kind.id).readAt, 'the allowed letter was read');
  assert.ok(!byId(odd.id).readAt && !byId(link.id).readAt, 'held letters are never read');
  assert.deepEqual(views.letters(life).map((l) => l.from), ['Mara']);
  assert.deepEqual(life.journey().letters.map((l) => l.from), ['Mara']);
  assert.deepEqual(life.keeperQueue().map((l) => l.from).sort(), ['Odd', 'Spam']);

  assert.ok(life.decide(odd.id, 'allow').ok);
  assert.ok(life.decide(link.id, 'reject').ok);
  assert.equal(letterStatus(byId(odd.id)), 'allowed');
  assert.equal(life.keeperQueue().length, 0);
  await life.wake('test');
  clearTimeout(life.timer);
  assert.ok(byId(odd.id).readAt, 'a letter the keeper allowed gets read');
  assert.ok(!byId(link.id).readAt);
  assert.equal(views.cycle(store, 1).letters[0].from, 'Mara');
});

test('keeper mode holds every letter; off allows everything', () => {
  assert.equal(makeLife('keeper').life.addLetter({ from: 'A', text: 'hello', person: 'a' }).status, 'held');
  assert.equal(makeLife('off').life.addLetter({ from: 'A', text: 'see www.example.com', person: 'a' }).status, 'allowed');
});

test('a withheld reply never reaches the public', () => {
  const record = {
    n: 1,
    letters: [{ id: 'L1', from: 'A', text: 'hi', reply: 'something it should not have said', replyWithheld: true }],
    replies: [{ letter: 'L1', text: 'something it should not have said', withheld: true }],
  };
  const pub = publicCycle(record);
  assert.equal(pub.letters[0].reply, null);
  assert.equal('replyWithheld' in pub.letters[0], false);
  assert.equal(pub.replies.length, 0);
  assert.ok(!JSON.stringify(pub).includes('should not'));
});
