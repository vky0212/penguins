// Converts the source "Baby Emperor Penguin (Chick)" GLB into assets/chick.glb.
//
//   cd tools/chick-model && npm i
//   node prepare.mjs "<path to source .glb>" ../../assets/chick.glb
//
// The source file references external textures (textures/*.png|jpg next to
// the .glb). What this script does:
//  1. Repairs the fur cards. Their material points at the white strand
//     alpha texture through UVs that actually address the body colour atlas,
//     so viewers show the coat as white slabs. Each card gets new strand UVs
//     (root to tip) and its colour baked from the atlas into COLOR_0. Cards
//     rooted on the eyes or bill are removed and nearby ones shortened.
//  2. Shrinks textures: diffuse to JPEG, roughness maps to 1024² JPEG.
//  3. Keeps the clips the game uses (four idles and the walk loop) and
//     quantizes the geometry (KHR_mesh_quantization). No meshopt or Draco,
//     so the browser needs no WebAssembly decoder to load it. Keyframes are
//     not resampled: this rig's joints pivot far from the skin they move, so
//     even tiny keyframe-reduction errors visibly warp the face.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const [src, out = '../../assets/chick.glb'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node prepare.mjs <source.glb> [out.glb]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// ── Image helpers ──
function decode(tex) {
  const bytes = Buffer.from(tex.getImage());
  if (tex.getMimeType() === 'image/png') {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
}

function downscale(img, size) {
  if (img.width === size) return img;
  const f = img.width / size;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
        for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
          const o = (sy * img.width + sx) * 4;
          for (let k = 0; k < 4; k++) acc[k] += img.data[o + k];
          n++;
        }
      }
      for (let k = 0; k < 4; k++) data[(y * size + x) * 4 + k] = acc[k] / n;
    }
  }
  return { width: size, height: size, data };
}

function toJPEG(tex, img, quality, name) {
  tex.setImage(new Uint8Array(jpeg.encode(img, quality).data));
  tex.setMimeType('image/jpeg');
  tex.setURI(name);
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// ── 1. Repair the fur cards ──
const meshByName = (n) => root.listMeshes().filter((m) => m.getName() === n);
const bodyPrim = meshByName('body')[0].listPrimitives()[0];
const diffuseTex = bodyPrim.getMaterial().getBaseColorTexture();
const diffuse = decode(diffuseTex);

const bPos = bodyPrim.getAttribute('POSITION').getArray();
const bUV = bodyPrim.getAttribute('TEXCOORD_0').getArray();
const bIdx = bodyPrim.getIndices().getArray();
const triCount = bIdx.length / 3;

// Uniform grid over the body's triangles for nearest-surface queries.
const CELL = 0.03;
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < bPos.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    bmin[k] = Math.min(bmin[k], bPos[i + k]);
    bmax[k] = Math.max(bmax[k], bPos[i + k]);
  }
}
const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((bmax[k] - bmin[k]) / CELL)));
const cells = new Map();
const cellKey = (x, y, z) => (x * dims[1] + y) * dims[2] + z;
const cellOf = (v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - bmin[k]) / CELL)));
for (let t = 0; t < triCount; t++) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 3; c++) {
    const vi = bIdx[t * 3 + c] * 3;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], bPos[vi + k]);
      hi[k] = Math.max(hi[k], bPos[vi + k]);
    }
  }
  for (let x = cellOf(lo[0], 0); x <= cellOf(hi[0], 0); x++) {
    for (let y = cellOf(lo[1], 1); y <= cellOf(hi[1], 1); y++) {
      for (let z = cellOf(lo[2], 2); z <= cellOf(hi[2], 2); z++) {
        const key = cellKey(x, y, z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(t);
      }
    }
  }
}

// Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5),
// returned as barycentric weights.
function closest(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [1 - v - w, v, w];
}

