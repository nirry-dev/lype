// Things made from its words: when it builds a part it asks to be made ("made", with "describe"), the words wait here
// (data/made/<id>.json), and between cycles, while the graphics card is free, scripts/make.py draws them with an image
// model and raises the drawing into a mesh (data/made/<id>.bin), which its place shows from then on. It never sees
// what was made: it only knows that something it described stands there.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleReason } from './moderation.js';

/** What is said about who made it, on the sign of a thing with something made in it. */
export const MADE_BY = 'Made from its words by FLUX.2 klein (drawing) and TripoSR (shape).';

/** Its words, tidied: what is asked for and what names the thing it asked for. */
export const tidyDescribe = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

export class Maker {
  constructor(cfg, store) {
    this.cfg = cfg.maker || {};
    this.store = store;
    this.dir = store.path('made');
  }

  get enabled() {
    return Boolean(this.cfg.enabled && this.cfg.python && existsSync(this.cfg.python));
  }

  /** The same words always name the same made thing. */
  idFor(describe) {
    return createHash('sha256').update(tidyDescribe(describe).toLowerCase()).digest('hex').slice(0, 12);
  }

  read(id) {
    try {
      return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  write(entry) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
  }

  /**
   * It asks for something to be made: its id, to stand in its shape until (and after) it is made. Words the rules turn
   * back are not made (null), and neither is anything once the maker is off.
   */
  request(describe, { cycle = null } = {}) {
    const words = tidyDescribe(describe);
    if (!this.enabled || words.length < 3 || ruleReason(words)) return null;
    const id = this.idFor(words);
    if (!this.read(id)) this.write({ id, describe: words, status: 'waiting', asked: new Date().toISOString(), cycle });
    return id;
  }

  waiting() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.read(f.slice(0, -5)))
      .filter((e) => e && (e.status === 'waiting' || (e.status === 'failed' && (e.tries || 0) < 2)))
      .sort((a, b) => a.asked.localeCompare(b.asked));
  }

  /** What became of each thing it asked for, by id: for its signs, and for the page to know what to fetch. */
  status(ids) {
    return Object.fromEntries(ids.map((id) => [id, this.read(id)]).filter(([, e]) => e).map(([id, e]) => [id, { describe: e.describe, status: e.status, dims: e.dims || null }]));
  }

  /** Makes one thing that is waiting (the oldest). Resolves to the entry as it ends: made, or failed with why. */
  async makeOne() {
    const entry = this.waiting()[0];
    if (!entry) return null;
    this.write({ ...entry, status: 'making', started: new Date().toISOString() });
    const out = join(this.dir, `${entry.id}.bin`);
    const result = await new Promise((resolve) => {
      const child = spawn(this.cfg.python, [this.cfg.script, '--describe', entry.describe, '--out', out], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', () => {}); // its progress; only the last line of stdout matters
      const timer = setTimeout(() => child.kill(), (this.cfg.timeoutMinutes || 15) * 60000);
      child.on('error', (err) => (clearTimeout(timer), resolve({ ok: false, error: err.message })));
      child.on('close', (code) => {
        clearTimeout(timer);
        const last = text.trim().split('\n').pop() || '';
        try {
          resolve(JSON.parse(last));
        } catch {
          resolve({ ok: false, error: code === null ? 'it took too long' : `the maker stopped (${code})` });
        }
      });
    });
    const done = result.ok
      ? { ...entry, status: 'made', made: new Date().toISOString(), dims: result.dims, faces: result.faces }
      : { ...entry, status: 'failed', error: String(result.error || 'unknown').slice(0, 300), tries: (entry.tries || 0) + 1 };
    this.write(done);
    return done;
  }
}
