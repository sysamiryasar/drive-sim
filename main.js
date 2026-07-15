'use strict';
// ============================================================
// main.js — input, modes, car & character physics, cameras,
// auto weather, day/night, portals, garage, battle royale, loop
// ============================================================

// ---------- Mode state ----------
let mode = 'drive';
let camStyle = 'chase';
let exitAnim = null;
const keys = {};
const pressed = new Set();
let mouseDown = false;
const flyCam = { yaw: 0, pitch: -0.3 };
const aim = { yaw: Math.PI / 2, pitch: -0.08 };
const raycaster = new THREE.Raycaster();

function playerPos() { return mode === 'drive' || mode === 'exiting' ? carState.pos : charState.pos; }

// ---------- HUD helpers ----------
const $ = (id) => document.getElementById(id);
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, 2000);
}
function bigMsg(msg, ms) {
  const el = $('bigmsg');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, ms || 2600);
}
function hitFlash() {
  const el = $('hitflash');
  el.style.opacity = 0.35;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, 120);
}
function setMode(m) {
  mode = m;
  const label = { drive: 'DRIVE', foot: 'ON FOOT', build: 'BUILD', br: 'BATTLE ROYALE', exiting: 'DRIVE' }[m];
  $('mode').textContent = label;
  $('mode').style.color = m === 'br' ? '#ff7a6b' : m === 'build' ? '#8fd3ff' : '#7CFC9A';
  $('crosshair').style.display = (m === 'build' || m === 'br') ? 'block' : 'none';
  $('palette').style.display = m === 'build' ? 'flex' : 'none';
  $('healthwrap').style.display = m === 'br' ? 'block' : 'none';
  $('alivewrap').style.display = m === 'br' ? 'block' : 'none';
  $('speedo').style.display = (m === 'drive' || m === 'exiting') ? 'block' : 'none';
  if (m !== 'build' && m !== 'br' && document.pointerLockElement) document.exitPointerLock();
}

// ---------- Blocks (build mode) ----------
const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
const MATERIALS = [
  { name: 'Wood',  mat: lambert(0x9a6b3f), css: '#9a6b3f' },
  { name: 'Stone', mat: lambert(0x8d8d92), css: '#8d8d92' },
  { name: 'Brick', mat: lambert(0xb5493a), css: '#b5493a' },
  { name: 'Glass', mat: lambert(0x9fd4e8, { transparent: true, opacity: 0.55 }), css: '#9fd4e8' },
  { name: 'Gold',  mat: standard(0xf2c14e, 0.3, 0.9), css: '#f2c14e' },
  { name: 'Metal', mat: standard(0x888890, 0.2, 0.85), css: '#888890' },
  { name: 'Marble',mat: standard(0xf0ece4, 0.15, 0.05), css: '#f0ece4' },
];
let selectedMat = 0;
const blockMap = new Map();
{
  const paletteEl = $('palette');
  MATERIALS.forEach((m, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === 0 ? ' sel' : '');
    slot.style.background = m.css;
    slot.textContent = (i + 1) + ' ' + m.name;
    paletteEl.appendChild(slot);
  });
}
function selectMaterial(i) {
  selectedMat = i;
  [...$('palette').children].forEach((el, j) => el.classList.toggle('sel', j === i));
}
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
  $('blocks').textContent = blockMap.size;
}
function removeBlock(mesh) {
  scene.remove(mesh);
  blockMap.delete(mesh.userData.blockKey);
  $('blocks').textContent = blockMap.size;
}

// ---------- Enter / exit car ----------
function startExitCar(next) {
  const from = car.localToWorld(new THREE.Vector3(-1.35, 0, 0));
  const to = car.localToWorld(new THREE.Vector3(-2.9, 0, 0.6));
  from.y = groundAt(from.x, from.z, carState.pos.y + 1);
  to.y = groundAt(to.x, to.z, carState.pos.y + 1);
  character.visible = true;
  character.userData.gun.visible = false;
  character.position.copy(from);
  character.rotation.y = carState.heading + Math.PI / 2;
  exitAnim = { t: 0, from, to, next };
  setMode('exiting');
}
function finishExitCar() {
  charState.pos.copy(exitAnim.to);
  charState.vel.set(0, 0, 0);
  charState.heading = carState.heading;
  const next = exitAnim.next;
  exitAnim = null;
  if (next === 'build') {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    flyCam.yaw = e.y; flyCam.pitch = e.x;
    toast('Build mode — click to capture mouse');
  }
  if (next === 'br') { brBegin(); return; }
  setMode(next);
}
function enterCar() {
  character.visible = false;
  carState.vel.set(0, 0, 0);
  setMode('drive');
  toast('Driving — F to get out, C for cockpit view');
}

// ---------- Weather (automatic) ----------
let weather = 'clear', wet = 0, snowF = 0, weatherTimer = 18;
let snowAccumLevel = 0;
function pickWeather() {
  const p = playerPos();
  const t = tempAt(p.x, p.z);
  const r = Math.random();
  if (p.y < UW_LIMIT) { weather = 'clear'; return; }
  if (t < 0.32) weather = r < 0.35 ? 'clear' : r < 0.8 ? 'snow' : 'rain';
  else if (t > 0.7) weather = r < 0.72 ? 'clear' : 'rain';
  else weather = r < 0.45 ? 'clear' : r < 0.82 ? 'rain' : 'snow';
  $('weather').textContent = weather === 'clear' ? 'Clear' : weather === 'rain' ? 'Rain' : 'Snow';
  if (weather !== 'clear') toast(weather === 'rain' ? 'Rain rolling in...' : 'Snow falling...');
}
function updateWeather(dt) {
  weatherTimer -= dt;
  if (weatherTimer <= 0) { weatherTimer = 30 + Math.random() * 45; pickWeather(); }
  wet += ((weather === 'rain' ? 1 : 0) - wet) * Math.min(1, dt * 0.5);
  snowF += ((weather === 'snow' ? 1 : 0) - snowF) * Math.min(1, dt * 0.35);
  snowAccumLevel += ((weather === 'snow' ? 0.6 : 0) - snowAccumLevel) * Math.min(1, dt * 0.08);
  snowAccumMat.opacity = snowAccumLevel * 0.7;
  snowAccumMat.needsUpdate = true;
  const snowPos = snowAccumGeo.attributes.position;
  for (let i = 0; i < snowPos.count; i++) {
    const x = snowPos.getX(i), z = snowPos.getZ(i);
    if (cityMask(x, z) > 0.3) { snowPos.setY(i, CITY_Y + 0.08); continue; }
    const h = terrainHeight(x, z);
    snowPos.setY(i, h + snowAccumLevel * 0.15);
  }
  snowPos.needsUpdate = true;
  for (const p of puddles) {
    p.material.opacity = wet * 0.4 * (1 - snowAccumLevel);
    p.position.y = CITY_Y + 0.04 + wet * 0.02;
  }
}