const vtx = (i) => [bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]];
function sample(img, u, v) {
  u -= Math.floor(u);
  v -= Math.floor(v);
  const x = u * (img.width - 1), y = v * (img.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const px = (xx, yy, k) => img.data[(yy * img.width + xx) * 4 + k];
  return [0, 1, 2].map((k) => (px(x0, y0, k) * (1 - fx) + px(x1, y0, k) * fx) * (1 - fy)
    + (px(x0, y1, k) * (1 - fx) + px(x1, y1, k) * fx) * fy);
}

// Fur cards are small strips (mostly 2×3 vertices). Their TEXCOORD_0 points
// into the body colour atlas; the UVs that mapped the strand alpha texture
// were lost in export. Rebuild them per card: v runs from the root (the end
// nearest the body surface) to the tip, u runs across the card.
function nearestDist2(p) {
  const cx = cellOf(p[0], 0), cy = cellOf(p[1], 1), cz = cellOf(p[2], 2);
  let best = Infinity;
  for (let r = 0; r < Math.max(...dims); r++) {
    if (best < ((r - 1) * CELL) ** 2) break;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;
      for (const t of cells.get(cellKey(x, y, z)) || []) {
        const A = vtx(bIdx[t * 3]), B = vtx(bIdx[t * 3 + 1]), Cc = vtx(bIdx[t * 3 + 2]);
        const [wa, wb, wc] = closest(p, A, B, Cc);
        best = Math.min(best, [0, 1, 2].reduce((s, k) => s + (A[k] * wa + B[k] * wb + Cc[k] * wc - p[k]) ** 2, 0));
      }
    }
  }
  return best;
}

