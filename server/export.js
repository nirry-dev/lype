// Writes a static, read-only copy of a life: the same viewer plus its public records, for any static host.
//   node server/export.js --out ../site/iterant              export ./data
//   node server/export.js --out ../site/iterant --data demo  export another life
// Only what the public may see is written (screened letters, no visitor keys, no withheld replies).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, loadConfig } from './config.js';
import { Life } from './life.js';
import { createStore, pad } from './store.js';
import * as views from './views.js';

const argv = process.argv.slice(2);
const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
if (!outArg) {
  console.error('usage: node server/export.js --out <folder> [--data <life folder>]');
  process.exit(1);
}
const out = resolve(outArg);
const cfg = loadConfig(argv);
if (!existsSync(join(cfg.dataDir, 'state.json'))) {
  console.error(`there is no life in ${cfg.dataDir} to export`);
  process.exit(1);
}

const store = createStore(cfg.dataDir);
const files = store.list('cycles');
const lastRecord = files.length ? store.read(`cycles/${files.at(-1)}`) : null;
const life = new Life({ config: cfg, store, brain: { label: lastRecord?.brain || 'unknown', kind: 'recorded' } });

const write = (rel, data) => {
  const file = join(out, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};

// Start from a clean data folder so nothing stale (or since-hidden) survives a re-export.
rmSync(join(out, 'data'), { recursive: true, force: true });

const snapshotAt = new Date().toISOString();
const gpu = lastRecord?.senses?.gpu;
const state = {
  ...life.publicState(),
  phase: 'recorded',
  detail: '',
  busy: false,
  paused: false,
  nextWakeAt: null,
  live: null,
  senses: lastRecord ? { ...lastRecord.senses, gpu: gpu ? { tempC: gpu.tempC, util: gpu.util, memUsedMb: gpu.memUsedMb, memTotalMb: gpu.memTotalMb, name: gpu.name } : null } : null,
  snapshotAt,
};
write('data/state.json', state);
write('data/journey.json', life.journey());
write('data/letters.json', views.letters(life));
write('data/works.json', views.works(life, store));
write('data/life.json', views.replay(life, store));
write('data/atlas.json', views.atlas(life, store));
write('data/world.json', views.world(life));
const errands = views.errands(life);
write('data/errands.json', errands);
for (const r of errands.flatMap((e) => e.returns)) {
  if (!r.photo) continue;
  mkdirSync(join(out, 'data/returns'), { recursive: true });
  copyFileSync(store.path(r.photo), join(out, `data/${r.photo}`));
}
for (const c of life.cycles) {
  write(`data/cycles/${pad(c.n)}.json`, views.cycle(store, c.n));
  const svg = store.path(`works/${pad(c.n)}.svg`);
  if (existsSync(svg)) {
    mkdirSync(join(out, 'data/works'), { recursive: true });
    copyFileSync(svg, join(out, `data/works/${pad(c.n)}.svg`));
  }
}

// The viewer itself, told to read the snapshot instead of the live API.
const web = join(ROOT, 'web');
// Stamped URLs, so a browser (or a CDN) holding the previous export's files can't pair them with this page.
const stamp = snapshotAt.replace(/\D/g, '').slice(0, 14);
const page = readFileSync(join(web, 'index.html'), 'utf8')
  .replace('<meta name="color-scheme" content="dark" />', '<meta name="color-scheme" content="dark" />\n    <meta name="iterant-snapshot" content="data/" />')
  .replace('href="style.css"', `href="style.css?v=${stamp}"`)
  .replace('src="app.js"', `src="app.js?v=${stamp}"`);
write('index.html', page);
for (const rel of ['app.js', 'atlas.js', 'presence.js', 'world.js', 'style.css', 'lib/svgclean.js']) write(rel, readFileSync(join(web, rel), 'utf8'));

console.log(`Exported ${life.cycles.length} cycles and ${life.nights.length} nights of ${state.name || 'an unnamed life'} to ${out}`);
