import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './model.js';

// Adult emperor penguin, ~1.1 m. Rigged model with feather cards
// (assets/adult.glb, built by tools/chick-model/prepare-adult.mjs). The
// source has no clips and its rest pose bows the head toward a chick, so all
// motion is procedural: the head lifts, looks around and dips for calls, the
// flippers sway and the body rocks. As with the chick, the skeleton is partly
// flattened, so joints are classified by the vertices they move (head,
// flippers) and get rigid world-space rotations instead of being posed
// through the hierarchy.

const HEIGHT = 1.1;
// The rest pose looks down at about 60°; this lift brings the bill up to a
// relaxed standing angle.
const HEAD_LIFT = 0.9;
const HEAD_MESHES = ['penguin_peck', 'penguin_tongue', 'penguin_eyes', 'penguin_eyelens'];

let ASSET = null;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export async function loadAdultAsset(urls, onProgress) {
  const gltf = await loadModel(urls, onProgress);
  if (!gltf) throw new Error('找不到帝企鵝模型檔案');
  const scene = gltf.scene;
  const materials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    materials.add(o.material);
    if (o.material.name === 'penguin_feather') {
      o.material.alphaTest = 0.5;
      o.material.roughness = 0.6;
      o.material.color.setScalar(1.3);
    }
  });

  // Classify every joint by the vertices it moves, in the rest pose.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const feet = new THREE.Box3();
  const v = new THREE.Vector3();
  const joints = []; // per skinned mesh, in traversal order
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const n = geo.attributes.position.count;
    const sums = o.skeleton.bones.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
      if (o.name === 'penguin_leg') feet.expandByPoint(v);
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
    joints.push({
      headOnly: HEAD_MESHES.includes(o.name),
      c: sums.map((s) => (s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null)),
    });
  });
  // Model units: y up, +z forward, the bird's left at +x. The bowed head
  // hangs in front of the chest, the bill tip down at breast height, so the
  // bill, tongue and eyes belong to the head outright; body and feather
  // joints count as head when they sit forward of the neck and above the
  // breast.
  const height = box.max.y - Math.min(0, box.min.y);
  const halfWidth = Math.max(-box.min.x, box.max.x);
  let shoulderY = 0;
  const classified = joints.map(({ headOnly, c: list }) => list.map((c) => {
    if (!c) return { head: 0, flip: 0 };
    if (headOnly) return { head: 1, flip: 0 };
    const head = smooth(0, 0.07 * height, c[2]) * smooth(0.64 * height, 0.72 * height, c[1]);
    const flip = Math.sign(c[0]) * smooth(halfWidth * 0.55, halfWidth * 0.72, Math.abs(c[0])) * (1 - head);
    if (flip) shoulderY = Math.max(shoulderY, c[1]);
    return { head, flip };
  }));

  ASSET = {
    scene, materials, joints: classified, height,
    center: feet.getCenter(new THREE.Vector3()).setY(0),
    neck: new THREE.Vector3(0, 0.8 * height, -0.02 * height),
    shoulderL: new THREE.Vector3(halfWidth * 0.55, shoulderY || height * 0.72, 0),
    shoulderR: new THREE.Vector3(-halfWidth * 0.55, shoulderY || height * 0.72, 0),
  };
}

