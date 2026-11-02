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
import { decode, downscale, repairFur, toJPEG } from './fur.mjs';

const [src, out = '../../assets/chick.glb'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node prepare.mjs <source.glb> [out.glb]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// ── 1. Repair the fur cards ──
// The chick's strand texture: tufts across the left half, roots at the bottom.
const { diffuseTex, diffuse } = repairFur(doc, {
  body: 'body', feather: 'feather', eyes: 'eyes', bill: 'peck',
  strand: (rnd) => ({ u0: rnd() * 0.45, uw: 0.45 + rnd() * 0.1, vRoot: 0.98, vTip: 0.08 }),
});

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
