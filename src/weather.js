import * as THREE from 'three';

// Weather over the sea ice: clear, falling snow and blizzard, either fixed or
// drifting from one to the next. Everything that depends on the weather reads
// the blended values here, so a change of weather fades in over a few seconds.
// The prevailing (katabatic) wind blows toward +x.

export const WEATHERS = {
  // wind: mean speed (m/s); snow/drift: 0..1 amounts; fog: FogExp2 density;
  // overcast: 0 = full sun, 1 = sun hidden behind cloud.
  clear: { label: '晴朗', wind: 3.2, gust: 0.5, snow: 0.06, drift: 0.15, fog: 0.0018, overcast: 0 },
  snow: { label: '飄雪', wind: 5.5, gust: 0.9, snow: 0.5, drift: 0.45, fog: 0.009, overcast: 0.55 },
  blizzard: { label: '暴風雪', wind: 15, gust: 1.6, snow: 1, drift: 1, fog: 0.042, overcast: 0.9 },
};
const KEYS = ['wind', 'gust', 'snow', 'drift', 'fog', 'overcast'];

// Auto mode: how long each weather lasts (s) and where it can go next.
const HOLD = { clear: [80, 180], snow: [50, 140], blizzard: [35, 80] };
const NEXT = { clear: ['snow'], snow: ['clear', 'clear', 'blizzard'], blizzard: ['snow'] };

const FLOW_PERIOD = 7;

export class Weather {
  constructor(mode = 'auto') {
    this.mode = mode;
    this.kind = mode === 'auto' ? 'clear' : mode;
    this.hold = 60;
    this.cur = { ...WEATHERS[this.kind] };
    this.wind = new THREE.Vector3();
    this.t = 0;
    this.gust = 0;
    this.gustT = 0;
    this.gustLen = 1;
    this.gustAmp = 0;
    this.nextGust = 4;
    // Two cross-faded flow layers carry the snow streaming over the ground.
    this.flows = [0, 0.5].map((p) => ({ age: p * FLOW_PERIOD, off: new THREE.Vector2(Math.random() * 500, Math.random() * 500) }));
    this.flow0 = new THREE.Vector3();
    this.flow1 = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'auto') this.kind = mode;
    this.hold = 40 + Math.random() * 60;
  }

  get label() {
    return WEATHERS[this.kind].label;
  }

  update(dt) {
    if (this.mode === 'auto') {
      this.hold -= dt;
      if (this.hold < 0) {
        const opts = NEXT[this.kind];
        this.kind = opts[Math.floor(Math.random() * opts.length)];
        const [a, b] = HOLD[this.kind];
        this.hold = a + Math.random() * (b - a);
      }
    }
    // Snowfall and cloud build up slowly; wind responds faster.
    const target = WEATHERS[this.kind];
    for (const k of KEYS) {
      const tau = k === 'wind' || k === 'gust' ? 5 : 9;
      this.cur[k] += (target[k] - this.cur[k]) * (1 - Math.exp(-dt / tau));
    }

    // Gusts: short pulses on top of the slowly varying mean wind.
    this.nextGust -= dt;
    if (this.nextGust < 0) {
      this.gustT = 0;
      this.gustLen = 1.5 + Math.random() * 3;
      this.gustAmp = this.cur.gust * this.cur.wind * (0.25 + Math.random() * 0.45);
      this.nextGust = this.gustLen + (3 + Math.random() * 10) / (0.4 + this.cur.gust);
    }
    this.gustT += dt;
    const g = Math.min(1, this.gustT / this.gustLen);
    this.gust = this.gustAmp * Math.sin(Math.PI * g) ** 2;

    for (const f of this.flows) {
      f.age += dt;
      if (f.age > FLOW_PERIOD) {
        f.age -= FLOW_PERIOD;
        f.off.set(Math.random() * 500, Math.random() * 500);
      }
      // Saltating snow moves slower than the air above it.
      f.off.x += this.wind.x * 0.55 * dt;
      f.off.y += this.wind.z * 0.55 * dt;
    }
    const w = (f) => 1 - Math.abs(2 * f.age / FLOW_PERIOD - 1);
    this.flow0.set(this.flows[0].off.x, this.flows[0].off.y, w(this.flows[0]));
    this.flow1.set(this.flows[1].off.x, this.flows[1].off.y, w(this.flows[1]));
  }

  // Wind at simulation time t (called from the fixed physics step).
  sampleWind(t, out = this.wind) {
    const c = this.cur;
    const ws = c.wind * (1 + 0.42 * Math.sin(t * 0.13) + 0.26 * Math.sin(t * 0.41 + 1) + 0.12 * Math.sin(t * 1.3)) + this.gust;
    const wa = 0.18 * Math.sin(t * 0.05) + 0.08 * Math.sin(t * 0.31) * c.gust;
    return out.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);
  }
}