export function setAdultQuality({ alphaToCoverage }) {
  for (const m of ASSET.materials) {
    if (m.name !== 'penguin_feather' || m.alphaToCoverage === alphaToCoverage) continue;
    m.alphaToCoverage = alphaToCoverage;
    m.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _hinv = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const AX_Z = new THREE.Vector3(0, 0, 1);

// Rotation `rot` about `pivot`, written into `out`.
function aboutPivot(pivot, rot, out) {
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(rot);
  return out.multiply(_t.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

export class Adult {
  constructor(x, z, yaw, world) {
    this.world = world;
    this.root = new THREE.Group();
    this.root.position.set(x, world.heightAt(x, z), z);
    this.root.rotation.y = yaw;
    const s = 0.95 + Math.random() * 0.1;
    this.yaw = yaw;
    this.targetYaw = yaw;

    // Rocks the whole bird about its feet.
    this.pivot = new THREE.Group();
    this.pivot.rotation.order = 'YXZ';
    this.root.add(this.pivot);
    this.holder = new THREE.Group();
    const k = (HEIGHT / ASSET.height) * s;
    this.holder.scale.setScalar(k);
    this.holder.position.copy(ASSET.center).multiplyScalar(-k);
    this.pivot.add(this.holder);
    this.model = cloneSkinned(ASSET.scene);
    this.holder.add(this.model);

    // Unique joints across all skins, each with its classification.
    const seen = new Map();
    let mi = 0;
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.skeleton.bones.forEach((bone, bi) => {
        const j = ASSET.joints[mi][bi];
        const prev = seen.get(bone);
        if (!prev) seen.set(bone, { bone, ...j });
        else if (!prev.head && !prev.flip) Object.assign(prev, j);
      });
      mi++;
    });
    this.joints = [...seen.values()].filter((j) => j.head || j.flip);

    this.t = Math.random() * 20;
    this.look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 0 };
    this.headYaw = 0;
    this.headPitch = 0;
    this.flipSpread = 0;
    this.callT = 0;
    this.collider = { x, z, r: 0.3 * s };
  }

  call() {
    this.callT = 2.2;
  }

  faceTowards(x, z) {
    this.targetYaw = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  update(dt) {
    const t = (this.t += dt);
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 1.2);
    this.root.rotation.y = this.yaw;

    const L = this.look;
    if (t > L.next) {
      L.tYaw = (Math.random() - 0.5) * 1.8;
      L.tPitch = (Math.random() - 0.4) * 0.5;
      L.next = t + 2 + Math.random() * 5;
    }
    L.yaw += (L.tYaw - L.yaw) * Math.min(1, dt * 2);
    L.pitch += (L.tPitch - L.pitch) * Math.min(1, dt * 2);

    this.callT = Math.max(0, this.callT - dt);
    const c = this.callT > 0 ? Math.sin(Math.PI * (1 - this.callT / 2.2)) : 0;
    // Calling posture: head down to the chest, then up.
    const callPitch = this.callT > 1.4 ? 0.5 * c : -0.7 * c;

    this.pivot.rotation.set(0.02 + Math.sin(t * 0.6) * 0.02 - c * 0.08, 0, Math.sin(t * 0.9) * 0.025);
    // Positive pitch lowers the head, as in the old procedural model.
    this.headPitch = lerp(L.pitch, 0, c) + callPitch - HEAD_LIFT;
    this.headYaw = L.yaw * (1 - c);
    this.headRoll = Math.sin(t * 0.5) * 0.06;
    this.flipSpread = 0.06 + Math.sin(t * 0.8) * 0.03 + c * 0.1;
  }

  // Call after scene.updateMatrixWorld(): turns the head and flipper joints
  // away from the rest pose.
  applyPose() {
    const H = this.holder.matrixWorld;
    _hinv.copy(H).invert();
    for (const j of this.joints) {
      if (j.head) {
        _e.set(this.headPitch * j.head, this.headYaw * j.head, this.headRoll * j.head);
        aboutPivot(ASSET.neck, _r.makeRotationFromEuler(_e), _m);
      } else {
        const pivot = j.flip > 0 ? ASSET.shoulderL : ASSET.shoulderR;
        aboutPivot(pivot, _r.makeRotationAxis(AX_Z, this.flipSpread * j.flip), _m);
      }
      // Model-space rigid transform to world space: H · M · H⁻¹.
      _m.premultiply(H).multiply(_hinv);
      j.bone.matrixWorld.premultiply(_m);
    }
  }
}
