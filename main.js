'use strict';
// ============================================================
// main.js — simulator: home screen, car physics, cameras,
// traffic lights, dashboard, weather, day/night, portals
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

// ---------- Home screen ----------
let selectedVehicle = 'sports';
const carCardsEl = $('carCards');
for (const [key, spec] of Object.entries(VEHICLES)) {
  const card = document.createElement('div');
  card.className = 'car-card' + (key === selectedVehicle ? ' selected' : '');
  card.dataset.vehicle = key;
  card.innerHTML = `<div class="icon">${spec.icon}</div><div class="name">${spec.name}</div>
    <div class="stats">Accel: ${Math.round(spec.accel / 23 * 100)}%<br>Top: ${spec.maxSpeed} km/h<br>Grip: ${Math.round(spec.grip / 10 * 100)}%</div>`;
  card.addEventListener('click', () => {
    document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedVehicle = key;
  });
  carCardsEl.appendChild(card);
}
$('startBtn').addEventListener('click', startGame);

function startGame() {
  $('homeScreen').classList.add('hidden');
  $('dashboard').classList.add('active');
  $('hudOverlay').classList.add('active');
  $('minimap').classList.add('active');
  initAudio();
  const colors = [0xd8342c, 0x2e7fd4, 0xf2c14e, 0x2f9e44, 0xe8e6e0, 0x1a1d24, 0x1a1a4e, 0xcc2222];
  carColor = colors[Math.floor(Math.random() * colors.length)];
  swapCar(selectedVehicle, carColor);
  carState.pos.set(-150, CITY_Y, 3);
  carState.vel.set(0, 0, 0);
  carState.heading = Math.PI / 2;
  car.position.copy(carState.pos);
  mode = 'drive';
  showGuidance('Press W to accelerate — Obey traffic signs!', 4000);
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
}

// ---------- Dashboard gauges ----------
const speedCtx = $('speedCanvas').getContext('2d');
const tachCtx = $('tachCanvas').getContext('2d');
function drawGauge(ctx, value, max, color, dangerZone) {
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
  const needleA = valA;
  const nx = cx + Math.cos(needleA) * (r - 15);
  const ny = cy + Math.sin(needleA) * (r - 15);
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
  for (let i = 0; i <= 8; i++) {
    const a = startA + (range * i / 8);
    const tx = cx + Math.cos(a) * (r + 14);
    const ty = cy + Math.sin(a) * (r + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(max * i / 8), tx, ty);
  }
}
function updateDashboard() {
  const kmh = Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6;
  const maxSpeed = VEHICLES[carStyle].maxSpeed;
  drawGauge(speedCtx, kmh, maxSpeed * 1.2, '#4fc3f7', maxSpeed);
  $('speedNum').textContent = Math.round(kmh);
  const rpm = (kmh / maxSpeed) * 7000 + (input.moveZ > 0 ? 1500 : 0);
  drawGauge(tachCtx, rpm, 8000, '#66bb6a', 6500);
  $('tachNum').textContent = Math.round(rpm / 100);
  const gear = kmh < 5 ? 'N' : kmh < 20 ? '1' : kmh < 35 ? '2' : kmh < 50 ? '3' : kmh < 70 ? '4' : '5';
  $('dashGear').textContent = gear;
  $('dashRPM').textContent = Math.round(rpm);
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
}
function removeBlock(mesh) {
  scene.remove(mesh);
  blockMap.delete(mesh.userData.blockKey);
}

// ---------- Enter / exit car ----------
function startExitCar(next) {
  const from = car.localToWorld(new THREE.Vector3(-1.35, 0, 0));
  const to = car.localToWorld(new THREE.Vector3(-2.9, 0, 0.6));
  from.y = groundAt(from.x, from.z, carState.pos.y + 1);
  to.y = groundAt(to.x, to.z, carState.pos.y + 1);
  exitAnim = { t: 0, from, to, next };
  mode = 'exiting';
}
function finishExitCar() {
  exitAnim = null;
  mode = 'drive';
}

