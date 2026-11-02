// Converts the adult from the source "Emperor Penguin Family" GLB into
// assets/adult.glb.
//
//   cd tools/chick-model && npm i
//   node prepare-adult.mjs "<path to Emperor Penguin Family.glb>" ../../assets/adult.glb
//
// The source holds an adult (meshes named penguin_*) and a chick side by
// side, references external textures (textures/*.png|jpg next to the .glb)
// and has no animations. What this script does:
//  1. Drops the chick and the joints only it used.
//  2. Repairs the feather cards like the chick's fur (see fur.mjs): each
//     card is mapped onto one of the long contour feathers of the strand
//     texture, coloured from the body atlas.
//  3. Shrinks textures: diffuse to JPEG, normal and roughness maps to 1024²
//     JPEG, and quantizes the geometry (KHR_mesh_quantization).

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { baseName, decode, downscale, repairFur, toJPEG } from './fur.mjs';

const [src, out = '../../assets/adult.glb'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node prepare-adult.mjs <source.glb> [out.glb]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// ── 1. Adult only ──
for (const node of root.listNodes()) {
  if (node.getMesh() && !node.getMesh().getName().startsWith('penguin_')) node.dispose();
}
const keep = new Set();
for (const node of root.listNodes()) {
  if (!node.getMesh()) continue;
  keep.add(node);
  for (const joint of node.getSkin()?.listJoints() ?? []) {
    for (let n = joint; n; n = n.getParentNode()) keep.add(n);
  }
}
const sceneRoot = root.listScenes()[0].listChildren()[0];
keep.add(sceneRoot);
for (const node of root.listNodes()) if (!keep.has(node)) node.dispose();
await doc.transform(prune());

// ── 2. Feather cards ──
// The strand texture's lower part holds eight long feathers side by side,
// roots at the bottom.
const { diffuseTex, diffuse } = repairFur(doc, {
  body: 'penguin_body', feather: 'penguin_feather', eyes: 'penguin_eyes', bill: 'penguin_peck', size: 1.85,
  strand: (rnd) => ({ u0: Math.floor(rnd() * 8) / 8 + 0.01, uw: 0.105, vRoot: 0.975, vTip: 0.36 }),
});
for (const mesh of root.listMeshes()) {
  if (mesh.getName() === 'penguin_feather') mesh.listPrimitives()[0].getMaterial().setNormalTexture(null);
}

// ── 3. Textures + geometry ──
for (const tex of root.listTextures()) {
  const base = baseName(tex);
  if (tex === diffuseTex) toJPEG(tex, diffuse, 86, base + '.jpg');
  else if (/_normal$|_MR$/.test(base)) toJPEG(tex, downscale(decode(tex), 1024), 88, base + '.jpg');
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
