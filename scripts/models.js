// Builds the catalogue of things it can borrow: whole objects from Kenney's free (CC0) 3D kits, each turned into one
// small mesh with its colours baked into its corners, so the page can draw it without a model loader or textures.
//   node scripts/models.js [folder of unzipped kits]   (default assets/kenney: one folder per kit, as unzipped)
// Writes web/models/catalogue.json and web/models/<kit>/<name>.bin. Modular pieces (walls, roofs, road and rail
// tiles), figures and weapons are left out: it builds its own walls, and its place holds things, not people or guns.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || join(ROOT, 'assets', 'kenney');
const OUT = join(ROOT, 'web', 'models');

/** Each kit: a short name for its folder, and words about where its things belong, to help find them. */
const KITS = {
  'furniture-kit': { kit: 'furniture', words: ['home', 'house', 'room', 'indoors', 'furniture'] },
  'nature-kit': { kit: 'nature', words: ['nature', 'outside', 'garden', 'forest', 'field'] },
  'food-kit': { kit: 'food', words: ['food', 'eat', 'kitchen', 'meal'] },
  'holiday-kit': { kit: 'holiday', words: ['winter', 'holiday', 'snow', 'cold', 'gift'] },
  'fantasy-town-kit': { kit: 'town', words: ['town', 'village', 'street', 'old', 'market'] },
  'graveyard-kit': { kit: 'graveyard', words: ['graveyard', 'grave', 'death', 'night', 'remember'] },
  'pirate-kit': { kit: 'harbour', words: ['sea', 'ship', 'island', 'harbour', 'beach'] },
  'survival-kit': { kit: 'camp', words: ['camp', 'outside', 'wild', 'tools', 'work'] },
  'space-kit': { kit: 'space', words: ['space', 'stars', 'sky', 'moon', 'far'] },
  'train-kit': { kit: 'trains', words: ['train', 'travel', 'journey', 'rail'] },
  // whole buildings, for a town to grow into a city
  'city-kit-commercial': { kit: 'city', words: ['city', 'shop', 'office', 'tower', 'building'] },
  'city-kit-suburban': { kit: 'suburb', words: ['house', 'home', 'street', 'garden', 'building'] },
  'city-kit-industrial': { kit: 'works', words: ['factory', 'work', 'warehouse', 'machine', 'building'] },
};

const LEAVE_OUT = [
  // pieces of buildings and ground, not things
  /^(wall|roof|road|floor|stairs|cliff|ground|railroad|track|spline|corridor|pipe|platform|terrain|rail|balcony|overhang|paneling|doorway|supports|structure|metal-panel|patch|hole|debris|planks|poles|cabin|bridge_(side|center)|crops_dirt|snow-flat|trainset-rail|brick-wall|stone-wall|iron-fence-border|border-pillar|mast|blade|tower-(base|middle|roof|top)|castle-|monorail_track|rocket_|fountain-(corner|edge|curved)|chimney-(base|top)|crypt-(door|large-door|large-roof|small-roof)|kitchenCabinet(Corner|UpperCorner)|hedge-(curved|large-curved)|fence_(bend|corner|simpleDiagonal)|path|river|lily|stone_(tall|small|large)?[A-Z]?$|train-connector|tree-(trunk|autumn-trunk))/i,
  /^wall/i,
  // the city kits' far-away copies of their buildings, and their road and ground pieces
  /^(low-detail|road|tile|driveway|planter-|grass|pavement)/i,
  // figures, and things for hurting
  /^(character|astronaut|alien)|weapon|turret|gun|rifle|blaster|cannon/i,
];

// ---------- a little PNG reader (8-bit, not interlaced: what the kits' colour maps are) ----------

