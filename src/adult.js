import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, smooth, lerp } from './fur.js';

// Adult emperor penguin: ~1.1 m, black back and head, white belly, pale
// yellow breast, orange-yellow ear patches, long beak with a pink-orange
// mandibular plate. Sleek feathers, so a glossy material instead of fur.

const C = (hex) => new THREE.Color(hex);
const PAL = {
  black: C('#0d0e11'),
  slate: C('#2a2f38'),
  white: C('#efeee8'),
  breast: C('#f5dc9a'),
  ear: C('#f2a531'),
  plate: C('#e9876a'),
};

let GEO = null;
function clean(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

function build() {
  const prof = [[0, 0], [0.12, 0.012], [0.2, 0.05], [0.235, 0.14], [0.246, 0.28], [0.236, 0.42], [0.205, 0.56],
    [0.166, 0.69], [0.13, 0.79], [0.104, 0.87], [0.086, 0.93], [0.05, 0.975], [0, 0.99]];
  const pts = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(64);
  pts[0].x = 0.0001;
  pts[pts.length - 1].x = 0.0001;
  let body = new THREE.LatheGeometry(pts, 56);
  const bp = body.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    bp.setZ(i, z * (z > 0 ? 1 + 0.12 * smooth(0.1, 0.4, y) * (1 - smooth(0.55, 0.8, y)) : 0.92));
  }
  body = clean(body);
  paint(body, (p, n, o) => {
    const y = p.y;
    const edge = -0.3 + 0.62 * smooth(0.45, 0.92, y);
    const wht = smooth(edge - 0.1, edge + 0.06, n.z) * (1 - smooth(0.93, 0.97, y));
    o.color.copy(PAL.black).lerp(PAL.slate, smooth(0.3, -0.6, n.z) * 0.35);
    o.color.lerp(PAL.white, wht);
    o.color.lerp(PAL.breast, smooth(0.55, 0.78, y) * wht * 0.8);
    const ear = smooth(0.8, 0.9, y) * smooth(0.25, 0.55, Math.abs(n.x)) * smooth(-0.45, -0.05, n.z) * (1 - smooth(0.95, 0.98, y));
    o.color.lerp(PAL.ear, ear * 0.9);
  });

  let head = new THREE.SphereGeometry(0.075, 40, 28);
  head = clean(head);
  head.scale(0.95, 0.9, 1.25);
  head.computeVertexNormals();
  const q = new THREE.Vector3();
  paint(head, (p, n, o) => {
    q.copy(p).normalize();
    const ear = smooth(0.4, 0.62, Math.abs(q.x)) * smooth(-0.75, -0.45, q.z) * (1 - smooth(-0.05, 0.25, q.z)) * (1 - smooth(0.1, 0.35, q.y));
    o.color.copy(PAL.black).lerp(PAL.ear, ear);
  });

  const beak = new THREE.ConeGeometry(0.017, 0.125, 20, 8);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0, 0.0625);
  beak.scale(0.7, 1, 1);
  const kp = beak.attributes.position;
  for (let i = 0; i < kp.count; i++) kp.setY(i, kp.getY(i) - 2.2 * kp.getZ(i) ** 2);
  beak.computeVertexNormals();
  paint(beak, (p, n, o) => {
    const plate = smooth(0.0, -0.006, p.y) * smooth(-0.2, 0.3, Math.abs(n.x)) * (1 - smooth(0.06, 0.09, p.z));
    o.color.copy(PAL.black).lerp(PAL.plate, plate);
  });

  let flip = new THREE.SphereGeometry(1, 20, 14);
  flip = clean(flip);
  flip.scale(0.016, 0.19, 0.06);
  flip.translate(0, -0.17, 0);
  flip.computeVertexNormals();
  paint(flip, (p, n, o) => o.color.copy(PAL.black).lerp(PAL.white, smooth(0.2, 0.7, -n.x) * 0.35));

  const foot = new THREE.SphereGeometry(0.05, 14, 8);
  foot.scale(0.9, 0.3, 1.3);
  foot.translate(0, 0.012, 0.05);
  return { body, head, beak, flip, foot };
}

let MAT = null;
function mats() {
  MAT ??= {
    feather: new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.55,
      sheen: 0.5, sheenRoughness: 0.6, sheenColor: C('#8a96a8'),
    }),
    foot: new THREE.MeshStandardMaterial({ color: C('#1b1c20'), roughness: 0.6 }),
    eye: new THREE.MeshPhysicalMaterial({ color: C('#130c08'), roughness: 0.05, clearcoat: 1 }),
  };
  return MAT;
}

export class Adult {
  constructor(x, z, yaw, world) {
    GEO ??= build();
    const M = mats();
    this.world = world;
    this.root = new THREE.Group();
    this.root.position.set(x, world.heightAt(x, z), z);
    this.root.rotation.y = yaw;
    const s = 1.04 + Math.random() * 0.1;
    this.root.scale.setScalar(s);
    this.yaw = yaw;
    this.targetYaw = yaw;

    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.03;
    this.pivot.rotation.order = 'YXZ';
    this.root.add(this.pivot);
    const body = new THREE.Mesh(GEO.body, M.feather);
    body.castShadow = body.receiveShadow = true;
    this.pivot.add(body);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.93, 0.0);
    this.headPivot.rotation.order = 'YXZ';
    this.pivot.add(this.headPivot);
    const head = new THREE.Mesh(GEO.head, M.feather);
    head.position.set(0, 0.06, 0.03);
    head.castShadow = true;
    this.headPivot.add(head);
    const beak = new THREE.Mesh(GEO.beak, M.feather);
    beak.position.set(0, 0.05, 0.11);
    beak.rotation.x = 0.12;
    beak.castShadow = true;
    this.headPivot.add(beak);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), M.eye);
      e.position.set(sx * 0.047, 0.075, 0.075);
      this.headPivot.add(e);
    }

    this.flippers = [];
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(sx * 0.2, 0.66, -0.01);
      const f = new THREE.Mesh(GEO.flip, M.feather);
      f.castShadow = true;
      pv.add(f);
      this.pivot.add(pv);
      this.flippers.push({ pv, side: sx });
    }
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(GEO.foot, M.foot);
      f.position.set(sx * 0.08, 0, 0.02);
      f.rotation.y = sx * -0.2;
      this.root.add(f);
    }

    this.t = Math.random() * 20;
    this.look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 0 };
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
    this.headPivot.rotation.set(lerp(L.pitch, 0, c) + callPitch, L.yaw * (1 - c), Math.sin(t * 0.5) * 0.06);
    for (const f of this.flippers) f.pv.rotation.set(0.05, 0, f.side * (0.12 + Math.sin(t * 0.8 + f.side) * 0.03 + c * 0.1));
  }
}