// rain particles
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

// snow particles
const SNOW_N = 1600;
const snowGeo = new THREE.BufferGeometry();
{
  const arr = new Float32Array(SNOW_N * 3);
  for (let i = 0; i < SNOW_N; i++) {
    arr.set([(Math.random() - 0.5) * 80, Math.random() * 55 - 8, (Math.random() - 0.5) * 80], i * 3);
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const snowMat = new THREE.PointsMaterial({
  color: 0xffffff, size: 0.22, transparent: true, opacity: 0, depthWrite: false,
});
const snowPts = new THREE.Points(snowGeo, snowMat);
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
      a[i * 6 + 1] = y;
      a[i * 6 + 4] = y - 0.9;
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
    snowMat.opacity = 0.85 * snowF;
  }
  if (typeof grassTufts !== 'undefined') {
    for (const g of grassTufts) {
      const windStr = wet > 0.1 ? 0.15 : 0.05;
      g.rotation.z = Math.sin(performance.now() * 0.002 + g.position.x * 0.5) * windStr;
    }
  }
}

// ---------- Audio ----------
let audio = null, muted = false;
function initAudio() {
  if (audio !== null) return;
  try {
    const ctx = new THREE.AudioContext ? new THREE.AudioContext() : new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'triangle';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 480;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 2);
    const windBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const wd = windBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) {
      wd[i] = (Math.random() * 2 - 1) * 0.3 * (1 + Math.sin(i / ctx.sampleRate * 0.5) * 0.5);
    }
    const impactBuf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const id = impactBuf.getChannelData(0);
    for (let i = 0; i < id.length; i++) id[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / id.length, 3);
    const footstepBuf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const fd = footstepBuf.getChannelData(0);
    for (let i = 0; i < fd.length; i++) fd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / fd.length, 4) * 0.5;
    audio = { ctx, osc, osc2, gain, noiseBuf, windBuf, impactBuf, footstepBuf, windGain: null, windOsc: null };
  } catch (e) { audio = false; }
}
function gunSound() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noiseBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.14;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 2400;
  src.connect(f); f.connect(g); g.connect(audio.ctx.destination);
  src.start();
}
function playImpact() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.impactBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.08;
  src.connect(g); g.connect(audio.ctx.destination);
  src.start();
}
function playFootstep() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.footstepBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.03;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 800;
  src.connect(f); f.connect(g); g.connect(audio.ctx.destination);
  src.start();
}
function playCollisionSound() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noiseBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.2;
  g.gain.exponentialRampToValueAtTime(0.01, audio.ctx.currentTime + 0.3);
  const f = audio.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1200;
  src.connect(f); f.connect(g); g.connect(audio.ctx.destination);
  src.start();
}
function startWind() {
  if (!audio || muted || audio.windGain) return;
  const osc = audio.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 80;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 300;
  filter.Q.value = 0.5;
  const gain = audio.ctx.createGain();
  gain.gain.value = 0;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start();
  audio.windOsc = osc;
  audio.windGain = gain;
}
function stopWind() {
  if (!audio || !audio.windGain) return;
  audio.windOsc.stop();
  audio.windOsc = null;
  audio.windGain = null;
}
let footstepTimer = 0;
let lastCollisionTime = 0;
function updateAudio(dt) {
  if (!audio) return;
  const t = audio.ctx.currentTime;
  const driving = mode === 'drive';
  const kmh = driving ? Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6 : 0;
  const gear = Math.min(5, Math.floor(kmh / 38));
  const within = (kmh - gear * 38) / 38;
  const freq = 52 + within * 92 + gear * 7;
  audio.osc.frequency.setTargetAtTime(freq, t, 0.05);
  audio.osc2.frequency.setTargetAtTime(freq * 1.5, t, 0.05);
  const g = (muted || !driving) ? 0 : 0.016 + Math.min(0.05, kmh * 0.0004);
  audio.gain.gain.setTargetAtTime(g, t, 0.1);
  if (wet > 0.3 || snowF > 0.3) {
    startWind();
    if (audio.windGain) {
      const windVol = (wet * 0.04 + snowF * 0.05) * (muted ? 0 : 1);
      audio.windGain.gain.setTargetAtTime(windVol, t, 0.3);
      audio.windOsc.frequency.setTargetAtTime(60 + wet * 40 + snowF * 50, t, 0.5);
    }
  } else {
    stopWind();
  }
  if (mode === 'foot' || mode === 'br') {
    const moving = Math.hypot(charState.vel.x, charState.vel.z) > 1;
    if (moving) {
      footstepTimer -= dt;
      if (footstepTimer <= 0) {
        playFootstep();
        footstepTimer = charState.sprinting ? 0.22 : 0.35;
      }
    }
  }
}

