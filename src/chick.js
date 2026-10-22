import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { FurPart, paint, smooth, lerp } from './fur.js';

// Emperor penguin chick (Aptenodytes forsteri), crèche age (~10 weeks):
// ~55 cm tall, pear-shaped and very fluffy, silver-grey down that is darker
// on the back and paler on the belly. Black crown running from the bill over
// the back of the head and down the sides of the neck; white cheeks,
// "goggles" around the eyes, chin and throat. Small dark-brown eyes, slender
// slightly hooked all-black bill, dark grey scaly feet with strong claws.

const C = (hex) => new THREE.Color(hex);
const PAL = {
  greyBack: C('#606367'),
  greyBelly: C('#999c9f'),
  greyLow: C('#808285'),
  stain: C('#8a857e'),
  throat: C('#cfd0ce'),
  hood: C('#2c2d31'),
  black: C('#0f0f11'),
  white: C('#f3f3ef'),
  flipper: C('#6c6f74'),
};

const HEAD_R = 0.104;
const HEAD_SCALE = new THREE.Vector3(1, 0.95, 1.06);
const EYE_DIR = new THREE.Vector3(0.57, 0.22, 0.79).normalize();
const EYE_DIR_L = EYE_DIR.clone().multiply(new THREE.Vector3(-1, 1, 1));
const perlin = new ImprovedNoise();

let GEO = null;