// Eyes and bill, so fur cards can be kept off them (in the source those
// cards only disappeared by accident, through the broken UVs).
const meshPoints = (name) => {
  const a = meshByName(name)[0].listPrimitives()[0].getAttribute('POSITION').getArray();
  const out = [];
  for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
};
const eyePts = meshPoints('eyes');
const eyes = [1, -1].map((sx) => {
  const p = eyePts.filter((q) => Math.sign(q[0]) === sx);
  const c = [0, 1, 2].map((k) => p.reduce((acc, q) => acc + q[k], 0) / p.length);
  return { c, r: Math.max(...p.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]))) };
});
const billPts = meshPoints('peck');
const eyeDist = (q) => Math.min(...eyes.map((e) => Math.hypot(q[0] - e.c[0], q[1] - e.c[1], q[2] - e.c[2]) / e.r));
const billDist = (q) => Math.min(...billPts.map((b) => Math.hypot(q[0] - b[0], q[1] - b[1], q[2] - b[2])));
const ramp = (e0, e1, x) => Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const buffer = root.listBuffers()[0];
for (const mesh of meshByName('feather')) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray();
    const uv0 = prim.getAttribute('TEXCOORD_0').getArray();
    const idx = prim.getIndices().getArray();
    const n = pos.length / 3;
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];

    const par = Int32Array.from({ length: n }, (_, i) => i);
    const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]); par[find(idx[t + 1])] = a; par[find(idx[t + 2])] = a; }
    const cards = new Map();
    for (let i = 0; i < n; i++) { const c = find(i); if (!cards.has(c)) cards.set(c, []); cards.get(c).push(i); }

    const strandUV = new Float32Array(n * 2);
    let trimmed = 0, removed = 0;
    const along = new Float32Array(n);
    for (const verts of cards.values()) {
      const pts = verts.map(P);
      const c = [0, 1, 2].map((k) => pts.reduce((s, q) => s + q[k], 0) / pts.length);
      // Principal axis by power iteration on the covariance.
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const q of pts) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += (q[a] - c[a]) * (q[b] - c[b]);
      let ax = [0.3, 0.5, 0.8];
      for (let it = 0; it < 24; it++) {
        const v = [0, 1, 2].map((a) => cov[a][0] * ax[0] + cov[a][1] * ax[1] + cov[a][2] * ax[2]);
        const l = Math.hypot(...v) || 1;
        ax = v.map((x) => x / l);
      }
      const proj = pts.map((q) => (q[0] - c[0]) * ax[0] + (q[1] - c[1]) * ax[1] + (q[2] - c[2]) * ax[2]);
      const lo = Math.min(...proj), hi = Math.max(...proj);
      const ends = [pts[proj.indexOf(lo)], pts[proj.indexOf(hi)]];
      const flip = nearestDist2(ends[1]) < nearestDist2(ends[0]);
      // Across-axis: remove the along component and measure along what remains.
      const resid = pts.map((q, k) => [0, 1, 2].map((a) => q[a] - c[a] - proj[k] * ax[a]));
      let cross = resid.reduce((best, r) => (Math.hypot(...r) > Math.hypot(...best) ? r : best), [1e-9, 0, 0]);
      const cl = Math.hypot(...cross) || 1;
      cross = cross.map((x) => x / cl);
      const side = resid.map((r) => r[0] * cross[0] + r[1] * cross[1] + r[2] * cross[2]);
      const slo = Math.min(...side), shi = Math.max(...side);
      // Root = the vertex nearest the body. Cards rooted on an eye or the
      // bill are collapsed; cards close to them are shortened so they don't
      // grow over them.
      const tOf = proj.map((x) => { const t = (x - lo) / (hi - lo || 1); return flip ? 1 - t : t; });
      const rootP = pts[tOf.indexOf(Math.min(...tOf))];
      const de = eyeDist(rootP), db = billDist(rootP);
      const keep = de < 1.5 || db < 0.003 ? 0 : 0.2 + 0.8 * Math.min(ramp(1.5, 3, de), ramp(0.003, 0.016, db));
      if (keep < 1) {
        trimmed += keep === 0 ? 0 : 1;
        removed += keep === 0 ? 1 : 0;
        verts.forEach((vi, k) => {
          for (let a = 0; a < 3; a++) pos[vi * 3 + a] = rootP[a] + (pts[k][a] - rootP[a]) * keep;
        });
      }
      const u0 = rnd() * 0.45, uw = 0.45 + rnd() * 0.1;
      verts.forEach((vi, k) => {
        let t = (proj[k] - lo) / (hi - lo || 1);
        if (flip) t = 1 - t;
        const s = (side[k] - slo) / (shi - slo || 1);
        along[vi] = t;
        strandUV[vi * 2] = u0 + s * uw;
        strandUV[vi * 2 + 1] = 0.98 - t * 0.9; // texture roots at the bottom, tips at the top
      });
    }

    // Colour from the artist's atlas UVs, darker toward the roots for depth.
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const rgb = sample(diffuse, uv0[i * 2], uv0[i * 2 + 1]);
      const shade = 0.62 + 0.45 * along[i];
      for (let k = 0; k < 3; k++) col[i * 4 + k] = srgbToLinear(rgb[k] / 255) * shade;
      col[i * 4 + 3] = 1;
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setBuffer(buffer));
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(strandUV).setBuffer(buffer));
    prim.getAttribute('POSITION').setArray(pos);
    console.log(`rebuilt ${cards.size} fur cards (${n} vertices); around eyes and bill: ${removed} removed, ${trimmed} shortened`);
  }
  const mat = mesh.listPrimitives()[0].getMaterial();
  mat.setMetallicRoughnessTexture(null).setRoughnessFactor(0.9);
}

// ── 2. Textures ──
for (const tex of root.listTextures()) {
  const uri = tex.getURI();
  const base = path.basename(uri).replace(/\.[^.]+$/, '');
  if (tex === diffuseTex) toJPEG(tex, diffuse, 88, base + '.jpg');
  else if (/_MR\./.test(uri)) toJPEG(tex, downscale(decode(tex), 1024), 85, base + '.jpg');
}

// ── 3. Animation + geometry ──
const KEEP = ['idle_A1', 'idle_A2', 'idle_B1', 'idle_B2', 'walk_A1'];
for (const anim of root.listAnimations()) {
  if (KEEP.some((k) => anim.getName().endsWith(k))) continue;
  anim.listChannels().forEach((c) => c.dispose());
  anim.listSamplers().forEach((smp) => smp.dispose());
  anim.dispose();
}
await doc.transform(
  dedup(),
  prune({ keepAttributes: true }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }),
  prune(),
);

fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
console.log(`wrote ${out}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
