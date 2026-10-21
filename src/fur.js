import * as THREE from 'three';

// Shell-textured down. The shells are one InstancedMesh: instance i is the
// surface pushed out along its normal by (i+1)/N of the fur length, and the
// fragment shader keeps only the pixels that fall inside a tapering strand.
// Strands are hashed from the undeformed object-space position, so they line
// up across shells without needing UVs.

export function makeFurMaterial({ length, density, tip = 1.15, sheen = 0.9 }) {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    sheen,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0.78, 0.82, 0.9),
  });
  const uniforms = {
    uShells: { value: 16 },
    uFurLen: { value: length },
    uDensity: { value: density },
    uFurDisp: { value: new THREE.Vector3() },
  };
  mat.userData.fur = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uShells;
        uniform float uFurLen;
        uniform vec3 uFurDisp;
        attribute float aFur;
        varying vec3 vBasePos;
        varying float vShellH;
        varying float vFur;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBasePos = position;
        vFur = aFur;
        float sh = float(gl_InstanceID + 1) / uShells;
        vShellH = sh;
        transformed += normalize(objectNormal) * uFurLen * sh * (0.35 + 0.65 * aFur);
        transformed += uFurDisp * sh * sh * aFur;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDensity;
        varying vec3 vBasePos;
        varying float vShellH;
        varying float vFur;
        float fh(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float strand(vec3 p, float h) {
          vec3 c = floor(p);
          vec3 f = fract(p) - 0.5;
          vec3 j = vec3(fh(c), fh(c + 11.3), fh(c + 23.7)) - 0.5;
          float len = 0.45 + 0.55 * fh(c + 5.1);
          if (h > len) return 0.0;
          float r = 0.62 * (1.0 - h / len);
          return step(length(f - j * 0.45), r);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float h = vShellH;
          if (h > vFur + 0.02) discard;
          vec3 p = vBasePos * uDensity;
          float s = max(strand(p, h), strand(p * 1.73 + vec3(7.1, 3.3, 1.9), h));
          if (s < 0.5) discard;
          diffuseColor.rgb *= mix(0.5, ${tip.toFixed(3)}, h);
        }`);
  };
  mat.customProgramCacheKey = () => 'fur-' + tip.toFixed(3);
  return mat;
}

// Solid under-layer + shells for one body part.
export class FurPart extends THREE.Group {
  constructor(geometry, { length, density, maxShells, tip, rootColor = 0.55, castShadow = true }) {
    super();
    this.base = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, color: new THREE.Color(rootColor, rootColor, rootColor),
    }));
    this.base.castShadow = castShadow;
    this.base.receiveShadow = true;
    this.add(this.base);
    this.material = makeFurMaterial({ length, density, tip });
    this.shells = new THREE.InstancedMesh(geometry, this.material, maxShells);
    this.shells.frustumCulled = false;
    this.shells.receiveShadow = true;
    this.add(this.shells);
    this.maxShells = maxShells;
  }

  setShells(n) {
    const c = Math.max(1, Math.min(this.maxShells, n));
    this.shells.count = c;
    this.material.userData.fur.uShells.value = c;
  }

  setDisp(v) {
    this.material.userData.fur.uFurDisp.value.copy(v);
  }
}

// Writes per-vertex colour + fur-length attributes from a painter callback.
export function paint(geo, fn) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const fur = new Float32Array(pos.count);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const out = { color: new THREE.Color(), fur: 1 };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    out.fur = 1;
    fn(p, n, out);
    col[i * 3] = out.color.r;
    col[i * 3 + 1] = out.color.g;
    col[i * 3 + 2] = out.color.b;
    fur[i] = out.fur;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aFur', new THREE.BufferAttribute(fur, 1));
  return geo;
}

export const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