function cleanSmooth(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

// Head shape: flatter crown, fuller cheeks, the face drawn forward into the bill.
function deformHead(v) {
  const q = v.clone().divideScalar(HEAD_R);
  if (q.y > 0) v.y *= 1 - 0.07 * q.y;
  v.x *= 1 + 0.07 * smooth(0.1, -0.45, q.y) * smooth(-0.3, 0.4, q.z);
  const muzzle = Math.exp(-((q.x / 0.38) ** 2) - (((q.y + 0.12) / 0.32) ** 2)) * smooth(0.25, 0.9, q.z);
  v.z += 0.014 * muzzle;
  v.y -= 0.004 * muzzle;
  return v.multiply(HEAD_SCALE);
}

function buildGeometry() {
  // Body: bell/pear lathe with a broad base, belly pushed forward.
  const prof = [[0.0, 0.0], [0.08, 0.004], [0.13, 0.024], [0.158, 0.058], [0.169, 0.105], [0.166, 0.155],
    [0.153, 0.215], [0.13, 0.27], [0.108, 0.316], [0.096, 0.352], [0.07, 0.384], [0.0, 0.396]];
  const pts = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(64);
  pts[0].x = 0.0001;
  pts[pts.length - 1].x = 0.0001;
  let body = new THREE.LatheGeometry(pts, 72);
  const bp = body.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    bp.setZ(i, z * (z > 0 ? 1 + 0.1 * smooth(0.02, 0.12, y) * (1 - smooth(0.24, 0.36, y)) : 0.96));
  }
  body = cleanSmooth(body);
  paint(body, (p, n, o) => {
    const j = perlin.noise(p.x * 40, p.y * 40, p.z * 40) * 0.08;
    const front = smooth(-0.35, 0.65, n.z + j);
    o.color.copy(PAL.greyBack).lerp(PAL.greyBelly, front * 0.9);
    o.color.lerp(PAL.greyLow, smooth(0.08, 0.0, p.y) * 0.6);
    o.color.lerp(PAL.stain, smooth(0.09, 0.02, p.y) * front * 0.35);
    // White chin/throat continues onto the upper breast.
    o.color.lerp(PAL.throat, smooth(0.26, 0.35, p.y + j * 0.2) * smooth(0.2, 0.75, n.z + j) * 0.85);
    // Black hood edge on the back and sides of the neck.
    o.color.lerp(PAL.hood, smooth(0.31, 0.37, p.y + j * 0.2) * smooth(0.1, -0.4, n.z + j) * 0.8);
    o.fur = 1 - 0.45 * smooth(0.05, 0.0, p.y) - 0.6 * smooth(0.37, 0.395, p.y);
  });

  let head = new THREE.SphereGeometry(HEAD_R, 64, 44);
  head = cleanSmooth(head);
  const hp = head.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < hp.count; i++) {
    deformHead(v.fromBufferAttribute(hp, i));
    hp.setXYZ(i, v.x, v.y, v.z);
  }
  head.computeVertexNormals();
  const q = new THREE.Vector3();
  paint(head, (p, n, o) => {
    q.copy(p).divide(HEAD_SCALE).normalize();
    // Feathery, irregular boundaries between black and white.
    const j = perlin.noise(p.x * 95, p.y * 95, p.z * 95) * 0.05 + perlin.noise(p.x * 30, p.y * 30, p.z * 30) * 0.03;
    const ax = Math.abs(q.x) + j;
    const y = q.y + j * 0.8;
    const eye = Math.max(q.dot(EYE_DIR), q.dot(EYE_DIR_L));
    // The upper edge of the white rises around each eye ("goggles").
    const top = 0.15 + 0.15 * smooth(0.8, 0.97, eye);
    const goggles = smooth(0.09, 0.16, ax) * smooth(-0.22, 0.0, q.z + j) * (1 - smooth(top - 0.05, top + 0.04, y));
    const chin = smooth(-0.26, -0.4, y) * smooth(-0.28, 0.12, q.z + j);
    const white = Math.max(goggles, chin);
    o.color.copy(PAL.black).lerp(PAL.white, white);
    // Bare dark skin ring right around the eye.
    o.color.lerp(PAL.black, smooth(0.975, 0.99, eye));
    const bill = smooth(0.84, 0.95, q.z) * (1 - smooth(0.16, 0.32, Math.abs(q.y + 0.12))) * (1 - smooth(0.2, 0.35, Math.abs(q.x)));
    o.fur = (1 - smooth(0.93, 0.985, eye)) * (1 - bill * 0.9) * (0.8 + 0.2 * white);
  });

  // Flipper: thin, tapered and swept back toward the tip.
  let flip = new THREE.SphereGeometry(1, 28, 18);
  flip = cleanSmooth(flip);
  flip.scale(0.013, 0.112, 0.05);
  flip.translate(0, -0.095, 0);
  const fp = flip.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const t = Math.min(1, Math.max(0, -fp.getY(i) / 0.2));
    fp.setZ(i, fp.getZ(i) * (1 - 0.5 * t) - 0.022 * t * t);
    fp.setX(i, fp.getX(i) * (1 - 0.35 * t));
  }
  flip.computeVertexNormals();
  paint(flip, (p, n, o) => {
    o.color.copy(PAL.flipper).lerp(PAL.greyBelly, smooth(-0.2, 0.6, -n.x) * 0.45);
    o.fur = 0.7;
  });

  // Foot: heel pad, three thick toes with webbing between them, long claws.
  const parts = [];
  const heel = new THREE.SphereGeometry(0.027, 16, 10);
  heel.scale(1, 0.42, 1.25);
  parts.push(heel);
  const TOES = [-0.45, 0, 0.45];
  for (const a of TOES) {
    const toe = new THREE.CapsuleGeometry(0.0105, 0.05, 4, 12);
    toe.rotateX(Math.PI / 2);
    toe.scale(1, 0.72, 1);
    toe.translate(0, -0.002, 0.036);
    // Knuckle bumps.
    const tp = toe.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const z = tp.getZ(i);
      const k = 1 + 0.08 * Math.max(0, Math.cos((z - 0.02) * 190));
      tp.setX(i, tp.getX(i) * k);
      tp.setY(i, tp.getY(i) * k);
    }
    toe.rotateY(a);
    parts.push(toe);
    const claw = new THREE.ConeGeometry(0.0055, 0.02, 10);
    claw.rotateX(Math.PI / 2 + 0.35);
    claw.translate(0, -0.005, 0.074);
    claw.rotateY(a);
    parts.push(claw);
  }
  const web = new THREE.Shape();
  const tip = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
  web.moveTo(...tip(TOES[0], 0.012));
  web.lineTo(...tip(TOES[0], 0.05));
  web.quadraticCurveTo(...tip((TOES[0] + TOES[1]) / 2, 0.034), ...tip(TOES[1], 0.052));
  web.quadraticCurveTo(...tip((TOES[1] + TOES[2]) / 2, 0.034), ...tip(TOES[2], 0.05));
  web.lineTo(...tip(TOES[2], 0.012));
  web.lineTo(...tip(TOES[0], 0.012));
  const webG = new THREE.ShapeGeometry(web, 6);
  webG.rotateX(Math.PI / 2);
  webG.translate(0, -0.003, 0);
  parts.push(webG);
  const foot = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
  foot.computeVertexNormals();

  // Bill: slender, ridged along the top (culmen), hooked at the tip.
  const upper = new THREE.ConeGeometry(0.0135, 0.054, 28, 8);
  upper.rotateX(Math.PI / 2);
  upper.translate(0, 0, 0.027);
  upper.scale(0.76, 0.72, 1);
  const up = upper.attributes.position;
  for (let i = 0; i < up.count; i++) {
    const x = up.getX(i), y = up.getY(i), z = up.getZ(i);
    const ridge = y > 0 ? 0.0024 * Math.max(0, 1 - Math.abs(x) / 0.009) * (1 - z / 0.054) : 0;
    up.setY(i, y + ridge - 3.4 * z * z);
  }
  upper.computeVertexNormals();
  const lower = new THREE.ConeGeometry(0.0105, 0.046, 24, 6);
  lower.rotateX(Math.PI / 2);
  lower.translate(0, 0, 0.023);
  lower.scale(0.72, 0.45, 1);
  const lp = lower.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) - 1.6 * lp.getZ(i) ** 2);
  lower.computeVertexNormals();

  // Where the bill meets the face, and where the eyes sit on the surface.
  let billBase = 0;
  for (let i = 0; i < hp.count; i++) {
    if (Math.abs(hp.getX(i)) < 0.012 && Math.abs(hp.getY(i) + 0.016) < 0.012) billBase = Math.max(billBase, hp.getZ(i));
  }
  const eyePos = deformHead(EYE_DIR.clone().multiplyScalar(HEAD_R)).multiplyScalar(0.975);

  return {
    body, head, flip, foot, upper, lower,
    eye: new THREE.SphereGeometry(0.0086, 20, 14),
    lid: new THREE.SphereGeometry(0.0096, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    ring: new THREE.TorusGeometry(0.0088, 0.0016, 8, 28),
    billBase: billBase - 0.004,
    eyePos,
  };
}

