// Its place as a small world you can walk around: the map it built, in plain WebGL (no libraries).
// Every thing stands where it built it, as its own drawing on a card of paper; the card it lives on glows in the
// middle; its light floats where it was last; the light of the sky follows its clock.
import { moodRGB } from './presence.js';

const PAPER = '#efe4d0';
const ORIGIN_PITCH = 0.5;

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

/** The ground: dots where tiles meet, and the paths it grew along, drawn flat. */
function groundTexture(world, margin) {
  const px = 40;
  const W = world.w + margin * 2;
  const H = world.h + margin * 2;
  const [c, g] = canvas2d(W * px, H * px);
  const grad = g.createRadialGradient((c.width / 2), (c.height / 2), px, c.width / 2, c.height / 2, c.width * 0.62);
  grad.addColorStop(0, '#2a3036');
  grad.addColorStop(0.55, '#1d2228');
  grad.addColorStop(1, '#14171c');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // its map, a little lighter than the land around it
  g.fillStyle = 'rgba(160, 190, 210, 0.05)';
  g.fillRect(margin * px, margin * px, world.w * px, world.h * px);
  g.fillStyle = 'rgba(200, 220, 235, 0.22)';
  for (let x = 0; x <= world.w; x++) for (let y = 0; y <= world.h; y++) g.fillRect((x + margin) * px - 2, (y + margin) * px - 2, 4, 4);
  const mid = (p) => [(p.x + margin + 0.5) * px, (p.y + margin + 0.5) * px];
  const byId = new Map(world.things.map((t) => [t.id, t]));
  g.strokeStyle = 'rgba(230, 214, 186, 0.28)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.setLineDash([1, 11]);
  for (const t of world.things) {
    const [ax, ay] = mid(t);
    const [bx, by] = mid(byId.get(t.near) || world.card);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
  return c;
}

/** A thing as it stands in the world: its drawing on a card of paper, greyed if it is a ruin. */
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
attribute vec3 aPos; attribute vec2 aUv;
uniform mat4 uProj, uView, uModel;
varying vec2 vUv; varying float vDepth;
void main() {
  vec4 p = uView * uModel * vec4(aPos, 1.0);
  vUv = aUv; vDepth = -p.z;
  gl_Position = uProj * p;
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform vec4 uTint; uniform vec3 uFog; uniform float uFogNear, uFogFar, uLight;
varying vec2 vUv; varying float vDepth;
void main() {
  vec4 c = texture2D(uTex, vUv) * uTint;
  if (c.a < 0.02) discard;
  vec3 lit = c.rgb * uLight;
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
  return {
    p,
    aPos: gl.getAttribLocation(p, 'aPos'),
    aUv: gl.getAttribLocation(p, 'aUv'),
    uProj: u('uProj'),
    uView: u('uView'),
    uModel: u('uModel'),
    uTex: u('uTex'),
    uTint: u('uTint'),
    uFog: u('uFog'),
    uFogNear: u('uFogNear'),
    uFogFar: u('uFogFar'),
    uLight: u('uLight'),
  };
}

function mesh(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buf, count: data.length / 5 };
}

// x, y, z, u, v
const QUAD_UPRIGHT = [-0.5, 0, 0, 0, 1, 0.5, 0, 0, 1, 1, 0.5, 1, 0, 1, 0, -0.5, 0, 0, 0, 1, 0.5, 1, 0, 1, 0, -0.5, 1, 0, 0, 0];
const QUAD_CENTERED = QUAD_UPRIGHT.map((v, i) => (i % 5 === 1 ? v - 0.5 : v));
const QUAD_FLAT = [-0.5, 0, -0.5, 0, 0, 0.5, 0, -0.5, 1, 0, 0.5, 0, 0.5, 1, 1, -0.5, 0, -0.5, 0, 0, 0.5, 0, 0.5, 1, 1, -0.5, 0, 0.5, 0, 1];

function box() {
  const v = [];
  const face = (a, b, c, d) => v.push(...a, 0, 0, ...b, 1, 0, ...c, 1, 1, ...a, 0, 0, ...c, 1, 1, ...d, 0, 1);
  const [x0, x1, y0, y1, z0, z1] = [-0.5, 0.5, 0, 1, -0.5, 0.5];
  face([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  return v;
}

/**
 * @param {HTMLElement} host  an element to fill (it gets a canvas and a layer of name labels)
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
  host.append(canvas, labels);

  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false, alpha: true });
  if (!gl) {
    host.classList.add('walk-unsupported');
    return null;
  }
  const prog = compile(gl);
  const quads = { upright: mesh(gl, QUAD_UPRIGHT), centered: mesh(gl, QUAD_CENTERED), flat: mesh(gl, QUAD_FLAT), box: mesh(gl, box()) };
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
  const [white] = canvas2d(2, 2);
  white.getContext('2d').fillStyle = '#fff';
  white.getContext('2d').fillRect(0, 0, 2, 2);
  const tex = { white: texture(white), glow: texture(glowTexture()), shadow: texture(shadowTexture()), ground: null };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARGIN = 10;
  let world = null;
  let look = { mood: { lonely: 0.5, warm: 0.5 }, hour: 12, asleep: false };
  let things = []; // { t, pos, tex, label }
  let selected = null;
  let site = null; // { x, y, name, tex, label, svg }
  const cam = { yaw: 0.6, pitch: ORIGIN_PITCH, dist: 9, target: [0, 0.4, 0], goal: null };
  const creature = { pos: [0, 1.2, 0], goal: [0, 1.2, 0] };
  const keys = new Set();
  let raf = 0;
  let last = performance.now();
  let dirty = true;
  let view = null;
  let proj = null;

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

  function draw(model, m, texture, tint, { additive = false, depthWrite = true } = {}) {
    gl.uniformMatrix4fv(prog.uModel, false, model);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(prog.aUv, 2, gl.FLOAT, false, 20, 12);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4fv(prog.uTint, tint);
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(depthWrite);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
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
    host.style.setProperty('--sky-top', `rgb(${sky.top.join(',')})`);
    host.style.setProperty('--sky-low', `rgb(${sky.low.join(',')})`);

    const eye = [
      cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * Math.sin(cam.pitch),
      cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
    ];
    proj = mat.perspective(0.82, canvas.width / canvas.height, 0.1, 120);
    view = mat.lookAt(eye, cam.target);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.enableVertexAttribArray(prog.aPos);
    gl.enableVertexAttribArray(prog.aUv);
    gl.uniformMatrix4fv(prog.uProj, false, proj);
    gl.uniformMatrix4fv(prog.uView, false, view);
    gl.uniform3fv(prog.uFog, sky.low.map((v) => v / 255));
    gl.uniform1f(prog.uFogNear, cam.dist * 0.8);
    gl.uniform1f(prog.uFogFar, cam.dist * 2.6);
    gl.uniform1i(prog.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    const t = now / 1000;
    const mood = moodRGB(look.mood).map((v) => v / 255);
    const facing = Math.atan2(eye[0] - cam.target[0], eye[2] - cam.target[2]);

    // the ground
    gl.uniform1f(prog.uLight, light);
    const gw = world.w + MARGIN * 2;
    const gh = world.h + MARGIN * 2;
    const gx = gw / 2 - world.card.x - MARGIN;
    const gz = gh / 2 - world.card.y - MARGIN;
    // land beyond its map, out to where the fog takes it
    draw(mat.model([0, -0.02, 0], 0, 0, [400, 1, 400]), quads.flat, tex.white, [0.078, 0.09, 0.11, 1]);
    draw(mat.model([gx, 0, gz], 0, 0, [gw, 1, gh]), quads.flat, tex.ground, [1, 1, 1, 1]);

    // pools of light on the ground: its light, the card, you
    gl.uniform1f(prog.uLight, 1);
    draw(mat.model([0, 0.01, 0], 0, 0, [2.6, 1, 2.6]), quads.flat, tex.glow, [0.45, 0.62, 1, 0.35], { additive: true, depthWrite: false });
    draw(mat.model([creature.pos[0], 0.012, creature.pos[2]], 0, 0, [2.2, 1, 2.2]), quads.flat, tex.glow, [...mood, 0.32], { additive: true, depthWrite: false });
    draw(mat.model([cam.target[0], 0.014, cam.target[2]], 0, 0, [0.7, 1, 0.7]), quads.flat, tex.glow, [1, 1, 1, 0.22], { additive: true, depthWrite: false });

    // shadows
    for (const th of things) draw(mat.model([th.pos[0], 0.016, th.pos[2] + 0.08], 0, 0, [0.95, 1, 0.5]), quads.flat, tex.shadow, [1, 1, 1, th.t.ruin ? 0.25 : 0.45], { depthWrite: false });

    // the card it lives on: a dark slab with a blue rim
    gl.uniform1f(prog.uLight, Math.max(light, 0.75));
    draw(mat.model([0, 0, 0], 0, 0, [1, 0.14, 0.66]), quads.box, tex.white, [0.3, 0.38, 0.56, 1]);
    draw(mat.model([0, 0.145, 0], 0, 0, [0.84, 1, 0.5]), quads.flat, tex.white, [0.62, 0.74, 0.95, 1]);
    for (const dx of [-0.3, -0.1, 0.1, 0.3]) for (const dz of [-0.36, 0.36]) draw(mat.model([dx, 0.02, dz], 0, 0, [0.05, 0.05, 0.08]), quads.box, tex.white, [0.82, 0.86, 0.9, 1]);
    draw(mat.model([0, 0.15, 0], 0, 0, [1.4, 1, 1.1]), quads.flat, tex.glow, [0.5, 0.7, 1, 0.45], { additive: true, depthWrite: false });

    // the things it built, back to front so their paper edges blend
    gl.uniform1f(prog.uLight, light);
    const order = [...things, ...(site?.tex ? [site] : [])]
      .map((th) => ({ th, d: (th.pos[0] - eye[0]) ** 2 + (th.pos[2] - eye[2]) ** 2 }))
      .sort((a, b) => b.d - a.d);
    for (const { th } of order) {
      const ruin = th.t?.ruin;
      const fade = th.t ? (ruin ? 0.8 : 0.55 + 0.45 * th.t.condition) : 0.75 + 0.25 * Math.sin(t * 3);
      const lift = th === selected ? 0.06 + (reduced ? 0 : 0.03 * Math.sin(t * 2.4)) : 0;
      const tilt = ruin ? 0.22 : 0;
      draw(mat.model([th.pos[0], (ruin ? -0.06 : 0) + lift, th.pos[2]], facing, tilt, [0.9, 0.9, 1]), quads.upright, th.tex, [1, 1, 1, fade]);
      if (th === selected) draw(mat.model([th.pos[0], 0.02, th.pos[2]], 0, 0, [1.4, 1, 1.4]), quads.flat, tex.glow, [0.55, 0.85, 0.8, 0.45], { additive: true, depthWrite: false });
    }

    // its light
    gl.uniform1f(prog.uLight, 1);
    const bob = reduced ? 0 : Math.sin(t * 1.3) * 0.08;
    const size = look.asleep ? 0.75 : 1;
    draw(mat.model([creature.pos[0], creature.pos[1] + bob, creature.pos[2]], facing, 0, [1.1 * size, 1.1 * size, 1]), quads.centered, tex.glow, [...mood, 0.9], { additive: true, depthWrite: false });
    draw(mat.model([creature.pos[0], creature.pos[1] + bob, creature.pos[2]], facing, 0, [0.38 * size, 0.38 * size, 1]), quads.centered, tex.glow, [1, 0.97, 0.9, 1], { additive: true, depthWrite: false });

    placeLabels();
    dirty = false;
    if (moving || !reduced) schedule();
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
    const k = reduced ? 1 : 1 - Math.exp(-dt * 1.6);
    const before = creature.pos.slice();
    for (let i = 0; i < 3; i++) creature.pos[i] = lerp(creature.pos[i], creature.goal[i], k);
    if (Math.hypot(...sub(before, creature.pos)) > 0.0005) moving = true;
    return moving || dirty;
  }

  function walk(dx, dz) {
    const b = bounds();
    cam.target[0] = clamp(cam.target[0] + dx, b.x0, b.x1);
    cam.target[2] = clamp(cam.target[2] + dz, b.z0, b.z1);
  }

  // ---------- names, floating over the things ----------

  function placeLabels() {
    const vp = mat.mul(proj, view);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const th of [...things, ...(site ? [site] : [])]) {
      const [x, y, z, depth] = mat.apply(vp, [th.pos[0], 0.98, th.pos[2]]);
      const show = depth > 0 && z < 1 && Math.abs(x) < 1.1 && Math.abs(y) < 1.1;
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
      if (drag.pinch) cam.dist = clamp((cam.dist * drag.pinch) / d, 3, 22);
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
        cam.pitch = clamp(cam.pitch + dy * 0.006, 0.18, 1.35);
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
      cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 3, 22);
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

  function pick(e) {
    if (!view) return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = 1 - ((e.clientY - r.top) / r.height) * 2;
    const vp = mat.mul(proj, view);
    let best = null;
    for (const th of things) {
      const [x0, y0, , d] = mat.apply(vp, [th.pos[0], 0, th.pos[2]]);
      const [, y1] = mat.apply(vp, [th.pos[0], 0.85, th.pos[2]]);
      const half = Math.abs(y1 - y0) * 0.55 * (canvas.height / canvas.width);
      if (d > 0 && Math.abs(px - x0) < half && py > y0 - 0.02 && py < y1 + 0.02 && (!best || d < best.d)) best = { th, d };
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
        const th = same ? Object.assign(old, { t }) : { t, pos: toWorld(t), tex: null, label: old?.label || label(t.name) };
        th.pos = toWorld(t);
        th.label.textContent = t.name;
        th.label.classList.toggle('ruin', Boolean(t.ruin));
        if (!same) {
          if (old?.tex) gl.deleteTexture(old.tex);
          th.tex = texture(await thingTexture(t.sprite ? asset(t.sprite) : null, null, t.ruin));
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
    const at = world.things.find((t) => t.id === world.at);
    const p = at ? toWorld(at) : [0, 0, 0];
    creature.goal = [p[0] + (at ? 0.15 : 0), at ? 1.35 : 1.05, p[2] + (at ? 0.45 : 0)];
    if (first) {
      creature.pos = creature.goal.slice();
      const xs = world.things.map((t) => Math.abs(t.x - world.card.x));
      const zs = world.things.map((t) => Math.abs(t.y - world.card.y));
      cam.dist = clamp(3.5 + Math.max(0, ...xs, ...zs) * 1.3, 4.5, 13);
    }
    dirty = true;
    schedule();
  }

  /** While it builds: the site where the thing will stand, its drawing arriving as it writes it. */
  let siteTimer = 0;
  function building(b, svgText) {
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
      site = { x: b.x, y: b.y, pos: toWorld(b), tex: null, label: label(b.name, 'site'), svg: null };
      creature.goal = [site.pos[0] + 0.15, 1.35, site.pos[2] + 0.45];
    }
    site.label.textContent = b.name;
    if (svgText !== site.svg && !siteTimer) {
      // Redraw the arriving drawing a few times a second, not on every token.
      siteTimer = setTimeout(async () => {
        siteTimer = 0;
        if (!site) return;
        site.svg = svgText;
        const old = site.tex;
        site.tex = texture(await thingTexture(null, svgText || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>', false));
        if (old) gl.deleteTexture(old);
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
  }

  return {
    show,
    building,
    select: (id) => {
      selected = things.find((th) => th.t.id === id) || null;
      dirty = true;
      schedule();
    },
    focus: (id) => choose(id, { fly: true }),
    destroy,
  };
}
