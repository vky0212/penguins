import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

// Sea-ice landscape around an emperor colony: wind-carved snow drifts,
// a few snow hills, wind-scoured blue ice patches, pressure-ridge ice
// blocks and tabular icebergs frozen into the fast ice on the horizon.

const perlin = new ImprovedNoise();
export const WORLD_RADIUS = 168;
const TERRAIN_SIZE = 400;
const FADE_START = 172;
const FADE_END = 194;

const HILLS = [
  { x: -46, z: -38, r: 30, h: 8.5 },
  { x: 62, z: -58, r: 24, h: 4.5 },
  { x: -72, z: 58, r: 26, h: 5.5 },
  { x: 30, z: 70, r: 18, h: 2.6 },
];

// flat: frozen melt-pond style patches (flattened); otherwise glaze ice on slopes
const ICE_PATCHES = [
  { x: 19, z: -22, rx: 13, rz: 8, rot: 0.4, flat: true },
  { x: -24, z: 27, rx: 9, rz: 6, rot: -0.7, flat: true },
  { x: 54, z: 16, rx: 16, rz: 9, rot: 1.1, flat: true },
  { x: -10, z: -64, rx: 12, rz: 7, rot: 0.2, flat: true },
  { x: -37, z: -22, rx: 7, rz: 14, rot: -0.9, flat: false },
];

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function baseHeight(x, z) {
  // Drifts and sastrugi are stretched along the prevailing wind (+x).
  let h = perlin.noise(x * 0.011, 0.5, z * 0.011) * 1.8
    + perlin.noise(x * 0.03 + 10, 1.5, z * 0.075) * 0.55
    + perlin.noise(x * 0.09, 2.5, z * 0.22) * 0.12
    + perlin.noise(x * 0.25, 4.5, z * 0.6) * 0.025;
  for (const k of HILLS) {
    const d2 = ((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r);
    h += k.h * Math.exp(-d2 * 2.5);
  }
  return h;
}

function patchDistance(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.sqrt((lx / p.rx) ** 2 + (lz / p.rz) ** 2) + perlin.noise(x * 0.22, 9.3, z * 0.22) * 0.22;
}

for (const p of ICE_PATCHES) p.level = baseHeight(p.x, p.z) - 0.07;

function analyticHeight(x, z) {
  let h = baseHeight(x, z);
  for (const p of ICE_PATCHES) {
    if (!p.flat) continue;
    const w = 1 - smooth(0.7, 1.25, patchDistance(p, x, z));
    if (w > 0) h += (p.level - h) * w;
  }
  const r = Math.hypot(x, z);
  return h * (1 - smooth(FADE_START, FADE_END, r));
}

function analyticIce(x, z) {
  let ice = 0;
  for (const p of ICE_PATCHES) ice = Math.max(ice, 1 - smooth(0.82, 1.0, patchDistance(p, x, z)));
  return ice;
}

// Tileable micro-relief for the snow: sum of integer-frequency waves.
function makeSnowNormalMap(size) {
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const sastrugi = i < 22;
    const k = sastrugi ? 2 + Math.floor(rnd() * 5) : 3 + Math.floor(rnd() * 40);
    const kx = sastrugi ? Math.floor(rnd() * 3) - 1 : Math.round((rnd() - 0.5) * 2 * k);
    const ky = sastrugi ? k * 3 + Math.floor(rnd() * 6) : Math.round((rnd() - 0.5) * 2 * k);
    if (kx === 0 && ky === 0) continue;
    const amp = (sastrugi ? 0.55 : 1.0) / Math.pow(Math.hypot(kx, ky), 1.1);
    waves.push({ kx, ky, amp, ph: rnd() * Math.PI * 2 });
  }
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      let h = 0;
      for (const w of waves) h += w.amp * Math.sin(2 * Math.PI * (w.kx * u + w.ky * v) + w.ph);
      H[j * size + i] = h;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const k = size * 0.012;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const hx = H[j * size + ((i + 1) % size)] - H[j * size + ((i - 1 + size) % size)];
      const hy = H[((j + 1) % size) * size + i] - H[((j - 1 + size) % size) * size + i];
      const nx = -hx * k, ny = -hy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (j * size + i) * 4;
      data[o] = (nx / l * 0.5 + 0.5) * 255;
      data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeSnowMaterial(normalMap) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#eef3f8'),
    roughness: 0.88,
    metalness: 0,
    normalMap,
    normalScale: new THREE.Vector2(0.26, 0.26),
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uIceColor = { value: new THREE.Color('#8fbfe0') };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aIce;
        varying float vIce;
        varying vec3 vWorldP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vIce = aIce;
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uIceColor;
        varying float vIce;
        varying vec3 vWorldP;
        float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        vec3 h33(vec3 p) { return vec3(h13(p), h13(p + 17.1), h13(p + 41.7)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float streak = h13(floor(vWorldP * vec3(0.6, 1.0, 2.4)));
          vec3 ice = uIceColor * (0.85 + 0.25 * streak);
          diffuseColor.rgb = mix(diffuseColor.rgb, ice, vIce);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.07, vIce);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, vIce * 0.85));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // Snow glitter: tiny ice-crystal facets catching the sun.
          vec3 cell = floor(vWorldP * 110.0);
          float r = h13(cell);
          vec3 facet = normalize(normal + (h33(cell) - 0.5) * 0.9);
          vec3 Hh = normalize(directLight.direction + normalize(vViewPosition));
          float g = pow(max(dot(facet, Hh), 0.0), 1600.0) * step(0.93, r) * (1.0 - vIce);
          float fade = 1.0 - smoothstep(8.0, 28.0, length(vViewPosition));
          reflectedLight.directSpecular += directLight.color * g * 45.0 * fade;
        }`);
  };
  return mat;
}

function makeIceberg(seed, radius, height) {
  const g = new THREE.CylinderGeometry(radius, radius * 1.04, height, 160, 18, false);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const yn = (v.y + height / 2) / height;
    const footprint = 1 + perlin.noise(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3, seed) * 0.35
      + perlin.noise(Math.cos(a) * 5 + seed, Math.sin(a) * 5, seed + 3) * 0.06;
    const fluting = perlin.noise(a * 26, yn * 2.5, seed + 7) * 0.025 + perlin.noise(a * 80, yn * 6, seed) * 0.008;
    const r = Math.hypot(v.x, v.z);
    const scale = r > 1e-3 ? footprint * (1 + fluting * (r / radius)) : 1;
    v.x *= scale;
    v.z *= scale;
    if (v.y > height / 2 - 1e-3) v.y += perlin.noise(v.x * 0.02, seed, v.z * 0.02) * height * 0.06;
    pos.setXYZ(i, v.x, v.y + height / 2 - 1.5, v.z);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const snow = new THREE.Color('#f3f6fa');
  const blue = new THREE.Color('#7fb3d6');
  const deep = new THREE.Color('#4f8fbd');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    const y = pos.getY(i);
    const band = 0.5 + 0.5 * Math.sin(y * 0.9 + perlin.noise(pos.getX(i) * 0.05, y * 0.1, seed) * 3);
    c.copy(blue).lerp(deep, band * 0.45 * (1 - y / height));
    c.lerp(snow, smooth(0.45, 0.8, ny));
    c.lerp(snow, smooth(height - 4, height - 1.5, y) * 0.6);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function makeIceChunk(rnd) {
  let g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = 0.7 + rnd() * 0.8, sy = 0.35 + rnd() * 0.45, sz = 0.7 + rnd() * 0.6;
  const seed = rnd() * 100;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + perlin.noise(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7) * 0.35;
    pos.setXYZ(i, v.x * d * sx, v.y * d * sy, v.z * d * sz);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const colors = new Float32Array(g.attributes.position.count * 3);
  const iceC = new THREE.Color('#9ccbe6'), snow = new THREE.Color('#f1f5f9'), c = new THREE.Color();
  for (let i = 0; i < nor.count; i++) {
    c.copy(iceC).lerp(snow, smooth(0.55, 0.85, nor.getY(i)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { geometry: g, radius: Math.max(sx, sz) };
}

export class World {
  constructor(scene, { segments = 256, normalMapSize = 512 } = {}) {
    this.scene = scene;
    this.colliders = [];
    this.seg = segments;
    this.cell = TERRAIN_SIZE / segments;
    const n1 = segments + 1;
    this.heights = new Float32Array(n1 * n1);
    this.ice = new Float32Array(n1 * n1);

    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const iceAttr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = analyticHeight(x, z);
      const ice = analyticIce(x, z);
      pos.setY(i, h);
      uv.setXY(i, x / 3.5, z / 3.5);
      iceAttr[i] = ice;
      const ix = Math.round((x + TERRAIN_SIZE / 2) / this.cell);
      const iz = Math.round((z + TERRAIN_SIZE / 2) / this.cell);
      this.heights[iz * n1 + ix] = h;
      this.ice[iz * n1 + ix] = ice;
    }
    geo.setAttribute('aIce', new THREE.BufferAttribute(iceAttr, 1));
    geo.computeVertexNormals();

    const normalMap = makeSnowNormalMap(normalMapSize);
    this.snowMat = makeSnowMaterial(normalMap);
    const terrain = new THREE.Mesh(geo, this.snowMat);
    terrain.receiveShadow = true;
    scene.add(terrain);
    this.terrain = terrain;

    // Flat sea ice from the terrain's edge to the horizon.
    const outer = new THREE.Shape();
    const F = 9000, h = TERRAIN_SIZE / 2;
    outer.moveTo(-F, -F); outer.lineTo(F, -F); outer.lineTo(F, F); outer.lineTo(-F, F); outer.lineTo(-F, -F);
    const hole = new THREE.Path();
    hole.moveTo(-h, -h); hole.lineTo(-h, h); hole.lineTo(h, h); hole.lineTo(h, -h); hole.lineTo(-h, -h);
    outer.holes.push(hole);
    const far = new THREE.ShapeGeometry(outer);
    far.rotateX(-Math.PI / 2);
    const fp = far.attributes.position, fuv = far.attributes.uv;
    for (let i = 0; i < fp.count; i++) fuv.setXY(i, fp.getX(i) / 3.5, fp.getZ(i) / 3.5);
    far.setAttribute('aIce', new THREE.BufferAttribute(new Float32Array(fp.count), 1));
    const farMesh = new THREE.Mesh(far, this.snowMat);
    farMesh.receiveShadow = true;
    scene.add(farMesh);

    this.iceMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25,
      sheen: 0.3, sheenColor: new THREE.Color('#bfe6ff'),
    });
    this.bergMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

    this.#placeIcebergs();
    this.#placeChunks();
  }

  #placeIcebergs() {
    const bergs = [
      { a: 0.3, d: 420, r: 120, h: 34 },
      { a: 1.25, d: 610, r: 220, h: 42 },
      { a: 2.4, d: 380, r: 70, h: 26 },
      { a: 3.5, d: 520, r: 160, h: 38 },
      { a: 4.6, d: 450, r: 95, h: 30 },
      { a: 5.5, d: 700, r: 260, h: 46 },
    ];
    bergs.forEach((b, i) => {
      const g = makeIceberg(i * 13.7 + 2, b.r, b.h);
      const m = new THREE.Mesh(g, this.bergMat);
      m.position.set(Math.cos(b.a) * b.d, 0, Math.sin(b.a) * b.d);
      m.rotation.y = i * 1.7;
      this.scene.add(m);
    });
  }

  #placeChunks() {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ridges = [
      { ax: -14, az: -6, bx: -3, bz: -22, n: 13 },
      { ax: 30, az: 34, bx: 44, bz: 28, n: 8 },
      { ax: -40, az: 6, bx: -52, bz: 18, n: 7 },
    ];
    const chunkGeos = Array.from({ length: 6 }, () => makeIceChunk(rnd));
    for (const r of ridges) {
      for (let i = 0; i < r.n; i++) {
        const t = i / (r.n - 1);
        const x = r.ax + (r.bx - r.ax) * t + (rnd() - 0.5) * 2.4;
        const z = r.az + (r.bz - r.az) * t + (rnd() - 0.5) * 2.4;
        const { geometry, radius } = chunkGeos[Math.floor(rnd() * chunkGeos.length)];
        const s = 0.45 + rnd() * 1.2;
        const m = new THREE.Mesh(geometry, this.iceMat);
        m.scale.setScalar(s);
        m.position.set(x, this.heightAt(x, z) + s * 0.12, z);
        m.rotation.set((rnd() - 0.5) * 0.7, rnd() * 6.28, (rnd() - 0.5) * 0.7);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
        this.colliders.push({ x, z, r: radius * s * 0.82 });
      }
    }
  }

  // Matches the terrain mesh triangulation exactly so feet sit on the drawn surface.
  heightAt(x, z) {
    const n1 = this.seg + 1;
    const gx = (x + TERRAIN_SIZE / 2) / this.cell;
    const gz = (z + TERRAIN_SIZE / 2) / this.cell;
    if (gx < 0 || gz < 0 || gx >= this.seg || gz >= this.seg) return 0;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const ha = this.heights[iz * n1 + ix];
    const hb = this.heights[(iz + 1) * n1 + ix];
    const hc = this.heights[(iz + 1) * n1 + ix + 1];
    const hd = this.heights[iz * n1 + ix + 1];
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  iceAt(x, z) {
    const n1 = this.seg + 1;
    const gx = (x + TERRAIN_SIZE / 2) / this.cell;
    const gz = (z + TERRAIN_SIZE / 2) / this.cell;
    if (gx < 0 || gz < 0 || gx >= this.seg || gz >= this.seg) return 0;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const a = this.ice[iz * n1 + ix], b = this.ice[iz * n1 + ix + 1];
    const c = this.ice[(iz + 1) * n1 + ix], d = this.ice[(iz + 1) * n1 + ix + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.35;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
}