// ---------- Car physics v2 ----------
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3();
const _right = new THREE.Vector3(), _m = new THREE.Matrix4();
const _camTarget = new THREE.Vector3(), _look = new THREE.Vector3(), _tmp = new THREE.Vector3();
function _fwd2(h) { return _tmp.set(Math.sin(h), 0, Math.cos(h)); }

let collisionCooldown = 0;
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
      if (vn < 0) { state.vel.x -= vn * (dx / d) * 1.2; state.vel.z -= vn * (dz / d) * 1.2; }
    }
  }
}
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
      if (wallNormal) {
        const vn = state.vel.x * wallNormal[0] + state.vel.z * wallNormal[1];
        if (vn < 0) {
          state.vel.x -= vn * wallNormal[0] * 1.2;
          state.vel.z -= vn * wallNormal[1] * 1.2;
          if (mode === 'drive' && collisionCooldown <= 0) {
            playCollisionSound();
            collisionCooldown = 0.3;
          }
        }
      }
    }
  }
  return wallNormal;
}

function updateCar(dt) {
  const s = carState;
  const spec = VEHICLES[carStyle];
  const throttle = input.moveZ;
  const steer = input.moveX;
  const slip = Math.min(0.75, wet * 0.4 + snowF * 0.6);
  collisionCooldown -= dt;

  _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
  _side.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
  let vF = s.vel.x * _fwd.x + s.vel.z * _fwd.z;
  let vS = s.vel.x * _side.x + s.vel.z * _side.z;
  const vy = s.vel.y;

  if (s.grounded) {
    const onRoad = inCity(s.pos.x, s.pos.z) && nearRoad(s.pos.x, s.pos.z);
    const surfF = onRoad || s.pos.y > 100 ? 1 : 1 - spec.offroadPenalty;
    if (throttle > 0) {
      const headroom = Math.max(0, 1 - vF / (spec.maxSpeed * (1 - slip * 0.25)));
      vF += spec.accel * surfF * headroom * (1 - slip * 0.35) * dt * throttle;
    } else if (throttle < 0) {
      vF -= (vF > 0.5 ? 26 * (1 - slip * 0.55) : 9) * dt * Math.abs(throttle);
      vF = Math.max(vF, -13);
    }
    vF -= vF * 0.28 * dt;
    let gripRate = spec.grip * (1 - slip);
    if (input.brake) { vF -= vF * 2.2 * (1 - slip * 0.5) * dt; gripRate = 1.1; }
    vS *= Math.exp(-Math.max(0.8, gripRate) * dt);
    const speedFactor = Math.min(1, Math.abs(vF) / 10);
    s.heading += steer * spec.turn * (1 - slip * 0.3) * speedFactor * dt * (vF < 0 ? -1 : 1);
    const n = groundNormalAt(s.pos.x, s.pos.z, s.pos.y);
    s.vel.x += n.x * 20 * dt;
    s.vel.z += n.z * 20 * dt;
    if (!inCity(s.pos.x, s.pos.z) && s.pos.y < WATER_Y + 0.3 && s.pos.y > UW_LIMIT) {
      vF *= 1 - 2.2 * dt;
    }
  } else {
    s.heading += steer * spec.turn * 0.25 * dt;
  }

  _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
  _side.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
  s.vel.x = _fwd.x * vF + _side.x * vS;
  s.vel.z = _fwd.z * vF + _side.z * vS;
  s.vel.y = vy - 25 * dt;

  s.pos.addScaledVector(s.vel, dt);
  const bound = s.pos.y < UW_LIMIT ? UW_HALF - 6 : MAP / 2 - 15;
  s.pos.x = Math.max(-bound, Math.min(bound, s.pos.x));
  s.pos.z = Math.max(-bound, Math.min(bound, s.pos.z));

  aabbCollide(s, 1.3);
  circlePush(s, treeObstacles, 1.2, s.pos.y > 100 ? undefined : 20);
  circlePush(s, rockObstacles, 1.0, s.pos.y > 100 ? undefined : 20);
  if (s.pos.y < UW_LIMIT) circlePush(s, pillarObstacles, 1.3);
  for (const c of aiCars) {
    const dx = s.pos.x - c.group.position.x, dz = s.pos.z - c.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 7.3 && d2 > 0.0001 && Math.abs(s.pos.y - CITY_Y) < 3) {
      const d = Math.sqrt(d2), push = 2.7 - d;
      s.pos.x += (dx / d) * push;
      s.pos.z += (dz / d) * push;
      s.vel.multiplyScalar(0.6);
      if (collisionCooldown <= 0) { playImpact(); collisionCooldown = 0.5; }
    }
  }

  const g = groundAt(s.pos.x, s.pos.z, s.pos.y);
  if (s.pos.y <= g + 0.05 || (s.grounded && s.pos.y - g < 0.6 && s.vel.y <= 0)) {
    if (s.vel.y < -16) { s.vel.multiplyScalar(0.6); if (collisionCooldown <= 0) { playImpact(); collisionCooldown = 0.5; } }
    s.pos.y = g;
    s.vel.y = 0;
    s.grounded = true;
  } else {
    s.grounded = s.pos.y - g < 0.15;
  }

  if (s.pos.y < UW_LIMIT) {
    for (const lp of lavaPools) {
      const dx = s.pos.x - lp.x, dz = s.pos.z - lp.z;
      if (dx * dx + dz * dz < lp.r * lp.r) {
        s.pos.set(0, uwFloorHeight(0, 0), 10);
        s.vel.set(0, 0, 0);
        toast('Melted in lava — vehicle recovered');
        break;
      }
    }
  }

  if (s.grounded) _up.copy(groundNormalAt(s.pos.x, s.pos.z, s.pos.y));
  else _up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 2)).normalize();
  _right.crossVectors(_up, _fwd).normalize();
  const alignedFwd = _fwd.clone().crossVectors(_right, _up).normalize();
  _m.makeBasis(_right, _up, alignedFwd);
  car.quaternion.setFromRotationMatrix(_m);
  const wantRoll = THREE.MathUtils.clamp(-steer * Math.abs(vF) * 0.0035, -0.09, 0.09);
  const wantPitch = THREE.MathUtils.clamp((throttle > 0 ? -1 : throttle < 0 ? 1.4 : 0) * Math.min(1, Math.abs(vF) / 8) * 0.035, -0.05, 0.06);
  s.visualRoll += (wantRoll - s.visualRoll) * Math.min(1, dt * 6);
  s.visualPitch += (wantPitch - s.visualPitch) * Math.min(1, dt * 6);
  car.rotateX(s.visualPitch);
  car.rotateZ(s.visualRoll);
  car.position.copy(s.pos);

  s.wheelSpin += (vF / VEHICLES[carStyle].wheelR) * dt;
  car.userData.wheels.forEach((w) => { w.rotation.x = s.wheelSpin; });
  car.userData.fronts.forEach((p) => { p.rotation.y = steer * 0.42; });
  car.userData.steeringWheel.rotation.set(-0.35, 0, -steer * 1.4);

  if (car.userData.policeLightL) {
    const t = performance.now() * 0.005;
    const flash = Math.sin(t * 3) > 0;
    car.userData.policeLightL.material.emissiveIntensity = flash ? 2.5 : 0;
    car.userData.policeLightR.material.emissiveIntensity = flash ? 0 : 2.5;
  }

  $('speedNum').textContent = Math.round(Math.abs(vF) * 3.6);
}

