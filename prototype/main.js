'use strict';
// ============================================================
// main.js — game loop, car physics, cameras, dashboard,
// traffic lights, wanted system, weather, day/night, audio
// ============================================================

// ---------- Mode state ----------
let mode = 'menu';
let camStyle = 'chase';
let exitAnim = null;
const keys = {};
const pressed = new Set();
let mouseDown = false;
const flyCam = { yaw: 0, pitch: -0.3 };
const raycaster = new THREE.Raycaster();
const SPAWN = { x: -150, z: 3, heading: Math.PI / 2 };

function playerPos() { return carState.pos; }

// ---------- HUD helpers ----------
const $ = (id) => document.getElementById(id);
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, 2500);
}
const HUD_IDS = ['dashboard', 'hudOverlay', 'minimap', 'healthBar', 'hudProfile', 'mSpeed'];
function setHudVisible(on) {
  HUD_IDS.forEach(id => { const el = $(id); if (el) el.classList.toggle('active', on); });
  $('homeScreen').classList.toggle('hidden', on);
  if (!on) ['speedLimit', 'trafficLightHud', 'combo', 'mission', 'objArrow'].forEach(id => { const el = $(id); if (el) el.classList.remove('active', 'show'); });
}

// ---------- Start / return to garage ----------
let sessionStart = null;
function startGame() {
  try {
    initAudio();
    if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
    if (inPlane) exitPlane();
    camera.clearViewOffset();
    setHudVisible(true);
    swapCar(selectedVehicle, PAINTS[save.paintOf[selectedVehicle] || 0].hex);
    car.visible = true;
    placeCar(SPAWN.x, SPAWN.z, SPAWN.heading);
    carState.grounded = true; carState.airTime = 0;
    camera.position.set(SPAWN.x - 8, CITY_Y + 3.5, SPAWN.z);
    camera.lookAt(carState.pos.x, carState.pos.y + 1.6, carState.pos.z);
    wantedLevel = 0; clearCops(); playerHealth = playerMaxHealth; bustedTimer = 0;
    resetActivities();
    addStat('sessions', 1);
    sessionStart = { cash: save.cash, ach: Object.keys(save.achievements).length, dist: save.stats.distance };
    sessionEarned = 0;
    checkAchievements();
    persist();
    mode = 'drive';
    paused = false;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.focus();
    if (save.stats.sessions <= 1) {
      showGuidance(isTouchDevice ? 'Push the stick to drive · N₂O = nitro · B = handbrake drift — roll into the 🏁 ring ahead to race!'
        : 'W to drive · Shift for nitro · Space to drift — roll into the 🏁 ring ahead to race!', 6000);
    }
    else showGuidance('Welcome back! ' + (save.daily.items.filter(i => !i.done).length) + ' daily challenges left today', 3500);
  } catch (e) {
    console.error('startGame FAILED:', e);
    document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#c00;color:#fff;padding:20px;z-index:9999;font:16px monospace;border-radius:8px">' +
      'ERROR: ' + e.message + '</div>');
  }
}
function returnToGarage() {
  bankCombo();
  resetActivities();
  if (inPlane) exitPlane();
  if (mode === 'build' && document.pointerLockElement) document.exitPointerLock();
  wantedLevel = 0; clearCops(); bustedTimer = 0; playerHealth = playerMaxHealth;
  $('bustedScreen').style.display = 'none';
  if (sessionStart) {
    lastSession = { cash: save.cash - sessionStart.cash, achievements: Object.keys(save.achievements).length - sessionStart.ach,
      km: (save.stats.distance - sessionStart.dist) / 1000 };
  }
  persist();
  paused = false;
  $('pauseOverlay').classList.remove('active');
  mode = 'menu';
  guidanceTimer = 0; $('guidance').classList.remove('active');
  setHudVisible(false);
  placeCar(SPAWN.x, SPAWN.z, SPAWN.heading);
  car.visible = true;
  selectedVehicle = carStyle;
  previewPaint = save.paintOf[carStyle] || 0;
  renderHome();
}

// ---------- Guidance system ----------
let guidanceTimer = 0;
function showGuidance(msg, ms) {
  const el = $('guidance');
  el.textContent = msg;
  el.classList.add('active');
  guidanceTimer = (ms || 3000) / 1000;
}
function updateGuidance(dt) {
  if (guidanceTimer > 0) {
    guidanceTimer -= dt;
    if (guidanceTimer <= 0) $('guidance').classList.remove('active');
  }
}

// ---------- Pause ----------
let paused = false;
function togglePause() {
  if (mode === 'menu') return;
  paused = !paused;
  $('pauseOverlay').classList.toggle('active', paused);
  if (paused) {
    $('pauseStats').innerHTML = 'This run: <b>' + (sessionEarned >= 0 ? '+' : '') + fmtCash(sessionEarned) + '</b> · Bank: <b>' + fmtCash(save.cash) + '</b> · Level <b>' + save.level + '</b>';
    persist();
  }
}
$('resumeBtn').addEventListener('click', () => { if (paused) togglePause(); });
$('garageBtn').addEventListener('click', returnToGarage);

// ---------- Dashboard gauges ----------
const speedCtx = $('speedCanvas').getContext('2d');
const tachCtx = $('tachCanvas').getContext('2d');
function drawGauge(ctx, value, max, color, dangerZone, labelDiv) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const cx = w / 2, cy = h / 2 + 10;
  const r = 95;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  const startA = Math.PI * 0.8;
  const endA = Math.PI * 2.2;
  const range = endA - startA;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA);
  ctx.stroke();
  if (dangerZone) {
    const dangerStart = startA + range * (dangerZone / max);
    ctx.strokeStyle = 'rgba(239,83,80,0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, dangerStart, endA);
    ctx.stroke();
  }
  const valA = startA + range * Math.min(1, value / max);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, color);
  grad.addColorStop(1, value > (dangerZone || max) ? '#ef5350' : color);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, valA);
  ctx.stroke();
  const nx = cx + Math.cos(valA) * (r - 15);
  const ny = cy + Math.sin(valA) * (r - 15);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 8; i++) {
    const a = startA + (range * i / 8);
    ctx.fillText(Math.round(max * i / 8 / (labelDiv || 1)), cx + Math.cos(a) * (r + 14), cy + Math.sin(a) * (r + 14));
  }
}
const GEAR_SPLITS = [0, 0.2, 0.36, 0.52, 0.68, 0.84, 1.0];
let engineRpm = 900;
let _dashFrame = 0;
function updateDashboard() {
  const vF = carState.vel.dot(_fwd2(carState.heading));
  const kmh = Math.abs(vF) * 3.6;
  const topKmh = VEHICLES[carStyle].maxSpeed * 3.6;
  let gear = 'N', rpm = 900;
  if (vF < -0.5) { gear = 'R'; rpm = 900 + Math.min(1, kmh / 40) * 3500; }
  else if (kmh > 2 || input.moveZ > 0) {
    const f = Math.min(1.05, kmh / topKmh);
    let g = 1;
    while (g < 6 && f > GEAR_SPLITS[g]) g++;
    const lo = GEAR_SPLITS[g - 1], hi = GEAR_SPLITS[g];
    rpm = (g === 1 ? 1000 : 3200) + Math.min(1, (f - lo) / (hi - lo)) * (g === 1 ? 6000 : 3800);
    gear = String(g);
  }
  if (!carState.grounded && input.moveZ > 0) rpm = Math.min(7800, rpm + 1500);
  engineRpm += (rpm - engineRpm) * 0.25;
  if (_dashFrame++ % 2) return;
  if (isTouchDevice) {
    $('mSpeedNum').textContent = Math.round(kmh);
    $('mGear').textContent = gear;
    $('mNitro').style.width = (nitro / nitroCap() * 100) + '%';
    return;
  }
  const gaugeMax = Math.ceil(topKmh * 1.3 / 40) * 40;
  drawGauge(speedCtx, kmh, gaugeMax, '#4fc3f7', topKmh);
  $('speedNum').textContent = Math.round(kmh);
  drawGauge(tachCtx, engineRpm, 8000, '#66bb6a', 6800, 1000);
  $('tachNum').textContent = (engineRpm / 1000).toFixed(1);
  $('dashGear').textContent = gear;
  $('dashRPM').textContent = Math.round(engineRpm);
  $('indLeft').className = 'dash-ind' + (input.moveX > 0.2 && Math.sin(performance.now() * 0.012) > 0 ? ' warn' : '');
  $('indRight').className = 'dash-ind' + (input.moveX < -0.2 && Math.sin(performance.now() * 0.012) > 0 ? ' warn' : '');
  $('indHigh').className = 'dash-ind' + (headlightsOn ? ' on' : '');
}

