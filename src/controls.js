import * as THREE from 'three';

// Third-person orbit camera plus keyboard, mouse, touch-joystick and
// pinch controls.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 2.3;
    this.target = new THREE.Vector3();
    this.manualAt = -100;
    this.time = 0;
    this.first = true;
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.004, -0.05, 1.25);
    this.manualAt = this.time;
  }

  zoom(f) {
    this.dist = clamp(this.dist * f, 0.85, 8);
  }

  update(dt, body, world, followBehind) {
    this.time += dt;
    const lying = body.mode !== 'walk';
    const want = new THREE.Vector3(body.pos.x, body.pos.y + (lying ? 0.2 : 0.4), body.pos.z);
    if (this.first) {
      this.target.copy(want);
      this.first = false;
    }
    this.target.lerp(want, 1 - Math.exp(-dt * 9));
    if (followBehind && body.speed > 0.15 && this.time - this.manualAt > 2.5) {
      const behind = body.yaw + Math.PI;
      this.yaw += angleTo(this.yaw, behind) * Math.min(1, dt * 0.9 * Math.min(1, body.speed));
    }
    const cp = Math.cos(this.pitch);
    const p = this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    const minY = world.heightAt(p.x, p.z) + 0.18;
    if (p.y < minY) p.y = minY;
    this.camera.lookAt(this.target);
  }

  // Horizontal forward/right relative to the view.
  basis() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return { fx, fz, rx: -fz, rz: fx };
  }
}

export class Input {
  constructor({ canvas, stick, knob, cam, onAction }) {
    this.cam = cam;
    this.onAction = onAction;
    this.keys = new Set();
    this.stickVec = { x: 0, y: 0 };
    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.stick = stick;
    this.knob = knob;
    this.camPointers = new Map();
    this.pinchDist = 0;
    this.enabled = false;
    this.lastTouchAt = 0;

    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.closest?.('input,button,select')) return;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'Space') onAction('hop');
        if (k === 'KeyE' || k === 'KeyF') onAction('slide');
        if (k === 'KeyC' || k === 'KeyQ') onAction('chirp');
      }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    addEventListener('pointermove', (e) => this.#move(e));
    addEventListener('pointerup', (e) => this.#up(e));
    addEventListener('pointercancel', (e) => this.#up(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.zoom(Math.exp(e.deltaY * 0.001));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #down(e) {
    if (!this.enabled) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch) this.lastTouchAt = performance.now();
    if (touch && this.stickId === null && e.clientX < innerWidth * 0.45) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stick.hidden = false;
      this.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.camPointers.size === 2) this.pinchDist = this.#pinch();
  }

  #pinch() {
    const [a, b] = [...this.camPointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  #move(e) {
    if (e.pointerId === this.stickId) {
      const R = 52;
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx *= R / l;
        dy *= R / l;
      }
      this.stickVec = { x: dx / R, y: -dy / R };
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const p = this.camPointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.camPointers.size === 2) {
      const d = this.#pinch();
      if (this.pinchDist > 0) this.cam.zoom(this.pinchDist / d);
      this.pinchDist = d;
    } else {
      const k = e.pointerType === 'mouse' ? 1 : 1.4;
      this.cam.orbit(dx * k, dy * k);
    }
  }

  #up(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stick.hidden = true;
      return;
    }
    this.camPointers.delete(e.pointerId);
    this.pinchDist = 0;
  }

  // Returns move intent in world space.
  read() {
    const k = this.keys;
    let ix = 0, iy = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iy -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (ix || iy) {
      const l = Math.hypot(ix, iy);
      ix /= l;
      iy /= l;
    } else {
      ix = this.stickVec.x;
      iy = this.stickVec.y;
      const m = Math.hypot(ix, iy);
      if (m < 0.12) ix = iy = 0;
      run = m > 0.9;
    }
    const b = this.cam.basis();
    return { x: b.fx * iy + b.rx * ix, z: b.fz * iy + b.rz * ix, run };
  }
}