const footMat = new THREE.MeshStandardMaterial({ color: C('#2b2c31'), roughness: 0.62, side: THREE.DoubleSide });
const beakMat = new THREE.MeshPhysicalMaterial({ color: C('#0d0d0f'), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const eyeMat = new THREE.MeshPhysicalMaterial({ color: C('#1d120b'), roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
const ringMat = new THREE.MeshStandardMaterial({ color: C('#151517'), roughness: 0.5 });
const lidMat = new THREE.MeshStandardMaterial({ color: C('#2e2f33'), roughness: 0.8 });

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _acc = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

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

    this.body = new FurPart(GEO.body, { length: 0.046, density: 300, maxShells: 32, tip: 1.14, comb: 0.35, tuft: 0.27, snow: 0.35 });
    this.body.position.y = -0.14;
    this.breath.add(this.body);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.205, 0.004);
    this.headPivot.rotation.order = 'YXZ';
    this.breath.add(this.headPivot);
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.062, 0.022);
    this.headPivot.add(headGroup);
    this.head = new FurPart(GEO.head, { length: 0.021, density: 380, maxShells: 32, tip: 1.0, comb: 0.45, tuft: 0.34, snow: 0.1, rootColor: 0.75 });
    headGroup.add(this.head);

    this.eyes = [];
    this.lids = [];
    for (const sx of [-1, 1]) {
      const dir = EYE_DIR.clone().multiply(new THREE.Vector3(sx, 1, 1));
      const pos = GEO.eyePos.clone().multiply(new THREE.Vector3(sx, 1, 1));
      const e = new THREE.Mesh(GEO.eye, eyeMat);
      e.position.copy(pos);
      headGroup.add(e);
      this.eyes.push(e);
      const ring = new THREE.Mesh(GEO.ring, ringMat);
      ring.position.copy(pos).addScaledVector(dir, 0.0035);
      ring.quaternion.setFromUnitVectors(Z, dir);
      headGroup.add(ring);
      const lid = new THREE.Mesh(GEO.lid, lidMat);
      lid.position.copy(pos);
      lid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      lid.visible = false;
      headGroup.add(lid);
      this.lids.push(lid);
    }
    const beakBase = new THREE.Vector3(0, -0.016, GEO.billBase);
    this.beakUpper = new THREE.Mesh(GEO.upper, beakMat);
    this.beakUpper.position.copy(beakBase);
    this.beakUpper.rotation.x = 0.14;
    this.beakUpper.castShadow = true;
    headGroup.add(this.beakUpper);
    this.beakLower = new THREE.Mesh(GEO.lower, beakMat);
    this.beakLower.position.copy(beakBase).add(new THREE.Vector3(0, -0.008, -0.004));
    this.beakLower.rotation.x = 0.17;
    headGroup.add(this.beakLower);

    this.flippers = [];
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(sx * 0.138, 0.1, -0.005);
      const f = new FurPart(GEO.flip, { length: 0.013, density: 340, maxShells: 16, tip: 1.12, comb: 0.6, tuft: 0.35, snow: 0.3 });
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
    for (const l of this.lids) l.visible = blink < 1;

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
