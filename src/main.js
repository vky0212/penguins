import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Atmosphere } from './atmosphere.js';
import { Chick } from './chick.js';
import { Adult } from './adult.js';
import { makeBody, stepCharacter } from './physics.js';
import { Prints } from './prints.js';
import { SnowLayer } from './snow.js';
import { FollowCamera, Input } from './controls.js';
import { AudioFX } from './audio.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('emperor-chick:' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('emperor-chick:' + k, JSON.stringify(v));
    } catch { /* storage unavailable */ }
  },
};

const PRESETS = {
  low: { dpr: 1, shadow: 1024, shells: 10, npcShells: 6, snow: 1200, drift: 500, bloom: false, msaa: 0 },
  medium: { dpr: 1.5, shadow: 2048, shells: 18, npcShells: 10, snow: 2600, drift: 1000, bloom: false, msaa: 2 },
  high: { dpr: 2, shadow: 4096, shells: 30, npcShells: 14, snow: 4500, drift: 1800, bloom: true, msaa: 4 },
};
let qualityName = store.get('quality', isTouch ? 'medium' : 'high');
if (!PRESETS[qualityName]) qualityName = 'medium';
let Q = PRESETS[qualityName];

const setProgress = async (p, label) => {
  $('load-bar').style.transform = `scaleX(${p})`;
  $('load-label').textContent = label;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};