// ---------- Weather ----------
let weather = 'clear', wet = 0, snowF = 0, weatherTimer = 18;
let snowAccumLevel = 0;
function pickWeather() {
  const r = Math.random();
  if (r < 0.45) weather = 'clear';
  else if (r < 0.8) weather = 'rain';
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
  for (const g of grassTufts) {
    g.rotation.z = Math.sin(performance.now() * 0.002 + g.position.x * 0.5) * (wet > 0.1 ? 0.15 : 0.05);
  }
}

// ---------- Audio ----------
let audio = null, muted = false;
let engineOsc, engineOsc2, engineGain, engineFilter;
function initAudio() {
  if (audio !== null) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
    engineOsc2 = ctx.createOscillator(); engineOsc2.type = 'triangle';
    engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 480;
    engineGain = ctx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(engineFilter); engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain); engineGain.connect(ctx.destination);
    engineOsc.start(); engineOsc2.start();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 2);
    const hornBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const hd = hornBuf.getChannelData(0);
    for (let i = 0; i < hd.length; i++) hd[i] = Math.sin(i / ctx.sampleRate * 440 * Math.PI * 2) * 0.3 * (1 - i / hd.length);
    audio = { ctx, noiseBuf, hornBuf };
  } catch (e) { audio = false; }
}
function playHorn() {
  if (!audio || muted) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.hornBuf;
  const g = audio.ctx.createGain();
  g.gain.value = 0.15;
  src.connect(g); g.connect(audio.ctx.destination);
  src.start();
}
function updateAudio(dt) {
  if (!audio || !engineGain) return;
  const t = audio.ctx.currentTime;
  const kmh = Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6;
  const gear = Math.min(5, Math.floor(kmh / 38));
  const within = (kmh - gear * 38) / 38;
  const freq = 52 + within * 92 + gear * 7;
  engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
  engineOsc2.frequency.setTargetAtTime(freq * 1.5, t, 0.05);
  const g = (muted || mode !== 'drive') ? 0 : 0.016 + Math.min(0.05, kmh * 0.0004);
  engineGain.gain.setTargetAtTime(g, t, 0.1);
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
    tl.rMat.emissive.set(tl.state === 'red' ? 0xff2222 : 0x000000);
    tl.rMat.emissiveIntensity = tl.state === 'red' ? 1.5 : 0;
    tl.yMat.color.set(tl.state === 'yellow' ? 0xffaa00 : 0x332200);
    tl.yMat.emissive.set(tl.state === 'yellow' ? 0xffaa00 : 0x000000);
    tl.yMat.emissiveIntensity = tl.state === 'yellow' ? 1.5 : 0;
    tl.gMat.color.set(tl.state === 'green' ? 0x22ff22 : 0x003300);
    tl.gMat.emissive.set(tl.state === 'green' ? 0x22ff22 : 0x000000);
    tl.gMat.emissiveIntensity = tl.state === 'green' ? 1.5 : 0;
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
        if (vn < 0) { state.vel.x -= vn * wallNormal[0] * 1.2; state.vel.z -= vn * wallNormal[1] * 1.2; }
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
      if (vF > 0.5) vF -= 26 * (1 - slip * 0.55) * dt * Math.abs(throttle);
      else { vF -= 9 * dt * Math.abs(throttle); vF = Math.max(vF, -13); }
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
    if (!inCity(s.pos.x, s.pos.z) && s.pos.y < WATER_Y + 0.3 && s.pos.y > UW_LIMIT) vF *= 1 - 2.2 * dt;
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
    }
  }

  const g = groundAt(s.pos.x, s.pos.z, s.pos.y);
  if (s.pos.y <= g + 0.05 || (s.grounded && s.pos.y - g < 0.6 && s.vel.y <= 0)) {
    if (s.vel.y < -16) s.vel.multiplyScalar(0.6);
    s.pos.y = g; s.vel.y = 0; s.grounded = true;
  } else s.grounded = s.pos.y - g < 0.15;

  if (s.pos.y < UW_LIMIT) {
    for (const lp of lavaPools) {
      const dx = s.pos.x - lp.x, dz = s.pos.z - lp.z;
      if (dx * dx + dz * dz < lp.r * lp.r) {
        s.pos.set(0, uwFloorHeight(0, 0), 10); s.vel.set(0, 0, 0);
        toast('Vehicle recovered');
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
  car.rotateX(s.visualPitch); car.rotateZ(s.visualRoll);
  car.position.copy(s.pos);

  s.wheelSpin += (vF / spec.wheelR) * dt;
  car.userData.wheels.forEach(w => { w.rotation.x = s.wheelSpin; });
  car.userData.fronts.forEach(p => { p.rotation.y = steer * 0.42; });
  car.userData.steeringWheel.rotation.set(-0.35, 0, -steer * 1.4);

  if (car.userData.policeLightL) {
    const flash = Math.sin(performance.now() * 0.005 * 3) > 0;
    car.userData.policeLightL.material.emissiveIntensity = flash ? 2.5 : 0;
    car.userData.policeLightR.material.emissiveIntensity = flash ? 0 : 2.5;
  }
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
  camera.fov += ((60 + vF * 0.32) - camera.fov) * Math.min(1, dt * 4);
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
      carState.pos.set(d.x, y, d.z);
      carState.vel.set(0, 0, 0);
      carState.heading = d.heading;
      car.position.copy(carState.pos);
      camera.position.set(d.x - Math.sin(d.heading) * 8, y + 4, d.z - Math.cos(d.heading) * 8);
      portalCooldown = 3;
      toast('Entering: ' + pt.label);
      break;
    }
  }
}