// ---------- Blocks (build mode) ----------
const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
const MATERIALS = [
  { name: 'Wood',  mat: lambert(0x9a6b3f), css: '#9a6b3f' },
  { name: 'Stone', mat: lambert(0x8d8d92), css: '#8d8d92' },
  { name: 'Brick', mat: lambert(0xb5493a), css: '#b5493a' },
  { name: 'Glass', mat: lambert(0x9fd4e8, { transparent: true, opacity: 0.55 }), css: '#9fd4e8' },
  { name: 'Gold',  mat: standard(0xf2c14e, 0.3, 0.9), css: '#f2c14e' },
];
let selectedMat = 0;
const blockMap = new Map();
function snapCoord(v) { return Math.floor(v / BLOCK) * BLOCK + BLOCK / 2; }
function placeBlock(point, normal) {
  const p = point.clone().addScaledVector(normal, 0.5);
  const cx = snapCoord(p.x), cy = snapCoord(p.y), cz = snapCoord(p.z);
  const key = cx + ',' + cy + ',' + cz;
  if (blockMap.has(key)) return;
  const mesh = new THREE.Mesh(blockGeo, MATERIALS[selectedMat].mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.blockKey = key;
  scene.add(mesh);
  blockMap.set(key, mesh);
  addStat('blocks', 1);
}
function removeBlock(mesh) {
  scene.remove(mesh);
  blockMap.delete(mesh.userData.blockKey);
}

// ---------- Weather ----------
let weather = 'clear', wet = 0, snowF = 0, weatherTimer = 18;
let snowAccumLevel = 0;
function pickWeather() {
  const r = Math.random();
  if (r < 0.5) weather = 'clear';
  else if (r < 0.82) weather = 'rain';
  else weather = 'snow';
  $('hudWeather').textContent = weather === 'clear' ? 'Clear' : weather === 'rain' ? 'Rain' : 'Snow';
}
function updateWeather(dt) {
  weatherTimer -= dt;
  if (weatherTimer <= 0) { weatherTimer = 30 + Math.random() * 45; pickWeather(); }
  wet += ((weather === 'rain' ? 1 : 0) - wet) * Math.min(1, dt * 0.5);
  snowF += ((weather === 'snow' ? 1 : 0) - snowF) * Math.min(1, dt * 0.35);
  snowAccumLevel += ((weather === 'snow' ? 0.6 : 0) - snowAccumLevel) * Math.min(1, dt * 0.08);
  snowAccumMat.opacity = snowAccumLevel * 0.7;
  for (const p of puddles) {
    p.material.opacity = wet * 0.4 * (1 - snowAccumLevel);
    p.position.y = CITY_Y + 0.04 + wet * 0.02;
  }
}
const RAIN_N = 1100;
const rainGeo = new THREE.BufferGeometry();
{
  const arr = new Float32Array(RAIN_N * 6);
  for (let i = 0; i < RAIN_N; i++) {
    const x = (Math.random() - 0.5) * 70, y = Math.random() * 62 - 12, z = (Math.random() - 0.5) * 70;
    arr.set([x, y, z, x, y - 0.9, z], i * 6);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const rainMat = new THREE.LineBasicMaterial({ color: 0x8fa8bf, transparent: true, opacity: 0 });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.visible = false;
scene.add(rain);
const SNOW_N = 1600;
const snowGeo = new THREE.BufferGeometry();
{
  const arr = new Float32Array(SNOW_N * 3);
  for (let i = 0; i < SNOW_N; i++) arr.set([(Math.random() - 0.5) * 80, Math.random() * 55 - 8, (Math.random() - 0.5) * 80], i * 3);
  snowGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const snowMat2 = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0, depthWrite: false });
const snowPts = new THREE.Points(snowGeo, snowMat2);
snowPts.visible = false;
scene.add(snowPts);
let snowSway = 0;
function updatePrecip(dt) {
  rain.visible = wet > 0.03;
  if (rain.visible) {
    rain.position.copy(camera.position);
    const a = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_N; i++) {
      let y = a[i * 6 + 1] - 55 * dt;
      if (y < -12) y += 62;
      a[i * 6 + 1] = y; a[i * 6 + 4] = y - 0.9;
    }
    rainGeo.attributes.position.needsUpdate = true;
    rainMat.opacity = 0.45 * wet;
  }
  snowPts.visible = snowF > 0.03;
  if (snowPts.visible) {
    snowSway += dt;
    snowPts.position.copy(camera.position);
    const a = snowGeo.attributes.position.array;
    for (let i = 0; i < SNOW_N; i++) {
      let y = a[i * 3 + 1] - 7.5 * dt;
      if (y < -8) y += 55;
      a[i * 3 + 1] = y;
      a[i * 3] += Math.sin(snowSway * 1.7 + i) * dt * 0.7;
    }
    snowGeo.attributes.position.needsUpdate = true;
    snowMat2.opacity = 0.85 * snowF;
  }
  const sway = wet > 0.1 ? 0.15 : 0.05, now = performance.now() * 0.002;
  for (const g of grassTufts) g.rotation.z = Math.sin(now + g.position.x * 0.5) * sway;
}

// ---------- Audio ----------
let audio = null, muted = false;
let engineOsc, engineOsc2, engineGain, engineFilter, sirenOsc, sirenGain;
function initAudio() {
  if (audio !== null) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { audio = false; return; }
    const ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
    engineOsc2 = ctx.createOscillator(); engineOsc2.type = 'triangle';
    engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 480;
    engineGain = ctx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(engineFilter); engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain); engineGain.connect(master);
    engineOsc.start(); engineOsc2.start();
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square';
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1400;
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sf); sf.connect(sirenGain); sirenGain.connect(master);
    sirenOsc.start();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const hornBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const hd = hornBuf.getChannelData(0);
    for (let i = 0; i < hd.length; i++) {
      const t = i / ctx.sampleRate;
      hd[i] = (Math.sign(Math.sin(t * 392 * Math.PI * 2)) * 0.5 + Math.sign(Math.sin(t * 494 * Math.PI * 2)) * 0.5) * 0.18 * Math.min(1, (hd.length - i) / 2000);
    }
    audio = { ctx, noiseBuf, hornBuf, master };
  } catch (e) { audio = false; }
}
function playHorn() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.hornBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.35;
  src.connect(g); g.connect(audio.master);
  src.start();
}
function tone(freq, start, dur, type, vol, slideTo) {
  const c = audio.ctx, t0 = c.currentTime + start;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(audio.master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(start, dur, vol, filterFreq, type) {
  const c = audio.ctx, t0 = c.currentTime + start;
  const src = c.createBufferSource(); src.buffer = audio.noiseBuf;
  const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = filterFreq || 800;
  const g = c.createGain();
  g.gain.setValueAtTime(vol || 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(audio.master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}
// Tiny synthesized sound kit — no audio files needed
function sfx(name, amt) {
  if (!audio || muted) return;
  try {
    switch (name) {
      case 'coin': tone(988, 0, 0.08, 'square', 0.06); tone(1319, 0.07, 0.18, 'square', 0.06); break;
      case 'star': [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.25, 'triangle', 0.1)); break;
      case 'trick': tone(660 + Math.min(10, combo.mult) * 40, 0, 0.09, 'triangle', 0.07); break;
      case 'bank': tone(523, 0, 0.1, 'triangle', 0.08); tone(784, 0.08, 0.2, 'triangle', 0.08); break;
      case 'achievement': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.1)); break;
      case 'levelup': [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.4, 'square', 0.06)); break;
      case 'fail': tone(330, 0, 0.18, 'sawtooth', 0.06, 160); break;
      case 'whoosh': noise(0, 0.35, 0.25, 1800, 'bandpass'); break;
      case 'smash': noise(0, 0.18, 0.35, 900); tone(140, 0, 0.12, 'square', 0.05, 70); break;
      case 'crash': noise(0, 0.4, 0.3 + (amt || 0.5) * 0.4, 600); tone(90, 0, 0.25, 'sawtooth', 0.08, 40); break;
      case 'beep': tone(660, 0, 0.15, 'square', 0.07); break;
      case 'go': tone(1320, 0, 0.45, 'square', 0.08); break;
      case 'checkpoint': tone(880, 0, 0.08, 'triangle', 0.09); tone(1320, 0.07, 0.15, 'triangle', 0.09); break;
      case 'camera': noise(0, 0.06, 0.25, 4000, 'highpass'); tone(2000, 0.02, 0.05, 'square', 0.04); break;
      case 'nitro': noise(0, 0.6, 0.18, 500, 'bandpass'); break;
      case 'click': tone(1200, 0, 0.03, 'square', 0.03); break;
    }
  } catch (e) { /* audio context closed */ }
}
let sirenOn = false;
function updateAudio(dt) {
  if (!audio || !engineGain) return;
  const t = audio.ctx.currentTime;
  const freq = 38 + engineRpm / 7000 * 118 + (VEHICLES[carStyle].proc === 'motorcycle' ? 25 : 0);
  engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
  engineOsc2.frequency.setTargetAtTime(freq * 1.5, t, 0.05);
  engineFilter.frequency.setTargetAtTime(380 + engineRpm * 0.08 + (boosting ? 500 : 0), t, 0.05);
  const kmh = carSpeed() * 3.6;
  const g = (muted || mode !== 'drive' || paused) ? 0 : 0.018 + Math.min(0.05, kmh * 0.0003 + Math.max(0, input.moveZ) * 0.012);
  engineGain.gain.setTargetAtTime(g, t, 0.1);
  const sOn = sirenOn && VEHICLES[carStyle].siren && mode === 'drive' && !muted && !paused;
  sirenOsc.frequency.setTargetAtTime(700 + 260 * Math.sin(performance.now() * 0.006), t, 0.02);
  sirenGain.gain.setTargetAtTime(sOn ? 0.025 : 0, t, 0.05);
}

