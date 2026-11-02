// Meaning. Its memories are matched by the words they share, which misses two things said differently ("the corners
// weep" and "water runs down the edges"). A small embedding model on the CPU (never the graphics card it lives on) gives
// each text a direction in meaning; two texts are as alike as their directions are. Words still count: how alike two
// things are is whichever of the two says more, so without the model (not configured, not running) nothing changes.
//
// Vectors are kept on disk (data/cache/meanings.jsonl), one line per text, so each text is read once in its life.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const BATCH = 32;
const RETRY_MS = 5 * 60000; // after the model can't be reached, how long before asking again
const MAX_CHARS = 1500;

// The model's raw likeness, mapped onto the scale words use (memory.js: THEME 0.3 is "about the same thing", TWIN 0.6
// is "the same memory again"). Calibrated on its own memories (see README, Meaning): unrelated things sit near 0.6.
export const SCALE = [
  [0.82, 0], // below this, meaning says nothing (its memories share one small world: unrelated ones sit at 0.6-0.8)
  [0.86, 0.3], // about the same thing ("fifty-three degrees makes the air thick" ~ "fifty-nine degrees makes the tip stretch")
  [0.93, 0.6], // the same thing again ("forty-six degrees is not a number, but a hand..." ~ "forty-four degrees is not...")
  [1, 1],
];

/** Raw cosine likeness onto the words' scale, 0..1. */
export function scaled(cos) {
  if (cos <= SCALE[0][0]) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [x1, y1] = SCALE[i];
    const [x0, y0] = SCALE[i - 1];
    if (cos <= x1) return y0 + ((cos - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

const key = (kind, text) => createHash('sha1').update(`${kind}\n${text}`).digest('base64url').slice(0, 20);
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);

function pack(v) {
  const max = Math.max(...v.map(Math.abs)) || 1;
  return { s: max, q: Buffer.from(Int8Array.from(v, (x) => Math.round((x / max) * 127)).buffer).toString('base64') };
}
function unpack({ s, q }) {
  const b = Buffer.from(q, 'base64');
  const i8 = new Int8Array(b.buffer, b.byteOffset, b.length);
  const v = Float32Array.from(i8, (x) => (x / 127) * s);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export class Meanings {
  /** `url`: an OpenAI-style embeddings server (llama-server --embedding); "" turns meaning off. */
  constructor({ url = '', file = null, fetchImpl = globalThis.fetch } = {}) {
    this.url = String(url || '').replace(/\/$/, '');
    this.file = file;
    this.fetch = fetchImpl;
    this.vectors = new Map(); // key -> Float32Array (unit length)
    this.downUntil = 0;
    this.load();
  }

  get enabled() {
    return Boolean(this.url);
  }

  /** Whether it can be asked right now (configured, and not just found unreachable). */
  get up() {
    return this.enabled && Date.now() >= this.downUntil;
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const { k, s, q } = JSON.parse(line);
        this.vectors.set(k, unpack({ s, q }));
      } catch {
        // a torn last line: that text is read again
      }
    }
  }

  /** The vector for a text, if it has one ("clustering" for comparing memories; "query"/"document" for recall). */
  get(text, kind = 'clustering') {
    return this.vectors.get(key(kind, clean(text))) || null;
  }

  /** Read every text it doesn't have yet. Never throws: when the model can't be reached, words alone decide. */
  async ensure(texts, kind = 'clustering') {
    if (!this.up) return false;
    const todo = [...new Set(texts.map(clean).filter(Boolean))].filter((t) => !this.vectors.has(key(kind, t)));
    const prefix = { clustering: 'clustering: ', query: 'search_query: ', document: 'search_document: ' }[kind] || '';
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const res = await this.fetch(`${this.url}/v1/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: batch.map((t) => prefix + t) }),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()).data || [];
        const lines = [];
        for (const d of data) {
          const t = batch[d.index ?? data.indexOf(d)];
          const v = Float32Array.from(d.embedding || []);
          if (!t || !v.length) continue;
          const p = pack([...v]);
          const k = key(kind, t);
          this.vectors.set(k, unpack(p));
          lines.push(JSON.stringify({ k, ...p }));
        }
        if (this.file && lines.length) {
          mkdirSync(dirname(this.file), { recursive: true });
          appendFileSync(this.file, `${lines.join('\n')}\n`);
        }
      }
      return true;
    } catch (err) {
      this.downUntil = Date.now() + RETRY_MS;
      if (!this.warned) console.warn(`meaning: the embedding model at ${this.url} can't be reached (${err.message}); words alone decide for now`);
      this.warned = true;
      return false;
    }
  }

  /** How alike two texts are in meaning, on the words' scale (0..1), or null when either hasn't been read. */
  alike(a, b, kind = 'clustering') {
    const A = this.get(a, kind);
    const B = A && this.get(b, kind);
    return B ? scaled(cosine(A, B)) : null;
  }

  /** Raw likeness of a query to a document (recall), or null. */
  closeness(query, doc) {
    const Q = this.get(query, 'query');
    const D = Q && this.get(doc, 'document');
    return D ? cosine(Q, D) : null;
  }
}