// ---------- Headlights ----------
let headlightsOn = false;
function toggleHeadlights() {
  headlightsOn = !headlightsOn;
  toast(headlightsOn ? 'Headlights on' : 'Headlights off');
}

// ---------- Speed limit & guidance ----------
let nearestSpeedLimit = 50;
function checkSpeedGuidance() {
  const kmh = Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6;
  if (kmh > 55 && Math.random() < 0.01) showGuidance('Slow down! Speed limit is 50 km/h', 2500);
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
  const underground = false;
  const skyGray = Math.max(wet, snowF * 0.9);

  _sunDir.set(Math.cos(a), sinA, 0.32).normalize();
  sun.position.copy(carState.pos).addScaledVector(_sunDir, 190);
  sun.target.position.copy(carState.pos);
  sun.intensity = (0.1 + dayF * 1.7) * (1 - skyGray * 0.6);
  hemi.intensity = (0.15 + dayF * 0.75) * (1 - skyGray * 0.3);
  ambient.intensity = 0.12 + dayF * 0.2;
  ambient.color.copy(srgb(0xffffff));

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
  scene.fog.far = 700 - skyGray * 320;
  scene.fog.near = 90 - skyGray * 40;

  starMat.opacity = nightF * (1 - skyGray);
  moonMat.opacity = nightF * (1 - skyGray * 0.7);
  moon.position.copy(_sunDir).multiplyScalar(-780);

  const winGlow = Math.min(1.2, nightF * 1.15 + skyGray * 0.25);
  facadeMats.forEach(m => { m.emissiveIntensity = winGlow; });
  lampHeadMat.emissiveIntensity = (nightF + skyGray * 0.5) * 1.6;
  headLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8;
  tailLightMat.emissiveIntensity = nightF * 1.4 + skyGray * 0.8;
  signalMat.emissiveIntensity = 0;
  car.userData.headlight.intensity = headlightsOn ? 3 : (nightF * 2.6 + skyGray * 1.2);

  cloudMat.color.copy(srgb(0xffffff)).multiplyScalar(Math.max(0.1, 0.2 + dayF * 0.8 - skyGray * 0.4 * dayF));
  water.material.opacity = 0.8 - skyGray * 0.2 - nightF * 0.15;

  const hour = (dayT * 24 + 6) % 24;
  $('hudClock').textContent = String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.floor((hour % 1) * 60)).padStart(2, '0');
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
  for (const tl of trafficLights) {
    mmCtx.fillStyle = tl.state === 'red' ? '#ef5350' : tl.state === 'yellow' ? '#ffa726' : '#66bb6a';
    mmCtx.fillRect(S / 2 + tl.x * sc - 2, S / 2 - tl.z * sc - 2, 4, 4);
  }
  mmCtx.fillStyle = '#e0a53c';
  for (const c of aiCars) {
    mmCtx.fillRect(S / 2 + c.group.position.x * sc - 1.5, S / 2 - c.group.position.z * sc - 1.5, 3, 3);
  }
  for (const pt of portals) {
    if (pt.y < 0 || pt.y > 100) continue;
    mmCtx.fillStyle = '#b45cf0';
    mmCtx.fillRect(S / 2 + pt.x * sc - 2, S / 2 - pt.z * sc - 2, 4, 4);
  }
  const heading = carState.heading;
  const px = Math.max(5, Math.min(S - 5, S / 2 + carState.pos.x * sc));
  const py = Math.max(5, Math.min(S - 5, S / 2 - carState.pos.z * sc));
  mmCtx.save();
  mmCtx.translate(px, py);
  mmCtx.rotate(heading);
  mmCtx.fillStyle = '#4fc3f7';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -5); mmCtx.lineTo(3.5, 4); mmCtx.lineTo(-3.5, 4);
  mmCtx.closePath(); mmCtx.fill();
  mmCtx.restore();
}

