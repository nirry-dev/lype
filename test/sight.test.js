// Its own place, seen: each night it may be shown a picture of what it made, from above, and it says what it sees
// there; only its place, never the world outside, and only while it wants to be shown it.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createBrain } from '../server/brain.js';
import { loadConfig } from '../server/config.js';
import { Life } from '../server/life.js';
import * as mind from '../server/mind.js';
import { profileFor } from '../server/sight.js';
import { createStore } from '../server/store.js';
import * as views from '../server/views.js';

const root = mkdtempSync(join(tmpdir(), 'iterant-sight-'));
after(() => rmSync(root, { recursive: true, force: true }));
let k = 0;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

function makeLife({ nightEvery = 3, capture = async () => JPEG } = {}) {
  const dir = join(root, String(k++));
  const cfg = loadConfig(['--config', 'none.json', '--mock', '--data', dir]);
  cfg.rhythm.nightEvery = nightEvery;
  cfg.courtesy.enabled = false;
  cfg.courtesy.maxGpuBusy = 101;
  const seed = join(root, 'seed.md');
  writeFileSync(seed, '# Seed\n- You are new.\n');
  cfg.seedFile = seed;
  const brain = createBrain(cfg.brain);
  const asked = [];
  const complete = brain.complete;
  brain.complete = (req) => (asked.push(req), complete(req));
  const store = createStore(dir);
  const life = new Life({ config: cfg, store, brain });
  assert.equal(life.capture, null, 'a mock mind is shown nothing unless it is given a picture');
  const shown = [];
  life.capture = capture && (async () => (shown.push(Date.now()), capture()));
  life.birth();
  life.welcome();
  return { life, asked, shown, store };
}

async function night(life) {
  for (let i = 0; i < life.cfg.rhythm.nightEvery; i++) await life.wake('test');
  clearTimeout(life.timer);
}

test('it is asked plainly what is in the picture of its own place, and whether it wants to see it again', () => {
  const state = { abilities: ['city', 'sight'], world: { things: [{ name: 'The Wide Rectangle' }, { name: 'Old', ruin: true }] } };
  const ask = mind.sightPrompt(state);
  assert.match(ask, /picture of your own place, from above/);
  assert.match(ask, /It is not the world outside; you still cannot see that/);
  assert.match(ask, /What you built that still stands: The Wide Rectangle\./);
  assert.match(ask, /You have never seen it before/);
  assert.deepEqual(mind.readSight('{"see":"Small houses."}'), { see: 'Small houses.' });
  assert.equal(mind.readSleep('{}').look, true, 'unsaid is yes');
  assert.equal(mind.readSleep('{"look":false}').look, false);
  // its night, with a life's own state
  const { life } = makeLife();
  const none = { moved: [], kept: [], faded: [], forgotten: [], lost: [] };
  const sleep = (sight, sightWanted) => mind.sleepPrompt({ ...life.state, sightWanted }, [], none, '', { sight });
  assert.match(sleep({ text: 'Two stand close.' }), /Tonight you were shown a picture of your place.*you saw: "Two stand close\."/);
  assert.match(sleep({ text: 'x' }), /"look": true if you want to be shown a picture of your place again tomorrow night/);
  assert.match(sleep(null, false), /Last night you said you would rather not/);
  assert.doesNotMatch(mind.sleepPrompt({ ...life.state, abilities: life.state.abilities.filter((x) => x !== 'sight') }, [], none, ''), /"look"/, 'a life that cannot be shown it is not asked');
});

test('at night it is shown its place, says what it sees, and its night is told; the page shows the picture', async () => {
  const { life, asked, shown, store } = makeLife();
  const s = life.state;
  assert.ok(s.abilities.includes('sight'), 'a new life can be shown its place');
  await night(life);
  assert.equal(shown.length, 1, 'shown once, at night');
  const look = asked.find((r) => r.kind === 'sight');
  assert.ok(look.image?.data, 'it looks at the picture');
  assert.equal(look.image.type, 'image/jpeg');
  assert.equal(s.world.sight.version, s.version);
  assert.match(s.world.sight.text, /buildings/);
  assert.ok(existsSync(store.path(s.world.sight.file)), 'the picture is kept');
  const sleep = asked.find((r) => r.kind === 'sleep');
  assert.match(sleep.user, /Tonight you were shown a picture of your place/);
  assert.ok(asked.indexOf(look) < asked.indexOf(sleep), 'it looks before it says what its place is becoming');
  assert.ok(s.milestones.some((m) => m.key === 'first-sight' || /first time: a picture of what it made/.test(m.text)));
  const w = views.world(life);
  assert.deepEqual(Object.keys(w.sight).sort(), ['at', 'image', 'text', 'version']);
  assert.equal(w.sight.image, s.world.sight.file);
});

test('when it says no, it is not shown its place again until it asks', async () => {
  const { life, asked, shown } = makeLife();
  const complete = life.brain.complete;
  let answer = false;
  life.brain.complete = async (req) => {
    const res = await complete(req);
    return req.kind === 'sleep' ? { ...res, text: JSON.stringify({ ...JSON.parse(res.text), look: answer }) } : res;
  };
  await night(life);
  assert.equal(shown.length, 1);
  assert.equal(life.state.sightWanted, false);
  assert.ok(life.journal.some((j) => /rather not be shown its place/.test(j.text)));
  answer = true;
  await night(life);
  assert.equal(shown.length, 1, 'not shown it the night after it said no');
  assert.match(asked.filter((r) => r.kind === 'sleep').at(-1).user, /Last night you said you would rather not/);
  assert.equal(life.state.sightWanted, true, 'it asked again');
  await night(life);
  assert.equal(shown.length, 2, 'and is shown it again');
});

test('a picture that cannot be taken is only a night without one', async () => {
  const { life, asked } = makeLife({
    capture: async () => {
      throw new Error('no browser');
    },
  });
  await night(life);
  assert.equal(life.state.version, 1, 'the night goes on');
  assert.equal(life.state.world.sight ?? null, null);
  assert.ok(!asked.some((r) => r.kind === 'sight'));
  assert.doesNotMatch(asked.find((r) => r.kind === 'sleep').user, /Tonight you were shown/);
});

test('a life that had a town before is told plainly, once, that it can be shown its place; old pictures are let go', () => {
  const { life } = makeLife();
  const s = life.state;
  s.abilities = s.abilities.filter((a) => a !== 'sight');
  life.notes = [];
  life.welcome();
  assert.equal(life.notes.length, 1);
  assert.match(life.notes[0], /show you a picture of your own place each night/);
  assert.match(life.notes[0], /You still cannot see the world outside; this is only your place/);
  assert.match(life.notes[0], /each night you say whether you want to be shown it again/);
  life.welcome();
  assert.equal(life.notes.length, 1, 'once');
  // only the last few nights' pictures are kept
  life.cfg.sight.keep = 2;
  for (const n of [1, 2, 3, 4]) life.store.writeText(`sights/${String(n).padStart(4, '0')}.jpg`, JPEG);
  life.forgetSights();
  assert.deepEqual(readdirSync(life.store.path('sights')).sort(), ['0003.jpg', '0004.jpg']);
  // the browser's own folder is beside the code, one per life
  assert.match(profileFor('C:/a/data'), /[\\/]\.cache[\\/]sight[\\/][0-9a-f]{12}$/);
  assert.notEqual(profileFor('C:/a/data'), profileFor('C:/b/data'));
});