// ---------- On-foot physics (parkour) ----------
function updateFoot(dt, aiming) {
  const s = charState;
  const spd = input.sprint ? 8.2 : 4.6;
  let ix = input.moveX, iz = input.moveZ;
  const camYaw = aiming ? aim.yaw : s.camYaw !== undefined ? s.camYaw : s.heading;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const sx = Math.cos(camYaw), sz = -Math.sin(camYaw);
  let dx = fx * iz + sx * ix, dz = fz * iz + sz * ix;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.01) { dx /= dl; dz /= dl; }
  const moving = dl > 0.01;

  const rate = s.grounded ? 12 : 3.5;
  s.vel.x += (dx * spd - s.vel.x) * Math.min(1, dt * rate);
  s.vel.z += (dz * spd - s.vel.z) * Math.min(1, dt * rate);

  if (pressed.has('Space') || inputEdge('jump')) {
    if (s.grounded) { s.vel.y = 9.6; s.grounded = false; s.jumps = 1; }
    else if (s.wallNormal) {
      s.vel.y = 9.2;
      s.vel.x += s.wallNormal[0] * 5.5;
      s.vel.z += s.wallNormal[1] * 5.5;
      s.jumps = 1;
      toast('Wall jump!');
    } else if (s.jumps < 2) { s.vel.y = 8.6; s.jumps = 2; }
  }
  s.vel.y -= 25 * dt;
  s.pos.addScaledVector(s.vel, dt);
  const bound = s.pos.y < UW_LIMIT ? UW_HALF - 4 : MAP / 2 - 10;
  s.pos.x = Math.max(-bound, Math.min(bound, s.pos.x));
  s.pos.z = Math.max(-bound, Math.min(bound, s.pos.z));

  if (moving) {
    const aheadX = s.pos.x + dx * 0.7, aheadZ = s.pos.z + dz * 0.7;
    const gAhead = groundAt(aheadX, aheadZ, s.pos.y + 2.4);
    if (gAhead > s.pos.y + 0.4 && gAhead - s.pos.y <= 2.3 && s.grounded) {
      s.pos.y = gAhead;
      s.vel.y = 0;
    }
  }
  s.wallNormal = aabbCollide(s, 0.45);
  circlePush(s, treeObstacles, 0.4, s.pos.y > 100 ? undefined : 20);
  circlePush(s, rockObstacles, 0.35, s.pos.y > 100 ? undefined : 20);
  if (s.pos.y < UW_LIMIT) circlePush(s, pillarObstacles, 0.45);

  const g = groundAt(s.pos.x, s.pos.z, s.pos.y);
  if (s.pos.y <= g + 0.03) {
    s.pos.y = g;
    s.vel.y = 0;
    if (!s.grounded) s.jumps = 0;
    s.grounded = true;
  } else s.grounded = false;

  if (s.pos.y < UW_LIMIT) {
    for (const lp of lavaPools) {
      const ddx = s.pos.x - lp.x, ddz = s.pos.z - lp.z;
      if (ddx * ddx + ddz * ddz < lp.r * lp.r) {
        s.pos.set(0, uwFloorHeight(0, 0), 10);
        s.vel.set(0, 0, 0);
        toast('Ouch! Lava.');
        break;
      }
    }
  }

  if (aiming) s.heading = aim.yaw;
  else if (moving) {
    const want = Math.atan2(s.vel.x, s.vel.z);
    let dh = want - s.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    s.heading += dh * Math.min(1, dt * 10);
  }
  s.walkPhase += Math.hypot(s.vel.x, s.vel.z) * dt * 2.4;
  character.position.copy(s.pos);
  character.rotation.y = s.heading;
  animateHumanoid(character, s.walkPhase, moving, aiming);
}

