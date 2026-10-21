import * as THREE from 'three';

// Footprints and belly-slide troughs pressed into the snow. Each mark is a
// decal whose normal map is derived from a generated depth field, so the
// low sun shades the dent instead of the mark being painted on.

function capsuleSDF(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function makeDecalTextures(size, depthFn, strength) {
  const D = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) D[j * size + i] = depthFn((i + 0.5) / size, (j + 0.5) / size);
  }
  const nrm = new Uint8Array(size * size * 4);
  const alpha = new Uint8Array(size * size * 4);
  const at = (i, j) => D[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dy = (at(i, j + 1) - at(i, j - 1)) * strength;
      // surface z = -depth  →  normal = (ddepth/dx, ddepth/dy, 1)
      const l = Math.hypot(dx, dy, 1);
      const o = (j * size + i) * 4;
      nrm[o] = (dx / l * 0.5 + 0.5) * 255;
      nrm[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      nrm[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
      const a = Math.min(1, Math.max(0, D[j * size + i]) * 7 + Math.hypot(dx, dy) * 0.25);
      alpha[o] = alpha[o + 1] = alpha[o + 2] = a * 255;
      alpha[o + 3] = 255;
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, size, size);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { normalMap: mk(nrm), alphaMap: mk(alpha) };
}

function footDepth(u, v) {
  // v grows toward the toes.
  const toes = [[0.2, 0.86], [0.5, 0.93], [0.8, 0.86]];
  let d = capsuleSDF(u, v, 0.5, 0.3, 0.5, 0.36, 0.17);
  for (const [tx, ty] of toes) d = Math.min(d, capsuleSDF(u, v, 0.5, 0.4, tx, ty, 0.075));
  const inside = Math.max(0, Math.min(1, -d / 0.08));
  const rim = Math.exp(-((d - 0.03) ** 2) / 0.0015);
  return inside * 0.22 - rim * 0.015;
}

function bellyDepth(u, v) {
  const x = (u - 0.5) / 0.42, y = (v - 0.5) / 0.5;
  const r = x * x + Math.pow(Math.abs(y), 4);
  return Math.pow(Math.max(0, 1 - r), 1.2) * 0.2;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _f = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _nrm = new THREE.Vector3();

class DecalPool {
  constructor(scene, w, h, tex, count, color) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.92,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      alphaMap: tex.alphaMap,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.next = 0;
    this.max = count;
    scene.add(this.mesh);
  }

  add(world, x, z, yaw, scale = 1) {
    const y = world.heightAt(x, z) + 0.003;
    world.normalAt(x, z, _nrm);
    _f.set(Math.sin(yaw), 0, Math.cos(yaw));
    _y.copy(_nrm);
    _f.addScaledVector(_y, -_f.dot(_y)).normalize();
    _x.crossVectors(_f, _y).normalize();
    _z.copy(_f).negate();
    _m.makeBasis(_x, _y, _z);
    _m.scale(_s.setScalar(scale));
    _m.setPosition(x, y, z);
    this.mesh.setMatrixAt(this.next, _m);
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Prints {
  constructor(scene, world) {
    this.world = world;
    this.footPool = new DecalPool(scene, 0.085, 0.09, makeDecalTextures(96, footDepth, 26), 700, '#d3dde8');
    this.bellyPool = new DecalPool(scene, 0.28, 0.4, makeDecalTextures(64, bellyDepth, 12), 600, '#c4d0de');
    this.lastBelly = new Map();
  }

  foot(x, z, yaw, side, scale = 1) {
    if (this.world.iceAt(x, z) > 0.4) return;
    this.footPool.add(this.world, x, z, yaw + side * -0.18, scale);
  }

  // Lay a trough segment every ~16 cm of slide.
  belly(key, x, z, yaw, scale = 1) {
    if (this.world.iceAt(x, z) > 0.4) return;
    const last = this.lastBelly.get(key);
    if (last && Math.hypot(last.x - x, last.z - z) < 0.11 * scale) return;
    this.lastBelly.set(key, { x, z });
    this.bellyPool.add(this.world, x, z, yaw, scale);
  }

  resetBelly(key) {
    this.lastBelly.delete(key);
  }
}
