// Live a few cycles from the command line, without the web server.
//   node server/run-cycles.js 4             four cycles at the configured pace of nights
//   node server/run-cycles.js 4 --mock      the same with canned replies (no GPU)
//   node server/run-cycles.js 1 --letter "Mara: It rained all day here."
//   node server/run-cycles.js 0 --night     only sleep now
import { createBrain } from './brain.js';
import { loadConfig } from './config.js';
import { Life } from './life.js';
import { createStore } from './store.js';

const argv = process.argv.slice(2);
const count = Number.parseInt(argv[0], 10) || 1;
const cfg = loadConfig(argv);
const store = createStore(cfg.dataDir);
const brain = createBrain(cfg.brain);
const life = new Life({ config: cfg, store, brain });
if (!life.state) life.birth();

const letterAt = argv.indexOf('--letter');
if (letterAt >= 0) {
  const raw = argv[letterAt + 1] || '';
  const [from, ...rest] = raw.includes(':') ? raw.split(':') : ['someone', raw];
  life.addLetter({ from: from.trim(), text: rest.join(':').trim(), person: `name:${from.trim().toLowerCase()}` });
}

life.on('status', (s) => process.stdout.write(`\n[${s.phase}${s.detail ? `: ${s.detail}` : ''}] `));
life.on('stream', ({ kind, delta }) => {
  if (kind !== 'draw') process.stdout.write(delta);
});
life.on('milestone', (m) => console.log(`\n  * milestone: ${m.text}`));
life.on('night', (n) => {
  console.log(`\n\n=== became version ${n.n}: "${n.release.title}" ===`);
  console.log(JSON.stringify({ self: n.self, portrait: n.portrait, name: n.name, release: n.release, day: n.day, influences: n.influences }, null, 2));
});

const force = argv.includes('--force');
for (let i = 0; i < count; i++) {
  const t0 = Date.now();
  const r = await life.wake('cli', { force });
  const c = store.read(`cycles/${String(life.state.cycle).padStart(6, '0')}.json`, null);
  console.log(`\n--- cycle ${life.state.cycle} ${r.ok ? 'done' : `did not happen: ${r.reason}`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (r.ok && c) {
    console.log(`action: ${c.action.kind} (${c.action.why})`);
    if (c.work) console.log(`work: ${JSON.stringify({ ...c.work, svg: c.work.svg ? `${c.work.svg.length} chars` : undefined })}`);
    for (const rep of c.replies) console.log(`reply to ${rep.letter}: ${rep.text}`);
    console.log(`diary: ${c.diary}`);
    console.log(`remember: ${JSON.stringify(c.remembered)}`);
    console.log(`mood: ${JSON.stringify(c.moodAfter)}`);
  }
  if (!r.ok) break;
}
if (argv.includes('--night')) {
  const r = await life.sleepNow();
  if (!r.ok) console.log(`night did not happen: ${r.reason}`);
}
life.stop();
process.exit(0);