// ---------- Cameras ----------
function updateChaseCamera(dt) {
  _fwd.set(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  if (camStyle === 'cockpit') {
    camera.position.copy(car.localToWorld(new THREE.Vector3(-0.42, 1.22, -0.05)));
    _look.copy(car.localToWorld(new THREE.Vector3(-0.42, 1.0, 10)));
    camera.lookAt(_look);
    if (camera.fov !== 72) { camera.fov = 72; camera.updateProjectionMatrix(); }
    return;
  }
  _camTarget.copy(carState.pos).addScaledVector(_fwd, -9.5);
  _camTarget.y = Math.max(carState.pos.y + 4.2, groundAt(_camTarget.x, _camTarget.z, carState.pos.y + 6) + 2);
  const k = 1 - Math.pow(0.0001, dt);
  camera.position.lerp(_camTarget, k);
  _look.copy(carState.pos); _look.y += 1.6;
  camera.lookAt(_look);
  const vF = Math.abs(carState.vel.dot(_fwd));
  const targetFov = 60 + vF * 0.32;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}
function updateFootCamera(dt, aiming) {
  if (aiming && !document.pointerLockElement) {
    aim.yaw -= input.lookDX;
    aim.pitch -= input.lookDY;
    aim.pitch = Math.max(-1.2, Math.min(1.2, aim.pitch));
  }
  if (aiming) {
    const cp = Math.cos(aim.pitch), spch = Math.sin(aim.pitch);
    const bx = -Math.sin(aim.yaw) * cp, bz = -Math.cos(aim.yaw) * cp;
    camera.position.set(
      charState.pos.x + bx * 3.4 + Math.cos(aim.yaw) * 0.7,
      Math.max(charState.pos.y + 1.9 - spch * 3.4, groundAt(charState.pos.x, charState.pos.z, charState.pos.y) + 0.5),
      charState.pos.z + bz * 3.4 - Math.sin(aim.yaw) * 0.7);
    _look.set(
      charState.pos.x + Math.sin(aim.yaw) * cp * 20,
      charState.pos.y + 1.6 + Math.sin(aim.pitch) * 20,
      charState.pos.z + Math.cos(aim.yaw) * cp * 20);
    camera.lookAt(_look);
    if (camera.fov !== 62) { camera.fov = 62; camera.updateProjectionMatrix(); }
    return;
  }
  charState.camYaw = charState.camYaw === undefined ? charState.heading : charState.camYaw;
  let dh = charState.heading - charState.camYaw;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  charState.camYaw += dh * Math.min(1, dt * 2.5);
  const bx = -Math.sin(charState.camYaw), bz = -Math.cos(charState.camYaw);
  _camTarget.set(charState.pos.x + bx * 5.4, charState.pos.y + 2.6, charState.pos.z + bz * 5.4);
  _camTarget.y = Math.max(_camTarget.y, groundAt(_camTarget.x, _camTarget.z, charState.pos.y + 3) + 1);
  camera.position.lerp(_camTarget, 1 - Math.pow(0.0005, dt));
  _look.copy(charState.pos); _look.y += 1.5;
  camera.lookAt(_look);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
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
  if (keys['KeyQ'] || input.sprint) camera.position.y -= v;
  camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z, camera.position.y) + 1);
}

// ---------- Portals ----------
let portalCooldown = 0;
function updatePortals(dt) {
  portalCooldown -= dt;
  const p = playerPos();
  for (const pt of portals) {
    pt.mesh.rotation.y += dt * 0.8;
    if (portalCooldown > 0) continue;
    const dx = p.x - pt.x, dy = p.y + 2 - pt.y, dz = p.z - pt.z;
    if (dx * dx + dz * dz < 20 && Math.abs(dy) < 6) {
      const d = pt.dest;
      const y = d.uw ? uwFloorHeight(d.x, d.z) : (d.y !== null ? d.y : surfaceGroundY(d.x, d.z));
      const st = (mode === 'drive' || mode === 'exiting') ? carState : charState;
      st.pos.set(d.x, y, d.z);
      st.vel.set(0, 0, 0);
      st.heading = d.heading;
      if (st === carState) car.position.copy(st.pos);
      else character.position.copy(st.pos);
      camera.position.set(d.x - Math.sin(d.heading) * 8, y + 4, d.z - Math.cos(d.heading) * 8);
      portalCooldown = 3;
      bigMsg('Entering: ' + pt.label, 1800);
      break;
    }
  }
}

// ---------- Garage ----------
let garageOpen = false;
function inGarage() {
  const p = carState.pos;
  return mode === 'drive' && Math.abs(p.x - GARAGE.x) < GARAGE.hw && Math.abs(p.z - GARAGE.z) < GARAGE.hd;
}
function buildGarageMenu() {
  const el = $('garage');
  const colors = [0xd8342c, 0x2e7fd4, 0xf2c14e, 0x2f9e44, 0xe8e6e0, 0x1a1d24, 0x1a1a4e, 0xcc2222];
  let html = '<h2>GARAGE</h2>';
  for (const key of Object.keys(VEHICLES)) {
    html += `<div class="grow"><span class="gname">${VEHICLES[key].name}</span>`;
    for (const c of colors) {
      html += `<span class="swatch" data-style="${key}" data-color="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></span>`;
    }
    html += '</div>';
  }
  html += '<div class="ghint">Click a color to take the vehicle — drive out to close</div>';
  el.innerHTML = html;
  el.addEventListener('click', (e) => {
    const t = e.target;
    if (t.classList.contains('swatch')) {
      swapCar(t.dataset.style, parseInt(t.dataset.color, 10));
      toast(VEHICLES[t.dataset.style].name + ' ready!');
    }
  });
}
buildGarageMenu();
function updateGarage() {
  const show = inGarage() && Math.abs(carState.vel.length()) < 4;
  if (show !== garageOpen) {
    garageOpen = show;
    $('garage').style.display = show ? 'block' : 'none';
  }
}

