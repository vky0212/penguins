import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './model.js';

// Adult emperor penguin, ~1.1 m. Rigged model with feather cards
// (assets/adult.glb, built by tools/chick-model/prepare-adult.mjs). The
// source has no clips and its rest pose bows the head toward a chick, so all
// motion is procedural. Each adult runs a small behaviour loop: standing and
// looking around, preening its flank, stretching (head up, flippers out and
// back), dozing, shaking its head, and now and then waddling a few metres
// through the colony. Walking is a short-stepped waddle: the body rolls onto
// the standing foot, the swinging foot lifts a few centimetres, the flippers
// hold out for balance. Calls dip the head to the chest and raise it.
// As with the chick, the skeleton is partly flattened, so joints are
// classified by the vertices they move (head, flippers, feet) and get rigid
// world-space transforms instead of being posed through the hierarchy.

const HEIGHT = 1.1;
// The rest pose looks down at about 60°; this lift brings the bill up to a
// relaxed standing angle.
const HEAD_LIFT = 0.9;
const HEAD_MESHES = ['penguin_peck', 'penguin_tongue', 'penguin_eyes', 'penguin_eyelens'];
const WALK_SPEED = 0.32; // m/s, an unhurried colony shuffle
const STRIDE = 0.12; // m per step
const STEP_LIFT = 0.035; // m
const WANDER = 2.4; // m around the spot each adult started on

