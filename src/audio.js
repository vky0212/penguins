// Synthesised soundscape: katabatic wind, crunching snow, the chick's
// two-voice whistle and the colony's trumpeting adults. No audio files.

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = w * 0.35 + b * 2.2;
    }

    // Wind: two filtered noise beds.
    const mk = (type, f, q, g) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.2;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = f;
      filt.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = g;
      src.connect(filt).connect(gain).connect(this.master);
      src.start();
      return { filt, gain };
    };
    this.windLow = mk('lowpass', 380, 0.7, 0.2);
    this.windHigh = mk('bandpass', 1400, 2.5, 0.02);
    this.slide = mk('highpass', 1800, 0.5, 0);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  setWind(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windLow.gain.gain.setTargetAtTime(0.12 + 0.3 * s, t, 0.4);
    this.windLow.filt.frequency.setTargetAtTime(260 + 420 * s, t, 0.4);
    this.windHigh.gain.gain.setTargetAtTime(0.004 + 0.05 * s * s, t, 0.5);
    this.windHigh.filt.frequency.setTargetAtTime(1100 + 900 * s, t, 0.6);
  }

  setSlide(speed, ice) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, speed / 4);
    this.slide.gain.gain.setTargetAtTime(v * (ice ? 0.05 : 0.14), t, 0.08);
    this.slide.filt.frequency.setTargetAtTime(ice ? 3800 : 1500 + v * 800, t, 0.1);
  }

  step(ice, vol = 1, pan = 0) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = ice ? 1.6 : 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = ice ? 3600 : 1400 + Math.random() * 900;
    f.Q.value = ice ? 3 : 0.9;
    const g = ctx.createGain();
    const dur = ice ? 0.035 : 0.09;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((ice ? 0.25 : 0.35) * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  // Emperor chick call: a run of whistled syllables. Penguins have two
  // independent voice sources, which shows up as beating between two tones.
  chirp(vol = 1, pan = 0, pitch = 1) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.master);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.13 + Math.random() * 0.08;
      const base = (2300 + Math.random() * 400) * pitch;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13 * vol, t + 0.02);
      g.gain.setValueAtTime(0.13 * vol, t + d * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      g.connect(out);
      for (const [mul, add] of [[1, 0], [1.006, 47]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(base * mul + add, t);
        o.frequency.linearRampToValueAtTime(base * 1.32 * mul + add, t + d * 0.35);
        o.frequency.linearRampToValueAtTime(base * 1.12 * mul + add, t + d);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 26;
        const lg = ctx.createGain();
        lg.gain.value = 90 * pitch;
        lfo.connect(lg).connect(o.frequency);
        o.connect(g);
        o.start(t);
        lfo.start(t);
        o.stop(t + d + 0.02);
        lfo.stop(t + d + 0.02);
      }
      t += d + 0.04 + Math.random() * 0.05;
    }
  }

  // Adult call: harsh, buzzy trumpet syllables with two-voice beating.
  adultCall(vol = 1, pan = 0) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx;
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 - (1 - vol) * 1000;
    lp.connect(out).connect(this.master);
    let t = ctx.currentTime + 0.05;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const d = 0.45 + Math.random() * 0.4;
      const base = 520 + Math.random() * 160;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.05);
      g.gain.setValueAtTime(0.07 * vol, t + d * 0.8);
      g.gain.linearRampToValueAtTime(0, t + d);
      g.connect(lp);
      for (const det of [0, 33]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base + det, t);
        o.frequency.linearRampToValueAtTime(base * 0.94 + det, t + d);
        o.connect(g);
        o.start(t);
        o.stop(t + d + 0.02);
      }
      t += d + 0.12;
    }
  }
}