// ---------- Battle royale ----------
const br = { active: false, stormR: 380, alive: 0, kills: 0 };
const stormMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 300, 48, 1, true),
  new THREE.MeshBasicMaterial({ color: srgb(0x3f8cff), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
stormMesh.visible = false;
scene.add(stormMesh);

const tracerPool = [];
{
  const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 24; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, mat.clone());
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
}
function spawnTracer(from, to) {
  const t = tracerPool.find(t => t.life <= 0) || tracerPool[0];
  const a = t.line.geometry.attributes.position.array;
  a[0] = from.x; a[1] = from.y; a[2] = from.z;
  a[3] = to.x; a[4] = to.y; a[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.07;
}
function updateTracers(dt) {
  for (const t of tracerPool) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
  }
}

function brBegin() {
  setMode('br');
  charState.hp = 100;
  character.visible = true;
  character.userData.gun.visible = true;
  br.active = true;
  br.stormR = 380;
  br.kills = 0;
  spawnBots(12);
  br.alive = 13;
  stormMesh.visible = true;
  aim.yaw = charState.heading;
  bigMsg('BATTLE ROYALE — 12 bots. Last one standing. Click to aim.', 3200);
}
function brEnd(won) {
  br.active = false;
  clearBots();
  stormMesh.visible = false;
  character.userData.gun.visible = false;
  setMode('foot');
  if (won === true) bigMsg('VICTORY ROYALE! ' + br.kills + ' kills', 4000);
  else if (won === false) bigMsg('ELIMINATED — ' + br.kills + ' kills', 3500);
  else toast('Battle royale cancelled');
}
function damagePlayer(amt) {
  charState.hp -= amt;
  charState.lastHurt = 0;
  hitFlash();
  if (charState.hp <= 0) brEnd(false);
}
function damageBot(b, amt, byPlayer) {
  b.hp -= amt;
  if (b.hp <= 0 && b.alive) {
    b.alive = false;
    scene.remove(b.g);
    br.alive--;
    if (byPlayer) { br.kills++; toast('Bot ' + b.id + ' eliminated (' + br.alive + ' left)'); }
    else toast('Bot ' + b.id + ' eliminated (' + br.alive + ' left)');
    if (br.alive === 1 && charState.hp > 0) brEnd(true);
  }
}
let shootCd = 0;
function playerShoot() {
  shootCd = 0.16;
  gunSound();
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 120;
  const botMeshes = [];
  for (const b of bots) if (b.alive) botMeshes.push(b.g);
  const hits = raycaster.intersectObjects([...botMeshes, ...buildingMeshes], true);
  const from = character.localToWorld(new THREE.Vector3(0.36, 1.35, 0.8));
  let to = raycaster.ray.at(80, new THREE.Vector3());
  if (hits.length) {
    to = hits[0].point;
    let obj = hits[0].object;
    for (const b of bots) {
      if (b.alive && (obj.parent === b.g || obj === b.g)) { damageBot(b, 40, true); break; }
    }
  }
  spawnTracer(from, to);
  aim.pitch = Math.min(1.4, aim.pitch + 0.008);
  raycaster.far = Infinity;
}
const _botDir = new THREE.Vector3();
function updateBots(dt) {
  for (const b of bots) {
    if (!b.alive) continue;
    const bp = b.g.position;
    const distC = Math.hypot(bp.x, bp.z);
    b.retarget -= dt;
    if (b.retarget <= 0) {
      b.retarget = 1.2 + Math.random() * 0.5;
      let best = null, bd = 1e9;
      for (const o of bots) {
        if (o !== b && o.alive) {
          const d = bp.distanceTo(o.g.position);
          if (d < bd) { bd = d; best = o; }
        }
      }
      const dp = bp.distanceTo(charState.pos);
      if (charState.hp > 0 && dp < bd) best = 'player';
      b.target = best;
      if (Math.random() < 0.4) b.strafeDir *= -1;
    }
    const tp = b.target === 'player' ? charState.pos : b.target ? b.target.g.position : null;
    let mx = 0, mz = 0;
    if (distC > br.stormR - 10) { mx = -bp.x / distC; mz = -bp.z / distC; }
    else if (tp) {
      const dx = tp.x - bp.x, dz = tp.z - bp.z;
      const d = Math.hypot(dx, dz) || 1;
      const preferDist = 15 + b.aggression * 15;
      if (d > preferDist) { mx = dx / d; mz = dz / d; }
      else { mx = (-dz / d) * b.strafeDir; mz = (dx / d) * b.strafeDir; }
      if (d < 8) { mx -= dx / d * 0.5; mz -= dz / d * 0.5; }
    }
    bp.x += mx * 4.6 * dt;
    bp.z += mz * 4.6 * dt;
    const fake = { pos: bp, vel: _botDir.set(0, 0, 0) };
    aabbCollide(fake, 0.45);
    bp.y = groundAt(bp.x, bp.z, bp.y + 1);
    if (tp) {
      b.g.rotation.y = Math.atan2(tp.x - bp.x, tp.z - bp.z);
    }
    b.walkPhase += Math.hypot(mx, mz) * 4.6 * dt * 2.4;
    animateHumanoid(b.g, b.walkPhase, mx !== 0 || mz !== 0, true);
    if (distC > br.stormR) damageBot(b, 6 * dt, false);
    b.cd -= dt;
    if (b.cd <= 0 && tp) {
      const d = bp.distanceTo(tp);
      if (d < 65) {
        b.cd = 1.2 + Math.random() * 0.8;
        const muzzle = new THREE.Vector3(bp.x, bp.y + 1.35, bp.z);
        const aimPt = tp.clone(); aimPt.y += 1.2;
        _botDir.copy(aimPt).sub(muzzle).normalize();
        raycaster.set(muzzle, _botDir);
        raycaster.far = d;
        const blockedHits = raycaster.intersectObjects(buildingMeshes, false);
        raycaster.far = Infinity;
        if (!blockedHits.length) {
          const jitter = new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.5);
          spawnTracer(muzzle, aimPt.clone().add(jitter));
          const hitChance = THREE.MathUtils.clamp(b.accuracy - d / 100, 0.1, 0.85);
          if (Math.random() < hitChance) {
            const dmg = 9 + Math.random() * 8;
            if (b.target === 'player') damagePlayer(dmg);
            else if (b.target && b.target !== 'player') damageBot(b.target, dmg, false);
          }
        }
      }
    }
  }
}
function updateBR(dt) {
  br.stormR = Math.max(26, br.stormR - 2.0 * dt);
  stormMesh.scale.set(br.stormR, 1, br.stormR);
  stormMesh.position.set(0, CITY_Y, 0);
  const distC = Math.hypot(charState.pos.x, charState.pos.z);
  if (distC > br.stormR) {
    charState.lastHurt = 0;
    charState.hp -= 6 * dt;
    if (charState.hp <= 0) { brEnd(false); return; }
  }
  charState.lastHurt += dt;
  if (charState.lastHurt > 6) charState.hp = Math.min(100, charState.hp + 4 * dt);
  updateBots(dt);
  if (shootCd > 0) shootCd -= dt;
  const shooting = (mouseDown && document.pointerLockElement === renderer.domElement) || input.fire;
  if (shooting && shootCd <= 0) playerShoot();
  $('healthbar').style.width = Math.max(0, charState.hp) + '%';
  $('alive').textContent = br.alive;
}

