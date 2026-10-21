import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FurPart, paint, smooth, lerp } from './fur.js';

// Emperor penguin chick (Aptenodytes forsteri), crèche age: ~55 cm tall,
// silver-grey down, black head with a white face mask, short black beak.

const C = (hex) => new THREE.Color(hex);
const PAL = {
  greyBack: C('#7a7d82'),
  greyBelly: C('#b5b8bc'),
  greyLow: C('#919499'),
  throat: C('#c6c8cb'),
  black: C('#121214'),
  white: C('#f1f1ec'),
  flipper: C('#75787d'),
};

const EYE_DIR = new THREE.Vector3(0.56, 0.2, 0.8).normalize();
const HEAD_SCALE = new THREE.Vector3(1, 0.94, 1.08);
const HEAD_R = 0.098;

let GEO = null;

function cleanSmooth(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

function buildGeometry() {
  // Body: pear-shaped lathe, plump belly pushed slightly forward.
  const prof = [[0.0, 0.0], [0.07, 0.004], [0.12, 0.024], [0.15, 0.06], [0.163, 0.11], [0.162, 0.16],
    [0.15, 0.22], [0.128, 0.275], [0.102, 0.32], [0.085, 0.355], [0.06, 0.385], [0.0, 0.396]];
  const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(56);
  pts[0].x = 0.0001;
  pts[pts.length - 1].x = 0.0001;
  let body = new THREE.LatheGeometry(pts, 64);
  const bp = body.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    if (z > 0) bp.setZ(i, z * (1 + 0.1 * smooth(0.02, 0.12, y) * (1 - smooth(0.24, 0.36, y))));
  }
  body = cleanSmooth(body);
  paint(body, (p, n, o) => {
    const front = smooth(-0.35, 0.65, n.z);
    o.color.copy(PAL.greyBack).lerp(PAL.greyBelly, front * 0.85);
    o.color.lerp(PAL.greyLow, smooth(0.07, 0.0, p.y) * 0.6);
    o.color.lerp(PAL.throat, smooth(0.27, 0.36, p.y) * front * 0.6);
    o.fur = 1 - 0.45 * smooth(0.05, 0.0, p.y) - 0.6 * smooth(0.37, 0.395, p.y);
  });

  // Head: slightly elongated sphere with the face mask painted on.
  let head = new THREE.SphereGeometry(HEAD_R, 48, 32);
  head = cleanSmooth(head);
  head.scale(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);
  head.computeVertexNormals();
  const q = new THREE.Vector3();
  const eyeL = EYE_DIR.clone().multiply(new THREE.Vector3(-1, 1, 1));
  paint(head, (p, n, o) => {
    q.copy(p).divide(HEAD_SCALE).normalize();
    let mask = smooth(0.11, 0.22, Math.abs(q.x)) * (1 - smooth(0.26, 0.4, q.y)) * smooth(-0.42, -0.12, q.z);
    const throat = smooth(-0.2, -0.48, q.y) * smooth(-0.05, 0.4, q.z);
    mask = Math.max(mask, throat * 0.85);
    o.color.copy(PAL.black).lerp(PAL.white, mask);
    const eye = Math.max(q.dot(EYE_DIR), q.dot(eyeL));
    const beak = smooth(0.82, 0.95, q.z) * (1 - smooth(0.2, 0.35, Math.abs(q.y + 0.08)));
    o.fur = (1 - smooth(0.9, 0.975, eye)) * (1 - beak * 0.85);
  });

  // Flipper: flattened ellipsoid hanging from the shoulder.
  let flip = new THREE.SphereGeometry(1, 24, 16);
  flip = cleanSmooth(flip);
  flip.scale(0.014, 0.105, 0.045);
  flip.translate(0, -0.088, 0);
  flip.computeVertexNormals();
  paint(flip, (p, n, o) => {
    o.color.copy(PAL.flipper).lerp(PAL.greyBelly, smooth(-0.2, 0.6, -n.x) * 0.5);
    o.fur = 0.75;
  });

  // Foot: heel pad, three toes and claws.
  const parts = [];
  const heel = new THREE.SphereGeometry(0.024, 14, 10);
  heel.scale(1, 0.42, 1.25);
  parts.push(heel);
  for (const a of [-0.42, 0, 0.42]) {
    const toe = new THREE.CapsuleGeometry(0.0095, 0.042, 4, 10);
    toe.rotateX(Math.PI / 2);
    toe.scale(1, 0.75, 1);
    toe.translate(0, -0.002, 0.032);
    toe.rotateY(a);
    parts.push(toe);
    const claw = new THREE.ConeGeometry(0.005, 0.016, 8);
    claw.rotateX(Math.PI / 2 + 0.25);
    claw.translate(0, -0.004, 0.066);
    claw.rotateY(a);
    parts.push(claw);
  }
  const foot = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
  foot.computeVertexNormals();

  // Beak: short, slightly hooked, upper and lower mandible.
  const upper = new THREE.ConeGeometry(0.017, 0.056, 20, 4);
  upper.rotateX(Math.PI / 2);
  upper.translate(0, 0, 0.028);
  upper.scale(0.82, 0.62, 1);
  const up = upper.attributes.position;
  for (let i = 0; i < up.count; i++) up.setY(i, up.getY(i) - 2.6 * up.getZ(i) ** 2);
  upper.computeVertexNormals();
  const lower = new THREE.ConeGeometry(0.012, 0.044, 16, 3);
  lower.rotateX(Math.PI / 2);
  lower.translate(0, 0, 0.022);
  lower.scale(0.8, 0.5, 1);

  return { body, head, flip, foot, upper, lower, eye: new THREE.SphereGeometry(0.0098, 18, 12) };
}

