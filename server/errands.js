// Errands: small things it asks the people who visit to bring back from the world it cannot see, as one photo.
// A photo waits for its keeper before it (or anyone) sees it; then it looks, says what it made of it, and an
// errand someone answered is filled.
import { similarity } from './memory.js';

export const MAX_OPEN_ERRANDS = 3;
export const MAX_PHOTO_SIDE = 4096;

// What an errand must never ask for, whatever the model thinks: people, who or where someone is, risk or cost.
const UNSAFE = [
  [/\b(faces?|selfies?|yourself|people|persons?|strangers?|neighbou?rs?|child(ren)?|kids?|bab(y|ies)|crowds?)\b/i, 'it asks for people'],
  [/\b(address|house number|where you live|your (home|house|flat|street|door|window|bedroom)|number ?plates?|licen[cs]e plates?)\b/i, 'it could show where someone lives'],
  [/\b(passports?|id cards?|documents?|receipts?|bank|credit cards?|passwords?|screenshots?|money|cash|wallets?)\b/i, 'it asks for something private or costly'],
  [/\b(buy|pay|climb|roof|trespass|break|steal|alone at night|in the dark outside|drive)\b/i, 'it asks for something risky or costly'],
];

/** A reason this errand can't be posted as it is, or null. */
export function errandReason(text) {
  for (const [re, why] of UNSAFE) if (re.test(text)) return why;
  return null;
}

export const openErrands = (list) => list.filter((e) => e.status === 'open');

/**
 * Post an errand (or hold it for its keeper). Returns the errand, or null if it is one it already has open.
 * Past the limit it lets its oldest open errand go.
 */
export function addErrand(list, { text, why, cycle, version, at, held = false, reason = '' }) {
  if (list.some((e) => ['open', 'held'].includes(e.status) && similarity(e.text, text) >= 0.6)) return null;
  const errand = {
    id: `e${list.length + 1}`,
    text,
    why,
    cycle,
    version,
    at,
    status: held ? 'held' : 'open',
    ...(held ? { heldBecause: reason } : {}),
    returns: [],
    filledBy: null,
  };
  list.push(errand);
  const open = openErrands(list);
  if (open.length > MAX_OPEN_ERRANDS) Object.assign(open[0], { status: 'closed', closedBecause: 'it let it go to make room', closedAt: at });
  return errand;
}

/** Its keeper posts a held errand, drops it, or closes an open one. */
export function decideErrand(list, id, action, at = new Date().toISOString()) {
  const e = list.find((x) => x.id === id);
  if (!e) return { ok: false, reason: 'no such errand' };
  if (action === 'post' && e.status === 'held') {
    e.status = 'open';
    e.postedAt = at;
    const open = openErrands(list);
    if (open.length > MAX_OPEN_ERRANDS) Object.assign(open[0], { status: 'closed', closedBecause: 'it let it go to make room', closedAt: at });
  } else if (action === 'drop' && e.status === 'held') {
    e.status = 'dropped';
  } else if (action === 'close' && e.status === 'open') {
    Object.assign(e, { status: 'closed', closedBecause: 'its keeper closed it', closedAt: at });
  } else return { ok: false, reason: `can't ${action} an errand that is ${e.status}` };
  return { ok: true, errand: e };
}

/**
 * A JPEG with everything but the picture taken out (camera, place and time metadata live in APP1..APP13 and
 * comments). Throws on anything that isn't a plausible JPEG.
 */
export function cleanJpeg(buf) {
  const fail = (why) => {
    throw Object.assign(new Error(`That photo couldn't be read: ${why}.`), { status: 400 });
  };
  if (buf.length < 128 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('it is not a JPEG');
  const out = [buf.subarray(0, 2)];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) fail('it is damaged');
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) fail('it ends too soon');
    const end = i + 2 + buf.readUInt16BE(i + 2);
    if (end > buf.length) fail('it ends too soon');
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      height = buf.readUInt16BE(i + 5);
      width = buf.readUInt16BE(i + 7);
    }
    if (marker === 0xda) {
      // The picture itself, up to its last end marker (progressive files carry more tables and scans inside it);
      // anything hidden after the end is left behind.
      const last = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (last <= i) fail('it ends too soon');
      out.push(buf.subarray(i, last + 2));
      break;
    }
    const metadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xfe;
    if (!metadata) out.push(buf.subarray(i, end));
    i = end;
  }
  if (!width || !height) fail('it has no picture in it');
  if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) fail(`it is larger than ${MAX_PHOTO_SIDE} pixels on a side`);
  const data = Buffer.concat(out);
  if (data.at(-2) !== 0xff || data.at(-1) !== 0xd9) fail('it has no end');
  return { data, width, height };
}