// ---------- Day / night ----------
let dayT = 0.14;
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
  const horizonF = Math.max(0, 1 - Math.abs(sinA) / 0.22) * (sinA > -0.06 ? 1 : 0);
  const p = playerPos();
  const underground = p.y < UW_LIMIT;
  const skyGray = Math.max(wet, snowF * 0.9);

  _sunDir.set(Math.cos(a), sinA, 0.32).normalize();
  sun.position.copy(p).addScaledVector(_sunDir, 190);
  sun.target.position.copy(p);
  sun.intensity = (0.1 + dayF * 1.7) * (1 - skyGray * 0.6) * (underground ? 0.1 : 1);
  hemi.intensity = (0.15 + dayF * 0.75) * (1 - skyGray * 0.3) * (underground ? 0.35 : 1);
  ambient.intensity = underground ? 0.34 : 0.12 + dayF * 0.2;
  ambient.color.copy(underground ? srgb(0xff9a66) : srgb(0xffffff));

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
  skyGroup.visible = !underground;

  const nightHorizon = Math.max(0, nightF * horizonF);
  const auroraIntensity = nightF * (1 - skyGray) * (1 - horizonF * 0.5);
  auroraMat.uniforms.uIntensity.value = auroraIntensity;
  auroraMat.uniforms.uTime.value += dt * 0.3;
  aurora.rotation.y = dayT * Math.PI * 2;

  if (underground) {
    scene.fog.color.copy(srgb(0x1c110c));
    scene.fog.near = 10;
    scene.fog.far = 170;
  } else {
    scene.fog.color.copy(_bot).convertSRGBToLinear();
    scene.fog.far = 700 - skyGray * 320;
    scene.fog.near = 90 - skyGray * 40;
  }

  starMat.opacity = nightF * (1 - skyGray);
  moonMat.opacity = nightF * (1 - skyGray * 0.7);
  moon.position.copy(_sunDir).multiplyScalar(-780);

  const winGlow = Math.min(1.2, nightF * 1.15 + skyGray * 0.25);
  facadeMats.forEach((m) => { m.emissiveIntensity = winGlow; });
  lampHeadMat.emissiveIntensity = (nightF + skyGray * 0.5) * 1.6;
  headLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8;
  tailLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8;
  signalMat.emissiveIntensity = 0;
  car.userData.headlight.intensity = Math.min(3, nightF * 2.6 + skyGray * 1.2 + (underground ? 2.2 : 0));

  cloudMat.color.copy(srgb(0xffffff)).multiplyScalar(Math.max(0.1, 0.2 + dayF * 0.8 - skyGray * 0.4 * dayF));

  water.material.opacity = 0.8 - skyGray * 0.2 - nightF * 0.15;

  const hour = (dayT * 24 + 6) % 24;
  const hh = String(Math.floor(hour)).padStart(2, '0');
  const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
  $('clock').textContent = hh + ':' + mm;
}

// ---------- Minimap ----------
const mmCtx = $('minimap').getContext('2d');
function drawMinimap() {
  const S = 170, sc = S / 430;
  mmCtx.fillStyle = 'rgba(10,14,22,0.95)';
  mmCtx.fillRect(0, 0, S, S);
  mmCtx.strokeStyle = '#3c424c';
  mmCtx.lineWidth = 3;
  const e = CITY_EDGE * sc;
  for (const L of ROADS) {
    const c = S / 2 + L * sc;
    mmCtx.beginPath(); mmCtx.moveTo(S / 2 - e, c); mmCtx.lineTo(S / 2 + e, c); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(c, S / 2 - e); mmCtx.lineTo(c, S / 2 + e); mmCtx.stroke();
  }
  for (const pt of portals) {
    if (pt.y < 0 || pt.y > 100) continue;
    mmCtx.fillStyle = '#b45cf0';
    mmCtx.fillRect(S / 2 + pt.x * sc - 2, S / 2 - pt.z * sc - 2, 4, 4);
  }
  if (br.active) {
    mmCtx.strokeStyle = 'rgba(80,150,255,0.9)';
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.arc(S / 2, S / 2, br.stormR * sc, 0, Math.PI * 2);
    mmCtx.stroke();
    mmCtx.fillStyle = '#ff6b5e';
    for (const b of bots) {
      if (!b.alive) continue;
      mmCtx.fillRect(S / 2 + b.g.position.x * sc - 1.5, S / 2 - b.g.position.z * sc - 1.5, 3, 3);
    }
  } else {
    mmCtx.fillStyle = '#e0a53c';
    for (const c of aiCars) {
      mmCtx.fillRect(S / 2 + c.group.position.x * sc - 1.5, S / 2 - c.group.position.z * sc - 1.5, 3, 3);
    }
  }
  const p = playerPos();
  const heading = (mode === 'drive' || mode === 'exiting') ? carState.heading : charState.heading;
  const px = Math.max(5, Math.min(S - 5, S / 2 + p.x * sc));
  const py = Math.max(5, Math.min(S - 5, S / 2 - p.z * sc));
  mmCtx.save();
  mmCtx.translate(px, py);
  mmCtx.rotate(heading);
  mmCtx.fillStyle = '#7CFC9A';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -5); mmCtx.lineTo(3.5, 4); mmCtx.lineTo(-3.5, 4);
  mmCtx.closePath(); mmCtx.fill();
  mmCtx.restore();
}

