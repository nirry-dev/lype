// Pen pals: other creatures it writes to and hears from. Mail is slow on purpose: what it writes to a pal leaves at
// night, listed in that night's sealed record and published in its outbox; a pal fetches that outbox now and then and
// checks each letter against the night that sent it. Only creatures its keeper listed are ever fetched, and its
// keeper can throttle or pause pen pal mail at any time.
import { createHash } from 'node:crypto';
import { pad } from './store.js';
import { sealInput, sealedBody } from '../web/lib/seal.js';

export const PAL_MODES = ['open', 'throttled', 'paused'];
const MAX_BYTES = 256 * 1024;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The limits for its keeper's current setting. */
export function palLimits(cfg, mode) {
  if (mode === 'paused') return { perNight: 0, perCycle: 0, threadMax: 0, restNights: 0, paused: true };
  return { ...(mode === 'throttled' ? cfg.pals.throttled : cfg.pals.open), paused: false };
}

/** A pal is reached over HTTPS, or plain HTTP only on this machine (a sibling on the same card). */
export function palUrlOk(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Its public page, if it has one: an https address only, so a page link can never be anything else. */
export function publicPage(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Fetches a pal's JSON with a time limit and a size cap; never follows anything a letter says. */
export async function fetchPalJson(url) {
  if (!palUrlOk(url)) throw new Error('not an address it may fetch');
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('too large');
  return JSON.parse(text);
}

/**
 * A letter is believed only if the night that sent it, as its writer published it, lists this very letter and still
 * hashes to its seal (and that seal is the one the letter carries).
 */
export async function verifyPalLetter(letter, from, outboxUrl, fetchJson = fetchPalJson) {
  if (!Number.isInteger(letter.night) || !/^[0-9a-f]{64}$/.test(letter.seal || '')) return 'it carries no seal';
  const template = String(from.night || '');
  if (!template.includes('{n')) return 'its writer does not say where its nights are';
  const url = new URL(template.replace('{n4}', pad(letter.night, 4)).replace('{n}', String(letter.night)), outboxUrl).href;
  const night = await fetchJson(url);
  const seal = night?.seal;
  if (!seal || seal.hash !== letter.seal) return 'the night that sent it has a different seal';
  const hash = sha256(sealInput({ prev: seal.prev, kind: 'night', n: letter.night, body: sealedBody(night), withheld: seal.withheld || [] }));
  if (hash !== seal.hash) return 'the night that sent it no longer matches its seal';
  const sent = (night.sent || []).find((x) => x.id === letter.id);
  if (!sent || sent.text !== letter.text || sent.to !== letter.to) return 'the night that sent it does not list this letter';
  return null;
}

/** Its outbox as a pal reads it. `night` says where its nights are, relative to the outbox's own address. */
export function outbox(life, { file = false } = {}) {
  const s = life.state;
  return {
    v: 1,
    from: {
      id: s.id,
      name: s.name || 'unnamed',
      night: file ? 'nights/{n4}.json' : 'night/{n}',
      ...(publicPage(life.cfg.publish?.url) ? { page: publicPage(life.cfg.publish.url) } : {}),
      // A child writes from the outbox its parent wrote from; this tells its parent's pen pals who it is.
      ...(s.parent ? { parent: { id: s.parent.id, name: s.parent.name || 'unnamed' } } : {}),
    },
    letters: (s.outbox || [])
      .filter((o) => o.sentAt && o.seal)
      .slice(-100)
      .map((o) => ({ id: o.id, to: o.to, toName: o.toName, text: o.text, inReplyTo: o.inReplyTo || null, night: o.night, seal: o.seal, at: o.sentAt })),
  };
}

/** Shapes a fetched outbox, dropping anything malformed. */
export function readOutbox(raw) {
  const from = raw?.from;
  if (!from || typeof from.id !== 'string' || typeof from.name !== 'string' || !Array.isArray(raw.letters)) return null;
  const letters = raw.letters
    .filter((l) => l && typeof l.id === 'string' && typeof l.to === 'string' && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({ ...l, text: l.text.slice(0, 1200), toName: String(l.toName || '').slice(0, 40) }));
  const page = publicPage(from.page);
  const tidy = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'a creature';
  const parent = typeof from.parent?.id === 'string' ? { id: from.parent.id.slice(0, 40), name: tidy(from.parent.name) } : null;
  return { from: { id: from.id.slice(0, 40), name: tidy(from.name), night: String(from.night || ''), ...(page ? { page } : {}), ...(parent ? { parent } : {}) }, letters };
}
