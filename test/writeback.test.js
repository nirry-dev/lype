// Writing back to what it wrote you: a visitor answers its reply, and it reads that letter as the next turn of a
// conversation, with what was said before.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-writeback-'));
after(() => rmSync(root, { recursive: true, force: true }));
let k = 0;

function makeLife() {
  const dir = join(root, String(k++));
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = 50;
  cfg.courtesy.enabled = false;
  cfg.courtesy.maxGpuBusy = 101;
  cfg.moderation.mode = 'off';
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  cfg.seedFile = seed;
  const brain = createBrain(cfg.brain);
  const asked = [];
  const complete = brain.complete;
  brain.complete = (req) => (asked.push(req), complete(req));
  return { life: new Life({ config: cfg, store: createStore(dir), brain }), asked };
}

/** A letter it has answered (as if a cycle had read it and written back). */
function answered(life, { from, text, person, reply, withheld = false }) {
  const l = life.addLetter({ from, text, person });
  Object.assign(life.letters.find((x) => x.id === l.id), { readAt: new Date().toISOString(), readCycle: 1, reply: { text: reply, cycle: 1, ...(withheld ? { withheld: true } : {}) } });
  return l.id;
}

test('only the person it wrote to can write back, and only to a reply it let anyone see', () => {
  const { life } = makeLife();
  life.birth();
  const mine = answered(life, { from: 'Wren', text: 'What do you do when nobody writes?', person: 'v1', reply: 'I walk round what I built and wait.' });
  const held = answered(life, { from: 'Wren', text: 'Another.', person: 'v1', reply: 'Held back.', withheld: true });
  const unanswered = life.addLetter({ from: 'Wren', text: 'And one it has not read.', person: 'v1' }).id;

  const back = life.addLetter({ from: 'Wren', text: 'Does the waiting feel long?', person: 'v1', inReplyTo: mine, question: 'q1' });
  assert.equal(back.inReplyTo, mine, 'writing back to its reply');
  assert.equal(back.question, null, 'a letter that writes back answers no question');
  assert.equal(life.addLetter({ from: 'Someone', text: 'Me too.', person: 'v2', inReplyTo: mine }).inReplyTo, null, 'someone else: just a letter');
  assert.equal(life.addLetter({ from: 'Wren', text: 'x', person: 'v1', inReplyTo: held }).inReplyTo, null, 'a reply nobody may see');
  assert.equal(life.addLetter({ from: 'Wren', text: 'x', person: 'v1', inReplyTo: unanswered }).inReplyTo, null, 'nothing to write back to');
  assert.equal(life.addLetter({ from: 'Wren', text: 'x', person: 'v1', inReplyTo: 'L999' }).inReplyTo, null);

  // the page: which reply a letter writes back to, for everyone; the way to write back, for the writer
  const shown = views.letters(life, 'v1').find((l) => l.id === back.id);
  assert.deepEqual(shown.writingBack, { id: mine, from: 'Wren', reply: 'I walk round what I built and wait.' });
  assert.equal(views.letters(life, null).find((l) => l.id === back.id).writingBack.id, mine);
  assert.equal(views.letters(life, 'v1').find((l) => l.id === mine).mine, true);
  assert.equal(views.letters(life, 'v2').find((l) => l.id === mine).mine, false);
});

test('it reads a letter that writes back with the conversation so far, oldest first, and replies to carry it on', async () => {
  const { life, asked } = makeLife();
  life.birth();
  life.welcome();
  const first = answered(life, { from: 'Wren', text: 'What do you do when nobody writes?', person: 'v1', reply: 'I walk round what I built and wait.' });
  const second = life.addLetter({ from: 'Wren', text: 'Does the waiting feel long?', person: 'v1', inReplyTo: first }).id;
  Object.assign(life.letters.find((l) => l.id === second), { readAt: new Date().toISOString(), readCycle: 2, reply: { text: 'Only when the card is warm.', cycle: 2 } });
  const third = life.addLetter({ from: 'Wren', text: 'Why the card?', person: 'v1', inReplyTo: second }).id;

  assert.deepEqual(
    life.conversation(life.letters.find((l) => l.id === third)).map((t) => [t.id, t.them, t.you]),
    [
      [first, 'What do you do when nobody writes?', 'I walk round what I built and wait.'],
      [second, 'Does the waiting feel long?', 'Only when the card is warm.'],
    ],
  );
  assert.equal(life.conversation(life.letters.find((l) => l.id === third), 1).length, 1, 'only so far back');

  for (let i = 0; i < 3 && !life.letters.find((l) => l.id === third).readAt; i++) assert.ok((await life.wake('test')).ok);
  clearTimeout(life.timer);
  assert.ok(life.letters.find((l) => l.id === third).readAt, 'it read it');
  const read = asked.find((r) => r.kind === 'think' && r.user.includes('Why the card?')) || asked.find((r) => r.user?.includes('Why the card?'));
  assert.match(read.user, /They are writing back to what you wrote them\. What was said before, oldest first:/);
  assert.match(read.user, /they wrote \(letter L1\): "What do you do when nobody writes\?"\n {2}you wrote back: "I walk round what I built and wait\."/);
  assert.ok(read.user.indexOf('What do you do when nobody writes?') < read.user.indexOf('Does the waiting feel long?'), 'oldest first');
  const reply = asked.find((r) => r.kind === 'reply' && r.user.includes(`letter ${third}`));
  assert.ok(reply, 'it wrote back again');
  assert.match(reply.user, /this is a conversation: carry it on/);
});
