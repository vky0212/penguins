import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Fetches the first URL that answers, with download progress. A `.txt` URL
// holds the same GLB as base64, for hosts that don't serve .glb files.
async function fetchModel(urls, onProgress) {
  for (const url of urls) {
    let res;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) onProgress?.(Math.min(1, loaded / total));
    }
    let bytes = new Uint8Array(loaded);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    if (url.endsWith('.txt')) {
      const bin = atob(new TextDecoder().decode(bytes).trim());
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }
  return null;
}

// Loads a GLB from the first URL that answers; null if none does.
export async function loadModel(urls, onProgress) {
  const bytes = await fetchModel(urls, onProgress);
  if (!bytes) return null;
  const loader = new GLTFLoader();
  // Decode embedded textures through <img> rather than fetch()+ImageBitmap,
  // so blob: image URLs work under strict content security policies.
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    parser.textureLoader.setCrossOrigin('anonymous');
    return { name: 'img-textures' };
  });
  return loader.parseAsync(bytes, '');
}