// ---------- Input ----------
addEventListener('keydown', (e) => {
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
  initAudio();
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Engine sound off' : 'Engine sound on'); }
  if (e.code === 'KeyC' && mode === 'drive') {
    camStyle = camStyle === 'chase' ? 'cockpit' : 'chase';
    toast(camStyle === 'cockpit' ? 'Cockpit view' : 'Chase view');
  }
  if (e.code === 'KeyF') {
    if (mode === 'drive') startExitCar('foot');
    else if (mode === 'foot' && charState.pos.distanceTo(carState.pos) < 4.5) enterCar();
    else if (mode === 'foot') toast('Get closer to the car (F)');
  }
  if (e.code === 'KeyB') {
    if (mode === 'drive') startExitCar('build');
    else if (mode === 'foot') {
      const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      flyCam.yaw = e2.y; flyCam.pitch = e2.x;
      setMode('build');
      toast('Build mode — click to capture mouse');
    } else if (mode === 'build') { setMode('foot'); toast('On foot'); }
  }
  if (e.code === 'KeyG') {
    if (mode === 'br') brEnd(null);
    else if (mode === 'drive') startExitCar('br');
    else if (mode === 'foot') brBegin();
  }
  if (e.code === 'KeyR' && mode === 'drive') {
    carState.pos.set(-150, CITY_Y, 3);
    carState.vel.set(0, 0, 0);
    carState.heading = Math.PI / 2;
    toast('Car reset');
  }
  if (mode === 'build' && e.code.startsWith('Digit')) {
    const i = parseInt(e.code.slice(5), 10) - 1;
    if (i >= 0 && i < MATERIALS.length) selectMaterial(i);
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { for (const k in keys) keys[k] = false; mouseDown = false; }
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
  } else if (mode === 'br') {
    aim.yaw -= e.movementX * 0.0022;
    aim.pitch -= e.movementY * 0.0022;
    aim.pitch = Math.max(-1.2, Math.min(1.2, aim.pitch));
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  initAudio();
  mouseDown = true;
  if (mode !== 'build' && mode !== 'br') return;
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }
  if (mode === 'build') {
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

// ---------- Main loop ----------
let last = performance.now();
const _size = new THREE.Vector2();
initInput();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  pollGamepad();
  keyboardToInput(keys);

  if (inputEdge('enter')) {
    if (mode === 'drive') startExitCar('foot');
    else if (mode === 'foot' && charState.pos.distanceTo(carState.pos) < 4.5) enterCar();
    else if (mode === 'foot') toast('Get closer to the car (F)');
  }
  if (inputEdge('camera') && mode === 'drive') {
    camStyle = camStyle === 'chase' ? 'cockpit' : 'chase';
    toast(camStyle === 'cockpit' ? 'Cockpit view' : 'Chase view');
  }
  if (inputEdge('build')) {
    if (mode === 'drive') startExitCar('build');
    else if (mode === 'foot') {
      const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      flyCam.yaw = e2.y; flyCam.pitch = e2.x;
      setMode('build');
      toast('Build mode');
    } else if (mode === 'build') { setMode('foot'); toast('On foot'); }
  }
  if (inputEdge('fight')) {
    if (mode === 'br') brEnd(null);
    else if (mode === 'drive') startExitCar('br');
    else if (mode === 'foot') brBegin();
  }
  if (inputEdge('reset') && mode === 'drive') {
    carState.pos.set(-150, CITY_Y, 3);
    carState.vel.set(0, 0, 0);
    carState.heading = Math.PI / 2;
    toast('Car reset');
  }
  if (inputEdge('fullscreen')) toggleFullscreen();

  if (mode === 'br') {
    aim.yaw -= input.lookDX;
    aim.pitch -= input.lookDY;
    aim.pitch = Math.max(-1.2, Math.min(1.2, aim.pitch));
  }

  renderer.getSize(_size);
  if (innerWidth > 0 && (_size.x !== innerWidth || _size.y !== innerHeight)) {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  if (mode === 'drive') { updateCar(dt); updateChaseCamera(dt); }
  else if (mode === 'exiting') {
    exitAnim.t += dt / 0.55;
    character.position.lerpVectors(exitAnim.from, exitAnim.to, Math.min(1, exitAnim.t));
    animateHumanoid(character, exitAnim.t * 9, true, false);
    updateChaseCamera(dt);
    if (exitAnim.t >= 1) finishExitCar();
  }
  else if (mode === 'foot') { updateFoot(dt, false); updateFootCamera(dt, false); }
  else if (mode === 'br') { updateFoot(dt, true); updateFootCamera(dt, true); updateBR(dt); }
  else if (mode === 'build') updateFlyCamera(dt);

  updateTraffic(dt);
  updatePeds(dt);
  updateWeather(dt);
  updatePrecip(dt);
  updateAudio(dt);
  updateDayNight(dt);
  updatePortals(dt);
  updateGarage();
  updateTracers(dt);
  for (const cl of clouds) {
    cl.position.x += 1.6 * dt;
    if (cl.position.x > 470) cl.position.x = -470;
  }
  skyGroup.position.copy(camera.position);

  const p = playerPos();
  $('biome').textContent = biomeName(p.x, p.z, p.y);
  $('zone').textContent = p.y < UW_LIMIT ? 'Underworld' : p.y > 120 ? 'Sky Realm' : 'Surface';

  drawMinimap();
  renderer.render(scene, camera);
  pressed.clear();
  inputEndFrame();
  requestAnimationFrame(tick);
}

$('traffic').textContent = aiCars.length;
setMode('drive');
camera.position.set(-160, CITY_Y + 5, 3);
requestAnimationFrame(tick);