let ASSET = null;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
  const feet = { L: new THREE.Box3(), R: new THREE.Box3() };
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
      if (o.name === 'penguin_leg') feet[v.x > 0 ? 'L' : 'R'].expandByPoint(v);
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
      leg: o.name === 'penguin_leg',
      c: sums.map((s) => (s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null)),
    });
  });
  // Model units: y up, +z forward, the bird's left at +x. The bowed head
  // hangs in front of the chest, the bill tip down at breast height, so the
  // bill, tongue and eyes belong to the head outright; body and feather
  // joints count as head when they sit forward of the neck and above the
  // breast. Feet are the leg joints near the ground.
  const height = box.max.y - Math.min(0, box.min.y);
  const halfWidth = Math.max(-box.min.x, box.max.x);
  let shoulderY = 0;
  const classified = joints.map(({ headOnly, leg, c: list }) => list.map((c) => {
    if (!c) return { head: 0, flip: 0, foot: 0 };
    if (headOnly) return { head: 1, flip: 0, foot: 0 };
    if (leg) return { head: 0, flip: 0, foot: c[1] < 0.15 * height ? Math.sign(c[0]) : 0 };
    const head = smooth(0, 0.07 * height, c[2]) * smooth(0.64 * height, 0.72 * height, c[1]);
    const flip = Math.sign(c[0]) * smooth(halfWidth * 0.55, halfWidth * 0.72, Math.abs(c[0])) * (1 - head);
    if (flip) shoulderY = Math.max(shoulderY, c[1]);
    return { head, flip, foot: 0 };
  }));

  const footL = feet.L.getCenter(new THREE.Vector3()).setY(0);
  const footR = feet.R.getCenter(new THREE.Vector3()).setY(0);
  ASSET = {
    scene, materials, joints: classified, height,
    unit: height / HEIGHT, // model units per metre
    center: footL.clone().add(footR).multiplyScalar(0.5),
    footL, footR,
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

// Rotation `rot` about `pivot`, written into `out`.
function aboutPivot(pivot, rot, out) {
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(rot);
  return out.multiply(_t.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

// Swing and stance of one foot at cycle position u (0–1): the first half
// swings forward and lifts, the second half stands while the body passes.
function footCycle(u) {
  if (u < 0.5) {
    const w = u * 2;
    return { z: -0.5 + smooth(0, 1, w), y: Math.sin(Math.PI * w) };
  }
  return { z: 0.5 - (u - 0.5) * 2, y: 0 };
}

export class Adult {
  constructor(x, z, yaw, world) {
    this.world = world;
    this.home = { x, z };
    this.restYaw = yaw; // back to the wind
    this.root = new THREE.Group();
    this.root.position.set(x, world.heightAt(x, z), z);
    this.root.rotation.y = yaw;
    const s = 0.95 + Math.random() * 0.1;
    this.size = s;
    this.yaw = yaw;
    this.targetYaw = yaw;

    // Rocks the whole bird about its feet.
    this.pivot = new THREE.Group();
    this.pivot.rotation.order = 'YXZ';
    this.root.add(this.pivot);
    this.holder = new THREE.Group();
    this.k = (HEIGHT / ASSET.height) * s;
    this.holder.scale.setScalar(this.k);
    this.holder.position.copy(ASSET.center).multiplyScalar(-this.k);
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
        else if (!prev.head && !prev.flip && !prev.foot) Object.assign(prev, j);
      });
      mi++;
    });
    this.joints = [...seen.values()].filter((j) => j.head || j.flip || j.foot);

    this.t = Math.random() * 20;
    this.look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 0 };
    // Current pose, eased toward each behaviour's target. Head pitch is
    // measured from the bowed rest pose, positive down.
    this.pose = { hp: -HEAD_LIFT, hy: 0, hr: 0, flipL: 0.06, flipR: 0.06, back: 0, lean: 0, sway: 1 };
    this.out = { hp: 0, hy: 0, hr: 0, flipL: 0, flipR: 0, back: 0 };
    this.act = { type: 'look', t: 0, dur: 2 + Math.random() * 8 };
    this.callT = 0;
    this.walk = null;
    this.speed = 0;
    this.phase = Math.random();
    this.stepW = 0;
    this.feet = { L: { z: 0, y: 0 }, R: { z: 0, y: 0 } };
    this.onStep = null;
    this.collider = { x, z, r: 0.3 * s };
  }

  call() {
    this.callT = 2.2;
  }

  faceTowards(x, z) {
    this.targetYaw = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  // Waddles over to (x, z) and stops `stopAt` metres short, e.g. to meet a
  // chick that called.
  walkTo(x, z, stopAt = 0) {
    this.walk = { x, z, stopAt, stuck: 0 };
    this.act = { type: 'walk', t: 0, dur: Infinity };
  }

  // A free spot near home, off the glaze ice and clear of other bodies.
  _wanderTarget(colliders) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * WANDER;
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (this.world.iceAt(x, z) > 0.2) continue;
      if (colliders.some((c) => c !== this.collider && Math.hypot(c.x - x, c.z - z) < c.r + 0.75)) continue;
      return { x, z };
    }
    return null;
  }

  _nextAct(colliders) {
    this.targetYaw = this.restYaw;
    const r = Math.random();
    const target = r < 0.12 ? this._wanderTarget(colliders) : null;
    if (target) return this.walkTo(target.x, target.z);
    if (r < 0.38) this.act = { type: 'preen', t: 0, dur: 4 + Math.random() * 4, side: Math.random() < 0.5 ? 1 : -1 };
    else if (r < 0.46) this.act = { type: 'stretch', t: 0, dur: 3.4 };
    else if (r < 0.6) this.act = { type: 'doze', t: 0, dur: 8 + Math.random() * 10 };
    else if (r < 0.66) this.act = { type: 'shake', t: 0, dur: 1 };
    else this.act = { type: 'look', t: 0, dur: 4 + Math.random() * 8 };
  }

  // colliders: everything an adult must not walk into (its own collider
  // included; it is skipped).
  update(dt, colliders = []) {
    const t = (this.t += dt);
    const act = this.act;
    act.t += dt;
    if (act.t > act.dur) this._nextAct(colliders);

    this.callT = Math.max(0, this.callT - dt);
    const c = this.callT > 0 ? Math.sin(Math.PI * (1 - this.callT / 2.2)) : 0;

    // ── Walking ──
    let want = 0;
    let turnRate = 1.2;
    const p = this.root.position;
    if (this.walk) {
      const W = this.walk;
      const dx = W.x - p.x, dz = W.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= W.stopAt + 0.1) {
        // Arrived. After meeting someone, stay facing them a while.
        this.walk = null;
        this.act = { type: 'look', t: 0, dur: W.stopAt > 0 ? 10 + Math.random() * 6 : 3 + Math.random() * 5 };
      } else {
        this.targetYaw = Math.atan2(dx, dz);
        turnRate = 2.5;
        const off = Math.abs(wrap(this.targetYaw - this.yaw));
        want = WALK_SPEED * this.size * (1 - smooth(0.25, 0.7, off)) * smooth(0, 0.35, d - W.stopAt);
        // Wait for whoever is in the way; give up after a while.
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        const blocked = colliders.some((o) => {
          if (o === this.collider) return false;
          const ox = o.x - p.x, oz = o.z - p.z;
          const od = Math.hypot(ox, oz);
          return od < this.collider.r + o.r + 0.2 && ox * fx + oz * fz > 0.3 * od;
        });
        if (blocked || c > 0) want = 0;
        W.stuck = blocked ? W.stuck + dt : 0;
        if (W.stuck > 2.5) {
          this.walk = null;
          this.act = { type: 'look', t: 0, dur: 2 + Math.random() * 4 };
        }
      }
    }
    const dy = wrap(this.targetYaw - this.yaw);
    const turn = dy * Math.min(1, dt * turnRate);
    this.yaw += turn;
    this.root.rotation.y = this.yaw;
    this.speed += (want - this.speed) * Math.min(1, dt * 4);
    if (this.speed > 1e-3) {
      p.x += Math.sin(this.yaw) * this.speed * dt;
      p.z += Math.cos(this.yaw) * this.speed * dt;
      p.y = this.world.heightAt(p.x, p.z);
      this.collider.x = p.x;
      this.collider.z = p.z;
    }

    // Short steps while moving or turning on the spot.
    const turning = Math.abs(turn / Math.max(dt, 1e-4)) > 0.25;
    const stepping = this.speed > 0.03 || turning;
    this.stepW += ((stepping ? 1 : 0) - this.stepW) * Math.min(1, dt * 5);
    const prevL = this.phase % 1;
    this.phase += (dt * Math.max(this.speed, stepping ? 0.12 : 0)) / (2 * STRIDE * this.size);
    const uL = this.phase % 1, uR = (this.phase + 0.5) % 1;
    const stride = STRIDE * ASSET.unit * smooth(0, WALK_SPEED, this.speed + 0.04);
    const lift = STEP_LIFT * ASSET.unit;
    for (const [side, u] of [['L', uL], ['R', uR]]) {
      const f = footCycle(u);
      this.feet[side].z = f.z * stride * this.stepW;
      this.feet[side].y = f.y * lift * this.stepW;
    }
    // Footfalls: the left foot lands at u = 0.5, the right at u = 0.
    if (this.stepW > 0.5 && this.onStep) {
      if (prevL < 0.5 && uL >= 0.5) this._footfall('L');
      if (uL < prevL) this._footfall('R');
    }

    // ── Behaviour targets ──
    const L = this.look;
    if (t > L.next) {
      L.tYaw = (Math.random() - 0.5) * 1.8;
      L.tPitch = (Math.random() - 0.4) * 0.5;
      L.next = t + 2 + Math.random() * 5;
    }
    L.yaw += (L.tYaw - L.yaw) * Math.min(1, dt * 2);
    L.pitch += (L.tPitch - L.pitch) * Math.min(1, dt * 2);

    const g = { hp: -HEAD_LIFT + L.pitch, hy: L.yaw, hr: 0, flipL: 0.06, flipR: 0.06, back: 0, lean: 0, sway: 1 };
    let shakeYaw = 0, nibble = 0;
    const e = act.dur < Infinity ? smooth(0, 0.6, act.t) * smooth(0, 0.6, act.dur - act.t) : 1;
    switch (act.type) {
      case 'walk':
        // Look ahead, flippers out for balance.
        g.hp = -HEAD_LIFT + 0.1;
        g.hy = L.yaw * 0.2;
        g.flipL = g.flipR = 0.2;
        g.lean = 0.04;
        break;
      case 'preen':
        // Head round to the flank, that flipper lifted, bill nibbling.
        g.hp = 0.1;
        g.hy = act.side * 1.1;
        g.hr = act.side * 0.3;
        g[act.side > 0 ? 'flipL' : 'flipR'] = 0.35;
        g.lean = 0.05;
        nibble = Math.sin(t * 13) * 0.07 * smooth(0.1, 0.4, Math.sin(t * 1.7)) * e;
        break;
      case 'stretch': {
        // Head high, flippers out and back, leaning back.
        const s = Math.sin(Math.PI * Math.min(1, act.t / act.dur));
        g.hp = -HEAD_LIFT - 0.5 * s;
        g.hy = 0;
        g.flipL = g.flipR = 0.06 + 0.7 * s;
        g.back = 0.45 * s;
        g.lean = -0.08 * s;
        break;
      }
      case 'doze':
        // Head sunk into the shoulders, barely swaying.
        g.hp = -0.3;
        g.hy = L.yaw * 0.1;
        g.lean = 0.03;
        g.sway = 0.3;
        break;
      case 'shake':
        g.hp = -HEAD_LIFT + 0.1;
        g.hy = 0;
        shakeYaw = Math.sin(act.t * 30) * 0.4 * (1 - act.t / act.dur) * smooth(0, 0.1, act.t);
        break;
    }
    const P = this.pose;
    const ease = Math.min(1, dt * (act.type === 'stretch' ? 6 : 3));
    for (const key of Object.keys(g)) P[key] += (g[key] - P[key]) * ease;

    // Calling posture: head down to the chest, then up.
    const callPitch = this.callT > 1.4 ? 0.5 * c : -0.7 * c;
    const O = this.out;
    O.hp = lerp(P.hp, -HEAD_LIFT, c) + callPitch + nibble;
    O.hy = P.hy * (1 - c) + shakeYaw;
    O.hr = P.hr * (1 - c) + Math.sin(t * 0.5) * 0.06 * P.sway;
    O.flipL = P.flipL + c * 0.1 + Math.sin(t * 0.8) * 0.03 * P.sway;
    O.flipR = P.flipR + c * 0.1 + Math.sin(t * 0.8 + 1) * 0.03 * P.sway;
    O.back = P.back;

    // Body: idle rocking, the waddle's roll onto the standing foot, leaning.
    const roll = Math.sin(2 * Math.PI * uL) * 0.085 * this.stepW;
    this.pivot.rotation.set(
      0.02 + P.lean + Math.sin(t * 0.6) * 0.02 * P.sway - c * 0.08,
      Math.sin(2 * Math.PI * uL) * 0.05 * this.stepW,
      Math.sin(t * 0.9) * 0.025 * P.sway + roll,
    );
  }

  _footfall(side) {
    const f = side === 'L' ? ASSET.footL : ASSET.footR;
    const lx = (f.x - ASSET.center.x) * this.k;
    const lz = (f.z - ASSET.center.z + this.feet[side].z) * this.k;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const p = this.root.position;
    this.onStep(side === 'L' ? -1 : 1, p.x + lx * c + lz * s, p.z - lx * s + lz * c);
  }

  // Call after scene.updateMatrixWorld(): moves the head, flipper and foot
  // joints away from the rest pose.
  applyPose() {
    const H = this.holder.matrixWorld;
    _hinv.copy(H).invert();
    const O = this.out;
    for (const j of this.joints) {
      if (j.head) {
        _e.set(O.hp * j.head, O.hy * j.head, O.hr * j.head);
        aboutPivot(ASSET.neck, _r.makeRotationFromEuler(_e), _m);
      } else if (j.flip) {
        const w = Math.abs(j.flip);
        _e.set(O.back * w, 0, (j.flip > 0 ? O.flipL : O.flipR) * j.flip);
        aboutPivot(j.flip > 0 ? ASSET.shoulderL : ASSET.shoulderR, _r.makeRotationFromEuler(_e), _m);
      } else {
        const f = this.feet[j.foot > 0 ? 'L' : 'R'];
        if (!f.y && !f.z) continue;
        _m.makeTranslation(0, f.y, f.z);
      }
      // Model-space rigid transform to world space: H · M · H⁻¹.
      _m.premultiply(H).multiply(_hinv);
      j.bone.matrixWorld.premultiply(_m);
    }
  }
}
