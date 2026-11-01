// Its place as a small world you can walk around, in plain WebGL (no libraries).
// What it built stands where it built it, stacked out of the solids it chose, with its drawing on a sign beside it.
// Things from before it could build in three dimensions are still only drawings, on cards of paper. The graphics card
// it lives on lies in the middle, its fans turning as fast as the real ones are worked; the land is only as wide as what
// it has built; the sky follows its clock. It moves about its place as itself: in the body it chose (or, before it
// chose one, as a light), wandering from thing to thing while it rests, at its card while it thinks, at its building
// site while it builds, and settled on the card at night. What it borrowed (ready-made models
// from the catalogue in models/) stands among its own solids, in the colours it came in.
import { COLORS, LOT, MODEL, formHeight, inlay, partialParts } from './lib/form.js';
import { moodRGB } from './presence.js';

const PAPER = '#efe4d0';
const ORIGIN_PITCH = 0.36;
const SPAN = 0.9; // how much of its tile a lot fills, so neighbours keep a path between them
const BODY = 0.042; // its body's steps, in world units: a body 24 steps tall stands about as high as a small house's door

// ---------- small matrix kit (column-major, as WebGL wants) ----------

const mat = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  },
  lookAt(eye, at, up = [0, 1, 0]) {
    let z = norm(sub(eye, at));
    let x = norm(cross(up, z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  },
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  // translate · rotateY(yaw) · rotateZ(tilt) · scale(sx, sy, sz)
  model([tx, ty, tz], yaw = 0, tilt = 0, [sx, sy, sz] = [1, 1, 1]) {
    const cy = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    return [cy * ct * sx, st * sx, -syw * ct * sx, 0, -cy * st * sy, ct * sy, syw * st * sy, 0, syw * sz, 0, cy * sz, 0, tx, ty, tz, 1];
  },
  apply(m, [x, y, z]) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
  /** The matrix that carries normals: the cofactors of the model's upper 3×3 (its inverse transpose, up to scale). */
  normal(m) {
    const [a00, a10, a20, , a01, a11, a21, , a02, a12, a22] = m;
    return [
      a11 * a22 - a12 * a21, a02 * a21 - a01 * a22, a01 * a12 - a02 * a11,
      a12 * a20 - a10 * a22, a00 * a22 - a02 * a20, a02 * a10 - a00 * a12,
      a10 * a21 - a11 * a20, a01 * a20 - a00 * a21, a00 * a11 - a01 * a10,
    ];
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** A stable 0..1 from a string, so the same part always weathers the same way. */
function hash(s) {
  let x = 2166136261;
  for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return ((x >>> 0) % 10007) / 10007;
}

// ---------- the sky, from its clock ----------

/** Sky, ground light and fog for an hour of its day (0-24). */
function skyAt(hour) {
  const keys = [
    [0, [12, 14, 32], [20, 24, 48], 0.42],
    [5, [22, 22, 46], [70, 52, 70], 0.5],
    [7, [96, 120, 168], [214, 160, 120], 0.8],
    [10, [104, 148, 196], [176, 204, 226], 1],
    [16, [96, 136, 186], [196, 196, 206], 0.98],
    [19, [70, 60, 110], [228, 140, 104], 0.74],
    [21, [20, 22, 50], [52, 40, 72], 0.5],
    [24, [12, 14, 32], [20, 24, 48], 0.42],
  ];
  let i = 0;
  while (keys[i + 1][0] <= hour) i++;
  const [h0, top0, low0, l0] = keys[i];
  const [h1, top1, low1, l1] = keys[i + 1];
  const t = (hour - h0) / (h1 - h0);
  const mix = (a, b) => a.map((v, k) => Math.round(lerp(v, b[k], t)));
  return { top: mix(top0, top1), low: mix(low0, low1), light: lerp(l0, l1, t) };
}

/** Where the sun is at an hour (rising at 6 in the east, highest at noon), and the moon opposite it. */
function sunAt(hour) {
  const a = ((hour - 6) / 12) * Math.PI;
  const sun = norm([Math.cos(a), Math.sin(a) * 0.9, -0.45]);
  const day = clamp(sun[1] * 3 + 0.2, 0, 1);
  return { sun, moon: [-sun[0], -sun[1], -sun[2]], day };
}

// ---------- textures drawn on a canvas ----------

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function glowTexture() {
  const [c, g] = canvas2d(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function shadowTexture() {
  const [c, g] = canvas2d(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/**
 * The ground. Land only reaches as far as what it has built: a little around the card and around each thing, darker
 * where something fell into a ruin, with stepping stones along what each thing was built beside. Beyond it, nothing.
 */
function groundTexture(world, margin) {
  const px = 48;
  const W = world.w + margin * 2;
  const H = world.h + margin * 2;
  const [c, g] = canvas2d(W * px, H * px);
  g.fillStyle = '#101317';
  g.fillRect(0, 0, c.width, c.height);
  const mid = (p) => [(p.x + margin + 0.5) * px, (p.y + margin + 0.5) * px];
  const held = [{ ...world.card, ruin: false, card: true }, ...world.things];
  // soft land around everything it built
  for (const t of held) {
    const [x, y] = mid(t);
    const r = px * (t.card ? 2.3 : 1.7);
    const grad = g.createRadialGradient(x, y, px * 0.3, x, y, r);
    grad.addColorStop(0, t.ruin ? 'rgba(66, 62, 58, 0.95)' : 'rgba(70, 86, 72, 0.95)');
    grad.addColorStop(0.6, t.ruin ? 'rgba(48, 46, 44, 0.6)' : 'rgba(52, 64, 58, 0.6)');
    grad.addColorStop(1, 'rgba(30, 36, 40, 0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // speckle, so it reads as ground rather than paint
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H * 6; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '210,220,200' : '0,0,0'}, ${0.03 + rnd() * 0.04})`;
    g.fillRect(rnd() * c.width, rnd() * c.height, 2, 2);
  }
  // each lot, faintly squared off
  g.strokeStyle = 'rgba(220, 230, 215, 0.08)';
  g.lineWidth = 2;
  for (const t of world.things) {
    const [x, y] = mid(t);
    g.strokeRect(x - (px * SPAN) / 2, y - (px * SPAN) / 2, px * SPAN, px * SPAN);
  }
  // stepping stones between each thing and what it was built beside
  const byId = new Map(world.things.map((t) => [t.id, t]));
  g.fillStyle = 'rgba(214, 204, 182, 0.32)';
  for (const t of world.things) {
    const [ax, ay] = mid(t);
    const [bx, by] = mid(byId.get(t.near) || world.card);
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.floor(len / (px * 0.28)));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const sx = lerp(ax, bx, k) + (hash(`${t.id}${i}`) - 0.5) * 6;
      const sy = lerp(ay, by, k) + (hash(`${i}${t.id}`) - 0.5) * 6;
      g.beginPath();
      g.ellipse(sx, sy, px * 0.09, px * 0.07, hash(`${t.id}r${i}`) * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

/** A drawing as it stands in the world: on a card of paper, greyed if it is a ruin. */
async function thingTexture(src, svgText, ruin) {
  const [c, g] = canvas2d(256, 256);
  g.fillStyle = PAPER;
  roundRect(g, 6, 6, 244, 244, 18);
  g.fill();
  g.strokeStyle = 'rgba(70, 52, 30, 0.35)';
  g.lineWidth = 4;
  g.stroke();
  const img = await svgImage(src, svgText).catch(() => null);
  if (img) g.drawImage(img, 24, 20, 208, 208);
  if (ruin) {
    const d = g.getImageData(0, 0, 256, 256);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) * 0.7;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    g.strokeStyle = 'rgba(30, 20, 20, 0.8)';
    g.lineWidth = 5;
    g.beginPath();
    let [cx, cy] = [52, 170];
    g.moveTo(cx, cy);
    for (const [dx, dy] of [[28, -36], [20, 24], [24, -44], [24, 32], [32, -24]]) g.lineTo((cx += dx), (cy += dy));
    g.stroke();
  }
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** An SVG as an image with a real size (a bare viewBox would be drawn at 300 by 150 and squashed). */
async function svgImage(src, svgText) {
  const text = svgText ?? (await (await fetch(src)).text());
  if (!/<svg[\s>]/.test(text)) throw new Error('not a drawing');
  const sized = text.replace(/<svg\b/, '<svg width="256" height="256"');
  // A data: URL, which the page's content policy allows for images (blob: it does not).
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  await img.decode();
  return img;
}

// ---------- WebGL ----------

const VS = `
attribute vec3 aPos; attribute vec2 aUv; attribute vec3 aNorm; attribute vec3 aColor;
uniform mat4 uProj, uView, uModel; uniform mat3 uNormal;
varying vec2 vUv; varying float vDepth; varying vec3 vNorm; varying vec3 vColor;
void main() {
  vec4 p = uView * uModel * vec4(aPos, 1.0);
  vUv = aUv; vDepth = -p.z; vNorm = uNormal * aNorm; vColor = aColor;
  gl_Position = uProj * p;
}`;
// uShade 0: lit only by the hour (paper, glows, the ground); 1: lit by the sun or moon and the sky, like a solid.
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform vec4 uTint; uniform vec3 uFog; uniform float uFogNear, uFogFar, uLight, uShade, uGlow;
uniform vec3 uSun, uSunColor, uSky, uGround;
varying vec2 vUv; varying float vDepth; varying vec3 vNorm; varying vec3 vColor;
void main() {
  vec4 c = texture2D(uTex, vUv) * uTint * vec4(vColor, 1.0);
  if (c.a < 0.02) discard;
  vec3 n = normalize(vNorm);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 solid = amb + uSunColor * max(dot(n, uSun), 0.0);
  vec3 lit = c.rgb * mix(vec3(uLight), solid, uShade);
  lit = mix(lit, c.rgb * 1.25, uGlow);
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFog, f), c.a);
}`;

function compile(gl) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = (n) => gl.getUniformLocation(p, n);
  const names = ['uProj', 'uView', 'uModel', 'uNormal', 'uTex', 'uTint', 'uFog', 'uFogNear', 'uFogFar', 'uLight', 'uShade', 'uGlow', 'uSun', 'uSunColor', 'uSky', 'uGround'];
  return {
    p,
    aPos: gl.getAttribLocation(p, 'aPos'),
    aUv: gl.getAttribLocation(p, 'aUv'),
    aNorm: gl.getAttribLocation(p, 'aNorm'),
    aColor: gl.getAttribLocation(p, 'aColor'),
    ...Object.fromEntries(names.map((n) => [n, u(n)])),
  };
}

function mesh(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buf, count: data.length / 8 };
}

// ---------- shapes, each standing on the ground in a unit box (x and z from -0.5 to 0.5, y from 0 to 1) ----------
// Every vertex: x, y, z, u, v, and its normal.

const vert = (v, p, n, uv = [0, 0]) => v.push(p[0], p[1], p[2], uv[0], uv[1], n[0], n[1], n[2]);
function quad(v, a, b, c, d, n, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  for (const i of [0, 1, 2, 0, 2, 3]) vert(v, [a, b, c, d][i], n, uvs[i]);
}
const tri = (v, a, b, c, n) => [a, b, c].forEach((p) => vert(v, p, n));

const UP = [0, 1, 0];
const QUAD_UPRIGHT = (() => {
  const v = [];
  quad(v, [-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  return v;
})();
const QUAD_CENTERED = QUAD_UPRIGHT.map((x, i) => (i % 8 === 1 ? x - 0.5 : x));
const QUAD_FLAT = (() => {
  const v = [];
  quad(v, [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], UP);
  return v;
})();

function boxMesh() {
  const v = [];
  const [x0, x1, y0, y1, z0, z1] = [-0.5, 0.5, 0, 1, -0.5, 0.5];
  quad(v, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], UP);
  quad(v, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad(v, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad(v, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad(v, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad(v, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  return v;
}

const SIDES = 20;
const ring = (i) => [Math.cos((i / SIDES) * Math.PI * 2) * 0.5, Math.sin((i / SIDES) * Math.PI * 2) * 0.5];

function cylinderMesh() {
  const v = [];
  for (let i = 0; i < SIDES; i++) {
    const [ax, az] = ring(i);
    const [bx, bz] = ring(i + 1);
    const na = norm([ax, 0, az]);
    const nb = norm([bx, 0, bz]);
    for (const [p, n] of [[[ax, 0, az], na], [[bx, 0, bz], nb], [[bx, 1, bz], nb], [[ax, 0, az], na], [[bx, 1, bz], nb], [[ax, 1, az], na]]) vert(v, p, n);
    tri(v, [0, 1, 0], [ax, 1, az], [bx, 1, bz], UP);
    tri(v, [0, 0, 0], [bx, 0, bz], [ax, 0, az], [0, -1, 0]);
  }
  return v;
}

function coneMesh() {
  const v = [];
  for (let i = 0; i < SIDES; i++) {
    const [ax, az] = ring(i);
    const [bx, bz] = ring(i + 1);
    const na = norm([ax * 2, 0.5, az * 2]);
    const nb = norm([bx * 2, 0.5, bz * 2]);
    vert(v, [ax, 0, az], na);
    vert(v, [bx, 0, bz], nb);
    vert(v, [0, 1, 0], norm([(ax + bx) * 2, 0.5, (az + bz) * 2]));
    tri(v, [0, 0, 0], [bx, 0, bz], [ax, 0, az], [0, -1, 0]);
  }
  return v;
}

function ballMesh() {
  const v = [];
  const LAT = 10;
  const at = (i, j) => {
    const th = (i / LAT) * Math.PI;
    const ph = (j / SIDES) * Math.PI * 2;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return [[n[0] * 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5], n];
  };
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < SIDES; j++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const [p, n] of [a, b, c, a, c, d]) vert(v, p, n);
    }
  }
  return v;
}

function roofMesh() {
  const v = [];
  const f = norm([0, 0.5, 1]);
  const b = norm([0, 0.5, -1]);
  quad(v, [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0], f);
  quad(v, [0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0], b);
  tri(v, [-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [-1, 0, 0]);
  tri(v, [0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [1, 0, 0]);
  quad(v, [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, -1, 0]);
  return v;
}

function pyramidMesh() {
  const v = [];
  const top = [0, 1, 0];
  tri(v, [-0.5, 0, 0.5], [0.5, 0, 0.5], top, norm([0, 0.5, 1]));
  tri(v, [0.5, 0, -0.5], [-0.5, 0, -0.5], top, norm([0, 0.5, -1]));
  tri(v, [-0.5, 0, -0.5], [-0.5, 0, 0.5], top, norm([-1, 0.5, 0]));
  tri(v, [0.5, 0, 0.5], [0.5, 0, -0.5], top, norm([1, 0.5, 0]));
  quad(v, [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, -1, 0]);
  return v;
}

/**
 * A borrowed model, as scripts/models.js packs it: its real size, then its corners (place in a unit box, facing,
 * colour) and its triangles. Unpacked into plain triangles, with a colour for each corner.
 */
function unpackModel(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'LYM1') throw new Error('not a model');
  const n = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const dims = [0, 1, 2].map((k) => dv.getFloat32(12 + k * 4, true));
  const P = 24;
  const N = P + n * 6;
  const C = N + n * 4;
  const I = C + n * 4;
  const wide = n > 65535;
  const v = new Float32Array(ni * 8);
  const col = new Uint8Array(ni * 4);
  for (let t = 0; t < ni; t++) {
    const i = wide ? dv.getUint32(I + t * 4, true) : dv.getUint16(I + t * 2, true);
    const o = t * 8;
    v[o] = dv.getUint16(P + i * 6, true) / 65535 - 0.5;
    v[o + 1] = dv.getUint16(P + i * 6 + 2, true) / 65535;
    v[o + 2] = dv.getUint16(P + i * 6 + 4, true) / 65535 - 0.5;
    for (let k = 0; k < 3; k++) v[o + 5 + k] = dv.getInt8(N + i * 4 + k) / 127;
    for (let k = 0; k < 3; k++) col[t * 4 + k] = dv.getUint8(C + i * 4 + k);
    col[t * 4 + 3] = 255;
  }
  return { v, col, dims };
}

const GREY = [0.46, 0.45, 0.44];

/**
 * Where each part of a thing stands, in world units around its lot's middle, and its colour as the weather has left it.
 * Wearing away, parts lean and fade; a ruin keeps only stumps of what stood on the ground, the rest lying beside them.
 */
function placedParts(t, form, dimsOf = () => null) {
  const c = t.ruin ? 0 : t.condition ?? 1;
  const out = [];
  form.parts.forEach((p, i) => {
    const salt = `${t.id}|${i}`;
    const base = p.shape === MODEL ? [1, 1, 1] : hex(COLORS[p.color] || COLORS.stone);
    const fade = t.ruin ? 0.75 : (1 - c) * 0.7;
    const color = base.map((v, k) => lerp(v, GREY[k], fade) * (t.ruin ? 0.8 : 1));
    const size = [(p.w / LOT) * SPAN, p.h / LOT, (p.d / LOT) * SPAN];
    // a borrowed model keeps its own proportions inside the space it was given
    const dims = p.shape === MODEL && dimsOf(p.model);
    if (dims) {
      const fit = Math.min(size[0] / dims[0], size[1] / dims[1], size[2] / dims[2]);
      for (let k = 0; k < 3; k++) size[k] = dims[k] * fit;
    }
    const at = [((p.x + p.w / 2) / LOT - 0.5) * SPAN, p.y / LOT, ((p.z + p.d / 2) / LOT - 0.5) * SPAN];
    // set flush into the face of a block (a window, a door), it is drawn a hair proud of it rather than in the same plane
    const face = form.parts.map((q) => inlay(p, q)).find(Boolean);
    if (face) at['xyz'.indexOf(face[0])] += face[1] * 0.004;
    let yaw = 0;
    let tilt = 0;
    if (t.ruin) {
      if (p.y === 0) size[1] *= 0.35 + hash(salt) * 0.25;
      else {
        if (i > 9) return; // the smallest pieces are gone
        at[0] = (hash(`${salt}x`) - 0.5) * SPAN * 0.9;
        at[2] = (hash(`${salt}z`) - 0.5) * SPAN * 0.9;
        at[1] = 0;
        yaw = hash(`${salt}y`) * Math.PI * 2;
        tilt = (hash(`${salt}t`) > 0.5 ? 1 : -1) * (1.25 + hash(`${salt}a`) * 0.3);
        // broken up: what fell lies in smaller pieces
        size[0] *= 0.55;
        size[2] *= 0.55;
        size[1] = Math.min(size[1] * 0.6, 0.4);
      }
    } else if (c < 1 && p.y > 0) {
      yaw = hash(`${salt}y`) * Math.PI * 2;
      tilt = (hash(`${salt}t`) - 0.5) * (1 - c) * 0.5;
    }
    out.push({ p, at, size, yaw, tilt, color, glow: p.glow && !t.ruin });
  });
  return out;
}

/**
 * @param {HTMLElement} host  an element to fill (it gets a canvas, a minimap and a layer of name labels)
 * @param {{ asset: (path: string) => string, onSelect: (id: string | null) => void }} opts
 */
export function createWalk(host, { asset, onSelect }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'walk-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Its place as a world you can walk around. Drag to look around, scroll to come closer, W A S D or the arrow keys to walk, Q and E to turn, and click a thing to read its sign.');
  const labels = document.createElement('div');
  labels.className = 'walk-labels';
  labels.setAttribute('aria-hidden', 'true');
  const selfLabel = document.createElement('div');
  const mini = document.createElement('canvas');
  mini.className = 'walk-mini';
  mini.title = 'Its whole place, from above. Click to go there.';
  mini.setAttribute('aria-hidden', 'true');
  host.append(canvas, labels, mini);
  selfLabel.className = 'walk-label self';
  labels.append(selfLabel);

  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false, alpha: true });
  if (!gl) {
    host.classList.add('walk-unsupported');
    mini.remove();
    return null;
  }
  const prog = compile(gl);
  const meshes = {
    upright: mesh(gl, QUAD_UPRIGHT),
    centered: mesh(gl, QUAD_CENTERED),
    flat: mesh(gl, QUAD_FLAT),
    block: mesh(gl, boxMesh()),
    cylinder: mesh(gl, cylinderMesh()),
    cone: mesh(gl, coneMesh()),
    ball: mesh(gl, ballMesh()),
    roof: mesh(gl, roofMesh()),
    pyramid: mesh(gl, pyramidMesh()),
  };
  const texture = (source) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  };
  // Borrowed models, fetched the first time something needs them; names (while it is still writing) via the catalogue.
  const models = new Map(); // id -> { mesh, colors, dims } | 'loading' | 'failed'
  let names = null;
  function modelFor(ref) {
    if (!ref) return null;
    let id = ref;
    if (!ref.includes('/')) {
      if (names === null) {
        names = 'loading';
        fetch('models/catalogue.json')
          .then((r) => r.json())
          .then((c) => {
            names = new Map(c.models.map((m) => [m.name, m.id]));
            refit();
          })
          .catch(() => (names = new Map()));
      }
      id = names instanceof Map ? names.get(ref) : null;
      if (!id) return null;
    }
    const got = models.get(id);
    if (got) return typeof got === 'object' ? got : null;
    models.set(id, 'loading');
    fetch(`models/${id}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        const { v, col, dims } = unpackModel(buf);
        const colors = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colors);
        gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
        models.set(id, { mesh: mesh(gl, v), colors, dims });
        refit();
      })
      .catch(() => models.set(id, 'failed'));
    return null;
  }
  const dimsOf = (ref) => modelFor(ref)?.dims || null;
  /** A model arrived: everything that borrowed it is placed again, now at its true proportions. */
  function refit() {
    for (const th of things) if (th.form) th.placed = placedParts(th.t, th.form, dimsOf);
    dirty = true;
    schedule();
  }

  const [white] = canvas2d(2, 2);
  white.getContext('2d').fillStyle = '#fff';
  white.getContext('2d').fillRect(0, 0, 2, 2);
  const tex = { white: texture(white), glow: texture(glowTexture()), shadow: texture(shadowTexture()), ground: null };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARGIN = 10;
  let world = null;
  let look = { mood: { lonely: 0.5, warm: 0.5 }, hour: 12, asleep: false, gpu: null };
  let things = []; // { t, pos, tex, label, top }
  let selected = null;
  let site = null; // { x, y, id, name, pos, tex, label, svg, parts: [{ p, at }] }
  const cam = { yaw: 0.6, pitch: ORIGIN_PITCH, dist: 9, target: [0, 0.4, 0], goal: null };
  // Where it is and where it is going: a spot on the ground (x, z), a height it floats at, which way it faces.
  const creature = { pos: [0, 0.6, 0], heading: 0, goal: null, face: null, arrived: 0, next: 0, visiting: null, trail: [], born: [] };

  const keys = new Set();
  let fan = 0;
  let raf = 0;
  let last = performance.now();
  let dirty = true;
  let view = null;
  let proj = null;
  let eye = [0, 0, 0];

  // A sky of fixed stars, the same every visit.
  const stars = Array.from({ length: 160 }, (_, i) => {
    const a = hash(`star${i}`) * Math.PI * 2;
    const e = 0.08 + hash(`alt${i}`) * 1.3;
    return { dir: [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)], size: 0.35 + hash(`s${i}`) * 0.6, tw: hash(`t${i}`) * 6 };
  });

  const toWorld = (p) => [p.x - world.card.x, 0, p.y - world.card.y];
  const bounds = () => ({ x0: -world.card.x - 1.5, x1: world.w - world.card.x + 0.5, z0: -world.card.y - 1.5, z1: world.h - world.card.y + 0.5 });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      dirty = true;
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---------- drawing ----------

  const FLAT = { shade: 0, glow: 0 };
  function draw(model, m, texture, tint, { additive = false, depthWrite = true, shade = 0, glow = 0, colors = null } = FLAT) {
    gl.uniformMatrix4fv(prog.uModel, false, model);
    gl.uniformMatrix3fv(prog.uNormal, false, mat.normal(model));
    gl.uniform1f(prog.uShade, shade);
    gl.uniform1f(prog.uGlow, glow);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(prog.aUv, 2, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(prog.aNorm, 3, gl.FLOAT, false, 32, 20);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4fv(prog.uTint, tint);
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(depthWrite);
    if (colors) {
      gl.bindBuffer(gl.ARRAY_BUFFER, colors);
      gl.enableVertexAttribArray(prog.aColor);
      gl.vertexAttribPointer(prog.aColor, 3, gl.UNSIGNED_BYTE, true, 4, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    if (colors) {
      gl.disableVertexAttribArray(prog.aColor);
      gl.vertexAttrib3f(prog.aColor, 1, 1, 1);
    }
  }
  /** A solid: lit by the sun or moon and the sky. A borrowed model not here yet is a faint box where it will stand. */
  function solid(shape, at, size, color, { yaw = 0, tilt = 0, glow = 0, alpha = 1, model = null } = {}) {
    const m = shape === MODEL ? modelFor(model) : null;
    if (shape === MODEL && !m) {
      draw(mat.model(at, yaw, tilt, size), meshes.block, tex.white, [...color, 0.18 * alpha], { shade: 1, depthWrite: false });
      return;
    }
    draw(mat.model(at, yaw, tilt, size), m ? m.mesh : meshes[shape], tex.white, [...color, alpha], { shade: 1, glow, depthWrite: alpha >= 1, colors: m?.colors });
  }
  const halo = (at, size, color, alpha) => draw(mat.model(at, 0, 0, [size, 1, size]), meshes.flat, tex.glow, [...color, alpha], { additive: true, depthWrite: false });
  const spark = (at, size, color, alpha) => draw(mat.model(at, facing(), 0, [size, size, 1]), meshes.centered, tex.glow, [...color, alpha], { additive: true, depthWrite: false });
  const facing = () => Math.atan2(eye[0] - cam.target[0], eye[2] - cam.target[2]);

  /** The graphics card it lives on: a board, a shroud, two fans turning with the real card's load, a light along its edge. */
  function drawCard(light, night, mood, t) {
    const util = clamp((look.gpu?.util ?? 8) / 100, 0, 1);
    const temp = clamp(((look.gpu?.tempC ?? 45) - 35) / 50, 0, 1);
    const heat = [lerp(0.4, 1, temp), lerp(0.7, 0.45, temp), lerp(1, 0.3, temp)];
    const y0 = 0.05;
    for (const dx of [-0.4, 0.4]) for (const dz of [-0.22, 0.22]) solid('cylinder', [dx, 0, dz], [0.04, y0, 0.04], [0.75, 0.76, 0.78]);
    solid('block', [0, y0, 0], [0.96, 0.03, 0.56], [0.1, 0.24, 0.17]); // the board
    for (let i = 0; i < 10; i++) solid('block', [-0.3 + i * 0.05, y0 - 0.01, 0.29], [0.03, 0.035, 0.012], [0.85, 0.68, 0.25]); // its gold fingers
    solid('block', [-0.5, y0, 0], [0.025, 0.26, 0.58], [0.72, 0.74, 0.77]); // the bracket
    solid('block', [0.02, y0 + 0.03, 0], [0.9, 0.11, 0.5], [0.2, 0.21, 0.24]); // the shroud
    solid('block', [0.02, y0 + 0.14, 0], [0.9, 0.012, 0.5], [0.3, 0.31, 0.35]);
    // its light, along the edge
    solid('block', [0.02, y0 + 0.07, 0.252], [0.86, 0.02, 0.006], [...mood.map((v) => v * 0.6 + 0.4)], { glow: 1 });
    // two fans in round wells
    for (const fx of [-0.2, 0.24]) {
      const top = y0 + 0.152;
      solid('cylinder', [fx, top - 0.004, 0], [0.4, 0.008, 0.4], [0.08, 0.08, 0.09]);
      solid('cylinder', [fx, top, 0], [0.09, 0.02, 0.09], [0.26, 0.27, 0.3]);
      for (let b = 0; b < 7; b++) {
        const a = fan * (fx < 0 ? 1 : -1) + (b / 7) * Math.PI * 2;
        const r = 0.1;
        solid('block', [fx + Math.cos(a) * r, top + 0.004, -Math.sin(a) * r], [0.16, 0.008, 0.06], [0.16, 0.16, 0.18], { yaw: a, tilt: 0.25 });
      }
    }
    // warmth rising off it: blue when it is cool, amber when it is worked hot
    gl.uniform1f(prog.uLight, 1);
    halo([0, 0.02, 0], 2.4, heat, 0.18 + night * 0.12 + util * 0.15);
    if (!reduced && util > 0.2) for (let i = 0; i < 3; i++) spark([Math.sin(t * 0.7 + i * 2) * 0.25, 0.3 + ((t * 0.25 + i / 3) % 1) * 0.9, 0], 0.18, heat, 0.25 * util * (1 - ((t * 0.25 + i / 3) % 1)));
    gl.uniform1f(prog.uLight, light);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const moving = step(dt);
    if (!world) return;
    resize();
    const sky = skyAt(look.hour);
    const light = look.asleep ? Math.min(sky.light, 0.5) : sky.light;
    const sun = sunAt(look.hour);
    const night = 1 - sun.day;
    host.style.setProperty('--sky-top', `rgb(${sky.top.join(',')})`);
    host.style.setProperty('--sky-low', `rgb(${sky.low.join(',')})`);

    eye = [
      cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * Math.sin(cam.pitch),
      cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
    ];
    proj = mat.perspective(0.82, canvas.width / canvas.height, 0.1, 160);
    view = mat.lookAt(eye, cam.target);
    // Where the horizon falls on screen, so the sky behind the canvas meets the fogged ground there without a seam.
    const ahead = [cam.target[0] - Math.sin(cam.yaw) * 150, 0, cam.target[2] - Math.cos(cam.yaw) * 150];
    const hy = mat.apply(mat.mul(proj, view), ahead)[1];
    host.style.setProperty('--horizon', `${clamp(((1 - hy) / 2) * 100, 0, 100).toFixed(1)}%`);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.enableVertexAttribArray(prog.aPos);
    gl.enableVertexAttribArray(prog.aUv);
    gl.enableVertexAttribArray(prog.aNorm);
    gl.disableVertexAttribArray(prog.aColor);
    gl.vertexAttrib3f(prog.aColor, 1, 1, 1);
    gl.uniformMatrix4fv(prog.uProj, false, proj);
    gl.uniformMatrix4fv(prog.uView, false, view);
    const fog = sky.low.map((v) => v / 255);
    gl.uniform3fv(prog.uFog, fog);
    gl.uniform1i(prog.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    // The light solids are lit by: the sun by day, a cooler, dimmer moon by night, and the sky all round.
    const dim = look.asleep ? 0.6 : 1;
    gl.uniform3fv(prog.uSun, sun.day > 0.05 ? sun.sun : sun.moon);
    gl.uniform3fv(prog.uSunColor, (sun.day > 0.05 ? [1, 0.93, 0.82].map((v) => v * (0.25 + 0.7 * sun.day)) : [0.36, 0.42, 0.62]).map((v) => v * dim));
    gl.uniform3fv(prog.uSky, sky.top.map((v) => (v / 255) * 0.55 + 0.2 * dim));
    gl.uniform3fv(prog.uGround, sky.low.map((v) => (v / 255) * 0.3 + 0.06));

    const t = now / 1000;
    if (!reduced) fan += dt * (1.5 + clamp((look.gpu?.util ?? 8) / 100, 0, 1) * 22);
    const mood = moodRGB(look.mood).map((v) => v / 255);

    // the sky: stars by night, the sun or the moon (out past the fog)
    gl.uniform1f(prog.uFogNear, 1000);
    gl.uniform1f(prog.uFogFar, 2000);
    gl.uniform1f(prog.uLight, 1);
    if (night > 0.05) {
      for (const s of stars) {
        const tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 1.3 + s.tw);
        spark(s.dir.map((v, k) => v * 80 + cam.target[k]), s.size * 1.6, [0.85, 0.9, 1], night * 0.85 * tw);
      }
    }
    const orb = sun.day > 0.05 ? sun.sun : sun.moon;
    const orbAt = orb.map((v, k) => v * 90 + cam.target[k]);
    if (orb[1] > -0.1) {
      const tint = sun.day > 0.05 ? [1, 0.86, 0.62] : [0.82, 0.88, 1];
      spark(orbAt, 30, tint, 0.35);
      spark(orbAt, 7, [1, 1, 0.96], sun.day > 0.05 ? 0.95 : 0.75);
    }
    gl.uniform1f(prog.uFogNear, cam.dist * 0.9);
    gl.uniform1f(prog.uFogFar, cam.dist * 3.2);

    // the ground
    gl.uniform1f(prog.uLight, light);
    const gw = world.w + MARGIN * 2;
    const gh = world.h + MARGIN * 2;
    const gx = gw / 2 - world.card.x - MARGIN;
    const gz = gh / 2 - world.card.y - MARGIN;
    draw(mat.model([0, -0.02, 0], 0, 0, [500, 1, 500]), meshes.flat, tex.white, [0.063, 0.075, 0.09, 1]);
    draw(mat.model([gx, 0, gz], 0, 0, [gw, 1, gh]), meshes.flat, tex.ground, [1, 1, 1, 1]);

    // pools of light on the ground: its light, you
    gl.uniform1f(prog.uLight, 1);
    halo([cam.target[0], 0.014, cam.target[2]], 0.7, [1, 1, 1], 0.18);

    // shadows under what stands
    for (const th of things) {
      const h = th.top;
      draw(mat.model([th.pos[0] + 0.06, 0.016, th.pos[2] + 0.06], 0, 0, th.form ? [1.25, 1, 1.25] : [0.95, 1, 0.5]), meshes.flat, tex.shadow, [1, 1, 1, th.t.ruin ? 0.25 : clamp(0.3 + h * 0.15, 0.3, 0.6)], { depthWrite: false });
    }

    gl.uniform1f(prog.uLight, light);
    drawCard(light, night, mood, t);

    // what it built, as solids
    const glows = [];
    for (const th of things) {
      if (!th.form || (site && site.id === th.t.id)) continue;
      const lift = th === selected ? 0.03 + (reduced ? 0 : 0.015 * Math.sin(t * 2.4)) : 0;
      for (const q of th.placed) {
        const at = [th.pos[0] + q.at[0], q.at[1] + lift, th.pos[2] + q.at[2]];
        solid(q.p.shape, at, q.size, q.color, { yaw: q.yaw, tilt: q.tilt, glow: q.glow ? 0.6 + night * 0.4 : 0, model: q.p.model });
        if (q.glow) glows.push({ at: [at[0], at[1] + q.size[1] / 2, at[2]], r: Math.max(q.size[0], q.size[1], q.size[2]), color: q.color });
      }
      // its sign: a post, and its drawing on a little card facing you
      if (th.signTex) {
        const sx = th.pos[0] + SPAN * 0.42;
        const sz = th.pos[2] + SPAN * 0.5;
        solid('block', [sx, 0, sz], [0.025, 0.24, 0.025], [0.42, 0.32, 0.22]);
      }
      if (th === selected) {
        gl.uniform1f(prog.uLight, 1);
        halo([th.pos[0], 0.02, th.pos[2]], 1.7, [0.55, 0.85, 0.8], 0.4);
        gl.uniform1f(prog.uLight, light);
      }
    }

    // while it builds: its lot marked out, and the parts it has written so far rising into place
    if (site) drawSite(t, light, night, mood, glows);

    // paper: the drawings that have no shape yet, and every sign; back to front so their edges blend
    const cards = [];
    for (const th of things) {
      if (site && site.id === th.t.id) continue;
      if (!th.form) cards.push({ th, at: [th.pos[0], 0, th.pos[2]], size: 0.9, tex: th.tex });
      else if (th.signTex) cards.push({ th, at: [th.pos[0] + SPAN * 0.42, 0.2, th.pos[2] + SPAN * 0.5], size: 0.24, tex: th.signTex });
    }
    if (site?.tex) cards.push({ th: site, at: site.parts.length ? [site.pos[0] + SPAN * 0.42, 0.2, site.pos[2] + SPAN * 0.5] : [site.pos[0], 0, site.pos[2]], size: site.parts.length ? 0.24 : 0.9, tex: site.tex, site: true });
    cards.sort((a, b) => (b.at[0] - eye[0]) ** 2 + (b.at[2] - eye[2]) ** 2 - ((a.at[0] - eye[0]) ** 2 + (a.at[2] - eye[2]) ** 2));
    for (const c of cards) {
      const ruin = c.th.t?.ruin;
      const fade = c.site ? 0.75 + 0.25 * Math.sin(t * 3) : c.th.form ? 1 : ruin ? 0.8 : 0.55 + 0.45 * c.th.t.condition;
      const lift = !c.th.form && c.th === selected ? 0.06 + (reduced ? 0 : 0.03 * Math.sin(t * 2.4)) : 0;
      draw(mat.model([c.at[0], c.at[1] + (ruin && !c.th.form ? -0.06 : 0) + lift, c.at[2]], facing(), ruin && !c.th.form ? 0.22 : 0, [c.size, c.size, 1]), meshes.upright, c.tex, [1, 1, 1, fade]);
      if (!c.th.form && c.th === selected) {
        gl.uniform1f(prog.uLight, 1);
        halo([c.at[0], 0.02, c.at[2]], 1.4, [0.55, 0.85, 0.8], 0.45);
        gl.uniform1f(prog.uLight, light);
      }
    }

    // light: what glows in what it built, brighter at night
    gl.uniform1f(prog.uLight, 1);
    for (const g of glows) {
      spark(g.at, 0.35 + g.r * 2.2, g.color.map((v) => v * 0.6 + 0.4), 0.18 + night * 0.5);
      halo([g.at[0], 0.02, g.at[2]], 0.6 + g.r * 3, g.color.map((v) => v * 0.6 + 0.4), 0.06 + night * 0.25);
    }

    // it: the body it chose, with a little of its light about it, or (before it chose one) only its light
    const form = body();
    creature.trail.forEach((p, i) => spark(p, 0.12 + (i / creature.trail.length) * 0.16, mood, (i / creature.trail.length) * 0.3));
    halo([creature.pos[0], 0.015, creature.pos[2]], form ? 1.1 : 1.6, mood, look.asleep ? 0.15 : 0.28);
    if (form) {
      gl.uniform1f(prog.uLight, light);
      creature.height = drawBody(form, t, night, mood);
      gl.uniform1f(prog.uLight, 1);
      spark([creature.pos[0], creature.pos[1] + creature.height * 0.55, creature.pos[2]], creature.height * 1.6 + 0.3, mood, look.asleep ? 0.12 : 0.22);
    } else {
      const bob = reduced ? 0 : Math.sin(t * 1.3) * 0.08;
      const size = look.asleep ? 0.75 : 1;
      creature.height = 0.4;
      spark([creature.pos[0], creature.pos[1] + bob, creature.pos[2]], 1.1 * size, mood, 0.9);
      spark([creature.pos[0], creature.pos[1] + bob, creature.pos[2]], 0.38 * size, [1, 0.97, 0.9], 1);
    }

    placeLabels();
    drawMini();
    dirty = false;
    if (moving || !reduced) schedule();
  }

  function drawSite(t, light, night, mood, glows) {
    const [x, , z] = site.pos;
    const half = SPAN / 2;
    gl.uniform1f(prog.uLight, 1);
    const pulse = 0.45 + (reduced ? 0 : 0.2 * Math.sin(t * 4));
    // the lot, marked out in its light
    for (const [dx, dz, sx, sz] of [[0, -half, SPAN, 0.025], [0, half, SPAN, 0.025], [-half, 0, 0.025, SPAN], [half, 0, 0.025, SPAN]]) {
      draw(mat.model([x + dx, 0.02, z + dz], 0, 0, [sx, 1, sz]), meshes.flat, tex.white, [...mood.map((v) => v * 0.5 + 0.5), pulse], { additive: true, depthWrite: false });
    }
    halo([x, 0.02, z], 1.8, mood, 0.25);
    gl.uniform1f(prog.uLight, light);
    const now = performance.now();
    const fake = { id: site.id || 'site', condition: 1, ruin: false };
    const placed = placedParts(fake, { parts: site.parts.map((s) => s.p) }, dimsOf);
    placed.forEach((q, i) => {
      const k = reduced ? 1 : clamp((now - site.parts[i].at) / 700, 0, 1);
      const ease = 1 - (1 - k) ** 3;
      const at = [x + q.at[0], q.at[1] - (1 - ease) * 0.35, z + q.at[2]];
      solid(q.p.shape, at, q.size, q.color, { glow: q.glow ? 0.6 + night * 0.4 : (1 - ease) * 0.8, alpha: 0.35 + 0.65 * ease, model: q.p.model });
      if (q.glow) glows.push({ at: [at[0], at[1] + q.size[1] / 2, at[2]], r: Math.max(...q.size), color: q.color });
      if (k < 1) {
        gl.uniform1f(prog.uLight, 1);
        spark([at[0], at[1] + q.size[1], at[2]], 0.5, mood, (1 - k) * 0.8);
        gl.uniform1f(prog.uLight, light);
      }
    });
    // a thread of its light from it to where it is building
    gl.uniform1f(prog.uLight, 1);
    const top = [x, Math.max(0.3, formHeight({ parts: site.parts.map((s) => s.p) })) + 0.05, z];
    const from = [creature.pos[0], creature.pos[1] + (creature.height || 0.4) * 0.6, creature.pos[2]];
    for (let i = 0; i < 14; i++) {
      const k = (i / 14 + (reduced ? 0 : t * 0.6)) % 1;
      spark([lerp(from[0], top[0], k), lerp(from[1], top[1], k) + Math.sin(k * Math.PI) * 0.15, lerp(from[2], top[2], k)], 0.16, mood, 0.55 * Math.sin(k * Math.PI));
    }
    gl.uniform1f(prog.uLight, light);
  }

  function schedule() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  /** Move the camera and its light toward where they are going; true while anything is still moving. */
  function step(dt) {
    let moving = false;
    if (keys.size) {
      const speed = (keys.has('Shift') ? 7 : 3.4) * dt;
      const fwd = [-Math.sin(cam.yaw), -Math.cos(cam.yaw)];
      const right = [Math.cos(cam.yaw), -Math.sin(cam.yaw)];
      let dx = 0;
      let dz = 0;
      if (keys.has('w') || keys.has('ArrowUp')) (dx += fwd[0]), (dz += fwd[1]);
      if (keys.has('s') || keys.has('ArrowDown')) (dx -= fwd[0]), (dz -= fwd[1]);
      if (keys.has('d') || keys.has('ArrowRight')) (dx += right[0]), (dz += right[1]);
      if (keys.has('a') || keys.has('ArrowLeft')) (dx -= right[0]), (dz -= right[1]);
      if (keys.has('q')) cam.yaw += 1.6 * dt;
      if (keys.has('e')) cam.yaw -= 1.6 * dt;
      walk(dx * speed, dz * speed);
      cam.goal = null;
      moving = true;
    }
    if (cam.goal) {
      const k = reduced ? 1 : 1 - Math.exp(-dt * 4);
      for (let i = 0; i < 3; i++) cam.target[i] = lerp(cam.target[i], cam.goal[i], k);
      if (Math.hypot(...sub(cam.target, cam.goal)) < 0.01) cam.goal = null;
      moving = true;
    }
    const moved = world ? move(dt) : 0;
    if (moved > 0.0005) moving = true;
    if (!reduced && (moved > 0.002 || creature.trail.length)) {
      if (moved > 0.002) creature.trail.push(creature.pos.slice());
      else creature.trail.shift();
      if (creature.trail.length > 18) creature.trail.shift();
    }
    return moving || dirty;
  }

  // ---------- it, moving about its place ----------

  const angleTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
  const turn = (a, b, k) => a + (((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
  /** A spot beside a thing, on its side facing `toward`, and the way to face to look at it. */
  function beside(th, toward = [0, 0]) {
    // the sides of its lot, nearest to `toward` first; open ground before a side where something else stands
    const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      .map((dir) => ({ dir, spot: [th.pos[0] + dir[0] * 0.66, th.pos[2] + dir[1] * 0.66] }))
      .sort((a, b) => Math.hypot(a.spot[0] - toward[0], a.spot[1] - toward[1]) - Math.hypot(b.spot[0] - toward[0], b.spot[1] - toward[1]));
    const { spot } = sides.find((s) => !clearance(...s.spot)) || sides[0];
    return { spot, face: angleTo(spot, [th.pos[0], th.pos[2]]) };
  }

  /**
   * Where it goes, from what it is really doing: beside its building site while it builds, at its card while it is
   * awake for anything else, settled on the card at night. Resting between cycles it wanders from one thing it built to
   * the next and stays a while with each, newest and most-tended first.
   */
  function decide(now) {
    if (site) {
      const lot = { pos: site.pos };
      creature.visiting = null;
      return beside(lot, [site.pos[0] + 0.2, site.pos[2] + 1]);
    }
    if (look.asleep || look.mode === 'night') {
      creature.visiting = null;
      return { spot: [0, 0], face: null, settle: true };
    }
    if (look.mode === 'awake' || reduced) {
      creature.visiting = null;
      const at = reduced && things.find((th) => th.t.id === world.at);
      return at ? beside(at, [0, 0]) : { spot: [0.25, 0.62], face: Math.PI };
    }
    // resting: wander
    const standing = things.filter((th) => !th.t.ruin);
    if (!creature.goal || (creature.arrived && now > creature.next) || (creature.visiting && !standing.includes(creature.visiting))) {
      const newest = Math.max(1, ...standing.map((th) => th.t.tended ?? th.t.built ?? 0));
      const choices = [...standing.filter((th) => th !== creature.visiting).map((th) => ({ th, w: 1 + (2 * (th.t.tended ?? th.t.built ?? 0)) / newest })), { th: null, w: 0.8 }];
      let r = Math.random() * choices.reduce((a, c) => a + c.w, 0);
      const pick = choices.find((c) => (r -= c.w) <= 0) || choices.at(-1);
      creature.visiting = pick.th;
      creature.arrived = 0;
      if (pick.th) {
        const from = [creature.pos[0], creature.pos[2]];
        return beside(pick.th, Math.random() < 0.5 ? from : [pick.th.pos[0] + (Math.random() - 0.5) * 4, pick.th.pos[2] + (Math.random() - 0.5) * 4]);
      }
      const a = Math.random() * Math.PI * 2;
      return { spot: [Math.cos(a) * 0.9, Math.sin(a) * 0.9], face: angleTo([Math.cos(a), Math.sin(a)], [0, 0]) };
    }
    return creature.goal;
  }

  /** How high it has to float here to pass over what stands below it. */
  function clearance(x, z) {
    let need = 0;
    if (Math.abs(x) < 0.55 && Math.abs(z) < 0.45) need = 0.24; // the card
    for (const th of things) if (Math.abs(x - th.pos[0]) < 0.47 && Math.abs(z - th.pos[2]) < 0.47) need = Math.max(need, th.top + 0.04);
    return need;
  }

  /** One step of it moving: toward where it is going, over what is in the way, turning to where it goes or looks. */
  function move(dt) {
    const now = performance.now();
    const goal = decide(now);
    if (goal !== creature.goal) creature.goal = goal;
    const [x, , z] = creature.pos;
    const [gx, gz] = goal.spot;
    const d = Math.hypot(gx - x, gz - z);
    const before = creature.pos.slice();
    const wandering = look.mode !== 'awake' && !site && !goal.settle;
    if (reduced) {
      creature.pos[0] = gx;
      creature.pos[2] = gz;
    } else if (d > 0.002) {
      const speed = (wandering ? 0.5 : 1.3) * clamp(d / 0.5, 0.2, 1);
      const k = Math.min(1, (speed * dt) / d);
      creature.pos[0] += (gx - x) * k;
      creature.pos[2] += (gz - z) * k;
    }
    const left = Math.hypot(gx - creature.pos[0], gz - creature.pos[2]);
    if (left < 0.03 && !creature.arrived) {
      creature.arrived = now;
      creature.next = now + 6000 + Math.random() * 7000; // it stays a while with what it visits
    }
    // float: just off the ground, higher over whatever it passes, resting on the card at night
    const hover = body() ? 0.1 : 0.55;
    const ahead = d > 0.01 ? [creature.pos[0] + ((gx - x) / d) * 0.3, creature.pos[2] + ((gz - z) / d) * 0.3] : [creature.pos[0], creature.pos[2]];
    const want = goal.settle ? 0.26 : Math.max(clearance(creature.pos[0], creature.pos[2]), clearance(...ahead)) + hover;
    creature.pos[1] = reduced ? want : lerp(creature.pos[1], want, 1 - Math.exp(-dt * 3));
    // facing: where it is going while it goes; once there, what it came to look at (or you)
    const going = Math.hypot(creature.pos[0] - before[0], creature.pos[2] - before[2]);
    const aim = going > 0.0004 ? angleTo([before[0], before[2]], [creature.pos[0], creature.pos[2]]) : goal.face ?? facing();
    creature.heading = reduced ? aim : turn(creature.heading, aim, 1 - Math.exp(-dt * 3));
    const moved = Math.hypot(...sub(before, creature.pos));
    return moved + (Math.abs(aim - creature.heading) > 0.01 ? 0.001 : 0);
  }

  /** The body it chose (or the one it is choosing right now, part by part), or null while it is only a light. */
  function body() {
    if (look.bodyLive != null) {
      const parts = partialParts(look.bodyLive);
      const now = performance.now();
      creature.born = parts.map((p, i) => creature.born[i] ?? now);
      return parts.length ? { parts, live: true } : null;
    }
    return look.body?.parts?.length ? look.body : null;
  }

  /** Its body where it is: each part around its middle, turned the way it faces, bobbing a little as it floats. */
  function drawBody(form, t, night, mood) {
    const bob = reduced ? 0 : Math.sin(t * 1.3) * 0.03;
    const [cx, cy, cz] = creature.pos;
    const cos = Math.cos(creature.heading);
    const sin = Math.sin(creature.heading);
    const now = performance.now();
    form.parts.forEach((p, i) => {
      let size = [p.w * BODY, p.h * BODY, p.d * BODY];
      const dims = p.shape === MODEL && dimsOf(p.model);
      if (dims) {
        const fit = Math.min(size[0] / dims[0], size[1] / dims[1], size[2] / dims[2]);
        size = dims.map((v) => v * fit);
      }
      const ox = (p.x + p.w / 2 - LOT / 2) * BODY;
      const oz = (p.z + p.d / 2 - LOT / 2) * BODY;
      const rise = form.live && !reduced ? 1 - (1 - clamp((now - creature.born[i]) / 700, 0, 1)) ** 3 : 1;
      const at = [cx + cos * ox + sin * oz, cy + p.y * BODY + bob - (1 - rise) * 0.2, cz - sin * ox + cos * oz];
      const color = p.shape === MODEL ? [1, 1, 1] : hex(COLORS[p.color] || COLORS.stone);
      const glow = p.glow ? 0.6 + night * 0.4 : form.live ? (1 - rise) * 0.8 : 0;
      solid(p.shape, at, size, look.asleep ? color.map((v) => v * 0.7) : color, { yaw: creature.heading, glow, alpha: 0.35 + 0.65 * rise, model: p.model });
    });
    return formHeight(form) * LOT * BODY;
  }

  function walk(dx, dz) {
    const b = bounds();
    cam.target[0] = clamp(cam.target[0] + dx, b.x0, b.x1);
    cam.target[2] = clamp(cam.target[2] + dz, b.z0, b.z1);
  }

  // ---------- the minimap: its whole place from above ----------

  function drawMini() {
    const W = world.w;
    const H = world.h;
    const cell = host.clientWidth < 560 ? 6 : 10;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (mini.width !== (W + 2) * cell * dpr || mini.style.width !== `${(W + 2) * cell}px`) {
      mini.width = (W + 2) * cell * dpr;
      mini.height = (H + 2) * cell * dpr;
      mini.style.width = `${(W + 2) * cell}px`;
      mini.style.height = `${(H + 2) * cell}px`;
    }
    const g = mini.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, cell * dpr, cell * dpr);
    g.clearRect(-cell, -cell, (W + 2) * cell, (H + 2) * cell);
    g.fillStyle = 'rgba(200, 220, 235, 0.22)';
    for (let x = 0; x <= W; x++) for (let y = 0; y <= H; y++) g.fillRect(x * cell - 0.5, y * cell - 0.5, 1, 1);
    // the land it has, as in the world
    g.fillStyle = 'rgba(96, 120, 100, 0.22)';
    for (const p of [world.card, ...world.things]) g.fillRect((p.x - 1) * cell, (p.y - 1) * cell, cell * 3, cell * 3);
    for (const th of things) {
      const t = th.t;
      // a borrowed model has no colour of its own to show here
      const own = th.form?.parts.filter((p) => p.shape !== MODEL) || [];
      const main = own.length ? COLORS[own.reduce((a, p) => (p.w * p.d * p.h > a.w * a.d * a.h ? p : a)).color] : th.form ? '#b9a98c' : PAPER;
      g.globalAlpha = t.ruin ? 0.5 : 0.6 + 0.4 * t.condition;
      g.fillStyle = t.ruin ? '#6b6763' : main;
      g.fillRect(t.x * cell + 1, t.y * cell + 1, cell - 2, cell - 2);
      if (th === selected) {
        g.globalAlpha = 1;
        g.strokeStyle = '#8fd8cc';
        g.lineWidth = 1.5;
        g.strokeRect(t.x * cell + 0.5, t.y * cell + 0.5, cell - 1, cell - 1);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#7f9cdc';
    g.fillRect(world.card.x * cell + 1, world.card.y * cell + 2.5, cell - 2, cell - 5);
    if (site) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.setLineDash([2, 2]);
      g.strokeRect(site.x * cell + 0.5, site.y * cell + 0.5, cell - 1, cell - 1);
      g.setLineDash([]);
    }
    // its light
    const mood = moodRGB(look.mood);
    const lx = (creature.pos[0] + world.card.x + 0.5) * cell;
    const ly = (creature.pos[2] + world.card.y + 0.5) * cell;
    g.fillStyle = `rgba(${mood.join(',')}, 0.95)`;
    g.beginPath();
    g.arc(lx, ly, 2.6, 0, Math.PI * 2);
    g.fill();
    // you, and which way you are looking
    const yx = (cam.target[0] + world.card.x + 0.5) * cell;
    const yy = (cam.target[2] + world.card.y + 0.5) * cell;
    const a = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(yx, yy);
    g.arc(yx, yy, cell * 3, a - 0.5, a + 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(yx, yy, 2, 0, Math.PI * 2);
    g.fill();
  }

  mini.addEventListener('click', (e) => {
    if (!world) return;
    const r = mini.getBoundingClientRect();
    const cell = r.width / (world.w + 2);
    const x = (e.clientX - r.left) / cell - 1 - 0.5 - world.card.x;
    const z = (e.clientY - r.top) / cell - 1 - 0.5 - world.card.y;
    const b = bounds();
    cam.goal = [clamp(x, b.x0, b.x1), 0.4, clamp(z, b.z0, b.z1)];
    schedule();
  });

  // ---------- names, floating over the things ----------

  function placeLabels() {
    const vp = mat.mul(proj, view);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    {
      const [x, y, z, depth] = mat.apply(vp, [creature.pos[0], creature.pos[1] + (creature.height || 0.4) + 0.12, creature.pos[2]]);
      const show = Boolean(look.name) && depth > 0 && z < 1 && Math.abs(x) < 1.1 && Math.abs(y) < 1.1;
      selfLabel.hidden = !show;
      if (show) {
        selfLabel.textContent = look.name;
        selfLabel.style.transform = `translate(${((x + 1) / 2) * w}px, ${((1 - y) / 2) * h}px) translate(-50%, -100%)`;
      }
    }
    for (const th of [...things, ...(site ? [site] : [])]) {
      const hidden = th !== site && site && site.id === th.t.id;
      const top = th === site ? Math.max(0.98, formHeight({ parts: site.parts.map((s) => s.p) }) + 0.18) : th.top + 0.18;
      const [x, y, z, depth] = mat.apply(vp, [th.pos[0], top, th.pos[2]]);
      const show = !hidden && depth > 0 && z < 1 && Math.abs(x) < 1.1 && Math.abs(y) < 1.1;
      th.label.hidden = !show;
      if (!show) continue;
      th.label.style.transform = `translate(${((x + 1) / 2) * w}px, ${((1 - y) / 2) * h}px) translate(-50%, -100%)`;
      th.label.style.opacity = String(clamp(1.6 - depth / (cam.dist * 2.2), 0.25, 1));
      th.label.classList.toggle('selected', th === selected);
    }
  }

  function label(text, cls = '') {
    const el = document.createElement('div');
    el.className = `walk-label ${cls}`;
    el.textContent = text;
    labels.append(el);
    return el;
  }

  // ---------- input ----------

  let drag = null;
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, pinch: pointers.size === 2 ? pinchDist() : 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const d = pinchDist();
      if (drag.pinch) cam.dist = clamp((cam.dist * drag.pinch) / d, 2.5, 22);
      drag.pinch = d;
      drag.moved += 10;
    } else {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) {
        const s = cam.dist / canvas.clientHeight;
        walk(-(dx * Math.cos(cam.yaw) + dy * Math.sin(cam.yaw)) * s * 1.2, (dx * Math.sin(cam.yaw) - dy * Math.cos(cam.yaw)) * s * 1.2);
      } else {
        cam.yaw -= dx * 0.008;
        cam.pitch = clamp(cam.pitch + dy * 0.006, 0.12, 1.35);
      }
      cam.goal = null;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    dirty = true;
    schedule();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (drag && drag.moved < 6 && pointers.size === 0) pick(e);
    if (!pointers.size) drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 2.5, 22);
      dirty = true;
      schedule();
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(k)) {
      e.preventDefault();
      if (!e.repeat && !keys.has(k)) {
        // A tap is a step; holding the key keeps walking.
        keys.add(k);
        step(0.12);
        dirty = true;
      }
      keys.add(k);
      schedule();
    } else if (k === 'Escape') {
      choose(null);
    } else if (k === 'Tab' && things.length) {
      // Tab walks from one thing to the next.
      e.preventDefault();
      const i = things.indexOf(selected);
      choose(things[(i + (e.shiftKey ? things.length - 1 : 1)) % things.length].t.id, { fly: true });
    }
  });
  canvas.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  canvas.addEventListener('blur', () => keys.clear());
  const onVisible = () => !document.hidden && schedule();
  document.addEventListener('visibilitychange', onVisible);

  function pinchDist() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  }

  /** What is under the pointer: the nearest thing whose standing box, as seen on screen, holds it. */
  function pick(e) {
    if (!view) return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = 1 - ((e.clientY - r.top) / r.height) * 2;
    const vp = mat.mul(proj, view);
    let best = null;
    for (const th of things) {
      const half = th.form ? SPAN / 2 : 0.45;
      const top = th.form ? Math.max(th.top, 0.2) : 0.85;
      let [x0, y0, x1, y1, d] = [Infinity, Infinity, -Infinity, -Infinity, Infinity];
      for (const dx of [-half, half]) {
        for (const dz of th.form ? [-half, half] : [0]) {
          for (const y of [0, top]) {
            const [x, yy, , w] = mat.apply(vp, [th.pos[0] + dx, y, th.pos[2] + dz]);
            if (w <= 0) continue;
            [x0, x1, y0, y1, d] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, yy), Math.max(y1, yy), Math.min(d, w)];
          }
        }
      }
      if (d < Infinity && px > x0 && px < x1 && py > y0 - 0.02 && py < y1 + 0.02 && (!best || d < best.d)) best = { th, d };
    }
    choose(best?.th.t.id ?? null);
  }

  function choose(id, { fly = false } = {}) {
    selected = things.find((th) => th.t.id === id) || null;
    if (selected && fly) cam.goal = [selected.pos[0], 0.4, selected.pos[2]];
    dirty = true;
    schedule();
    onSelect?.(selected?.t.id ?? null);
  }

  // ---------- what it shows ----------

  async function show(next, nextLook = {}) {
    const first = !world;
    const changed = !world || JSON.stringify(next.things) !== JSON.stringify(world.things);
    world = next;
    look = { ...look, ...nextLook };
    if (changed) {
      if (tex.ground) gl.deleteTexture(tex.ground);
      tex.ground = texture(groundTexture(world, MARGIN));
      const keep = new Map(things.map((th) => [th.t.id, th]));
      const fresh = [];
      for (const t of world.things) {
        const old = keep.get(t.id);
        const same = old && old.t.sprite === t.sprite && old.t.ruin === t.ruin;
        const th = same ? Object.assign(old, { t }) : { t, pos: toWorld(t), tex: null, signTex: null, label: old?.label || label(t.name) };
        th.pos = toWorld(t);
        th.form = t.form?.parts?.length ? t.form : null;
        th.placed = th.form ? placedParts(t, th.form, dimsOf) : [];
        th.top = th.form ? (t.ruin ? 0.35 : formHeight(th.form)) : 0.85;
        th.label.textContent = t.name;
        th.label.classList.toggle('ruin', Boolean(t.ruin));
        if (!same) {
          if (old?.tex) gl.deleteTexture(old.tex);
          if (old?.signTex && old.signTex !== old.tex) gl.deleteTexture(old.signTex);
          th.tex = texture(await thingTexture(t.sprite ? asset(t.sprite) : null, null, t.ruin));
          th.signTex = t.sprite ? th.tex : null;
        }
        keep.delete(t.id);
        fresh.push(th);
      }
      for (const gone of keep.values()) {
        gone.label.remove();
        if (gone.tex) gl.deleteTexture(gone.tex);
      }
      things = fresh;
      if (selected) selected = things.find((th) => th.t.id === selected.t.id) || null;
    }
    if (first) {
      // it starts where it was last (beside that thing, or at its card)
      const at = things.find((th) => th.t.id === world.at);
      const start = at ? beside(at, [0, 0]).spot : [0.25, 0.62];
      creature.pos = [start[0], 0.6, start[1]];
      const xs = world.things.map((t) => Math.abs(t.x - world.card.x));
      const zs = world.things.map((t) => Math.abs(t.y - world.card.y));
      cam.dist = clamp(3.5 + Math.max(0, ...xs, ...zs) * 1.3, 4.5, 13);
    }
    dirty = true;
    schedule();
  }

  /**
   * While it builds: the site where the thing will stand, its drawing arriving as it writes it, then its parts rising
   * one by one as it writes those. `b.id` is set when it is reshaping something already there.
   */
  let siteTimer = 0;
  function building(b, svgText, formText) {
    if (!b) {
      if (site) {
        site.label.remove();
        if (site.tex) gl.deleteTexture(site.tex);
        site = null;
        dirty = true;
        schedule();
      }
      return;
    }
    if (!site || site.x !== b.x || site.y !== b.y) {
      if (site) building(null);
      site = { x: b.x, y: b.y, id: b.id || null, pos: toWorld(b), tex: null, label: label(b.name, 'site'), svg: null, parts: [] };
    }
    site.label.textContent = b.name;
    const parts = partialParts(formText);
    const now = performance.now();
    site.parts = parts.map((p, i) => ({ p, at: site.parts[i]?.at ?? now }));
    const old = site.id && things.find((th) => th.t.id === site.id);
    if (svgText !== site.svg && !siteTimer) {
      // Redraw the arriving drawing a few times a second, not on every token.
      siteTimer = setTimeout(async () => {
        siteTimer = 0;
        if (!site) return;
        site.svg = svgText;
        const prev = site.tex;
        // reshaping something without drawing it again: its old drawing stays on its sign
        site.tex = svgText || !old?.t.sprite ? texture(await thingTexture(null, svgText || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>', false)) : texture(await thingTexture(asset(old.t.sprite), null, false));
        if (prev) gl.deleteTexture(prev);
        dirty = true;
        schedule();
      }, 160);
    }
    dirty = true;
    schedule();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    clearTimeout(siteTimer);
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    labels.remove();
    mini.remove();
  }

  return {
    show,
    building,
    /** What it is doing now, its body, its name: it goes where that takes it. */
    setLook(next) {
      if (next.bodyLive == null) creature.born = [];
      look = { ...look, ...next };
      dirty = true;
      schedule();
    },
    select: (id) => {
      selected = things.find((th) => th.t.id === id) || null;
      dirty = true;
      schedule();
    },
    focus: (id) => choose(id, { fly: true }),
    destroy,
  };
}
