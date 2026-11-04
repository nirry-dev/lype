// Its way round what stands in its place: along the streets between the lots, never over a building. Plain functions,
// so the page and the tests share them.

/**
 * What it goes round, as squares on the ground: `list` holds each one's middle [x, z], `half` how far each reaches out
 * from it (half a lot, and as far as its own body reaches).
 * @typedef {{ half: number, list: [number, number][] }} Blocks
 */

const inside = (p, [x, z], half) => Math.abs(p[0] - x) < half && Math.abs(p[1] - z) < half;

/** Whether it can go straight from a to c without passing over anything (what a or c is in, it may leave or reach). */
export function clear(a, c, b) {
  const list = b.list.filter((q) => !inside(a, q, b.half) && !inside(c, q, b.half));
  if (!list.length) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.05));
  for (let i = 1; i < n; i++) {
    const p = [a[0] + ((c[0] - a[0]) * i) / n, a[1] + ((c[1] - a[1]) * i) / n];
    if (list.some((q) => inside(p, q, b.half))) return false;
  }
  return true;
}

/**
 * Its way from one spot to another round what stands: over a grid `step` apart (half the distance between lots, so its
 * points are lot middles and street middles), then cut short wherever it can go straight. Gives the turns on the way,
 * not the end (where it goes may move on, as when it walks round something): none when it can go straight, and none
 * when there is no way round (then it floats over, as it always did).
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @param {Blocks} b
 * @param {number} step
 * @returns {[number, number][]}
 */
export function route(from, to, b, step) {
  if (!b.list.length || clear(from, to, b)) return [];
  const H = step;
  const xs = [from[0], to[0], ...b.list.map((q) => q[0])];
  const zs = [from[1], to[1], ...b.list.map((q) => q[1])];
  const i0 = Math.floor(Math.min(...xs) / H) - 2;
  const i1 = Math.ceil(Math.max(...xs) / H) + 2;
  const j0 = Math.floor(Math.min(...zs) / H) - 2;
  const j1 = Math.ceil(Math.max(...zs) / H) + 2;
  const at = (k) => k.split(',').map((v) => Number(v) * H);
  const free = (i, j) => !b.list.some((q) => inside([i * H, j * H], q, b.half));
  // the grid points round a spot it can get to (or from) straight
  const near = (p) => {
    const out = [];
    for (let i = Math.floor(p[0] / H) - 1; i <= Math.ceil(p[0] / H) + 1; i++)
      for (let j = Math.floor(p[1] / H) - 1; j <= Math.ceil(p[1] / H) + 1; j++) if (free(i, j) && clear(p, [i * H, j * H], b)) out.push(`${i},${j}`);
    return out;
  };
  const ends = new Set(near(to));
  const cost = new Map();
  const prev = new Map();
  const open = new Map(); // what to look on from: its cost so far, plus the straight way left
  const guess = (k) => {
    const [x, z] = at(k);
    return Math.hypot(x - to[0], z - to[1]);
  };
  for (const k of near(from)) {
    const [x, z] = at(k);
    const g = Math.hypot(x - from[0], z - from[1]);
    cost.set(k, g);
    open.set(k, g + guess(k));
  }
  let found = null;
  while (open.size) {
    let k = null;
    let best = Infinity;
    for (const [key, f] of open) if (f < best) [k, best] = [key, f];
    open.delete(k);
    if (ends.has(k)) {
      found = k;
      break;
    }
    const [i, j] = k.split(',').map(Number);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di;
        const nj = j + dj;
        if ((!di && !dj) || ni < i0 || ni > i1 || nj < j0 || nj > j1 || !free(ni, nj)) continue;
        const nk = `${ni},${nj}`;
        if (di && dj && !clear(at(k), at(nk), b)) continue; // not across a corner of something
        const g = cost.get(k) + Math.hypot(di, dj) * H;
        if (g >= (cost.get(nk) ?? Infinity)) continue;
        cost.set(nk, g);
        prev.set(nk, k);
        open.set(nk, g + guess(nk));
      }
  }
  if (!found) return [];
  const points = [to];
  for (let k = found; k; k = prev.get(k)) points.unshift(at(k));
  points.unshift(from);
  // cut the corners: from each turn, straight on to the farthest one it can reach
  const way = [];
  for (let k = 0; k < points.length - 1; ) {
    let m = points.length - 1;
    while (m > k + 1 && !clear(points[k], points[m], b)) m--;
    way.push(points[m]);
    k = m;
  }
  return way.slice(0, -1);
}
