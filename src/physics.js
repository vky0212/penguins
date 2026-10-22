import * as THREE from 'three';
import { WORLD_RADIUS } from './world.js';

// Character physics on a heightfield: Coulomb-style friction that depends on
// the surface (snow vs. glaze ice) and posture (standing vs. tobogganing),
// slope gravity, hops, and circle colliders.

const G = 9.81;
const _n = new THREE.Vector3();

export function makeBody(x, z, yaw, world) {
  return {
    pos: new THREE.Vector3(x, world.heightAt(x, z), z),
    vel: new THREE.Vector3(),
    yaw,
    radius: 0.12,
    grounded: true,
    mode: 'walk',
    modeT: 0,
    slip: 0,
    onIce: false,
    speed: 0,
    slopeF: 0,
    pushing: false,
    landed: false,
  };
}

const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// inp: { x, z (world-space move dir, |v|<=1), run, hop, slide }
export function stepCharacter(b, inp, dt, world, colliders) {
  const n = world.normalAt(b.pos.x, b.pos.z, _n);
  const ice = world.iceAt(b.pos.x, b.pos.z) > 0.5;
  b.onIce = ice;
  b.landed = false;
  const mag = Math.min(1, Math.hypot(inp.x, inp.z));
  let vx = b.vel.x, vz = b.vel.z;

  if (b.mode === 'tumble') {
    b.modeT -= dt;
    if (b.modeT <= 0) b.mode = 'walk';
  }
  if (inp.slide && b.grounded) {
    if (b.mode === 'walk') {
      b.mode = 'slide';
      vx += Math.sin(b.yaw) * 0.7;
      vz += Math.cos(b.yaw) * 0.7;
    } else if (b.mode === 'slide') {
      b.mode = 'walk';
    }
  }
  const lying = b.mode !== 'walk';
  b.pushing = false;

  if (b.grounded) {
    // Gravity along the slope. Standing on snow, static friction holds the
    // chick on gentle slopes; on ice or on the belly it slides.
    let slopeK = lying ? 1 : ice ? 0.75 : Math.max(0, (0.88 - n.y) * 5);
    vx += G * n.y * n.x * slopeK * dt;
    vz += G * n.y * n.z * slopeK * dt;

    if (!lying) {
      const maxSpd = (inp.run ? 1.45 : 0.72) * n.y;
      const tx = inp.x * maxSpd, tz = inp.z * maxSpd;
      let ex = tx - vx, ez = tz - vz;
      const el = Math.hypot(ex, ez);
      const traction = (ice ? 0.9 : 6.5) * dt;
      if (el > traction) {
        ex *= traction / el;
        ez *= traction / el;
        if (ice && el > 0.55 && Math.hypot(vx, vz) > 0.55) b.slip += dt;
      } else {
        b.slip = Math.max(0, b.slip - dt * 2);
      }
      vx += ex;
      vz += ez;
      if (b.slip > 0.45 && Math.random() < dt * 3) {
        b.mode = 'tumble';
        b.modeT = 1.7;
        b.slip = 0;
      }
      const sp = Math.hypot(vx, vz);
      let target = b.yaw;
      if (mag > 0.1) target = Math.atan2(inp.x, inp.z);
      else if (sp > 0.35) target = Math.atan2(vx, vz);
      const rate = (ice ? 3 : 6) * dt;
      b.yaw += Math.max(-rate, Math.min(rate, angleTo(b.yaw, target)));
      if (inp.hop) {
        b.vel.y = 2.0;
        b.grounded = false;
      }
    } else {
      // Tobogganing: kinetic friction on the belly, feet push, steer slowly.
      const mu = b.mode === 'tumble' ? 0.35 : ice ? 0.025 : 0.065;
      let sp = Math.hypot(vx, vz);
      if (sp > 1e-4) {
        // Coulomb friction plus aerodynamic/snow-plough drag.
        const dec = Math.min(sp, (mu * G * n.y + 0.05 * sp * sp) * dt);
        vx -= (vx / sp) * dec;
        vz -= (vz / sp) * dec;
      }
      if (b.mode === 'slide') {
        if (mag > 0.1) {
          const target = Math.atan2(inp.x, inp.z);
          const rate = 1.6 * dt;
          b.yaw += Math.max(-rate, Math.min(rate, angleTo(b.yaw, target)));
          const fwd = Math.sin(b.yaw) * inp.x + Math.cos(b.yaw) * inp.z;
          sp = Math.hypot(vx, vz);
          if (fwd > 0.2 && sp < 2.0) {
            const push = (ice ? 0.8 : 2.4) * fwd * dt;
            vx += Math.sin(b.yaw) * push;
            vz += Math.cos(b.yaw) * push;
            b.pushing = true;
          }
        }
        // The belly acts like a keel: velocity bends toward the facing.
        sp = Math.hypot(vx, vz);
        if (sp > 0.15) {
          const vy = Math.atan2(vx, vz);
          const k = Math.min(1, (ice ? 0.6 : 2.2) * dt);
          const ny = vy + angleTo(vy, b.yaw) * k;
          vx = Math.sin(ny) * sp;
          vz = Math.cos(ny) * sp;
          if (mag < 0.1) b.yaw += angleTo(b.yaw, vy) * Math.min(1, dt * 0.8);
        }
      }
    }
  } else {
    b.vel.y -= G * dt;
    vx += inp.x * 0.6 * dt;
    vz += inp.z * 0.6 * dt;
  }

  const sp = Math.hypot(vx, vz);
  if (sp > 8) {
    vx *= 8 / sp;
    vz *= 8 / sp;
  }

  b.pos.x += vx * dt;
  b.pos.z += vz * dt;

  // Circle colliders (ice blocks, adults, other chicks).
  for (const c of colliders) {
    if (c.self === b) continue;
    const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
    const rr = c.r + b.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const push = rr - d;
      b.pos.x += nx * push;
      b.pos.z += nz * push;
      const vn = vx * nx + vz * nz;
      if (vn < 0) {
        vx -= vn * nx * 1.25;
        vz -= vn * nz * 1.25;
      }
    }
  }
  const r = Math.hypot(b.pos.x, b.pos.z);
  if (r > WORLD_RADIUS) {
    b.pos.x *= WORLD_RADIUS / r;
    b.pos.z *= WORLD_RADIUS / r;
    const vn = (vx * b.pos.x + vz * b.pos.z) / WORLD_RADIUS;
    if (vn > 0) {
      vx -= (vn * b.pos.x) / WORLD_RADIUS;
      vz -= (vn * b.pos.z) / WORLD_RADIUS;
    }
  }

  const gy = world.heightAt(b.pos.x, b.pos.z);
  if (b.grounded) {
    b.pos.y = gy;
    b.vel.y = 0;
  } else {
    b.pos.y += b.vel.y * dt;
    if (b.pos.y <= gy) {
      b.pos.y = gy;
      b.vel.y = 0;
      b.grounded = true;
      b.landed = true;
    }
  }
  b.vel.x = vx;
  b.vel.z = vz;
  b.speed = Math.hypot(vx, vz);
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  b.slopeF = -(n.x * fx + n.z * fz) / Math.max(n.y, 0.3);
}
