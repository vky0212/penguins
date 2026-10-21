import * as THREE from 'three';

// Wind-driven snow. Particles live in a box that wraps around the camera, so
// a fixed buffer covers the whole world. The wind offset is integrated on the
// CPU so gusts change speed without making the flakes jump.

export class SnowLayer {
  constructor(scene, { count, box, size, opacity, ground = false }) {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box.x;
      pos[i * 3 + 1] = (Math.random() - 0.5) * box.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * box.z;
      rnd[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    this.max = count;
    this.uniforms = {
      uOffset: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: box.clone() },
      uSize: { value: size },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 },
      uScale: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        uniform vec3 uOffset; uniform vec3 uCenter; uniform vec3 uBox;
        uniform float uSize; uniform float uTime; uniform float uScale;
        attribute float aRand;
        varying float vAlpha;
        void main() {
          vec3 p = position + uOffset * (0.75 + aRand * 0.5);
          p += vec3(sin(uTime * 1.3 + aRand * 40.0), sin(uTime * 0.9 + aRand * 23.0) * 0.6, cos(uTime * 1.1 + aRand * 17.0)) * 0.22;
          p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = uSize * uScale * (0.5 + aRand) / max(d, 0.1);
          vAlpha = smoothstep(0.25, 1.0, d) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d));
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, r) * vAlpha * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.ground = ground;
    scene.add(this.points);
  }

  setCount(n) {
    this.points.geometry.setDrawRange(0, Math.min(this.max, n));
  }

  update(dt, center, wind, fall, color, pixelScale) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uOffset.value.x += wind.x * dt;
    u.uOffset.value.z += wind.z * dt;
    u.uOffset.value.y -= fall * dt;
    u.uCenter.value.copy(center);
    u.uColor.value.copy(color);
    u.uScale.value = pixelScale;
  }
}