function readPng(file) {
  const b = readFileSync(file);
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let palette = null;
  let alpha = null;
  const data = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const kind = b.toString('ascii', at + 4, at + 8);
    const body = b.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      [w, h, type] = [body.readUInt32BE(0), body.readUInt32BE(4), body[9]];
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced PNGs`);
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') alpha = body;
    else if (kind === 'IDAT') data.push(body);
    at += 12 + len;
  }
  const bpp = { 2: 3, 3: 1, 6: 4 }[type];
  if (!bpp) throw new Error(`${file}: colour type ${type}`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + up - c;
      const pred = [0, a, up, (a + up) >> 1, Math.abs(p - a) <= Math.abs(p - up) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - up) <= Math.abs(p - c) ? up : c][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return {
    w,
    h,
    /** The colour at a texture coordinate, nearest pixel, wrapping as the kits' samplers do. */
    at(u, v) {
      const x = ((Math.floor(u * w) % w) + w) % w;
      const y = ((Math.floor(v * h) % h) + h) % h;
      const i = (y * w + x) * bpp;
      if (type === 3) return [palette[px[i] * 3], palette[px[i] * 3 + 1], palette[px[i] * 3 + 2]].map((v) => v / 255);
      return [px[i], px[i + 1], px[i + 2]].map((v) => v / 255);
    },
  };
}

// ---------- reading a GLB ----------

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const READ = { 5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 0], 5126: ['getFloat32', 4, 0] };

function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const [get, bytes, max] = READ[a.componentType];
  const n = SIZE[a.type];
  const stride = view.byteStride || bytes * n;
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0));
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const item = [];
    for (let k = 0; k < n; k++) {
      const v = dv[get](i * stride + k * bytes, true);
      item.push(a.normalized && max ? Math.max(v / max, -1) : v);
    }
    out.push(n === 1 ? item[0] : item);
  }
  return out;
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, [x, y, z], w = 1) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
const unit = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

/** One GLB as plain triangles: where each corner is, which way it faces, and its colour. */
function readGlb(file, colormaps) {
  const b = readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const gltf = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binAt = 20 + jsonLen;
  const bin = b.subarray(binAt + 8, binAt + 8 + b.readUInt32LE(binAt));
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const material = (i) => {
    const m = gltf.materials?.[i]?.pbrMetallicRoughness || {};
    const factor = (m.baseColorFactor || [1, 1, 1, 1]).slice(0, 3);
    const t = m.baseColorTexture;
    if (!t) return { factor };
    const image = gltf.images[gltf.textures[t.index].source];
    const map = colormaps(join(dirname(file), image.uri));
    const tr = t.extensions?.KHR_texture_transform || {};
    return { factor, map, offset: tr.offset || [0, 0], scale: tr.scale || [1, 1], rotation: tr.rotation || 0, set: tr.texCoord ?? t.texCoord ?? 0 };
  };
  const visit = (i, parent) => {
    const node = gltf.nodes[i];
    const m = mul(parent, nodeMatrix(node));
    for (const p of node.mesh != null ? gltf.meshes[node.mesh].primitives : []) {
      if ((p.mode ?? 4) !== 4) continue;
      const P = readAccessor(gltf, bin, p.attributes.POSITION);
      const N = p.attributes.NORMAL != null ? readAccessor(gltf, bin, p.attributes.NORMAL) : null;
      const mat = material(p.material);
      const UV = mat.map ? readAccessor(gltf, bin, p.attributes[`TEXCOORD_${mat.set}`]) : null;
      const I = p.indices != null ? readAccessor(gltf, bin, p.indices) : P.map((_, k) => k);
      const base = pos.length;
      P.forEach((v, k) => {
        pos.push(apply(m, v));
        nor.push(N ? unit(apply(m, N[k], 0)) : [0, 1, 0]);
        let c = mat.factor;
        if (mat.map) {
          let [u, v2] = UV[k];
          const [cs, sn] = [Math.cos(mat.rotation), Math.sin(mat.rotation)];
          [u, v2] = [cs * u * mat.scale[0] + sn * v2 * mat.scale[1] + mat.offset[0], -sn * u * mat.scale[0] + cs * v2 * mat.scale[1] + mat.offset[1]];
          c = mat.map.at(u, v2).map((x, j) => x * mat.factor[j]);
        }
        col.push(c);
      });
      for (const k of I) idx.push(base + k);
    }
    for (const c of node.children || []) visit(c, m);
  };
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = gltf.scenes?.[gltf.scene ?? 0]?.nodes || gltf.nodes.map((_, i) => i);
  for (const i of scene) visit(i, IDENTITY);
  return { pos, nor, col, idx };
}

/**
 * The mesh, squeezed into a unit box (x and z from -0.5 to 0.5, y from 0 to 1) and packed small:
 * "LYM1", corner count, index count, its real width, height and depth (3 × float32); then per corner its place (3 × uint16), facing (3 × int8, 1 spare) and colour
 * (3 × uint8, 1 spare); then the triangles' corners (uint16, or uint32 for a big mesh). Returns its real size too.
 */
function pack({ pos, nor, col, idx }) {
  const lo = [0, 1, 2].map((k) => Math.min(...pos.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pos.map((p) => p[k])));
  const dims = hi.map((v, k) => Math.max(v - lo[k], 1e-4));
  const n = pos.length;
  const wide = n > 65535;
  const bytes = 24 + n * 14 + idx.length * (wide ? 4 : 2);
  const buf = Buffer.alloc(bytes + ((4 - (bytes % 4)) % 4));
  buf.write('LYM1', 0, 'ascii');
  buf.writeUInt32LE(n, 4);
  buf.writeUInt32LE(idx.length, 8);
  dims.forEach((v, k) => buf.writeFloatLE(v, 12 + k * 4));
  let at = 24;
  for (const p of pos) for (let k = 0; k < 3; k++, at += 2) buf.writeUInt16LE(Math.round(((p[k] - lo[k]) / dims[k]) * 65535), at);
  for (const v of nor) {
    for (let k = 0; k < 3; k++) buf.writeInt8(Math.round(v[k] * 127), at++);
    at++;
  }
  for (const c of col) {
    for (let k = 0; k < 3; k++) buf.writeUInt8(Math.round(Math.min(1, Math.max(0, c[k])) * 255), at++);
    at++;
  }
  for (const i of idx) {
    if (wide) buf.writeUInt32LE(i, at);
    else buf.writeUInt16LE(i, at);
    at += wide ? 4 : 2;
  }
  return { buf, dims: dims.map((v) => +v.toFixed(3)) };
}

/** "bathroomCabinetDrawer" and "tree_blocks_dark" and "pumpkin-tall-carved" as words. */
const nameWords = (file) =>
  file
    .replace(/\.glb$/, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .split(/[-_\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w && !/^\d+$/.test(w) && !/^[a-d]$/.test(w))
    .map((w) => ({ advocado: 'avocado', musterd: 'mustard', chopstic: 'chopstick', cne: 'cone', rond: 'round', leafs: 'leaves', wholer: 'whole' })[w] || w);

const models = [];
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const maps = new Map();
const colormaps = (file) => (maps.has(file) ? maps.get(file) : maps.set(file, readPng(file)).get(file));
let bytes = 0;
const seen = new Set();
for (const folder of readdirSync(SRC)) {
  const about = KITS[folder];
  if (!about) continue;
  const models3d = join(SRC, folder, 'Models');
  const dir = ['GLB format', 'GLTF format'].map((d) => join(models3d, d)).find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.glb')));
  if (!dir) continue;
  mkdirSync(join(OUT, about.kit), { recursive: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
    const stem = file.replace(/\.glb$/, '');
    if (LEAVE_OUT.some((re) => re.test(stem))) continue;
    // Variants that differ only by a letter (rock A to F) are one thing to it: the first stands for them all.
    const words = nameWords(file);
    const key = `${about.kit}|${words.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mesh = readGlb(join(dir, file), colormaps);
    if (!mesh.idx.length) continue;
    const { buf, dims } = pack(mesh);
    const id = `${about.kit}/${stem}`;
    writeFileSync(join(OUT, `${id}.bin`), buf);
    bytes += buf.length;
    models.push({ id, words, kit: about.kit, dims });
  }
}

// A name for each, in words; where two kits have the same thing, the kit tells them apart.
const byName = new Map();
for (const m of models) byName.set(m.words.join(' '), [...(byName.get(m.words.join(' ')) || []), m]);
for (const [name, list] of byName) for (const m of list) m.name = list.length > 1 ? `${name} (${m.kit})` : name;

writeFileSync(
  join(OUT, 'catalogue.json'),
  `${JSON.stringify({
    credit: 'Borrowed models by Kenney (kenney.nl), CC0.',
    kits: Object.fromEntries(Object.values(KITS).map((k) => [k.kit, k.words])),
    models: models.map(({ id, name, words, dims }) => ({ id, name, words, dims })),
  })}\n`,
);
console.log(`${models.length} models, ${(bytes / 1048576).toFixed(1)} MB, in ${OUT}`);