async function boot() {
  const canvas = $('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    $('load-label').textContent = '這個瀏覽器無法啟用 WebGL 2，請改用最新版 Chrome、Safari 或 Firefox。';
    throw err;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 30000);

  await setProgress(0.15, '堆積雪丘與海冰…');
  const world = new World(scene, { segments: isTouch ? 220 : 300, normalMapSize: isTouch ? 256 : 512 });

  await setProgress(0.45, '計算天空與低角度的極地陽光…');
  const atmo = new Atmosphere(renderer, scene);
  atmo.setShadowSize(Q.shadow);
  let sunElev = store.get('sun', 11);
  atmo.setSun(sunElev);

  await setProgress(0.65, '長出絨毛…');
  const prints = new Prints(scene, world);
  const audio = new AudioFX();
  audio.setMuted(store.get('muted', false));

  // Player.
  const COLONY = new THREE.Vector3(15, 0, 11);
  const player = new Chick({ shells: Q.shells });
  scene.add(player.root);
  const body = makeBody(0, 0, Math.atan2(COLONY.x, COLONY.z), world);
  let walked = 0;
  player.onStep = (i, x, z) => {
    prints.foot(x, z, body.yaw, player.feet[i].side);
    audio.step(body.onIce, 0.9, player.feet[i].side * 0.15);
  };

  await setProgress(0.8, '集合帝企鵝群…');
  // Adults stand with their backs to the wind, which blows toward +x.
  const adults = [];
  const placed = [];
  let tries = 0;
  while (adults.length < 16 && tries++ < 600) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 6.5;
    const x = COLONY.x + Math.cos(a) * r, z = COLONY.z + Math.sin(a) * r;
    if (world.iceAt(x, z) > 0.2) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 0.95)) continue;
    if (world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.6)) continue;
    placed.push({ x, z });
    const ad = new Adult(x, z, Math.PI / 2 + (Math.random() - 0.5) * 1.4, world);
    scene.add(ad.root);
    adults.push(ad);
  }

  // Crèche: other chicks wandering around the colony.
  const npcs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, r = 3 + Math.random() * 4;
    const x = COLONY.x + Math.cos(a) * r, z = COLONY.z + Math.sin(a) * r;
    const scale = 0.88 + Math.random() * 0.18;
    const chick = new Chick({ shells: Q.npcShells, scale });
    const b = makeBody(x, z, Math.random() * 6.28, world);
    b.radius = 0.12 * scale;
    const npc = { chick, body: b, target: new THREE.Vector3(x, 0, z), wait: Math.random() * 3, pace: 0.45 + Math.random() * 0.35, nextChirp: 4 + Math.random() * 14, replyIn: -1 };
    chick.onStep = (k, fx, fz) => {
      prints.foot(fx, fz, b.yaw, chick.feet[k].side, scale);
      const d = camera.position.distanceTo(b.pos);
      if (d < 8) audio.step(b.onIce, 0.5 / (1 + d), panOf(b.pos));
    };
    scene.add(chick.root);
    npcs.push(npc);
  }

  const colliders = [...world.colliders, ...adults.map((a) => a.collider)];
  const dyn = [body, ...npcs.map((n) => n.body)].map((b) => ({ x: 0, z: 0, r: b.radius, self: b, body: b }));
  colliders.push(...dyn);

  await setProgress(0.92, '準備風雪…');
  const snow = new SnowLayer(scene, { count: PRESETS.high.snow, box: new THREE.Vector3(34, 14, 34), size: 0.014, opacity: 0.85 });
  const drift = new SnowLayer(scene, { count: PRESETS.high.drift, box: new THREE.Vector3(22, 0.7, 22), size: 0.007, opacity: 0.4 });

  // Post-processing. Everything renders to an HDR target so fog, sky and
  // bloom blend in linear light; OutputPass applies tone mapping at the end.
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 2.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const cam = new FollowCamera(camera);
  cam.yaw = body.yaw + Math.PI + 0.5;
  const pending = { hop: false, slide: false, chirp: false };
  const input = new Input({
    canvas, stick: $('stick'), knob: $('knob'), cam,
    onAction: (a) => { pending[a] = true; },
  });

  function panOf(p) {
    const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const b = cam.basis();
    return Math.max(-1, Math.min(1, (dx * b.rx + dz * b.rz) / l));
  }

  function applyQuality(name) {
    qualityName = name;
    Q = PRESETS[name];
    store.set('quality', name);
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
    atmo.setShadowSize(Q.shadow);
    player.setShells(Q.shells);
    for (const n of npcs) n.chick.setShells(Q.npcShells);
    snow.setCount(Q.snow);
    drift.setCount(Q.drift);
    bloom.enabled = Q.bloom;
    for (const t of [composer.renderTarget1, composer.renderTarget2]) {
      t.samples = Q.msaa;
      t.dispose();
    }
    resize();
    document.querySelectorAll('[data-quality]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === name)));
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 64 : 55;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
  }
  addEventListener('resize', resize);

  // ── UI wiring ──
  const ui = {
    temp: $('hud-temp'), wind: $('hud-wind'), surf: $('hud-surface'), dist: $('hud-dist'), state: $('hud-state'),
  };
  const muteBtn = $('btn-sound');
  const syncMute = () => {
    muteBtn.setAttribute('aria-pressed', String(!audio.muted));
    muteBtn.setAttribute('aria-label', audio.muted ? '開啟聲音' : '關閉聲音');
  };
  syncMute();
  muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    store.set('muted', audio.muted);
    syncMute();
  });
  const fsBtn = $('btn-fullscreen');
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { fsBtn.hidden = true; }
  });
  const sheet = $('settings');
  $('btn-settings').addEventListener('click', () => {
    sheet.hidden = !sheet.hidden;
    $('btn-settings').setAttribute('aria-expanded', String(!sheet.hidden));
  });
  $('btn-close-settings').addEventListener('click', () => {
    sheet.hidden = true;
    $('btn-settings').setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => applyQuality(b.dataset.quality)));
  const sunInput = $('sun');
  const sunOut = $('sun-out');
  sunInput.value = sunElev;
  sunOut.textContent = `${sunElev}°`;
  let sunTimer = 0;
  sunInput.addEventListener('input', () => {
    sunElev = Number(sunInput.value);
    sunOut.textContent = `${sunElev}°`;
    clearTimeout(sunTimer);
    sunTimer = setTimeout(() => {
      atmo.setSun(sunElev);
      store.set('sun', sunElev);
    }, 60);
  });

  const bindHold = (id, action) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pending[action] = true;
      el.classList.add('is-down');
    });
    const up = () => el.classList.remove('is-down');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('click', (e) => {
      // Keyboard activation (Enter/Space on a focused button).
      if (e.detail === 0) pending[action] = true;
    });
  };
  bindHold('act-hop', 'hop');
  bindHold('act-slide', 'slide');
  bindHold('act-chirp', 'chirp');

  document.body.classList.toggle('touch', isTouch);
  let started = false;
  $('btn-start').addEventListener('click', async () => {
    started = true;
    input.enabled = true;
    audio.start();
    document.body.classList.add('playing');
    $('intro').hidden = true;
    cam.manualAt = -100;
    try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    setTimeout(() => $('hint').classList.add('fade'), 9000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else if (started) audio.resume();
  });

  applyQuality(qualityName);
  await setProgress(1, '準備好了');
  $('btn-start').disabled = false;
  $('btn-start').textContent = '開始散步';
  document.body.classList.add('ready');

  // ── Simulation ──
  const clock = new THREE.Clock();
  const STEP = 1 / 120;
  let acc = 0, t = 0, hudT = 0, ambientCallT = 3;
  const wind = new THREE.Vector3();
  const prevPos = body.pos.clone();
  const snowColor = new THREE.Color();
  const center = new THREE.Vector3();
  const playerState = { pos: body.pos, vel: body.vel, wind, world };
  let forced = null;

  function chickState(b, st) {
    st.yaw = b.yaw;
    st.speed = b.speed;
    st.grounded = b.grounded;
    st.mode = b.mode;
    st.pushing = b.pushing;
    st.slopeF = b.slopeF;
    return st;
  }
  for (const n of npcs) n.state = { pos: n.body.pos, vel: n.body.vel, wind, world };

  function npcThink(n, dt) {
    const b = n.body;
    n.nextChirp -= dt;
    if (n.nextChirp < 0 || (n.replyIn > 0 && (n.replyIn -= dt) <= 0)) {
      n.nextChirp = 8 + Math.random() * 16;
      n.replyIn = -1;
      n.chick.chirp();
      const d = camera.position.distanceTo(b.pos);
      audio.chirp(Math.min(1, 2.2 / (1 + d)), panOf(b.pos), 0.92 + Math.random() * 0.2);
    }
    if (b.mode !== 'walk') return { x: 0, z: 0, run: false };
    if (n.wait > 0) {
      n.wait -= dt;
      return { x: 0, z: 0, run: false };
    }
    const dx = n.target.x - b.pos.x, dz = n.target.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      n.wait = 1 + Math.random() * 5;
      const curious = body.pos.distanceTo(b.pos) < 7 && Math.random() < 0.35;
      if (curious) {
        n.target.set(body.pos.x + (Math.random() - 0.5) * 1.6, 0, body.pos.z + (Math.random() - 0.5) * 1.6);
      } else {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 8;
        n.target.set(COLONY.x + Math.cos(a) * r, 0, COLONY.z + Math.sin(a) * r);
      }
      return { x: 0, z: 0, run: false };
    }
    return { x: (dx / d) * n.pace, z: (dz / d) * n.pace, run: false };
  }

  function onPlayerChirp() {
    player.chirp();
    audio.chirp(1, 0, 1);
    let best = null, bd = 9;
    for (const a of adults) {
      const d = a.root.position.distanceTo(body.pos);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) {
      best.faceTowards(body.pos.x, body.pos.z);
      setTimeout(() => {
        best.call();
        audio.adultCall(Math.min(1, 3 / (1 + camera.position.distanceTo(best.root.position))), panOf(best.root.position));
      }, 600);
    }
    for (const n of npcs) {
      if (n.body.pos.distanceTo(body.pos) < 9 && Math.random() < 0.6) n.replyIn = 0.5 + Math.random() * 1.2;
    }
  }

  function step(dt) {
    t += dt;
    const ws = 4.5 + 2.2 * Math.sin(t * 0.13) + 1.3 * Math.sin(t * 0.41 + 1) + 0.6 * Math.sin(t * 1.3);
    const wa = 0.18 * Math.sin(t * 0.05);
    wind.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);

    for (const d of dyn) { d.x = d.body.pos.x; d.z = d.body.pos.z; }

    const mv = forced ?? (started ? input.read() : { x: 0, z: 0, run: false });
    const wasMode = body.mode;
    stepCharacter(body, { ...mv, hop: pending.hop, slide: pending.slide }, dt, world, colliders);
    if (pending.chirp && started) onPlayerChirp();
    pending.hop = pending.slide = pending.chirp = false;
    if (body.mode !== wasMode && body.mode === 'walk') prints.resetBelly('p');
    if (body.landed) audio.step(body.onIce, 1.2, 0);

    for (const n of npcs) {
      stepCharacter(n.body, { ...npcThink(n, dt), hop: false, slide: false }, dt, world, colliders);
    }
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }

    walked += Math.hypot(body.pos.x - prevPos.x, body.pos.z - prevPos.z);
    prevPos.copy(body.pos);

    player.update(dt, chickState(body, playerState));
    if (body.mode !== 'walk' && body.grounded && body.speed > 0.05) prints.belly('p', body.pos.x, body.pos.z, body.yaw);
    audio.setSlide(body.mode === 'slide' && body.grounded ? body.speed : 0, body.onIce);
    audio.setWind(Math.min(1, wind.length() / 9));

    for (const n of npcs) {
      n.chick.update(dt, chickState(n.body, n.state));
      if (n.body.mode !== 'walk') prints.belly(n, n.body.pos.x, n.body.pos.z, n.body.yaw, n.chick.scale);
    }
    for (const a of adults) a.update(dt);

    ambientCallT -= dt;
    if (ambientCallT < 0 && started) {
      ambientCallT = 4 + Math.random() * 7;
      const a = adults[Math.floor(Math.random() * adults.length)];
      if (a) {
        a.call();
        audio.adultCall(Math.min(1, 3 / (1 + camera.position.distanceTo(a.root.position))), panOf(a.root.position));
      }
    }

    if (!started) cam.yaw += dt * 0.08;
    cam.update(dt, body, world, started);
    atmo.follow(body.pos);

    center.copy(camera.position);
    const pr = renderer.getPixelRatio();
    const pxScale = (innerHeight * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    snowColor.copy(atmo.fogColor).multiplyScalar(1.5).add(atmo.sun.color.clone().multiplyScalar(0.25));
    snow.update(dt, center, wind, 0.7, snowColor, pxScale);
    center.set(body.pos.x, body.pos.y + 0.3, body.pos.z);
    drift.update(dt, center, wind.clone().multiplyScalar(1.8), 0, snowColor, pxScale);
    drift.uniforms.uOpacity.value = 0.12 + 0.35 * Math.min(1, Math.max(0, (wind.length() - 3) / 5));

    hudT -= dt;
    if (hudT < 0) {
      hudT = 0.25;
      const ws = wind.length();
      // Wind chill (JAG/TI formula), air temperature drifting with sun height.
      const air = -24 + sunElev * 0.25;
      const vk = Math.pow(ws * 3.6, 0.16);
      const chill = 13.12 + 0.6215 * air - 11.37 * vk + 0.3965 * air * vk;
      ui.temp.textContent = `${Math.round(air)}°C`;
      ui.wind.textContent = `${ws.toFixed(1)} m/s · 體感 ${Math.round(chill)}°C`;
      ui.surf.textContent = body.onIce ? '藍冰（很滑）' : '雪面';
      ui.surf.dataset.ice = String(body.onIce);
      ui.dist.textContent = walked < 1000 ? `${walked.toFixed(0)} m` : `${(walked / 1000).toFixed(2)} km`;
      const S = { walk: body.speed > 0.05 ? (body.speed > 0.9 ? '快步搖擺' : '搖擺走路') : '站著', slide: '腹部滑行', tumble: '滑倒了！' };
      ui.state.textContent = body.grounded ? S[body.mode] : '跳起來';
      $('act-slide').setAttribute('aria-pressed', String(body.mode === 'slide'));
    }

    composer.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Test hook: advance the simulation deterministically with a fixed input.
  window.__sim = {
    body, world, player, scene, renderer, camera, cam, atmo,
    simulate(secs, mv, action) {
      forced = mv;
      if (action) pending[action] = true;
      for (let i = 0; i < secs * 60; i++) {
        step(STEP); step(STEP);
        player.update(1 / 60, chickState(body, playerState));
        if (body.mode !== 'walk' && body.grounded && body.speed > 0.05) prints.belly('p', body.pos.x, body.pos.z, body.yaw);
        for (const n of npcs) n.chick.update(1 / 60, chickState(n.body, n.state));
        cam.update(1 / 60, body, world, true);
      }
      forced = null;
      return { x: +body.pos.x.toFixed(2), z: +body.pos.z.toFixed(2), y: +body.pos.y.toFixed(2), mode: body.mode, speed: +body.speed.toFixed(2), ice: body.onIce };
    },
  };
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('load-label');
  if (l && !l.textContent.includes('WebGL')) l.textContent = '載入失敗：' + err.message;
});