// ---------- Traffic lights update ----------
function updateTrafficLights(dt) {
  for (const tl of trafficLights) {
    tl.timer -= dt;
    if (tl.timer <= 0) {
      if (tl.state === 'green') { tl.state = 'yellow'; tl.timer = 3 + Math.random() * 2; }
      else if (tl.state === 'yellow') { tl.state = 'red'; tl.timer = 12 + Math.random() * 8; }
      else { tl.state = 'green'; tl.timer = 15 + Math.random() * 10; }
    }
    tl.rMat.color.set(tl.state === 'red' ? 0xff2222 : 0x330000);
    tl.yMat.color.set(tl.state === 'yellow' ? 0xffaa00 : 0x332200);
    tl.gMat.color.set(tl.state === 'green' ? 0x22ff22 : 0x003300);
  }
}
function getNearestTrafficLight() {
  let best = null, bd = Infinity;
  for (const tl of trafficLights) {
    const d = Math.hypot(tl.x - carState.pos.x, tl.z - carState.pos.z);
    if (d < 40 && d < bd) { bd = d; best = tl; }
  }
  return best ? { tl: best, dist: bd } : null;
}

// ---------- Car physics ----------
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3();
const _right = new THREE.Vector3(), _m = new THREE.Matrix4(), _worldUp = new THREE.Vector3(0, 1, 0);
const _camTarget = new THREE.Vector3(), _look = new THREE.Vector3(), _tmp = new THREE.Vector3();
function _fwd2(h) { return _tmp.set(Math.sin(h), 0, Math.cos(h)); }