// ---------- Traffic light HUD ----------
function updateTrafficLightHud() {
  const nearest = getNearestTrafficLight();
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
addEventListener('keydown', (e) => {
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
  if (mode === 'menu') return;
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused) return;
  initAudio();
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Sound off' : 'Sound on'); }
  if (e.code === 'KeyC') {
    camStyle = camStyle === 'chase' ? 'cockpit' : camStyle === 'cockpit' ? 'top' : 'chase';
    toast(camStyle === 'cockpit' ? 'Cockpit view' : camStyle === 'top' ? 'Top view' : 'Chase view');
  }
  if (e.code === 'KeyF') toggleHeadlights();
  if (e.code === 'KeyH') playHorn();
  if (e.code === 'KeyR' && mode === 'drive') {
    carState.pos.set(-150, CITY_Y, 3);
    carState.vel.set(0, 0, 0);
    carState.heading = Math.PI / 2;
    car.position.copy(carState.pos);
    toast('Vehicle reset');
  }
  if (e.code === 'KeyB') {
    if (mode === 'drive') {
      const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      flyCam.yaw = e2.y; flyCam.pitch = e2.x;
      mode = 'build';
    } else if (mode === 'build') { mode = 'drive'; }
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

// ---------- Touch input ----------
const isTouchDevice = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
if (isTouchDevice) document.body.classList.add('touch-device');

// ---------- Main loop ----------
let last = performance.now();
const _size = new THREE.Vector2();
if (typeof initInput === 'function') initInput();

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (typeof pollGamepad === 'function') pollGamepad();
  if (typeof keyboardToInput === 'function') keyboardToInput(keys);

  if (mode !== 'menu' && !paused) {
    if (mode === 'drive' || mode === 'exiting') {
      updateCar(dt);
      updateChaseCamera(dt);
    } else if (mode === 'build') {
      updateFlyCamera(dt);
    }
    if (exitAnim) {
      exitAnim.t += dt / 0.55;
      if (exitAnim.t >= 1) finishExitCar();
    }
    updateTraffic(dt);
    updatePeds(dt);
    updateTrafficLights(dt);
    updateWeather(dt);
    updatePrecip(dt);
    updateAudio(dt);
    updateDayNight(dt);
    updatePortals(dt);
    updateGuidance(dt);
    updateTrafficLightHud();
    checkSpeedGuidance();
    for (const cl of clouds) {
      cl.position.x += 1.6 * dt;
      if (cl.position.x > 470) cl.position.x = -470;
    }
    skyGroup.position.copy(camera.position);

    if (mode === 'drive') updateDashboard();

    const p = playerPos();
    $('hudBiome').textContent = biomeName(p.x, p.z, p.y);
    $('hudZone').textContent = p.y < UW_LIMIT ? 'Underworld' : p.y > 120 ? 'Sky Realm' : 'City Center';

    drawMinimap();
  }

  renderer.render(scene, camera);
  pressed.clear();
  if (typeof inputEndFrame === 'function') inputEndFrame();
  requestAnimationFrame(tick);
}

setInterval(() => {
  const kmh = Math.abs(carState.vel.dot(_fwd2(carState.heading))) * 3.6;
  $('speedLimit').classList.toggle('active', mode === 'drive' && kmh > 2);
}, 500);

requestAnimationFrame(tick);
