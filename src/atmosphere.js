import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Physical sky (Preetham), image-based lighting baked from that same sky,
// a low polar sun with long shadows, and fog matched to the horizon colour.

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 1.8;
    u.rayleigh.value = 1.25;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.86;

    this.envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.material = this.sky.material;
    envSky.scale.setScalar(20000);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14;
    sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.sunDir = new THREE.Vector3();
    this.fogColor = new THREE.Color('#b9c8d8');
    this.skyTop = new THREE.Color();
    scene.fog = new THREE.FogExp2(this.fogColor.clone(), 0.0022);

    const canFloat = renderer.extensions.has('EXT_color_buffer_float');
    this.sampleRT = canFloat ? new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType }) : null;
    this.sampleCam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.sampleBuf = new Float32Array(8 * 8 * 4);
  }

  #sample(dirX, dirY, dirZ, out) {
    this.sampleCam.position.set(0, 0, 0);
    this.sampleCam.lookAt(dirX, dirY, dirZ);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.sampleRT);
    r.render(this.envScene, this.sampleCam);
    r.readRenderTargetPixels(this.sampleRT, 0, 0, 8, 8, this.sampleBuf);
    r.setRenderTarget(prev);
    let R = 0, G = 0, B = 0;
    for (let i = 0; i < 64; i++) {
      R += this.sampleBuf[i * 4];
      G += this.sampleBuf[i * 4 + 1];
      B += this.sampleBuf[i * 4 + 2];
    }
    return out.set(R / 64, G / 64, B / 64);
  }

  setSun(elevDeg, azimDeg = 100) {
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimDeg);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    const env = this.pmrem.fromScene(this.envScene, 0.02);
    this.env?.dispose();
    this.env = env;
    this.scene.environment = env.texture;

    // Low sun: warm and dim, cold blue sky light in the shadows.
    const e = smooth(0, 30, elevDeg);
    this.sun.color.setRGB(1, 0.72 + 0.24 * e, 0.5 + 0.4 * e);
    this.sun.intensity = 1.6 + 2.2 * smooth(-1, 20, elevDeg);
    this.scene.environmentIntensity = 0.75;

    if (this.sampleRT) {
      const c = new THREE.Color(), acc = new THREE.Color(0, 0, 0);
      for (let i = 0; i < 6; i++) {
        const a = theta + (i / 6) * Math.PI * 2;
        acc.add(this.#sample(Math.sin(a), 0.03, Math.cos(a), c));
      }
      acc.multiplyScalar(1 / 6);
      this.fogColor.copy(acc);
      this.#sample(0, 1, 0.001, this.skyTop);
    } else {
      this.fogColor.setRGB(0.55 + 0.2 * e, 0.62 + 0.2 * e, 0.75 + 0.15 * e);
    }
    this.scene.fog.color.copy(this.fogColor);
  }

  follow(target) {
    // Snap to shadow texels to reduce shimmering while walking.
    const texel = 28 / this.sun.shadow.mapSize.x;
    const t = this.sun.target.position.copy(target);
    t.x = Math.round(t.x / texel) * texel;
    t.z = Math.round(t.z / texel) * texel;
    this.sun.position.copy(t).addScaledVector(this.sunDir, 80);
  }

  setShadowSize(n) {
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