const GRAVITY = 20;
let collisionCooldown = 0;
let boosting = false, _boostWas = false;
function circlePush(state, obstacles, radius, yMax) {
  for (const o of obstacles) {
    if (yMax !== undefined && state.pos.y > yMax) continue;
    const dx = state.pos.x - o.x, dz = state.pos.z - o.z;
    const rr = o.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      state.pos.x += (dx / d) * (rr - d);
      state.pos.z += (dz / d) * (rr - d);
      const vn = state.vel.x * (dx / d) + state.vel.z * (dz / d);
      if (vn < 0) {
        state.vel.x -= vn * (dx / d) * 1.2; state.vel.z -= vn * (dz / d) * 1.2;
        lastImpact = Math.max(lastImpact, -vn);
      }
    }
  }
}
let lastImpact = 0;
function aabbCollide(state, radius) {
  let wallNormal = null;
  for (const b of buildingAABBs) {
    if (state.pos.y > b.topY - 0.4) continue;
    if (state.pos.x > b.minX - radius && state.pos.x < b.maxX + radius &&
        state.pos.z > b.minZ - radius && state.pos.z < b.maxZ + radius) {
      const pxl = state.pos.x - (b.minX - radius), pxr = (b.maxX + radius) - state.pos.x;
      const pzl = state.pos.z - (b.minZ - radius), pzr = (b.maxZ + radius) - state.pos.z;
      const minPen = Math.min(pxl, pxr, pzl, pzr);
      if (minPen === pxl) { state.pos.x = b.minX - radius; wallNormal = [-1, 0]; }
      else if (minPen === pxr) { state.pos.x = b.maxX + radius; wallNormal = [1, 0]; }
      else if (minPen === pzl) { state.pos.z = b.minZ - radius; wallNormal = [0, -1]; }
      else { state.pos.z = b.maxZ + radius; wallNormal = [0, 1]; }
      const vn = state.vel.x * wallNormal[0] + state.vel.z * wallNormal[1];
      if (vn < 0) {
        state.vel.x -= vn * wallNormal[0] * 1.2; state.vel.z -= vn * wallNormal[1] * 1.2;
        lastImpact = Math.max(lastImpact, -vn);
      }
    }
  }
  return wallNormal;
}
// Ramps are solid from the sides and the tall end
function rampCollide(state, radius) {
  for (const r of ramps) {
    const l = rampLocal(r, state.pos.x, state.pos.z);
    const hw = r.wid / 2 + radius, hl = r.len / 2;
    if (Math.abs(l.lx) > hw || l.lz < -hl || l.lz > hl + radius) continue;
    const u = Math.max(0, Math.min(1, (l.lz + hl) / r.len));
    if (state.pos.y > r.base + r.hgt * u - 0.9) continue;
    const pl = l.lx + hw, pr = hw - l.lx, pb = hl + radius - l.lz;
    const m = Math.min(pl, pr, pb);
    let nx, nz;  // local push normal
    if (m === pb) { nx = 0; nz = 1; l.lz = hl + radius; }
    else if (m === pl) { nx = -1; nz = 0; l.lx = -hw; }
    else { nx = 1; nz = 0; l.lx = hw; }
    state.pos.x = r.x + l.lx * r.cos + l.lz * r.sin;
    state.pos.z = r.z - l.lx * r.sin + l.lz * r.cos;
    const wx = nx * r.cos + nz * r.sin, wz = -nx * r.sin + nz * r.cos;
    const vn = state.vel.x * wx + state.vel.z * wz;
    if (vn < 0) { state.vel.x -= vn * wx * 1.2; state.vel.z -= vn * wz * 1.2; lastImpact = Math.max(lastImpact, -vn); }
  }
}

