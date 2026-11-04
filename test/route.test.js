// Its way round what stands: along the streets, never over a building.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clear, route } from '../web/lib/route.js';

const PITCH = 1.4;
const half = 0.47 + 0.084; // half a lot, and as far as its body reaches
// a town like Lype's: lots a street apart round its card (at 0, 0)
const lots = [[1, 1], [2, 2], [2, 1], [1, 2], [-1, 4], [-1, 2], [-4, -1], [-1, 1], [-4, -2], [-5, -2], [-5, -1]];
const b = { half, list: lots.map(([i, j]) => [i * PITCH, j * PITCH]) };
const over = (p) => b.list.some(([x, z]) => Math.abs(p[0] - x) < half && Math.abs(p[1] - z) < half);

/** Every point it passes on its way, a little apart. */
function walk(from, to) {
  const pts = [from, ...route(from, to, b, PITCH / 2), to];
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) for (let i = 0; i <= 40; i++) out.push([pts[k][0] + ((pts[k + 1][0] - pts[k][0]) * i) / 40, pts[k][1] + ((pts[k + 1][1] - pts[k][1]) * i) / 40]);
  return out;
}

test('with nothing in the way it goes straight', () => {
  assert.deepEqual(route([0.25, 0.62], [-0.7, -0.7], b, PITCH / 2), []);
  assert.deepEqual(route([0, 0], [5, 5], { half, list: [] }, PITCH / 2), []);
});

test('across the town it goes round every building, along the streets', () => {
  // from beside the far quarter, past the block of four round The Wide Rectangle, to the far side of it
  const from = [-4 * PITCH, -1 * PITCH + 0.62];
  const to = [2 * PITCH + 0.62, 2 * PITCH];
  assert.equal(clear(from, to, b), false, 'straight there would pass over something');
  const way = route(from, to, b, PITCH / 2);
  assert.ok(way.length >= 1, 'it turns');
  const passed = walk(from, to);
  assert.ok(passed.every((p) => !over(p)), 'never over a building');
  const long = passed.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - passed[i][0], p[1] - passed[i][1]), 0);
  assert.ok(long < Math.hypot(to[0] - from[0], to[1] - from[1]) * 1.6, 'not far out of its way');
});

test('into the middle of a block of four it comes up the street between them', () => {
  // the street between the four lots round The Wide Rectangle
  const to = [1.5 * PITCH, 1.5 * PITCH];
  for (const from of [[0.25, 0.62], [4 * PITCH, 4 * PITCH], [-1 * PITCH + 0.62, 4 * PITCH]]) assert.ok(walk(from, to).every((p) => !over(p)), `from ${from}`);
});

test('shut in, it has no way round (and floats over, as before)', () => {
  const ring = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) ring.push([i * 0.9, j * 0.9]);
  assert.deepEqual(route([0, 0], [5, 5], { half: 0.5, list: ring }, PITCH / 2), []);
});
