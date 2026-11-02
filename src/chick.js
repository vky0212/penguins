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
// the root), so joints can't be posed through the hierarchy. Instead each
// joint is classified by where the vertices it moves sit (head, flippers),
// and those joints get a rigid world-space rotation after the animation.

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

  ASSET = {
    scene, clips, materials, joints, height,
    neck: new THREE.Vector3(0, neckY, headPos.z - height * 0.05),
    shoulderL: new THREE.Vector3(halfWidth * 0.55, shoulderY || height * 0.7, 0),
    shoulderR: new THREE.Vector3(-halfWidth * 0.55, shoulderY || height * 0.7, 0),
  };
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
const _v = new THREE.Vector3();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

// Rotation by `angle` about `axis` through `pivot`, written into `out`.
function pivotRotation(pivot, axis, angle, out) {
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(_r.makeRotationAxis(axis, angle));
  return out.multiply(_t.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

export class Chick {
  constructor({ scale = 1 } = {}) {
    this.scale = scale;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.holder = new THREE.Group();
    this.holder.scale.setScalar((HEIGHT / ASSET.height) * scale);
    this.tilt.add(this.holder);
    this.model = cloneSkinned(ASSET.scene);
    this.holder.add(this.model);

    this.skins = [];
    this.model.traverse((o) => { if (o.isSkinnedMesh) this.skins.push(o); });
    this.toes = { L: [], R: [] };
    for (const s of this.skins) {
      for (const b of s.skeleton.bones) {
        if (/^LegToeL/.test(b.name)) this.toes.L.push(b);
        if (/^LegToeR/.test(b.name)) this.toes.R.push(b);
      }
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const act = (clip) => {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.actions = {
      idle: act(ASSET.clips.idle),
      idleFlap: act(ASSET.clips.idleFlap),
      walk: act(ASSET.clips.walk),
      callA: act(ASSET.clips.callA),
      callB: act(ASSET.clips.callB),
    };
    for (const k of ['callA', 'callB']) {
      this.actions[k].setLoop(THREE.LoopOnce, 1);
      this.actions[k].clampWhenFinished = true;
    }
    this.actions.idle.time = Math.random() * ASSET.clips.idle.duration;
    this.actions.walk.time = Math.random() * ASSET.clips.walk.duration;

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
  }

  chirp() {
    const a = Math.random() < 0.5 ? this.actions.callA : this.actions.callB;
    this.call = a;
    this.callT = a.getClip().duration;
    a.reset();
    a.play();
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
      const elapsed = this.call.getClip().duration - this.callT;
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
    const A = this.actions;
    A.walk.setEffectiveWeight(walkWeight * (1 - callW));
    A.idle.setEffectiveWeight(rest * (1 - this.flapMix * (1 - s)));
    A.idleFlap.setEffectiveWeight(rest * this.flapMix * (1 - s));
    A.callA.setEffectiveWeight(this.call === A.callA ? callW : 0);
    A.callB.setEffectiveWeight(this.call === A.callB ? callW : 0);
    A.walk.timeScale = lying ? 2.4 : THREE.MathUtils.clamp(st.speed / (WALK_STRIDE_SPEED * this.scale), 0.6, 3.4);

    // Distant chicks animate at a lower rate.
    this.mixAcc += dt;
    if (this.mixAcc >= ((st.camDist ?? 0) > 18 ? 0.1 : 0)) {
      this.mixer.update(this.mixAcc);
      this.mixAcc = 0;
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

    // Footfalls: a foot lands when its lowest toe comes down to the ground.
    if (walking && this.walkW > 0.3) {
      this.root.updateMatrixWorld(true);
      for (const side of ['L', 'R']) {
        let low = Infinity, lx = 0, lz = 0;
        for (const b of this.toes[side]) {
          b.getWorldPosition(_v);
          if (_v.y < low) { low = _v.y; lx = _v.x; lz = _v.z; }
        }
        const h = low - st.pos.y;
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

  // Call after scene.updateMatrixWorld(): layers the procedural pose on top of
  // the animated skeleton by transforming joint world matrices directly.
  applyPose() {
    if (this.headLift < 1e-3 && Math.abs(this.flipSpread) < 1e-3) return;
    const H = this.holder.matrixWorld;
    _hinv.copy(H).invert();
    this.skins.forEach((mesh, mi) => {
      const bones = mesh.skeleton.bones;
      for (const j of ASSET.joints[mi]) {
        if (j.head) pivotRotation(ASSET.neck, AX_X, -this.headLift * j.head, _m);
        else if (j.flip) pivotRotation(j.flip > 0 ? ASSET.shoulderL : ASSET.shoulderR, AX_Z, this.flipSpread * j.flip, _m);
        else continue;
        // Model-space rigid transform to world space: H · M · H⁻¹.
        _m.premultiply(H).multiply(_hinv);
        bones[j.index].matrixWorld.premultiply(_m);
      }
    });
  }
}