function updateCar(dt) {
  const s = carState;
  const spec = VEHICLES[carStyle];
  const locked = controlsLocked();
  let throttle = locked ? 0 : input.moveZ;
  const steer = locked ? 0 : input.moveX;
  const spikeSlip = gripPenaltyTimer > 0 ? 0.6 : 0;
  const slip = Math.min(0.75, wet * 0.4 + snowF * 0.6 + spikeSlip);
  collisionCooldown -= dt;
  lastImpact = 0;

  // nitro
  boosting = !locked && input.nitro && nitro > 0.02 && throttle >= 0;
  if (boosting) { nitro = Math.max(0, nitro - dt * 0.3); throttle = 1; }
  if (boosting && !_boostWas) sfx('nitro');
  _boostWas = boosting;
  const topMul = boosting ? 1.25 : 1, accMul = boosting ? 1.9 : 1;

  _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
  _side.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
  let vF = s.vel.x * _fwd.x + s.vel.z * _fwd.z;
  let vS = s.vel.x * _side.x + s.vel.z * _side.z;
  const vy = s.vel.y;

  if (s.grounded) {
    const onRoad = (inCity(s.pos.x, s.pos.z) && nearRoad(s.pos.x, s.pos.z)) || rampUnder(s.pos.x, s.pos.z, s.pos.y);
    const surfF = onRoad || s.pos.y > 100 ? 1 : 1 - spec.offroadPenalty;
    if (throttle > 0) {
      const headroom = Math.max(0, 1 - vF / (spec.maxSpeed * topMul * (1 - slip * 0.25)));
      vF += spec.accel * accMul * surfF * headroom * (1 - slip * 0.35) * dt * throttle;
    } else if (throttle < 0) {
      if (vF > 0.5) vF -= 26 * (1 - slip * 0.55) * dt * Math.abs(throttle);
      else { vF -= 9 * dt * Math.abs(throttle); vF = Math.max(vF, -13); }
    }
    vF -= vF * 0.28 * dt;
    if (!onRoad) vF -= vF * spec.offroadPenalty * 0.4 * dt;
    const handbrake = input.brake && !locked;
    let gripRate = spec.grip * 2.2 * (1 - slip);
    if (handbrake) { vF -= vF * 0.7 * (1 - slip * 0.5) * dt; gripRate = 1.1; }
    // tyres turn sideways momentum back into forward speed instead of just scrubbing it
    const vS0 = vS;
    vS *= Math.exp(-Math.max(0.8, gripRate) * dt);
    const regained = vS0 * vS0 - vS * vS;
    if (regained > 0 && Math.abs(vF) > 1) vF += Math.sign(vF) * (Math.sqrt(vF * vF + regained * (handbrake ? 0.5 : 0.85)) - Math.abs(vF));
    const speedFactor = Math.min(1, Math.abs(vF) / 10);
    const driftTurn = input.brake ? 1.35 : 1;
    s.heading += steer * spec.turn * driftTurn * (1 - slip * 0.3) * speedFactor * dt * (vF < 0 ? -1 : 1);
    const n = groundNormalAt(s.pos.x, s.pos.z, s.pos.y);
    s.vel.x += n.x * 20 * dt;
    s.vel.z += n.z * 20 * dt;
    if (!inCity(s.pos.x, s.pos.z) && s.pos.y < WATER_Y + 0.3) vF *= 1 - 2.2 * dt;
  } else {
    s.heading += steer * spec.turn * 0.35 * dt;
  }

  // compose with the pre-steering axes: the body rotates first and momentum follows
  // through grip next frame, which is what lets the car slide into drifts
  s.vel.x = _fwd.x * vF + _side.x * vS;
  s.vel.z = _fwd.z * vF + _side.z * vS;
  s.vel.y = vy - GRAVITY * dt;
  _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
  _side.set(Math.cos(s.heading), 0, -Math.sin(s.heading));

  s.pos.addScaledVector(s.vel, dt);
  s.pos.x = Math.max(-MAP / 2 + 15, Math.min(MAP / 2 - 15, s.pos.x));
  s.pos.z = Math.max(-MAP / 2 + 15, Math.min(MAP / 2 - 15, s.pos.z));

  const radius = spec.proc === 'motorcycle' ? 0.8 : 1.3;
  aabbCollide(s, radius);
  rampCollide(s, radius);
  circlePush(s, treeObstacles, radius - 0.1, s.pos.y > 100 ? undefined : 20);
  circlePush(s, rockObstacles, radius - 0.3, s.pos.y > 100 ? undefined : 20);
  const bump = (list, keep, isCop) => {
    for (const c of list) {
      if (isCop && !c.active) continue;
      const dx = s.pos.x - c.group.position.x, dz = s.pos.z - c.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 7.3 && d2 > 0.0001 && Math.abs(s.pos.y - CITY_Y) < 3) {
        const d = Math.sqrt(d2), push = 2.7 - d;
        const impact = Math.hypot(s.vel.x - Math.sin(c.heading) * c.speed, s.vel.z - Math.cos(c.heading) * c.speed);
        s.pos.x += (dx / d) * push;
        s.pos.z += (dz / d) * push;
        const k = Math.min(1, keep * spec.weight);
        s.vel.multiplyScalar(k);
        lastImpact = Math.max(lastImpact, impact * (1 - k));
        if (isCop && impact > 8 && wantedLevel < 10 && collisionCooldown <= 0) { wantedLevel = Math.min(10, wantedLevel + 1); toast('Rammed a cop! Wanted level: ' + wantedLevel); }
      }
    }
  };
  bump(aiCars, 0.4, false);
  bump(copCars, 0.3, true);
  if (lastImpact > 4 && collisionCooldown <= 0) { onCrash(lastImpact); collisionCooldown = 0.5; }

  const speed = Math.hypot(s.vel.x, s.vel.z);
  for (const p of peds) {
    if (!p.wx || p.state === 'ko') continue;
    const dx = s.pos.x - p.wx, dz = s.pos.z - p.wz;
    if (dx * dx + dz * dz < 2.2 && Math.abs(s.pos.y - CITY_Y) < 2) {
      if (speed > 1.5) {
        knockPed(p, s.vel.x, s.vel.z);
        s.vel.multiplyScalar(0.85);
        if (speed > 4) {
          wantedLevel = Math.min(10, wantedLevel + 2);
          loseCombo('PEDESTRIAN');
          toast('Hit a pedestrian! Wanted level: ' + wantedLevel);
        }
      }
    }
  }

  // ground contact; slopes give the car vertical speed so ramps launch it
  const g = groundAt(s.pos.x, s.pos.z, s.pos.y);
  if (s.pos.y <= g + 0.05 || (s.grounded && s.pos.y - g < 0.6 && s.vel.y <= s.slopeVy + 0.5)) {
    if (!s.grounded && s.vel.y < -16) { s.vel.x *= 0.8; s.vel.z *= 0.8; camShake = Math.min(1, camShake - s.vel.y * 0.02); }
    s.pos.y = g; s.grounded = true;
    const sp = Math.hypot(s.vel.x, s.vel.z);
    if (sp > 0.5) {
      const bx = s.pos.x - s.vel.x / sp, bz = s.pos.z - s.vel.z / sp;
      s.slopeVy = Math.max(-25, Math.min(30, (g - groundAt(bx, bz, s.pos.y + 0.5)) * sp));
    } else s.slopeVy = 0;
    s.vel.y = s.slopeVy;
  } else s.grounded = false;

  if (s.grounded) _up.copy(groundNormalAt(s.pos.x, s.pos.z, s.pos.y));
  else _up.lerp(_worldUp, Math.min(1, dt * 2)).normalize();
  _right.crossVectors(_up, _fwd).normalize();
  const alignedFwd = _tmp.crossVectors(_right, _up).normalize();
  _m.makeBasis(_right, _up, alignedFwd);
  car.quaternion.setFromRotationMatrix(_m);
  const wantRoll = THREE.MathUtils.clamp(-steer * Math.abs(vF) * 0.0035, -0.09, 0.09);
  let wantPitch = THREE.MathUtils.clamp((throttle > 0 ? -1 : throttle < 0 ? 1.4 : 0) * Math.min(1, Math.abs(vF) / 8) * 0.035, -0.05, 0.06);
  if (!s.grounded) wantPitch = THREE.MathUtils.clamp(-s.vel.y * 0.012, -0.3, 0.3);
  s.visualRoll += (wantRoll - s.visualRoll) * Math.min(1, dt * 6);
  s.visualPitch += (wantPitch - s.visualPitch) * Math.min(1, dt * (s.grounded ? 6 : 2));
  car.rotateX(s.visualPitch); car.rotateZ(s.visualRoll);
  car.position.copy(s.pos);

  const ud = car.userData;
  s.wheelSpin += (vF / (ud.wheelR || 0.4)) * dt * (ud.spinSign || 1);
  ud.wheels.forEach(w => { w.rotation.x = s.wheelSpin; });
  ud.fronts.forEach(p => { p.rotation.y = steer * 0.42; });
  if (ud.steeringWheel) ud.steeringWheel.rotation.set(-0.35, 0, -steer * 1.4);
  if (ud.sirenL) {
    const flash = sirenOn && Math.sin(performance.now() * 0.015) > 0;
    ud.sirenL.material.color.set(flash ? 0x0066ff : 0x001133);
    ud.sirenR.material.color.set(sirenOn && !flash ? 0xff3300 : 0x330000);
  }
  if (ud.flames) {
    ud.flames.forEach(f => {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.6);
    });
  }
  if (sirenOn && spec.siren && Math.random() < dt * 2) scarePeds(s.pos.x, s.pos.z, 26, 'flee');
}

