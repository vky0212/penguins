import * as THREE from 'three';

// Shell-textured down. The shells are one InstancedMesh: instance i is the
// surface pushed out along its normal by (i+1)/N of the fur length, and the
// fragment shader keeps only the pixels that fall inside a down tuft.
//
// Chick down grows in soft tufts, not as single hairs: each tuft is a cone
// that is wide at the skin and pinches to a wispy tip, made of finer strands
// that only separate in its outer half. Tufts are combed down and back by
// gravity and wind, their tips are paler (the "silver" in silver-grey), and
// tufts facing the sky can carry a dusting of snow. Backlit down glows at
// the silhouette because light scatters through the thin outer layer.
// Everything is hashed from the undeformed object-space position, so tufts
// line up across shells without needing UVs.

export function makeFurMaterial({
  length, density, tip = 1.15, comb = 0.8, tuft = 0.3, snow = 0.6, sheen = 0.9,
}) {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    sheen,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0.8, 0.84, 0.92),
  });
  const uniforms = {
    uShells: { value: 16 },
    uFurLen: { value: length },
    uDensity: { value: density },
    uComb: { value: comb },
    uSnow: { value: snow },
    uFurDisp: { value: new THREE.Vector3() },
  };
  mat.userData.fur = uniforms;
  const f = (x) => x.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uShells;
        uniform float uFurLen;
        uniform float uComb;
        uniform vec3 uFurDisp;
        attribute float aFur;
        varying vec3 vBasePos;
        varying float vShellH;
        varying float vFur;
        varying float vUp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBasePos = position;
        vFur = aFur;
        float sh = float(gl_InstanceID + 1) / uShells;
        vShellH = sh;
        vec3 fn = normalize(objectNormal);
        vec3 gdir = vec3(0.0, -1.0, -0.35);
        vec3 combDir = gdir - fn * dot(fn, gdir);
        float flen = uFurLen * (0.35 + 0.65 * aFur);
        transformed += fn * flen * sh;
        transformed += combDir * flen * uComb * sh * sh;
        transformed += uFurDisp * sh * sh * aFur;
        vUp = normalize(mat3(modelMatrix) * fn).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDensity;
        uniform float uSnow;
        varying vec3 vBasePos;
        varying float vShellH;
        varying float vFur;
        varying float vUp;
        float fh(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        // Distance to the jittered centre of the cell around p, plus that cell's id.
        float cellDist(vec3 p, out vec3 id) {
          id = floor(p);
          vec3 j = vec3(fh(id), fh(id + 11.3), fh(id + 23.7)) - 0.5;
          return length(fract(p) - 0.5 - j * 0.5);
        }
        // Tuft: cone that pinches toward its tip.
        // Tuft: cone that pinches toward its tip and leans its own way, so
        // neighbouring tufts cross instead of stacking like scales.
        float tuftMask(vec3 p, float h, out vec3 id) {
          id = floor(p);
          vec3 j = vec3(fh(id), fh(id + 11.3), fh(id + 23.7)) - 0.5;
          vec3 lean = vec3(fh(id + 31.1), fh(id + 37.9), fh(id + 43.3)) - 0.5;
          float len = 0.5 + 0.5 * fh(id + 1.7);
          if (h > len) return 0.0;
          float t = h / len;
          float d = length(fract(p) - 0.5 - j * 0.5 - lean * t * 1.0);
          float wisp = 0.12 * sin(dot(fract(p), vec3(17.0, 13.0, 11.0)) + fh(id + 3.3) * 6.28) * t;
          return step(d, 0.8 * (1.0 - 0.8 * t * t) + wisp);
        }
        float strandMask(vec3 p, float h) {
          vec3 id;
          float d = cellDist(p, id);
          float len = 0.4 + 0.6 * fh(id + 5.1);
          if (h > len) return 0.0;
          return step(d, 0.6 * (1.0 - h / len));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float h = vShellH;
          if (h > vFur + 0.02) discard;
          vec3 pt = vBasePos * uDensity * ${f(tuft)};
          vec3 idA, idB;
          float tA = tuftMask(pt, h, idA);
          float tB = tuftMask(pt * 1.31 + vec3(4.7, 1.3, 8.2), h, idB);
          if (max(tA, tB) < 0.5) discard;
          vec3 id = tA > 0.5 ? idA : idB;
          // Fine strands only separate in the outer half of the tuft.
          if (h > 0.45) {
            vec3 ps = vBasePos * uDensity;
            float s = max(strandMask(ps, (h - 0.45) / 0.55), strandMask(ps * 1.7 + 3.1, (h - 0.45) / 0.55));
            if (s < 0.5) discard;
          }
          float v = fh(id + 9.3);
          diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.0, 0.75, h)) * (0.88 + 0.24 * v);
          diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * ${f(tip)} + 0.05, vec3(1.0)), smoothstep(0.55, 1.0, h));
          float frost = smoothstep(0.45, 0.85, vUp) * step(0.9, fh(id + 21.0)) * smoothstep(0.5, 0.95, h) * uSnow;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 1.0), frost * 0.85);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // Black down should not get a pale velvet sheen.
        material.sheenColor *= clamp(diffuseColor.rgb * 1.8, 0.0, 1.0);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // Light scattered through backlit down at the silhouette.
          float back = pow(saturate(-dot(directLight.direction, geometryViewDir)), 2.0);
          float rim = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
          reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * back * rim * 1.6 * (0.25 + 0.75 * vShellH);
        }`);
  };
  mat.customProgramCacheKey = () => `fur2-${f(tip)}-${f(tuft)}`;
  return mat;
}

// Solid under-layer + shells for one body part.
export class FurPart extends THREE.Group {
  constructor(geometry, { length, density, maxShells, tip, comb, tuft, snow, rootColor = 0.5, castShadow = true }) {
    super();
    this.base = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, color: new THREE.Color(rootColor, rootColor, rootColor),
    }));
    this.base.castShadow = castShadow;
    this.base.receiveShadow = true;
    this.add(this.base);
    this.material = makeFurMaterial({ length, density, tip, comb, tuft, snow });
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
