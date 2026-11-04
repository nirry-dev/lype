// Writes a static, read-only copy of a life: the same viewer plus its public records, for any static host.
//   node server/export.js --out ../site/lype                 export ./data
//   node server/export.js --out ../site/lype --data demo     export another life
// Only what the public may see is written (screened letters, no visitor keys, no withheld replies).
// The lives that lived here before it (data/ancestors/) are exported beside it, each replayable at ancestors/<k>/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig } from './config.js';
import { Life } from './life.js';
import { createStore, pad } from './store.js';
import { loadCatalogue } from './models.js';
import { outbox } from './pals.js';
import * as views from './views.js';

/** The page with a way back to the site it lives on at the left of its header (publish.home), if there is one. */
export function withHome(page, home) {
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(home?.url || '') || !home.name) return page;
  const name = escapeHtml(home.name);
  const link = `<a class="home-link" href="${home.url}" aria-label="${name}, home"><span class="home-mark" aria-hidden="true">◢</span>${name}</a><span class="home-sep" aria-hidden="true">/</span>`;
  return page.replace('<header class="top">', `<header class="top">
      ${link}`);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Writes one life (cfg.dataDir) to `out`, and the lives before it to out/ancestors/<k>/. Returns what it wrote. */
export function exportLife(cfg, out, { relayUrl = '', allModels = true } = {}) {
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
  const letters = views.letters(life);
  write('data/letters.json', letters);
  write('data/works.json', views.works(life, store));
  write('data/life.json', views.replay(life, store));
  write('data/atlas.json', views.atlas(life, store));
  write('data/world.json', views.world(life));
  const errands = views.errands(life);
  write('data/errands.json', errands);
  // the photos people brought back for its errands or sent with a letter (only those its keeper let through)
  for (const photo of [...errands.flatMap((e) => e.returns).map((r) => r.photo), ...letters.map((l) => l.photo)]) {
    if (!photo) continue;
    mkdirSync(join(out, 'data/returns'), { recursive: true });
    copyFileSync(store.path(photo), join(out, `data/${photo}`));
  }
  // the last picture of its place it was shown, beside what it saw there
  const seen = views.world(life).sight;
  if (seen && existsSync(store.path(seen.image))) {
    mkdirSync(join(out, 'data/sights'), { recursive: true });
    copyFileSync(store.path(seen.image), join(out, `data/${seen.image}`));
  }
  write('data/chain.json', views.chain(life));
  write('data/outbox.json', outbox(life, { file: true }));
  write('data/thread.json', views.thread(life));
  write('data/neighbor.json', life.neighbor ? { ...life.neighbor, holds: false } : null);
  for (const night of life.nights) write(`data/nights/${pad(night.n, 4)}.json`, views.night(store, night.n));
  const copyWork = (n) => {
    const svg = store.path(`works/${pad(n)}.svg`);
    if (!existsSync(svg)) return;
    mkdirSync(join(out, 'data/works'), { recursive: true });
    copyFileSync(svg, join(out, `data/works/${pad(n)}.svg`));
  };
  for (const c of life.cycles) {
    write(`data/cycles/${pad(c.n)}.json`, views.cycle(store, c.n));
    copyWork(c.n);
  }
  // What it asked to be made, once made (and never the pictures they were made from).
  for (const t of life.state.world.things) {
    for (const p of t.form?.parts || []) {
      const bin = p.made && store.path(`made/${p.made}.bin`);
      if (!bin || !existsSync(bin)) continue;
      mkdirSync(join(out, 'data/made'), { recursive: true });
      copyFileSync(bin, join(out, `data/made/${p.made}.bin`));
    }
  }
  // Drawings it inherited with its place were made by its parent, not in any of its own cycles.
  for (const t of life.state.world.things) if (t.sprite) copyWork(t.sprite);

  // The viewer itself, told to read the snapshot instead of the live API.
  const web = join(ROOT, 'web');
  // Stamped URLs, so a browser (or a CDN) holding the previous export's files can't pair them with this page.
  const stamp = snapshotAt.replace(/\D/g, '').slice(0, 14);
  const relayMeta = /^https:\/\/[\w.-]+(:\d+)?\/?$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(relayUrl || '') ? `\n    <meta name="iterant-relay" content="${relayUrl.replace(/\/$/, '')}" />` : '';
  const page = withHome(readFileSync(join(web, 'index.html'), 'utf8'), cfg.publish?.home)
    .replace('<meta name="color-scheme" content="dark" />', `<meta name="color-scheme" content="dark" />\n    <meta name="iterant-snapshot" content="data/" />${relayMeta}`)
    .replace('href="style.css"', `href="style.css?v=${stamp}"`)
    .replace('src="app.js"', `src="app.js?v=${stamp}"`);
  write('index.html', page);
  // The modules it imports are stamped too: a browser holding last night's world.js must not run it under tonight's app.js.
  const stamped = (src) => src.replace(/(\bfrom\s+'\.{1,2}\/[^'?]+\.js)'/g, `$1?v=${stamp}'`);
  for (const rel of ['app.js', 'atlas.js', 'presence.js', 'world.js', 'style.css', 'lib/svgclean.js', 'lib/seal.js', 'lib/form.js', 'lib/town.js', 'lib/route.js']) {
    const src = readFileSync(join(web, rel), 'utf8');
    write(rel, rel.endsWith('.js') ? stamped(src) : src);
  }

  // The things it can borrow: all of them for a life that may still borrow more while people watch; for a life that
  // has ended, only what it borrowed.
  const catalogue = loadCatalogue();
  const used = new Set(life.state.world?.things.flatMap((t) => [...(t.form?.parts || []).map((p) => p.model), ...(t.around || []).map((a) => a.model)].filter(Boolean)) || []);
  for (const q of life.state.world?.quarters || []) for (const name of q.street || []) used.add(catalogue.byName.get(name)?.id); // what lines its streets
  if (catalogue.models.length) write('models/catalogue.json', readFileSync(join(web, 'models', 'catalogue.json'), 'utf8'));
  for (const m of catalogue.models) {
    if (!allModels && !used.has(m.id)) continue;
    mkdirSync(dirname(join(out, 'models', `${m.id}.bin`)), { recursive: true });
    copyFileSync(join(web, 'models', `${m.id}.bin`), join(out, 'models', `${m.id}.bin`));
  }

  // The lives before it: each its own read-only page, with no relay (they will never be live again).
  const ancestors = life.lineage.filter((a) => existsSync(join(cfg.dataDir, a.dir, 'state.json')));
  for (const a of ancestors) exportLife({ ...cfg, dataDir: join(cfg.dataDir, a.dir) }, join(out, a.dir), { allModels: false });
  return { name: state.name, cycles: life.cycles.length, nights: life.nights.length, ancestors: ancestors.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  if (!outArg) {
    console.error('usage: node server/export.js --out <folder> [--data <life folder>]');
    process.exit(1);
  }
  const cfg = loadConfig(argv);
  if (!existsSync(join(cfg.dataDir, 'state.json'))) {
    console.error(`there is no life in ${cfg.dataDir} to export`);
    process.exit(1);
  }
  // --relay <url>: when the creature is reachable through that relay, the page goes live; when not, it plays this copy.
  const relayUrl = argv.includes('--relay') ? argv[argv.indexOf('--relay') + 1] : '';
  const out = resolve(outArg);
  const done = exportLife(cfg, out, { relayUrl });
  console.log(`Exported ${done.cycles} cycles and ${done.nights} nights of ${done.name || 'an unnamed life'}${done.ancestors ? ` (and the ${done.ancestors} before it)` : ''} to ${out}`);
}
