import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Emperor penguin chick (Aptenodytes forsteri), crèche age, ~62 cm tall.
// Rigged model with fur cards (assets/chick.glb, built by tools/chick-model).
// Its clips drive standing, walking and calling. Lying on the belly,
// tobogganing and tumbling are layered on procedurally:
//  - the whole model pitches forward onto its belly around its middle;
//  - the head and neck lift so the chick looks ahead while lying;
//  - the flippers spread for balance.
// The model's skeletons are partly flattened (many joints hang straight off
// the root, pivoting far from the vertices they move), so joints can't be
// posed through the hierarchy, and clips can't be blended joint by joint.
// Clips are blended as posed joint matrices, and for the procedural pose
// each joint is classified by where its vertices sit (head, flippers) and
// gets a rigid world-space rotation.

const HEIGHT = 0.62;
const WALK_STRIDE_SPEED = 0.275; // m/s covered by the walk_A1 cycle at timeScale 1
const CLIP = { idle: 'idle_A1', idleFlap: 'idle_A2', callA: 'idle_B1', callB: 'idle_B2', walk: 'walk_A1' };

let ASSET = null;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

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
  throw new Error('找不到企鵝寶寶模型檔案');
}

export async function loadChickAsset(urls, onProgress) {
  const loader = new GLTFLoader();
  // Decode embedded textures through <img> rather than fetch()+ImageBitmap,
  // so blob: image URLs work under strict content security policies.
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    parser.textureLoader.setCrossOrigin('anonymous');
    return { name: 'img-textures' };
  });
  const gltf = await loader.parseAsync(await fetchModel(urls, onProgress), '');
  const scene = gltf.scene;
  const clips = {};
  for (const [key, name] of Object.entries(CLIP)) {
    clips[key] = gltf.animations.find((a) => a.name.endsWith(name));
  }

  const materials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    materials.add(o.material);
    // The baked fur colours read dark under the low polar sun; lift them
    // toward the mid-grey of real chicks.
    if (o.material.name === 'feather') {
      o.material.alphaTest = 0.5;
      o.material.roughness = 0.92;
      o.material.color.setScalar(1.55);
    }
    if (o.material.name === 'body') o.material.color.setScalar(1.25);
  });

  // Pose the template once and classify every joint by the vertices it moves.
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clips.idle).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const joints = []; // per skinned mesh, in traversal order
  let headBone = null;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const n = geo.attributes.position.count;
    const step = n > 20000 ? 5 : 1;
    const sums = o.skeleton.bones.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i += step) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const s = sums[si.getComponent(i, k)];
        s[0] += v.x * w;
        s[1] += v.y * w;
        s[2] += v.z * w;
        s[3] += w;
      }
    }
    headBone ??= o.skeleton.bones.find((b) => b.name === 'Head_0117');
    joints.push(sums.map((s, index) => ({ index, c: s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null, head: 0, flip: 0 })));
  });
  const height = box.max.y - Math.min(0, box.min.y);
  const headPos = headBone.getWorldPosition(new THREE.Vector3());
  // Model units: y up, +z forward, the chick's left at +x.
  const neckY = headPos.y - height * 0.12;
  const halfWidth = Math.max(-box.min.x, box.max.x);
  let shoulderY = 0;
  for (const list of joints) {
    for (const j of list) {
      if (!j.c) continue;
      j.head = smooth(neckY - height * 0.05, neckY + height * 0.06, j.c[1]);
      j.flip = Math.sign(j.c[0]) * smooth(halfWidth * 0.55, halfWidth * 0.72, Math.abs(j.c[0])) * (1 - j.head);
      if (j.flip) shoulderY = Math.max(shoulderY, j.c[1]);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // Every node a clip animates, so each clip can start from the rest pose.
  const animated = new Set();
  for (const clip of Object.values(clips)) {
    for (const track of clip.tracks) animated.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  }

  ASSET = {
    scene, clips, materials, joints, height, animated: [...animated],
    neck: new THREE.Vector3(0, neckY, headPos.z - height * 0.05),
    shoulderL: new THREE.Vector3(halfWidth * 0.55, shoulderY || height * 0.7, 0),
    shoulderR: new THREE.Vector3(-halfWidth * 0.55, shoulderY || height * 0.7, 0),
  };
}

// Per-chick down colour: `pale` (0–1) lifts the grey down toward silvery
// white. Only mid-grey pixels change, picked by brightness, so the black cap,
// white face, bill and feet keep their colours.
function paleMaterial(source, pale) {
  const m = source.clone();
  const uPale = { value: pale };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPale = uPale;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPale;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float grey = smoothstep(0.03, 0.1, lum) * (1.0 - smoothstep(0.7, 1.0, lum));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.96, 0.98) * max(lum * 1.6, 0.75), uPale * grey);
        }`);
  };
  m.customProgramCacheKey = () => 'chick-pale';
  ASSET.materials.add(m);
  return m;
}

export function setChickQuality({ alphaToCoverage }) {
  for (const m of ASSET.materials) {
    if (m.name !== 'feather' || m.alphaToCoverage === alphaToCoverage) continue;
    m.alphaToCoverage = alphaToCoverage;
    m.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _hinv = new THREE.Matrix4();
const _minv = new THREE.Matrix4();
const _v = new THREE.Vector3();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

// Rotation by `angle` about `axis` through `pivot`, written into `out`.
function pivotRotation(pivot, axis, angle, out) {
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(_r.makeRotationAxis(axis, angle));
  return out.multiply(_t.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

const LAYERS = ['idle', 'idleFlap', 'walk', 'callA', 'callB'];

export class Chick {
  constructor({ scale = 1, pale = 0 } = {}) {
    this.scale = scale;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.holder = new THREE.Group();
    this.holder.scale.setScalar((HEIGHT / ASSET.height) * scale);
    this.tilt.add(this.holder);
    this.model = cloneSkinned(ASSET.scene);
    this.holder.add(this.model);
    if (pale > 0) {
      const swapped = new Map();
      this.model.traverse((o) => {
        if (!o.isMesh || !['feather', 'body'].includes(o.material.name)) return;
        if (!swapped.has(o.material)) swapped.set(o.material, paleMaterial(o.material, pale));
        o.material = swapped.get(o.material);
      });
    }

    // Unique joints across all skins (the eye and eye-lens skins share
    // theirs), each with its head/flipper classification.
    this.skins = [];
    this.model.traverse((o) => { if (o.isSkinnedMesh) this.skins.push(o); });
    const seen = new Map();
    this.skins.forEach((mesh, mi) => {
      mesh.skeleton.bones.forEach((bone, bi) => {
        const j = ASSET.joints[mi][bi];
        const prev = seen.get(bone);
        if (!prev) seen.set(bone, { bone, head: j.head, flip: j.flip });
        else if (!prev.head && !prev.flip) Object.assign(prev, { head: j.head, flip: j.flip });
      });
    });
    this.joints = [...seen.values()];
    this.toes = {
      L: this.joints.filter((j) => /^LegToeL/.test(j.bone.name)).map((j) => j.bone),
      R: this.joints.filter((j) => /^LegToeR/.test(j.bone.name)).map((j) => j.bone),
    };

    // Each clip is sampled on its own and clips are blended by mixing the
    // posed joint matrices, not joint rotations: many of this rig's joints
    // pivot far from the vertices they move, and interpolating their
    // rotations swings those vertices through wide arcs mid-blend (the face
    // and beak flop around). Skinning is linear, so mixing the matrices
    // blends the posed meshes exactly.
    this.animated = ASSET.animated.map((n) => this.model.getObjectByName(n)).filter(Boolean);
    this.rest = this.animated.map((o) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
    this.layers = {};
    for (const key of LAYERS) {
      const clip = ASSET.clips[key];
      const channels = [];
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const node = this.model.getObjectByName(nodeName);
        if (node && node[propertyName]?.fromArray) channels.push({ target: node[propertyName], interp: track.createInterpolant() });
      }
      this.layers[key] = {
        clip, channels, time: 0, timeScale: 1, once: key.startsWith('call'),
        w: 0, pending: 0, pose: new Float32Array(this.joints.length * 16), posed: false,
      };
    }
    this.layers.idle.time = Math.random() * ASSET.clips.idle.duration;
    this.layers.walk.time = Math.random() * ASSET.clips.walk.duration;
    this.blend = new Float32Array(16);

    this.time = Math.random() * 10;
    this.walkW = 0;
    this.slideW = 0;
    this.airW = 0;
    this.flapMix = 0;
    this.flapTarget = 0;
    this.nextIdleSwitch = 6 + Math.random() * 8;
    this.call = null;
    this.callT = 0;
    this.mixAcc = 0;
    this.feet = { L: { down: true }, R: { down: true } };
    this.onStep = null;
    this.headLift = 0;
    this.flipSpread = 0;
    this.tumbleRoll = 0;
    this.stepping = false;
    this.groundY = 0;
  }

  chirp() {
    const key = Math.random() < 0.5 ? 'callA' : 'callB';
    const layer = this.layers[key];
    this.call = key;
    this.callT = layer.clip.duration;
    layer.time = 0;
    layer.pending = 0;
  }

  // Advances one clip, samples it from the rest pose and stores the joint
  // matrices relative to the model root.
  _poseLayer(layer, dt) {
    const d = layer.clip.duration;
    layer.time += dt * layer.timeScale;
    layer.time = layer.once ? Math.min(layer.time, d) : ((layer.time % d) + d) % d;
    this.animated.forEach((o, i) => {
      const r = this.rest[i];
      o.position.copy(r[0]);
      o.quaternion.copy(r[1]);
      o.scale.copy(r[2]);
    });
    for (const c of layer.channels) c.target.fromArray(c.interp.evaluate(layer.time));
    this.model.updateMatrixWorld(true);
    _minv.copy(this.model.matrixWorld).invert();
    this.joints.forEach((j, i) => {
      _m.multiplyMatrices(_minv, j.bone.matrixWorld).toArray(layer.pose, i * 16);
    });
    layer.posed = true;
  }

  // st: { pos, yaw, vel, speed, grounded, mode, pushing, slopeF, world, camDist }
  update(dt, st) {
    const t = (this.time += dt);
    const lying = st.mode === 'slide' || st.mode === 'tumble';
    const walking = st.mode === 'walk' && st.grounded;

    this.walkW += ((walking ? smooth(0.04, 0.2, st.speed) : 0) - this.walkW) * Math.min(1, dt * 6);
    this.slideW += ((lying ? 1 : 0) - this.slideW) * Math.min(1, dt * (st.mode === 'tumble' ? 9 : 4));
    this.airW += ((st.grounded ? 0 : 1) - this.airW) * Math.min(1, dt * 10);
    const s = this.slideW;

    // Calling: one-shot clip with a short fade in and out.
    let callW = 0;
    if (this.call) {
      this.callT = Math.max(0, this.callT - dt);
      const elapsed = this.layers[this.call].clip.duration - this.callT;
      callW = smooth(0, 0.25, elapsed) * smooth(0, 0.35, this.callT);
      if (this.callT === 0) this.call = null;
    }

    // Idle variety: mostly looking around, now and then a flapping stretch.
    if (t > this.nextIdleSwitch) {
      this.flapTarget = this.flapTarget ? 0 : (Math.random() < 0.35 ? 1 : 0);
      this.nextIdleSwitch = t + (this.flapTarget ? 4.6 : 7 + Math.random() * 9);
    }
    this.flapMix += (this.flapTarget - this.flapMix) * Math.min(1, dt * 2);

    // Lying down: paddle with the feet (walk cycle) while pushing, else rest.
    const paddle = lying && st.pushing ? 1 : 0;
    const walkWeight = Math.max(this.walkW * (1 - s), paddle * s);
    const rest = (1 - walkWeight) * (1 - callW);
    const L = this.layers;
    L.walk.w = walkWeight * (1 - callW);
    L.idle.w = rest * (1 - this.flapMix * (1 - s));
    L.idleFlap.w = rest * this.flapMix * (1 - s);
    L.callA.w = this.call === 'callA' ? callW : 0;
    L.callB.w = this.call === 'callB' ? callW : 0;
    L.walk.timeScale = lying ? 2.4 : THREE.MathUtils.clamp(st.speed / (WALK_STRIDE_SPEED * this.scale), 0.6, 3.4);

    // Only clips that contribute advance and get evaluated; distant chicks
    // at a lower rate.
    for (const key of LAYERS) L[key].pending += dt;
    this.mixAcc += dt;
    if (this.mixAcc >= ((st.camDist ?? 0) > 18 ? 0.1 : 0)) {
      this.mixAcc = 0;
      for (const key of LAYERS) {
        const layer = L[key];
        if (layer.w > 1e-3 || !layer.posed) {
          this._poseLayer(layer, layer.pending);
          layer.pending = 0;
        }
      }
    }

    this.root.position.copy(st.pos);
    this.root.rotation.y = st.yaw;

    // Belly pose: pitch forward around the middle until the belly meets the snow.
    const mid = HEIGHT * this.scale * 0.45;
    const bellyH = HEIGHT * this.scale * 0.2;
    this.tumbleRoll = st.mode === 'tumble' ? Math.sin(t * 7) * 0.3 : this.tumbleRoll * Math.max(0, 1 - dt * 4);
    this.tilt.position.y = lerp(mid, bellyH, s) + this.airW * 0.01;
    this.tilt.rotation.set(lerp(THREE.MathUtils.clamp(st.slopeF * 0.3, -0.15, 0.15), 1.42, s), 0, this.tumbleRoll * s);
    this.holder.position.y = -mid;

    this.headLift = s * 1.05;
    this.flipSpread = s * 0.9 + this.airW * 0.5 + (st.mode === 'tumble' ? Math.sin(t * 16) * 0.4 : 0);
    this.stepping = walking && this.walkW > 0.3;
    this.groundY = st.pos.y;
  }

  // Call after scene.updateMatrixWorld(): writes the blended clip pose plus
  // the procedural belly pose straight into the joint world matrices.
  applyPose() {
    const layers = LAYERS.map((k) => this.layers[k]).filter((l) => l.w > 1e-3 && l.posed);
    const total = layers.reduce((a, l) => a + l.w, 0) || 1;
    const Mw = this.model.matrixWorld;
    const B = this.blend;
    this.joints.forEach((j, i) => {
      B.fill(0);
      for (const l of layers) {
        const w = l.w / total;
        for (let k = 0; k < 16; k++) B[k] += l.pose[i * 16 + k] * w;
      }
      j.bone.matrixWorld.fromArray(B).premultiply(Mw);
    });

    if (this.headLift > 1e-3 || Math.abs(this.flipSpread) > 1e-3) {
      const H = this.holder.matrixWorld;
      _hinv.copy(H).invert();
      for (const j of this.joints) {
        if (j.head) pivotRotation(ASSET.neck, AX_X, -this.headLift * j.head, _m);
        else if (j.flip) pivotRotation(j.flip > 0 ? ASSET.shoulderL : ASSET.shoulderR, AX_Z, this.flipSpread * j.flip, _m);
        else continue;
        // Model-space rigid transform to world space: H · M · H⁻¹.
        _m.premultiply(H).multiply(_hinv);
        j.bone.matrixWorld.premultiply(_m);
      }
    }

    // Footfalls: a foot lands when its lowest toe comes down to the ground.
    if (!this.stepping) return;
    for (const side of ['L', 'R']) {
      let low = Infinity, lx = 0, lz = 0;
      for (const b of this.toes[side]) {
        _v.setFromMatrixPosition(b.matrixWorld);
        if (_v.y < low) { low = _v.y; lx = _v.x; lz = _v.z; }
      }
      const h = low - this.groundY;
      const f = this.feet[side];
      if (!f.down && h < 0.012 * this.scale) {
        f.down = true;
        this.onStep?.(side === 'L' ? -1 : 1, lx, lz);
      } else if (f.down && h > 0.025 * this.scale) {
        f.down = false;
      }
    }
  }
}