// ---------- Cameras ----------
function updateChaseCamera(dt) {
  _fwd.set(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  const shake = camShake * camShake;
  if (camStyle === 'cockpit' && mode !== 'fly') {
    // roof cam: Kenney bodies are solid, so sit just above the roof line
    const sz = car.userData.size || new THREE.Vector3(2, 1.3, 4.4);
    camera.position.copy(car.localToWorld(_tmp.set(0, sz.y + 0.35, sz.z * 0.05)));
    _look.copy(car.localToWorld(_tmp.set(0, sz.y * 0.55, 14)));
    camera.lookAt(_look);
    const want = 72 + (boosting ? 8 : 0);
    if (Math.abs(camera.fov - want) > 0.1) { camera.fov += (want - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    return;
  }
  if (camStyle === 'top') {
    _camTarget.set(carState.pos.x - _fwd.x * 6, carState.pos.y + 34, carState.pos.z - _fwd.z * 6);
    camera.position.lerp(_camTarget, 1 - Math.pow(0.001, dt));
    camera.lookAt(carState.pos.x + _fwd.x * 6, carState.pos.y, carState.pos.z + _fwd.z * 6);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
    return;
  }
  const portrait = camera.aspect < 1;
  const back = (mode === 'fly' ? 12 : 6 + Math.min(2, carSpeed() * 0.03)) + (portrait ? 2.5 : 0);
  _camTarget.copy(carState.pos).addScaledVector(_fwd, -back);
  _camTarget.y = Math.max(carState.pos.y + (mode === 'fly' ? 4 : 2.8), surfaceGroundY(_camTarget.x, _camTarget.z) + 2);
  const k = 1 - Math.pow(0.0001, dt);
  camera.position.lerp(_camTarget, k);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.8;
    camera.position.y += (Math.random() - 0.5) * shake * 0.8;
  }
  _look.copy(carState.pos); _look.y += 1.6;
  camera.lookAt(_look);
  const vF = Math.abs(carState.vel.dot(_fwd));
  camera.fov += (((portrait ? 72 : 60) + vF * 0.32 + (boosting ? 12 : 0)) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}
function updateFlyCamera(dt) {
  flyCam.yaw -= input.lookDX;
  flyCam.pitch -= input.lookDY;
  flyCam.pitch = Math.max(-1.45, Math.min(1.45, flyCam.pitch));
  camera.rotation.set(flyCam.pitch, flyCam.yaw, 0, 'YXZ');
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  const v = 26 * dt;
  if (input.moveZ > 0.2) camera.position.addScaledVector(dir, v * input.moveZ);
  if (input.moveZ < -0.2) camera.position.addScaledVector(dir, v * input.moveZ);
  if (input.moveX < -0.2) camera.position.addScaledVector(right, -v * input.moveX);
  if (input.moveX > 0.2) camera.position.addScaledVector(right, -v * input.moveX);
  if (keys['KeyE'] || input.brake) camera.position.y += v;
  if (keys['KeyQ']) camera.position.y -= v;
  camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z, camera.position.y) + 1);
}
// Garage showroom: slow orbit around the selected car
let menuOrbit = 0;
function updateMenuCamera(dt) {
  menuOrbit += dt * 0.22;
  const c = carState.pos;
  const r = innerWidth < 700 ? 9.5 : 8;
  camera.position.set(c.x + Math.sin(menuOrbit) * r, c.y + 2.6, c.z + Math.cos(menuOrbit) * r);
  camera.lookAt(c.x, c.y + 0.8, c.z);
  if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
  if (innerWidth > 900) camera.setViewOffset(innerWidth, innerHeight, -Math.min(230, innerWidth * 0.17), 0, innerWidth, innerHeight);
  else if (innerWidth < 700) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.22, innerWidth, innerHeight);
  else camera.clearViewOffset();
}

// ---------- Headlights / horn ----------
let headlightsOn = false;
function toggleHeadlights() {
  headlightsOn = !headlightsOn;
  toast(headlightsOn ? 'Headlights on' : 'Headlights off');
}
function honk() {
  const spec = VEHICLES[carStyle];
  if (spec.siren) {
    sirenOn = !sirenOn;
    toast(sirenOn ? 'Siren on — clear the way!' : 'Siren off');
  } else {
    playHorn();
    scarePeds(carState.pos.x, carState.pos.z, 15, carSpeed() > 8 ? 'flee' : 'wave');
  }
  addStat('honks', 1);
}
function resetCar() {
  if (activity) abortActivity('reset');
  const p = carState.pos;
  if (inCity(p.x, p.z)) placeCar(SPAWN.x, SPAWN.z, SPAWN.heading);
  else placeCar(p.x, p.z, carState.heading);
  toast('Vehicle reset');
}

// ---------- Speed limit & wanted system ----------
let redLightViolationTimer = 0;
let wantedDecayTimer = 0;
function checkSpeedGuidance(dt) {
  const kmh = Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6;
  const p = carState.pos, city = inCity(p.x, p.z) && Math.abs(p.y - CITY_Y) < 3;
  const spec = VEHICLES[carStyle];
  if (city && !activity && kmh > 90 && wantedLevel < 2 && !spec.copPerk && Math.random() < dt * 0.05) {
    wantedLevel++;
    toast('Caught speeding! Wanted level: ' + wantedLevel);
  }
  let nearRed = false;
  if (city && !activity) {
    for (const tl of trafficLights) {
      if (tl.state !== 'red') continue;
      if (Math.hypot(tl.x - p.x, tl.z - p.z) < 15 && kmh > 8) nearRed = true;
    }
  }
  if (nearRed) {
    redLightViolationTimer += dt;
    if (redLightViolationTimer > 1.5) {
      redLightViolationTimer = 0;
      if (wantedLevel < 3) {
        wantedLevel++;
        toast('Ran a red light! Wanted level: ' + wantedLevel);
      }
    }
  } else {
    redLightViolationTimer = Math.max(0, redLightViolationTimer - dt);
  }
  if (wantedLevel > 0) {
    wantedDecayTimer += dt * (spec.copPerk ? 2 : 1);
    if (wantedDecayTimer > 15) {
      wantedDecayTimer = 0;
      wantedLevel = Math.max(0, wantedLevel - 1);
      toast(wantedLevel ? 'Wanted level: ' + wantedLevel : 'The cops lost your trail');
    }
  } else wantedDecayTimer = 0;
  if (wantedLevel >= 6 && Math.random() < dt * 0.24 && roadblocks.length < 4) {
    spawnRoadblock();
    toast('Roadblock ahead!');
  }
  if (wantedLevel >= 9 && Math.random() < dt * 0.18 && spikeStrips.length < 3) {
    spawnSpikeStrip();
    toast('Spike strip deployed!');
  }
}

// ---------- Day / night ----------
let dayT = 0.14;
let isNight = false;
const CYCLE = 300;
const dayTop = new THREE.Color(0x2e74c4), dayBot = new THREE.Color(0xcfe3f2);
const nightTop = new THREE.Color(0x04070f), nightBot = new THREE.Color(0x0d1526);
const sunsetBot = new THREE.Color(0xe8926b);
const grayTop = new THREE.Color(0x5a636e), grayBot = new THREE.Color(0x89929c);
const snowTopC = new THREE.Color(0x7d8894), snowBotC = new THREE.Color(0xb8c0c9);
const _top = new THREE.Color(), _bot = new THREE.Color(), _gray = new THREE.Color();
const _sunDir = new THREE.Vector3();

