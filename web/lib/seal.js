// Its sealed record, shared by the server (which seals) and the page (which checks). Every cycle and night is sealed
// when it is written: a SHA-256 over the public form of the record and the seal before it, so changing or removing
// anything it ever did breaks every seal after it. A reply still held for its keeper is sealed as a salted fingerprint:
// it provably existed, and can be shown later, but can't be guessed from its seal.

export const SEAL_VERSION = 1;
export const GENESIS = '0'.repeat(64);

/** JSON with keys sorted at every level (and undefined dropped, as JSON does), so both sides hash the same bytes. */
export function canonical(value) {
  const plain = JSON.parse(JSON.stringify(value ?? null));
  const walk = (v) => {
    if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${walk(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  };
  return walk(plain);
}

/** The exact text that is hashed for one entry. */
export function sealInput({ prev, kind, n, body, withheld = [] }) {
  return `lype-seal-${SEAL_VERSION}\n${prev}\n${kind}:${n}\n${canonical(body)}\n${withheld.join(',')}`;
}

/** A record as published, without its seal: what the seal covers. */
export function sealedBody(record) {
  const { seal, ...body } = record || {};
  return body;
}

/** The seal as anyone may see it (a withheld reply's salt stays with its keeper until the reply is shown). */
export function publicSeal(seal) {
  if (!seal) return undefined;
  const { salts, ...rest } = seal;
  return rest;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/**
 * Checks the whole chain: each entry links to the one before, and each record, fetched as published, still hashes to
 * its seal. fetchRecord(entry) returns the published record (with its seal). Returns { ok, checked, late, problem }.
 */
export async function verifyChain(entries, fetchRecord, { onProgress = () => {}, parallel = 6, from = 0 } = {}) {
  for (let i = 0; i < entries.length; i++) {
    const want = i ? entries[i - 1].hash : GENESIS;
    if (entries[i].prev !== want) return { ok: false, checked: i, problem: { at: entries[i], why: 'it does not link to the entry before it' } };
  }
  // Every link is checked; the records themselves from `from` on (the newest few, or all of them).
  const records = entries.slice(from);
  let checked = 0;
  let problem = null;
  let next = 0;
  const worker = async () => {
    while (!problem && next < records.length) {
      const e = records[next++];
      let record;
      try {
        record = await fetchRecord(e);
      } catch (err) {
        problem ??= { at: e, why: `it could not be fetched (${err.message})` };
        return;
      }
      const seal = record?.seal;
      if (!seal || seal.hash !== e.hash || seal.prev !== e.prev) {
        problem ??= { at: e, why: 'its seal is missing or differs from the chain' };
        return;
      }
      const hash = await sha256(sealInput({ prev: e.prev, kind: e.kind, n: e.n, body: sealedBody(record), withheld: seal.withheld }));
      if (hash !== e.hash) {
        problem ??= { at: e, why: 'what is published no longer matches what was sealed' };
        return;
      }
      checked++;
      onProgress(checked, records.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, records.length) }, worker));
  return { ok: !problem && checked === records.length, checked, late: entries.filter((e) => e.late).length, problem };
}