const footMat = new THREE.MeshStandardMaterial({ color: C('#2a2b30'), roughness: 0.55 });
const beakMat = new THREE.MeshPhysicalMaterial({ color: C('#0e0e10'), roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3 });
const eyeMat = new THREE.MeshPhysicalMaterial({ color: C('#070504'), roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _acc = new THREE.Vector3();

export class Chick {
  constructor({ shells = 16, scale = 1 } = {}) {
    GEO ??= buildGeometry();
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.scale = scale;

    this.pivot = new THREE.Group();
    this.pivot.rotation.order = 'YXZ';
    this.root.add(this.pivot);
    this.breath = new THREE.Group();
    this.pivot.add(this.breath);

    this.body = new FurPart(GEO.body, { length: 0.034, density: 260, maxShells: 24, tip: 1.18 });
    this.body.position.y = -0.14;
    this.breath.add(this.body);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.21, 0.004);
    this.headPivot.rotation.order = 'YXZ';
    this.breath.add(this.headPivot);
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.075, 0.02);
    this.headPivot.add(headGroup);
    this.head = new FurPart(GEO.head, { length: 0.016, density: 330, maxShells: 24, tip: 1.08, rootColor: 0.7 });
    headGroup.add(this.head);

    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(GEO.eye, eyeMat);
      const d = EYE_DIR.clone().multiply(new THREE.Vector3(sx, 1, 1)).multiplyScalar(HEAD_R * 0.93).multiply(HEAD_SCALE);
      e.position.copy(d);
      headGroup.add(e);
      this.eyes.push(e);
    }
    const beakBase = new THREE.Vector3(0, -0.012, HEAD_R * HEAD_SCALE.z * 0.9);
    this.beakUpper = new THREE.Mesh(GEO.upper, beakMat);
    this.beakUpper.position.copy(beakBase);
    this.beakUpper.rotation.x = 0.12;
    this.beakUpper.castShadow = true;
    headGroup.add(this.beakUpper);
    this.beakLower = new THREE.Mesh(GEO.lower, beakMat);
    this.beakLower.position.copy(beakBase).add(new THREE.Vector3(0, -0.009, -0.004));
    this.beakLower.rotation.x = 0.16;
    headGroup.add(this.beakLower);

    this.flippers = [];
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(sx * 0.132, 0.1, -0.005);
      const f = new FurPart(GEO.flip, { length: 0.011, density: 300, maxShells: 12, tip: 1.1 });
      pv.add(f);
      this.breath.add(pv);
      this.flippers.push({ pv, part: f, side: sx });
    }

    this.feet = [];
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(GEO.foot, footMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      this.feet.push({ mesh: m, side: sx, prevSin: 0 });
    }

    this.parts = [this.body, this.head, ...this.flippers.map((f) => f.part)];
    this.setShells(shells);

    this.time = Math.random() * 10;
    this.phase = 0;
    this.walkW = 0;
    this.slideW = 0;
    this.airW = 0;
    this.chirpT = 0;
    this.look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 0 };
    this.blinkT = 2 + Math.random() * 3;
    this.prevVel = new THREE.Vector3();
    this.accS = new THREE.Vector3();
    this.disp = new THREE.Vector3();
    this.onStep = null;
  }

  setShells(n) {
    this.body.setShells(n);
    this.head.setShells(n);
    for (const f of this.flippers) f.part.setShells(Math.ceil(n / 2));
  }

  chirp() {
    this.chirpT = 1.1;
  }

  // st: { pos, yaw, vel, speed, grounded, mode, pushing, slopeF, wind, world }
  update(dt, st) {
    const t = (this.time += dt);
    const sp = st.speed;
    const walking = st.mode === 'walk' && st.grounded;
    this.walkW += ((walking ? Math.min(1, sp / 0.22) : 0) - this.walkW) * Math.min(1, dt * 8);
    const freq = 1.5 + 2.3 * Math.min(sp, 1.6);
    if (walking && sp > 0.02) this.phase += dt * freq;
    const w = this.walkW;
    const ph = this.phase * Math.PI * 2;

    const lying = st.mode === 'slide' || st.mode === 'tumble';
    this.slideW += ((lying ? 1 : 0) - this.slideW) * Math.min(1, dt * (st.mode === 'tumble' ? 10 : 5));
    const s = this.slideW;
    this.airW += ((st.grounded ? 0 : 1) - this.airW) * Math.min(1, dt * 12);
    const air = this.airW;

    this.chirpT = Math.max(0, this.chirpT - dt);
    const c = this.chirpT > 0 ? Math.sin(Math.PI * (1 - this.chirpT / 1.1)) : 0;

    this.root.position.copy(st.pos);
    this.root.rotation.y = st.yaw;

    // Waddle: lean over the stance foot, small vertical bob.
    const roll = Math.sin(ph) * 0.15 * w;
    const bob = Math.abs(Math.cos(ph)) * 0.012 * w;
    const tumbleRoll = st.mode === 'tumble' ? Math.sin(t * 7) * 0.25 : 0;
    this.pivot.position.set(Math.sin(ph) * 0.011 * w * (1 - s), lerp(0.17 + bob, 0.15, s) + air * 0.01, lerp(0, -0.04, s));
    this.pivot.rotation.set(
      lerp(st.slopeF * 0.35 + 0.05 * w + 0.06 * Math.min(sp, 1.5), 1.38, s) - air * 0.08,
      Math.sin(ph) * 0.07 * w,
      roll * (1 - s) + tumbleRoll * s,
    );
    const br = Math.sin(t * 2.4);
    this.breath.scale.set(1 + br * 0.008, 1 + br * 0.005, 1 + br * 0.01);

    // Head: idle look-around, counter-roll while walking, lift when lying.
    const L = this.look;
    if (t > L.next) {
      L.tYaw = (Math.random() - 0.5) * 1.6 * (1 - w * 0.7);
      L.tPitch = (Math.random() - 0.6) * 0.45;
      L.next = t + 1.2 + Math.random() * 3.2;
    }
    L.yaw += (L.tYaw - L.yaw) * Math.min(1, dt * 3);
    L.pitch += (L.tPitch - L.pitch) * Math.min(1, dt * 3);
    this.headPivot.rotation.set(
      lerp(L.pitch * (1 - w * 0.6) - 0.05 * w, -1.05, s) - 0.55 * c,
      L.yaw * (1 - s) * (1 - c * 0.8),
      -roll * 0.55 + Math.sin(t * 0.7) * 0.05 * (1 - w),
    );
    this.beakLower.rotation.x = 0.16 + c * (0.32 + 0.12 * Math.sin(t * 34));

    // Blink.
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? 0.12 : 1;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blink;

    // Flippers: held out for balance, wider when running, sliding or airborne.
    const flap = c * (0.35 + 0.35 * Math.sin(t * 24)) + (st.mode === 'tumble' ? Math.sin(t * 18) * 0.5 : 0);
    const out = 0.16 + 0.22 * w + 0.15 * Math.min(sp, 1.2) * (1 - s) + 0.85 * s + 0.6 * air + flap;
    for (const f of this.flippers) {
      f.pv.rotation.set(0.08 + 0.25 * s, 0, f.side * (out + Math.sin(ph) * 0.07 * w * f.side));
    }

    // Feet: stepping cycle, adapted to the terrain under each foot.
    const A = Math.min(0.045, sp / (4 * freq));
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const p = ph + i * Math.PI;
      const sn = Math.sin(p);
      const lift = Math.max(0, sn) * 0.032 * w * (1 - s);
      let z = -A * Math.cos(p) * w + 0.012;
      let x = f.side * 0.056;
      let footY = 0.004;
      const kick = st.pushing ? Math.sin(t * 9 + i * Math.PI) * 0.045 : 0;
      z = lerp(z, -0.2 + kick, s);
      x = lerp(x, f.side * 0.05, s);
      const sc = this.scale;
      const wx = st.pos.x + (cy * x + sy * z) * sc;
      const wz = st.pos.z + (-sy * x + cy * z) * sc;
      const gy = (st.world.heightAt(wx, wz) - st.pos.y) / sc;
      footY = lerp(gy + footY + lift, 0.035 + Math.max(0, kick) * 0.3, s);
      footY = lerp(footY, 0.02, air);
      f.mesh.position.set(x, footY, z);
      f.mesh.rotation.set(lerp(-lift * 5, -1.5, s), f.side * -0.18, 0);
      if (f.prevSin > 0 && sn <= 0 && w > 0.3 && st.grounded) this.onStep?.(i, wx, wz);
      f.prevSin = sn;
    }

    // Down reacts to acceleration, wind and gravity.
    _acc.copy(st.vel).sub(this.prevVel).divideScalar(Math.max(dt, 1e-3));
    this.prevVel.copy(st.vel);
    this.accS.lerp(_acc, Math.min(1, dt * 6));
    const gust = 0.6 + 0.4 * Math.sin(t * 3.1 + Math.sin(t * 1.3) * 2);
    this.disp.copy(this.accS).multiplyScalar(-0.0035)
      .addScaledVector(st.wind, 0.0011 * gust)
      .add(_v.set(0, -0.005, 0));
    if (this.disp.length() > 0.02) this.disp.setLength(0.02);
    this.pivot.getWorldQuaternion(_q).invert();
    this.disp.applyQuaternion(_q);
    for (const p of this.parts) p.setDisp(this.disp);
  }
}