function updateDayNight(dt) {
  dayT = (dayT + dt / CYCLE) % 1;
  const a = dayT * Math.PI * 2;
  const sinA = Math.sin(a);
  const dayF = Math.max(0, sinA);
  const nightF = Math.max(0, 1 - dayF * 2.5);
  isNight = nightF > 0.5;
  const horizonF = Math.max(0, 1 - Math.abs(sinA) / 0.22) * (sinA > -0.06 ? 1 : 0);
  const skyGray = Math.max(wet, snowF * 0.9);

  _sunDir.set(Math.cos(a), sinA, 0.32).normalize();
  sun.position.copy(carState.pos).addScaledVector(_sunDir, 190);
  sun.target.position.copy(carState.pos);
  sun.intensity = (0.1 + dayF * 1.7) * (1 - skyGray * 0.6);
  hemi.intensity = (0.15 + dayF * 0.75) * (1 - skyGray * 0.3);
  ambient.intensity = 0.12 + dayF * 0.2;

  _top.copy(nightTop).lerp(dayTop, dayF);
  _bot.copy(nightBot).lerp(dayBot, dayF);
  _bot.lerp(sunsetBot, horizonF * 0.75);
  _gray.copy(wet >= snowF ? grayTop : snowTopC).multiplyScalar(0.15 + 0.85 * dayF);
  _top.lerp(_gray, skyGray * 0.85);
  _gray.copy(wet >= snowF ? grayBot : snowBotC).multiplyScalar(0.15 + 0.85 * dayF);
  _bot.lerp(_gray, skyGray * 0.85);

  skyMat.uniforms.uTop.value.copy(_top);
  skyMat.uniforms.uBottom.value.copy(_bot);
  skyMat.uniforms.uSunDir.value.copy(_sunDir);
  skyMat.uniforms.uSunI.value = (dayF * 0.9 + horizonF * 0.6) * (1 - skyGray * 0.85);
  skyMat.uniforms.uTime.value = dayT * 100;

  auroraMat.uniforms.uIntensity.value = nightF * (1 - skyGray) * (1 - horizonF * 0.5);
  auroraMat.uniforms.uTime.value += dt * 0.3;
  aurora.rotation.y = dayT * Math.PI * 2;

  scene.fog.color.copy(_bot).convertSRGBToLinear();
  scene.fog.far = 1200 - skyGray * 500;
  scene.fog.near = 120 - skyGray * 50;

  starMat.opacity = nightF * (1 - skyGray);
  moonMat.opacity = nightF * (1 - skyGray * 0.7);
  moon.position.copy(_sunDir).multiplyScalar(-780);

  const winGlow = Math.min(1.2, nightF * 1.15 + skyGray * 0.25);
  facadeMats.forEach(m => { m.emissiveIntensity = winGlow; });
  lampHeadMat.emissiveIntensity = (nightF + skyGray * 0.5) * 1.6;
  headLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8 + (headlightsOn ? 1 : 0);
  tailLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8;
  // the glow boxes only read as lamps once they are lit; by day the models' own lamps show
  headLightMat.visible = tailLightMat.visible = headLightMat.emissiveIntensity > 0.35;
  if (car.userData.headlight) car.userData.headlight.intensity = headlightsOn ? 3 : (nightF * 2.6 + skyGray * 1.2);

  cloudMat.color.copy(srgb(0xffffff)).multiplyScalar(Math.max(0.1, 0.2 + dayF * 0.8 - skyGray * 0.4 * dayF));
  water.material.opacity = 0.8 - skyGray * 0.2 - nightF * 0.15;

  const hour = (dayT * 24 + 6) % 24;
  $('hudClock').textContent = String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.floor((hour % 1) * 60)).padStart(2, '0');
}

// ---------- Minimap (player-centred radar) ----------
const mmCanvas = $('minimap');
const mmCtx = mmCanvas.getContext('2d');
function drawMinimap() {
  const S = mmCanvas.width, C = S / 2, sc = S / 460;
  const px = carState.pos.x, pz = carState.pos.z;
  const mx = (x) => C + (x - px) * sc, my = (z) => C - (z - pz) * sc;
  const t = performance.now() * 0.001;
  mmCtx.fillStyle = 'rgba(16,30,22,0.95)';
  mmCtx.fillRect(0, 0, S, S);
  // city block
  mmCtx.fillStyle = 'rgba(40,46,56,0.95)';
  mmCtx.fillRect(mx(-CITY_EDGE), my(CITY_EDGE), CITY_EDGE * 2 * sc, CITY_EDGE * 2 * sc);
  mmCtx.strokeStyle = '#5a616c';
  mmCtx.lineWidth = 3;
  for (const L of ROADS) {
    mmCtx.beginPath(); mmCtx.moveTo(mx(-CITY_EDGE), my(L)); mmCtx.lineTo(mx(CITY_EDGE), my(L)); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(mx(L), my(-CITY_EDGE)); mmCtx.lineTo(mx(L), my(CITY_EDGE)); mmCtx.stroke();
  }
  const dot = (x, z, r, col, clampEdge) => {
    let sx = mx(x), sy = my(z);
    if (clampEdge) { sx = Math.max(6, Math.min(S - 6, sx)); sy = Math.max(6, Math.min(S - 6, sy)); }
    else if (sx < -6 || sy < -6 || sx > S + 6 || sy > S + 6) return;
    mmCtx.fillStyle = col;
    mmCtx.beginPath(); mmCtx.arc(sx, sy, r, 0, Math.PI * 2); mmCtx.fill();
  };
  mmCtx.fillStyle = '#ff9f43';
  for (const r of ramps) dot(r.x, r.z, 2.2, '#ff9f43');
  for (const tl of trafficLights) dot(tl.x, tl.z, 1.6, tl.state === 'red' ? '#ef5350' : tl.state === 'yellow' ? '#ffa726' : '#66bb6a');
  for (const c of aiCars) dot(c.group.position.x, c.group.position.z, 1.6, '#c9b27a');
  for (const b of cashBags) if (b.respawn <= 0) dot(b.x, b.z, 2, '#7ed321');
  for (const st of hiddenStars) {
    if (st.found) continue;
    if (Math.hypot(st.x - px, st.z - pz) > 90) continue;
    mmCtx.strokeStyle = 'rgba(255,213,74,' + (0.5 + 0.5 * Math.sin(t * 5)) + ')';
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath(); mmCtx.arc(mx(st.x), my(st.z), 4 + 2 * Math.sin(t * 5), 0, Math.PI * 2); mmCtx.stroke();
  }
  if (!activity) {
    for (const r of RACES) dot(r.start[0], r.start[1], 4, '#ffffff');
    for (const d of DEPOTS) dot(d[0], d[1], 4, '#f2c14e');
  }
  for (const c of copCars) if (c.active) dot(c.group.position.x, c.group.position.z, 2.6, Math.sin(t * 12) > 0 ? '#ff3333' : '#3366ff');
  for (const h of helicopters) if (h.active) dot(h.pos.x, h.pos.z, 3, '#ff66ff');
  const tgt = activityTarget();
  if (tgt) dot(tgt.x, tgt.z, 5 + Math.sin(t * 6), activity.type === 'race' ? '#4fc3f7' : '#66bb6a', true);
  mmCtx.save();
  mmCtx.translate(C, C);
  mmCtx.rotate(carState.heading);
  mmCtx.fillStyle = '#4fc3f7';
  mmCtx.strokeStyle = '#fff'; mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(0, -6); mmCtx.lineTo(4.5, 5); mmCtx.lineTo(-4.5, 5);
  mmCtx.closePath(); mmCtx.fill(); mmCtx.stroke();
  mmCtx.restore();
}

// ---------- Traffic light HUD ----------
function updateTrafficLightHud() {
  const nearest = mode === 'drive' ? getNearestTrafficLight() : null;
  const el = $('trafficLightHud');
  if (nearest && nearest.dist < 40) {
    el.classList.add('active');
    $('tlRed').className = 'tl-dot' + (nearest.tl.state === 'red' ? ' red' : '');
    $('tlYellow').className = 'tl-dot' + (nearest.tl.state === 'yellow' ? ' yellow' : '');
    $('tlGreen').className = 'tl-dot' + (nearest.tl.state === 'green' ? ' green' : '');
    $('tlDist').textContent = Math.round(nearest.dist) + 'm';
  } else {
    el.classList.remove('active');
  }
}

