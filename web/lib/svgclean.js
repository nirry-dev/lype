// Turns model-written SVG (possibly half-streamed) into a safe drawing: whitelisted shapes and
// presentation attributes only, every tag closed. Shared by the server and the browser.

const TAG_NAMES = ['svg', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'];
const CONTAINERS = new Set(['svg', 'g', 'defs', 'linearGradient', 'radialGradient']);
const TAGS = new Map(TAG_NAMES.map((t) => [t.toLowerCase(), t]));

const ATTR_NAMES = [
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'd', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
  'fill-opacity', 'fill-rule', 'opacity', 'transform', 'offset', 'stop-color', 'stop-opacity', 'id',
  'gradientUnits', 'gradientTransform', 'spreadMethod',
];
const ATTRS = new Map(ATTR_NAMES.map((a) => [a.toLowerCase(), a]));

// No quotes, angle brackets, ampersands, colons or slashes: nothing that can open a URL, a script or a new tag.
const SAFE_VALUE = /^[a-zA-Z0-9#.,%()\s+\-]*$/;
const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[?!][^>]*>?|<\s*(\/)?\s*([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?\s*>/g;
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function cleanValue(name, raw, idPrefix) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 6000 || !SAFE_VALUE.test(value)) return null;
  if (/url\s*\(/i.test(value)) {
    const ref = /^url\(\s*#([\w-]+)\s*\)$/i.exec(value);
    return ref ? `url(#${idPrefix}${ref[1]})` : null;
  }
  if (name === 'id') return /^[\w-]{1,64}$/.test(value) ? idPrefix + value : null;
  return value;
}

function parseAttrs(raw, idPrefix) {
  const attrs = new Map();
  let style = '';
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const key = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (key === 'style') style = value;
    else if (key === 'viewbox') attrs.set('viewBox', value);
    else if (ATTRS.has(key)) {
      const clean = cleanValue(key, value, idPrefix);
      if (clean !== null) attrs.set(ATTRS.get(key), clean);
    }
  }
  // Models often write style="fill: red; stroke: blue": keep the declarations we allow as attributes.
  for (const decl of style.split(';')) {
    const [prop, ...rest] = decl.split(':');
    const key = prop?.trim().toLowerCase();
    if (!key || !ATTRS.has(key) || key === 'id' || attrs.has(ATTRS.get(key))) continue;
    const clean = cleanValue(key, rest.join(':'), idPrefix);
    if (clean !== null) attrs.set(ATTRS.get(key), clean);
  }
  return attrs;
}

const renderAttrs = (attrs) => [...attrs].map(([k, v]) => ` ${k}="${v}"`).join('');

function rootViewBox(value) {
  const nums = String(value ?? '').trim().split(/[\s,]+/).map(Number);
  return nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0 ? nums.join(' ') : '0 0 512 512';
}

/**
 * @param {string} input SVG text from the model (complete or still streaming)
 * @param {{ partial?: boolean, idPrefix?: string, maxElements?: number }} [opts]
 * @returns {{ svg: string, shapes: number }}
 */
export function cleanSvg(input, { partial = false, idPrefix = '', maxElements = 600 } = {}) {
  let body = String(input ?? '');
  const start = body.search(/<svg[\s>]/i);
  if (start < 0) return { svg: '', shapes: 0 };
  body = body.slice(start);
  if (partial) {
    const lt = body.lastIndexOf('<');
    if (lt > body.lastIndexOf('>')) body = body.slice(0, lt); // drop the tag still being written
  }

  const out = [];
  const open = []; // { name, emitted }
  const skipping = []; // raw names of disallowed elements we are inside of
  let shapes = 0;
  let elements = 0;
  let rooted = false;

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(body)) && elements < maxElements) {
    const [, closing, rawName, rawAttrs = '', selfClose] = m;
    if (!rawName) continue; // comment, doctype, processing instruction, CDATA
    const lower = rawName.toLowerCase();

    if (skipping.length) {
      if (closing) {
        if (skipping[skipping.length - 1] === lower) skipping.pop();
      } else if (!selfClose) skipping.push(lower);
      continue;
    }

    const name = TAGS.get(lower);
    if (closing) {
      const at = name ? open.map((o) => o.name).lastIndexOf(name) : -1;
      if (at < 0) continue;
      while (open.length > at) {
        const top = open.pop();
        if (top.emitted) out.push(`</${top.name}>`);
      }
      if (!open.length) break; // the root closed: the drawing is finished
      continue;
    }

    if (!name || (name === 'svg' && rooted) || (!rooted && name !== 'svg')) {
      if (!selfClose) skipping.push(lower);
      continue;
    }

    const attrs = parseAttrs(rawAttrs, idPrefix);
    elements++;
    if (name === 'svg') {
      rooted = true;
      out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rootViewBox(attrs.get('viewBox'))}">`);
      open.push({ name, emitted: true });
      continue;
    }
    attrs.delete('viewBox');
    if (CONTAINERS.has(name)) {
      out.push(`<${name}${renderAttrs(attrs)}${selfClose ? '/>' : '>'}`);
      if (!selfClose) open.push({ name, emitted: true });
    } else {
      out.push(`<${name}${renderAttrs(attrs)}/>`);
      if (name !== 'stop') shapes++;
      if (!selfClose) open.push({ name, emitted: false }); // <rect ...></rect>: swallow the closing tag later
    }
  }

  if (!rooted) return { svg: '', shapes: 0 };
  while (open.length) {
    const top = open.pop();
    if (top.emitted) out.push(`</${top.name}>`);
  }
  return { svg: out.join(''), shapes };
}