// ---------- Input ----------
const GAME_KEYS = ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyH', 'KeyC', 'KeyB', 'KeyM', 'KeyP', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
function handleAction(action) {
  if (mode === 'menu' || paused) return;
  if (action === 'horn') honk();
  else if (action === 'camera') {
    camStyle = camStyle === 'chase' ? 'cockpit' : camStyle === 'cockpit' ? 'top' : 'chase';
    toast(camStyle === 'cockpit' ? 'Cockpit view' : camStyle === 'top' ? 'Top view' : 'Chase view');
  } else if (action === 'reset' && mode === 'drive') resetCar();
  else if (action === 'fullscreen') toggleFullscreen();
  else if (action === 'pause') togglePause();
}
addEventListener('keydown', (e) => {
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
  if (mode === 'menu') return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused || e.repeat) return;
  initAudio();
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Sound off' : 'Sound on'); }
  if (e.code === 'KeyC') handleAction('camera');
  if (e.code === 'KeyF') toggleHeadlights();
  if (e.code === 'KeyH') handleAction('horn');
  if (e.code === 'KeyR') handleAction('reset');
  if (e.code === 'KeyB') {
    if (mode === 'drive') {
      const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      flyCam.yaw = e2.y; flyCam.pitch = e2.x;
      bankCombo();
      mode = 'build';
      toast('Build mode — click to lock mouse · LMB place · RMB remove · 1-5 material · B to exit');
    } else if (mode === 'build') {
      if (document.pointerLockElement) document.exitPointerLock();
      mode = 'drive';
    }
  }
  if (mode === 'build' && /^Digit[1-5]$/.test(e.code)) {
    selectedMat = +e.code.slice(5) - 1;
    toast('Material: ' + MATERIALS[selectedMat].name);
  }
  if (e.code === 'KeyP') {
    if (mode === 'drive') { if (activity) abortActivity('took off'); bankCombo(); enterPlane(); }
    else if (mode === 'fly') exitPlane();
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const k in keys) keys[k] = false;
    mouseDown = false;
    if (mode !== 'menu' && !paused) togglePause();
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (mode === 'build') {
    flyCam.yaw -= e.movementX * 0.0022;
    flyCam.pitch -= e.movementY * 0.0022;
    flyCam.pitch = Math.max(-1.45, Math.min(1.45, flyCam.pitch));
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  initAudio();
  mouseDown = true;
  if (mode === 'build') {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
      return;
    }
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const targets = [terrain, ...cityGround, ...buildingMeshes, ...blockMap.values()];
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length || hits[0].distance > 70) return;
    const hit = hits[0];
    if (e.button === 0) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      placeBlock(hit.point, n);
    } else if (e.button === 2 && hit.object.userData.blockKey) removeBlock(hit.object);
  }
});
addEventListener('mouseup', () => { mouseDown = false; });

// ---------- Touch device (check input.js for isTouchDevice) ----------
if (typeof isTouchDevice !== 'undefined' && isTouchDevice) document.body.classList.add('touch-device');

// ---------- HUD refresh ----------
function updateHud(dt) {
  const healthFill = $('healthFill');
  healthFill.style.width = (playerHealth / playerMaxHealth * 100) + '%';
  healthFill.style.background = playerHealth > 60 ? '#4caf50' : playerHealth > 30 ? '#ffa726' : '#ef5350';
  $('healthLabel').textContent = Math.round(playerHealth) + ' HP';
  const altEl = $('altitudeMeter');
  if (inPlane && planeState) { $('altitudeVal').textContent = Math.round(planeState.altitude) + 'm · ' + Math.round(planeState.speed * 3.6) + ' km/h'; altEl.style.display = 'block'; }
  else altEl.style.display = 'none';
  const dmgFlash = $('damageFlash');
  if (damageFlashTimer > 0) {
    damageFlashTimer -= dt;
    dmgFlash.style.opacity = String(Math.max(0, damageFlashTimer / 0.35 * 0.5));
  } else dmgFlash.style.opacity = '0';
  const busted = $('bustedScreen');
  if (bustedTimer > 0) {
    bustedTimer -= dt;
    busted.style.display = 'flex';
    if (bustedTimer <= 0) { busted.style.display = 'none'; respawnPlayer(); }
  } else busted.style.display = 'none';

  const p = playerPos();
  $('hudBiome').textContent = biomeName(p.x, p.z, p.y);
  const zone = $('hudZone');
  if (wantedLevel > 0) {
    zone.textContent = '★'.repeat(wantedLevel) + '☆'.repeat(Math.max(0, 5 - wantedLevel));
    zone.style.color = '#ff4444';
  } else {
    zone.textContent = Math.hypot(p.x - STUNT_PARK.x, p.z - STUNT_PARK.z) < 80 ? 'Stunt Park' : inCity(p.x, p.z) ? 'City' : 'Countryside';
    zone.style.color = '';
  }
  $('speedLimit').classList.toggle('active', mode === 'drive' && inCity(p.x, p.z) && carSpeed() > 1);
}

// ---------- Main loop ----------
let last = performance.now();
if (typeof initInput === 'function') initInput();

function tick(now) {
  try {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (typeof pollGamepad === 'function') pollGamepad();
    if (typeof keyboardToInput === 'function') keyboardToInput(keys);
    for (const a of input._edgeQueue) handleAction(a);

    if (mode !== 'menu' && !paused) {
      if (mode === 'drive' || mode === 'exiting' || mode === 'fly') {
        if (mode === 'fly') updatePlane(dt);
        else updateCar(dt);
        updateChaseCamera(dt);
      } else if (mode === 'build') {
        updateFlyCamera(dt);
      }
      updateTraffic(dt);
      updatePeds(dt);
      updateTrafficLights(dt);
      updateWeather(dt);
      updatePrecip(dt);
      updateAudio(dt);
      updateDayNight(dt);
      updateCops(dt);
      updateBullets(dt);
      updateRoadblocks(dt);
      updateSpikeStrips(dt);
      updateHelicopters(dt);
      updateGuidance(dt);
      updateTrafficLightHud();
      if (mode === 'drive') checkSpeedGuidance(dt);
      updateActivities(dt);
      for (const cl of clouds) {
        cl.position.x += 1.6 * dt;
        if (cl.position.x > 470) cl.position.x = -470;
      }
      skyGroup.position.copy(camera.position);
      if (mode === 'drive' || mode === 'fly') updateDashboard();
      updateHud(dt);
      drawMinimap();
    } else if (mode === 'menu') {
      updateMenuCamera(dt);
      updateTraffic(dt);
      updatePeds(dt);
      updateTrafficLights(dt);
      updateAudio(dt);
      skyGroup.position.copy(camera.position);
      for (const cl of clouds) {
        cl.position.x += 1.6 * dt;
        if (cl.position.x > 470) cl.position.x = -470;
      }
      updateDayNight(dt * 0.3);
      updateCollectibles(dt);
    }

    renderer.render(scene, camera);
    pressed.clear();
    if (typeof inputEndFrame === 'function') inputEndFrame();
  } catch (e) { console.error('tick error:', e); }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
