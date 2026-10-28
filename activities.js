'use strict';
// ============================================================
// activities.js — arcade scoring (drift / near miss / air /
// smash combos), collectibles, speed traps, races, deliveries,
// police escapes, tyre effects
// ============================================================

// ---------- Helpers ----------
function emojiTexture(emoji, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size || 128;
  const g = cv.getContext('2d');
  g.font = Math.round(cv.width * 0.78) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, cv.width / 2, cv.height / 2 + cv.width * 0.06);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function labelSprite(text, color, width) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,14,22,0.78)';
  g.beginPath();
  if (g.roundRect) g.roundRect(8, 16, 496, 96, 28); else g.rect(8, 16, 496, 96);
  g.fill();
  g.strokeStyle = color || '#4fc3f7'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 50px "Segoe UI",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66, 470);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  const w = width || 10;
  sp.scale.set(w, w / 4, 1);
  return sp;
}
const glowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
function makeMarker(color, label) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 4.2, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 48, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 24;
  g.add(ring, beam);
  if (label) { const sp = labelSprite(label, '#' + new THREE.Color(color).getHexString(), 11); sp.position.y = 6.5; g.add(sp); g.userData.label = sp; }
  g.userData.ring = ring; g.userData.beam = beam;
  scene.add(g);
  return g;
}
function groundY(x, z) { return inCity(x, z) ? CITY_Y : terrainHeight(x, z); }
function carSpeed() { return Math.hypot(carState.vel.x, carState.vel.z); }
function carNear(x, z, r) { return Math.hypot(carState.pos.x - x, carState.pos.z - z) < r; }
function playing() { return mode === 'drive' && !paused; }

// ---------- Combo / trick system ----------
const combo = { pts: 0, mult: 1, tricks: 0, timer: 0, label: '' };
const COMBO_WINDOW = 4;
let nitro = 1;
function nitroCap() { return 1 + (VEHICLES[carStyle].nitroBonus || 0); }
function addTrick(label, base) {
  if (mode !== 'drive') return;
  const pts = Math.round(base * combo.mult);
  combo.pts += pts; combo.tricks++;
  combo.mult = Math.min(15, 1 + combo.tricks);
  combo.timer = COMBO_WINDOW;
  combo.label = label;
  maxStat('bestCombo', combo.mult);
  nitro = Math.min(nitroCap(), nitro + 0.1);
  popup(label + '  +' + fmtNum(pts), 'trick');
  sfx('trick');
}
function bankCombo() {
  const pts = combo.pts;
  if (pts > 0) {
    maxStat('bestComboScore', pts);
    dailyEvent('combo', pts);
    earn(pts / 10, pts / 5, combo.tricks > 1 ? 'COMBO x' + combo.mult : combo.label);
    sfx('bank');
  }
  combo.pts = 0; combo.mult = 1; combo.tricks = 0; combo.timer = 0;
}
function loseCombo(reason) {
  if (combo.pts > 0 || stunt.driftPts > 300) { popup('COMBO LOST · ' + reason, 'lost'); sfx('fail'); }
  combo.pts = 0; combo.mult = 1; combo.tricks = 0; combo.timer = 0;
  stunt.drifting = false; stunt.driftPts = 0;
}
let camShake = 0;
function onCrash(impact) {
  camShake = Math.min(1, camShake + impact * 0.03);
  if (impact > 9) { sfx('crash', Math.min(1, impact / 25)); loseCombo('CRASH'); }
}

// ---------- Stunt detection ----------
const stunt = { drifting: false, driftPts: 0, driftIdle: 0, airborne: false, airT: 0, rampId: -1, lastRamp: null };
let kmAccum = 0, speedReported = 0;
function finishDrift() {
  const raw = stunt.driftPts;
  stunt.drifting = false; stunt.driftPts = 0;
  if (raw < 150) return;
  maxStat('bestDrift', raw);
  addStat('totalDrift', raw);
  dailyEvent('drift', raw);
  addTrick('DRIFT', raw);
}
function land() {
  const t = stunt.airT;
  stunt.airborne = false;
  if (t < 0.6) return;
  camShake = Math.min(1, camShake + t * 0.25);
  maxStat('bestAir', t);
  addStat('totalAir', t);
  dailyEvent('air', t);
  addTrick('AIR ' + t.toFixed(1) + 's', t * 450);
  const r = stunt.rampId >= 0 ? ramps[stunt.rampId] : null;
  if (r && t > 0.7) {
    addStat('stuntJumps', 1);
    if (!save.jumps[r.id]) {
      save.jumps[r.id] = true;
      markDirty();
      showBanner('STUNT JUMP', r.name + ' · ' + Object.keys(save.jumps).length + '/' + ramps.length + ' cleared');
      earn(500, 200);
      sfx('star');
    }
  }
}
function updateStunts(dt) {
  const s = carState;
  if (mode !== 'drive') { stunt.airborne = false; return; }
  const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
  const vS = s.vel.x * fz - s.vel.z * fx;
  const speed = carSpeed(), kmh = speed * 3.6;
  const spec = VEHICLES[carStyle];

  // distance & environment stats
  const d = speed * dt;
  addStat('distance', d);
  addStat('playTime', dt);
  if (typeof isNight !== 'undefined' && isNight) addStat('nightDist', d);
  if (weather === 'snow') addStat('snowDist', d);
  kmAccum += d;
  if (kmAccum >= 100) { kmAccum -= 100; dailyEvent('km', 0.1); }
  if (maxStat('topSpeed', kmh) && kmh > speedReported + 2) { speedReported = kmh; dailyEvent('speed', kmh); }

  // drift
  if (s.grounded && Math.abs(vS) > 3 && speed > 9) {
    stunt.driftPts += (Math.abs(vS) * 8 + speed * 1.2) * 10 * dt * (1 + (spec.driftBonus || 0));
    stunt.drifting = true; stunt.driftIdle = 0;
    if (combo.timer > 0) combo.timer = COMBO_WINDOW;
    emitSkid(dt, true);
  } else {
    if (s.grounded && input.brake && speed > 6) emitSkid(dt, false);
    if (stunt.drifting) { stunt.driftIdle += dt; if (stunt.driftIdle > 0.6) finishDrift(); }
  }

  // air
  if (!s.grounded) {
    if (!stunt.airborne) { stunt.airborne = true; stunt.airT = 0; stunt.rampId = stunt.lastRamp ? stunt.lastRamp.id : -1; }
    stunt.airT += dt;
  } else {
    if (stunt.airborne) land();
    stunt.lastRamp = rampUnder(s.pos.x, s.pos.z, s.pos.y);
  }

  // near misses (traffic and police)
  const scan = (c, cop) => {
    const dd = Math.hypot(c.group.position.x - s.pos.x, c.group.position.z - s.pos.z);
    if (dd < 9 && Math.abs(s.pos.y - CITY_Y) < 3) {
      if (!c._nm) c._nm = { min: dd, spd: 0, hit: false };
      c._nm.min = Math.min(c._nm.min, dd);
      c._nm.spd = Math.max(c._nm.spd, speed);
      if (dd < 2.9) c._nm.hit = true;
    } else if (c._nm) {
      if (!c._nm.hit && c._nm.min < 4.6 && c._nm.spd > 14) {
        addStat('nearMisses', 1);
        dailyEvent('nearMiss', 1);
        addTrick(cop ? 'COP NEAR MISS' : 'NEAR MISS', cop ? 400 : 250);
        sfx('whoosh');
      }
      c._nm = null;
    }
  };
  for (const c of aiCars) scan(c, false);
  for (const c of copCars) if (c.active) scan(c, true);

  // combo timer
  if (combo.pts > 0 && !stunt.drifting && !stunt.airborne) {
    combo.timer -= dt;
    if (combo.timer <= 0) bankCombo();
  }

  // nitro trickle refill
  nitro = Math.min(nitroCap(), nitro + dt * 0.035);
}

// ---------- Smashable street props ----------
const props = [];
function fitHeight(wrap, h) {
  const sz = wrap.userData.size;
  wrap.scale.setScalar(h / Math.max(0.01, sz.y));
  return wrap;
}
function buildPropMesh(kind) {
  if (kind === 'cone' && modelCache.cone) return fitHeight(instanceModel('cone', 1, 0), 0.85);
  if (kind === 'crate' && modelCache.box) return fitHeight(instanceModel('box', 1, Math.random() * Math.PI), 1.0);
  const g = new THREE.Group();
  if (kind === 'cone') {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 10), lambert(0xff6a00));
    c.position.y = 0.4; c.castShadow = true; g.add(c);
  } else if (kind === 'crate') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), lambert(0x9a6b3f));
    b.position.y = 0.45; b.castShadow = true; g.add(b);
  } else if (kind === 'hydrant') {
    const m = standard(0xd32f2f, 0.5, 0.2);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.7, 10), m);
    body.position.y = 0.35;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
    cap.position.y = 0.7;
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), m);
    nub.rotation.z = Math.PI / 2; nub.position.y = 0.45;
    body.castShadow = true;
    g.add(body, cap, nub);
  } else {
    const m = lambert(0x2f6e45);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.27, 0.95, 12), m);
    bin.position.y = 0.48; bin.castShadow = true;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 12), lambert(0x24262a));
    lid.position.y = 0.99;
    g.add(bin, lid);
  }
  return g;
}
function addProp(kind, x, z) {
  const mesh = buildPropMesh(kind);
  const y = groundY(x, z) + (inCity(x, z) ? 0.0 : 0);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  props.push({ kind, mesh, x, z, y, r: kind === 'crate' ? 0.7 : 0.45, mass: kind === 'hydrant' ? 3 : kind === 'crate' ? 2 : 1,
    state: 'idle', t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
}
function buildProps() {
  const rnd = seededRand('realmdrive-props');
  const kinds = ['cone', 'cone', 'crate', 'hydrant', 'bin'];
  let n = 0, tries = 0;
  while (n < 110 && tries < 2000) {
    tries++;
    const L = ROADS[Math.floor(rnd() * ROADS.length)];
    const sPos = (rnd() - 0.5) * 350;
    const nearI = ROADS.some(r => Math.abs(sPos - r) < 10);
    if (nearI) continue;
    const off = (rnd() < 0.5 ? -1 : 1) * 6.4;
    const alongX = rnd() < 0.5;
    const x = alongX ? sPos : L + off, z = alongX ? L + off : sPos;
    if (ramps.some(r => Math.hypot(x - r.x, z - r.z) < r.len)) continue;
    addProp(kinds[Math.floor(rnd() * kinds.length)], x, z);
    n++;
  }
  // a playground of cones and crates around the Stunt Park
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2, d = 14 + rnd() * 30;
    const x = STUNT_PARK.x + 10 + Math.cos(a) * d, z = STUNT_PARK.z + Math.sin(a) * d;
    if (ramps.some(r => Math.hypot(x - r.x, z - r.z) < r.len / 2 + 3)) continue;
    addProp(rnd() < 0.6 ? 'cone' : 'crate', x, z);
  }
}
onModelsReady(buildProps);
function smashProp(p, speed) {
  const s = carState;
  const spec = VEHICLES[carStyle];
  p.state = 'flying'; p.t = 0;
  p.vel.set(s.vel.x * (1.1 + Math.random() * 0.4) + (Math.random() - 0.5) * 4,
            3 + speed * 0.22 + Math.random() * 2,
            s.vel.z * (1.1 + Math.random() * 0.4) + (Math.random() - 0.5) * 4);
  p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
  s.vel.multiplyScalar(1 - Math.min(0.25, p.mass * 0.035 / spec.weight));
  addStat('smashed', 1);
  dailyEvent('smash', 1);
  addTrick('SMASH', 60 * (1 + (spec.smashBonus || 0)));
  sfx('smash');
}
function updateProps(dt) {
  const s = carState, speed = carSpeed();
  for (const p of props) {
    if (p.state === 'idle') {
      const dx = s.pos.x - p.x, dz = s.pos.z - p.z;
      if (Math.abs(dx) < 3.5 && Math.abs(dz) < 3.5 && Math.abs(s.pos.y - p.y) < 2.2 && mode === 'drive') {
        if (Math.hypot(dx, dz) < p.r + 1.25 && speed > 2.5) smashProp(p, speed);
      }
      continue;
    }
    p.t += dt;
    if (p.state === 'flying') {
      p.vel.y -= 20 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
      const gy = groundY(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < gy) {
        p.mesh.position.y = gy;
        p.vel.y = Math.abs(p.vel.y) * 0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin.multiplyScalar(0.5);
        if (Math.abs(p.vel.y) < 1.2 && p.t > 0.6) { p.state = 'down'; p.t = 0; }
      }
    } else if (p.state === 'down' && p.t > 45 && !carNear(p.x, p.z, 40)) {
      p.state = 'idle';
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    }
  }
}

// ---------- Hidden stars ----------
const hiddenStars = [];
const hiddenStarGeo = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.45 : 1;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  g.center();
  return g;
})();
const hiddenStarMat = new THREE.MeshStandardMaterial({ color: srgb(0xffd54a), emissive: srgb(0xffb300), emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 });
function starSpots() {
  const rnd = seededRand('realmdrive-stars-v1');
  const spots = [];
  // street level, tucked against the kerbs
  while (spots.length < 12) {
    const L = ROADS[Math.floor(rnd() * ROADS.length)];
    const sPos = (rnd() - 0.5) * 340;
    if (ROADS.some(r => Math.abs(sPos - r) < 9)) continue;
    const off = (rnd() < 0.5 ? -1 : 1) * 5.2, alongX = rnd() < 0.5;
    const x = alongX ? sPos : L + off, z = alongX ? L + off : sPos;
    if (ramps.some(r => Math.hypot(x - r.x, z - r.z) < r.len)) continue;
    spots.push({ x, z, y: CITY_Y + 1.3, hint: 'street' });
  }
  // mid-air above every ramp — only reachable by jumping
  for (const r of ramps) {
    const ahead = r.hgt > 5 ? 18 : r.hgt > 2.5 ? 11 : 9;
    const lift = r.hgt > 5 ? 4 : 2.2;
    spots.push({ x: r.lipX + r.sin * ahead, z: r.lipZ + r.cos * ahead, y: r.base + r.hgt + lift, hint: 'air' });
  }
  // countryside exploration
  let guard = 0;
  while (spots.length < 36 && guard++ < 5000) {
    const a = rnd() * Math.PI * 2, d = 260 + rnd() * 1000;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = terrainHeight(x, z);
    if (h < 1.3 || nearRamp(x, z, 20)) continue;
    spots.push({ x, z, y: h + 1.4, hint: 'wild' });
  }
  // the far edges of the map
  for (const [cx, cz] of [[1300, 1300], [-1300, 1300], [1300, -1300], [-1300, -1300]]) {
    let best = null;
    for (let i = 0; i < 400; i++) {
      const x = cx + (rnd() - 0.5) * 300, z = cz + (rnd() - 0.5) * 300, h = terrainHeight(x, z);
      if (h > 1.3 && (!best || h > best.h)) best = { x, z, h };
    }
    if (best) spots.push({ x: best.x, z: best.z, y: best.h + 1.4, hint: 'edge' });
  }
  return spots;
}
{
  starSpots().forEach((sp, id) => {
    const st = { id, x: sp.x, y: sp.y, z: sp.z, found: !!save.stars[id], mesh: null };
    if (!st.found) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(hiddenStarGeo, hiddenStarMat);
      m.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd54a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(4.5, 4.5, 1);
      g.add(m, glow);
      g.position.set(sp.x, sp.y, sp.z);
      g.userData.spin = m;
      scene.add(g);
      st.mesh = g;
    }
    hiddenStars.push(st);
  });
}
function starsFound() { return Object.keys(save.stars).length; }

// ---------- Cash bags ----------
const cashBags = [];
{
  const rnd = seededRand('realmdrive-bags');
  const tex = emojiTexture('💰');
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  let guard = 0;
  while (cashBags.length < 28 && guard++ < 2000) {
    let x, z;
    if (cashBags.length < 20) {
      const L = ROADS[Math.floor(rnd() * ROADS.length)];
      const sPos = (rnd() - 0.5) * 340, off = (rnd() - 0.5) * 8, alongX = rnd() < 0.5;
      x = alongX ? sPos : L + off; z = alongX ? L + off : sPos;
    } else {
      const a = rnd() * Math.PI * 2, d = 220 + rnd() * 260;
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (terrainHeight(x, z) < 1.2) continue;
    }
    if (nearRamp(x, z, 4)) continue;
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.2, 2.2, 1);
    const y = groundY(x, z) + 1.4;
    sp.position.set(x, y, z);
    scene.add(sp);
    cashBags.push({ x, y, z, mesh: sp, value: 40 + Math.floor(rnd() * 110), respawn: 0 });
  }
}

// ---------- Speed traps ----------
const SPEED_TRAPS = [
  { id: 'harbor', name: 'Harbor Straight', x: -30, z: -180 },
  { id: 'north', name: 'North Ave', x: 0, z: 150 },
  { id: 'east', name: 'East Ring', x: 180, z: -30 },
];
SPEED_TRAPS.forEach(t => {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 8), lambert(0x24262a));
  const ox = t.x === 180 ? 7.5 : 0, oz = t.x === 180 ? 0 : 7.5;
  pole.position.set(t.x + ox, CITY_Y + 2.5, t.z + oz);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.8), lambert(0xf2c14e));
  cam.position.set(t.x + ox, CITY_Y + 5, t.z + oz);
  const sp = labelSprite('📸 SPEED TRAP', '#f2c14e', 8);
  sp.position.set(t.x + ox, CITY_Y + 7, t.z + oz);
  scene.add(pole, cam, sp);
  t.cool = 0;
});
function updateSpeedTraps(dt) {
  const kmh = carSpeed() * 3.6;
  for (const t of SPEED_TRAPS) {
    t.cool -= dt;
    if (t.cool > 0 || !carNear(t.x, t.z, 7) || Math.abs(carState.pos.y - CITY_Y) > 4) continue;
    t.cool = 3;
    if (kmh < 40) continue;
    const best = save.traps[t.id] || 0;
    sfx('camera');
    if (kmh > best) {
      save.traps[t.id] = Math.round(kmh);
      markDirty();
      showBanner('SPEED TRAP · ' + Math.round(kmh) + ' km/h', t.name + (best ? ' · new record (was ' + best + ')' : ' · first record'));
      earn(Math.round(kmh * 2), Math.round(kmh));
    } else popup('📸 ' + Math.round(kmh) + ' km/h · best ' + best, 'info');
    if (kmh > 100) addTrick('SPEED TRAP', kmh * 3);
  }
}

// ---------- Activities: races & deliveries ----------
const RACES = [
  { id: 'downtown', name: 'Downtown Dash', icon: '🏙️', start: [-100, 3], heading: Math.PI / 2, pace: 1, reward: 1,
    cps: [[60, 0], [60, -60], [-120, -60], [-120, 0], [-100, 0]] },
  { id: 'ring', name: 'Ring Road Sprint', icon: '🛣️', start: [0, -177], heading: Math.PI / 2, pace: 1.05, reward: 1.6,
    cps: [[180, -180], [180, 180], [-180, 180], [-180, -180], [0, -180]] },
  { id: 'rally', name: 'Countryside Rally', icon: '🌄', start: [-176, 60], heading: -Math.PI / 2, pace: 0.8, reward: 1.8,
    cps: [[-244, 151], [-269, 237], [-322, 314], [-371, 423], [-337, 514], [-243, 598]] },
];
RACES.forEach(r => {
  let len = 0, prev = r.start;
  for (const c of r.cps) { len += Math.hypot(c[0] - prev[0], c[1] - prev[1]); prev = c; }
  r.len = len;
  r.medals = [len / (15 * r.pace) + 8, len / (21 * r.pace) + 6, len / (27 * r.pace) + 5];  // bronze, silver, gold
  r.medals = r.medals.map(t => Math.round(t));
  r.marker = makeMarker(0xffffff, '🏁 ' + r.name);
  r.marker.position.set(r.start[0], groundY(r.start[0], r.start[1]), r.start[1]);
});
const MEDALS = ['', '🥉 Bronze', '🥈 Silver', '🥇 Gold'];
const DEPOTS = [[-128, -4], [-30, 64], [124, -150], [30, -176]];
const depotMarkers = DEPOTS.map(([x, z]) => {
  const m = makeMarker(0xf2c14e, '📦 Delivery Jobs');
  m.position.set(x, CITY_Y, z);
  return m;
});
const STREETS = ['Maple Ave', 'Oak St', 'Harbor Rd', 'Elm St', 'Pine Blvd', 'Cedar Ln', 'Market St', 'Sunset Dr',
  'Lakeview Rd', 'Bay St', 'Hill St', 'Union Ave', 'Birch Way', 'Station Rd'];
const CARGO = ['pizza 🍕', 'flowers 💐', 'a mystery box 📦', 'birthday cake 🎂', 'sneakers 👟', 'a guitar 🎸',
  'groceries 🛒', 'a puppy 🐶 (handle with care!)', 'tacos 🌮', 'a new phone 📱', 'concert tickets 🎟️'];

let activity = null;
const gate = (() => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.45, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.9 }));
  ring.position.y = 6;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 30;
  g.add(ring, beam);
  g.visible = false;
  g.userData.ring = ring; g.userData.beam = beam;
  scene.add(g);
  return g;
})();
const dropMarker = makeMarker(0x66bb6a, '');
dropMarker.visible = false;

function placeCar(x, z, heading) {
  const s = carState;
  s.pos.set(x, groundAt(x, z, 50), z);
  s.vel.set(0, 0, 0);
  s.heading = heading;
  car.position.copy(s.pos);
  car.rotation.set(0, heading, 0);
}
function controlsLocked() { return !!(activity && activity.type === 'race' && activity.state === 'countdown'); }

function startRace(r) {
  bankCombo();
  activity = { type: 'race', race: r, state: 'countdown', t: 3.5, cp: 0, time: 0, lastBeep: 4 };
  placeCar(r.start[0], r.start[1], r.heading);
  setGate(r, 0);
  toast(r.name + ' — gold ' + fmtTime(r.medals[2]));
}
function setGate(r, i) {
  const p = r.cps[i], prev = i === 0 ? r.start : r.cps[i - 1];
  const last = i === r.cps.length - 1;
  gate.visible = true;
  gate.position.set(p[0], groundY(p[0], p[1]), p[1]);
  gate.rotation.y = Math.atan2(p[0] - prev[0], p[1] - prev[1]);
  const col = last ? 0xffd54a : 0x4fc3f7;
  gate.userData.ring.material.color.set(col);
  gate.userData.beam.material.color.set(col);
}
function finishRace() {
  const a = activity, r = a.race, t = a.time;
  activity = null; gate.visible = false;
  disarmNearbyMarkers();
  const rec = save.races[r.id] || { best: null, medal: 0 };
  const medal = t <= r.medals[2] ? 3 : t <= r.medals[1] ? 2 : t <= r.medals[0] ? 1 : 0;
  const newBest = rec.best == null || t < rec.best;
  const firstGold = medal === 3 && rec.medal < 3;
  if (newBest) rec.best = t;
  rec.medal = Math.max(rec.medal, medal);
  save.races[r.id] = rec;
  addStat('racesFinished', 1);
  dailyEvent('race', 1);
  const pay = [300, 600, 1000, 1600][medal] * r.reward + (firstGold ? 1500 : 0);
  showBanner(medal ? MEDALS[medal] : 'FINISHED', r.name + ' · ' + fmtTime(t) + (newBest ? ' · NEW BEST!' : ' · best ' + fmtTime(rec.best)), medal === 3 ? 'gold' : '');
  earn(pay, pay / 2);
  sfx(medal >= 2 ? 'levelup' : 'bank');
  markDirty(); persist();
  checkAchievements();
}

function startDelivery(fromX, fromZ, streak) {
  let dest = null;
  for (let i = 0; i < 60 && !dest; i++) {
    const L = ROADS[Math.floor(Math.random() * ROADS.length)];
    const sPos = (Math.random() - 0.5) * 340;
    if (ROADS.some(r => Math.abs(sPos - r) < 12)) continue;
    const off = (Math.random() < 0.5 ? -1 : 1) * 4.5, alongX = Math.random() < 0.5;
    const x = alongX ? sPos : L + off, z = alongX ? L + off : sPos;
    const d = Math.hypot(x - fromX, z - fromZ);
    if (d > 130 && d < 380 && !ramps.some(r => Math.hypot(x - r.x, z - r.z) < 12)) dest = { x, z, d };
  }
  if (!dest) return;
  const addr = (10 + Math.floor(Math.random() * 890)) + ' ' + STREETS[Math.floor(Math.random() * STREETS.length)];
  const cargo = CARGO[Math.floor(Math.random() * CARGO.length)];
  const time = Math.round(dest.d / 14 + 14);
  activity = { type: 'delivery', dest, addr, cargo, timer: time, total: time, streak, from: [fromX, fromZ] };
  dropMarker.visible = true;
  dropMarker.position.set(dest.x, CITY_Y, dest.z);
  if (dropMarker.userData.label) dropMarker.remove(dropMarker.userData.label);
  const lbl = labelSprite('📍 ' + addr, '#66bb6a', 10);
  lbl.position.y = 6.5;
  dropMarker.add(lbl); dropMarker.userData.label = lbl;
  showBanner(streak > 1 ? 'NEXT DROP · STREAK x' + streak : 'DELIVERY JOB', 'Take ' + cargo + ' to ' + addr + ' · ' + time + 's');
  sfx('beep');
}
function finishDelivery() {
  const a = activity, spec = VEHICLES[carStyle];
  const streakMult = Math.min(2.5, 1 + 0.25 * (a.streak - 1));
  const pay = (150 + a.dest.d * 0.9 + a.timer * 8) * streakMult * (1 + (spec.deliveryBonus || 0));
  addStat('deliveries', 1);
  maxStat('bestDeliveryStreak', a.streak);
  dailyEvent('delivery', 1);
  earn(pay, 80 + a.dest.d * 0.3, 'DELIVERED' + (a.streak > 1 ? ' x' + a.streak : ''));
  sfx('bank');
  checkAchievements();
  activity = null; dropMarker.visible = false;
  startDelivery(a.dest.x, a.dest.z, a.streak + 1);
}
function abortActivity(reason) {
  if (!activity) return;
  if (reason) popup((activity.type === 'race' ? 'Race' : 'Delivery') + ' ended · ' + reason, 'lost');
  activity = null;
  disarmNearbyMarkers();
  gate.visible = false; dropMarker.visible = false;
}

// Markers re-arm once you drive away, so finishing on a start ring doesn't relaunch it
const depotArmed = DEPOTS.map(() => true);
function rearmMarkers() {
  RACES.forEach(r => { if (!r.armed && !carNear(r.start[0], r.start[1], 14)) r.armed = true; });
  DEPOTS.forEach(([x, z], i) => { if (!depotArmed[i] && !carNear(x, z, 14)) depotArmed[i] = true; });
}
function disarmNearbyMarkers() {
  RACES.forEach(r => { if (carNear(r.start[0], r.start[1], 14)) r.armed = false; });
  DEPOTS.forEach(([x, z], i) => { if (carNear(x, z, 14)) depotArmed[i] = false; });
}
function updateActivity(dt) {
  const s = carState, speed = carSpeed();
  rearmMarkers();
  if (!activity) {
    if (mode !== 'drive' || bustedTimer > 0) return;
    for (const r of RACES) {
      if (r.armed === false) continue;
      if (carNear(r.start[0], r.start[1], 5) && speed < 9) { r.armed = false; startRace(r); return; }
      if (carNear(r.start[0], r.start[1], 30) && guidanceTimer <= 0) {
        const rec = save.races[r.id];
        showGuidance('🏁 ' + r.name + ' — roll into the ring to start' + (rec && rec.best ? ' · best ' + fmtTime(rec.best) : ''), 1500);
      }
    }
    for (let i = 0; i < DEPOTS.length; i++) {
      const [x, z] = DEPOTS[i];
      if (!depotArmed[i]) continue;
      if (carNear(x, z, 5) && speed < 12) { depotArmed[i] = false; startDelivery(x, z, 1); return; }
      if (carNear(x, z, 25) && guidanceTimer <= 0) showGuidance('📦 Delivery jobs — drive into the ring', 1500);
    }
    return;
  }
  if (activity.type === 'race') {
    const a = activity, r = a.race;
    if (a.state === 'countdown') {
      a.t -= dt;
      s.vel.set(0, 0, 0);
      const n = Math.ceil(a.t - 0.5);
      if (n < a.lastBeep && n >= 1) { a.lastBeep = n; sfx('beep'); showCountdown(String(n)); }
      if (a.t <= 0.5) { a.state = 'racing'; sfx('go'); showCountdown('GO!'); }
      return;
    }
    a.time += dt;
    const p = r.cps[a.cp];
    if (carNear(p[0], p[1], 10)) {
      a.cp++;
      if (a.cp >= r.cps.length) { finishRace(); return; }
      sfx('checkpoint');
      setGate(r, a.cp);
    }
    if (a.time > r.medals[0] * 2.5) abortActivity('out of time');
  } else if (activity.type === 'delivery') {
    const a = activity;
    a.timer -= dt;
    if (carNear(a.dest.x, a.dest.z, 6.5) && speed < 11) { finishDelivery(); return; }
    if (a.timer <= 0) {
      showBanner('TOO LATE!', 'The customer gave up waiting · streak lost', 'fail');
      sfx('fail');
      abortActivity();
    }
  }
}
function activityTarget() {
  if (!activity) return null;
  if (activity.type === 'race') {
    if (activity.state === 'countdown') return null;
    const p = activity.race.cps[activity.cp];
    return { x: p[0], z: p[1] };
  }
  return { x: activity.dest.x, z: activity.dest.z };
}

// ---------- Police chase escapes ----------
const chase = { active: false, max: 0, pulledAt: -99 };
function onPulledOver() { chase.pulledAt = performance.now() / 1000; }
function onBusted() {
  chase.active = false; chase.max = 0;
  addStat('busted', 1);
  loseCombo('BUSTED');
  abortActivity('busted');
}
function onPlaneTakeoff() { addStat('planeFlights', 1); checkAchievements(); }
function updateChase() {
  if (wantedLevel > 0) { chase.active = true; chase.max = Math.max(chase.max, wantedLevel); return; }
  if (!chase.active) return;
  chase.active = false;
  const recentlyPulled = performance.now() / 1000 - chase.pulledAt < 2;
  if (bustedTimer <= 0 && !recentlyPulled) {
    const m = chase.max;
    addStat('escapes', 1);
    maxStat('bestEscape', m);
    dailyEvent('escape', 1);
    showBanner('ESCAPED!', 'You lost the cops at ' + m + '★');
    earn(Math.round(250 * Math.pow(m, 1.3)), 120 * m);
    sfx('levelup');
    checkAchievements();
  }
  chase.max = 0;
}

// ---------- Tyre marks & smoke ----------
const SKID_N = 700;
const skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.7).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_N);
skidMesh.frustumCulled = false;
{
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SKID_N; i++) skidMesh.setMatrixAt(i, zero);
}
scene.add(skidMesh);
let skidIdx = 0, skidT = 0;
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _sp = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), _yAxis = new THREE.Vector3(0, 1, 0);
const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xd8dde3, transparent: true, opacity: 0, depthWrite: false });
const smoke = [];
for (let i = 0; i < 36; i++) {
  const sp = new THREE.Sprite(smokeMat.clone());
  sp.visible = false;
  scene.add(sp);
  smoke.push({ sp, life: 0 });
}
let smokeIdx = 0;
function emitSkid(dt, withSmoke) {
  skidT += dt;
  if (skidT < 0.025) return;
  skidT = 0;
  const size = car.userData.size || new THREE.Vector3(2, 1.3, 4.4);
  const offs = VEHICLES[carStyle].proc === 'motorcycle' ? [0] : [-size.x * 0.36, size.x * 0.36];
  _sq.setFromAxisAngle(_yAxis, carState.heading);
  for (const ox of offs) {
    _sp.set(ox, 0, -size.z * 0.32);
    car.localToWorld(_sp);
    _sp.y = groundAt(_sp.x, _sp.z, carState.pos.y + 0.5) + 0.03;
    _sm.compose(_sp, _sq, _ss);
    skidMesh.setMatrixAt(skidIdx, _sm);
    skidIdx = (skidIdx + 1) % SKID_N;
    if (withSmoke) {
      const p = smoke[smokeIdx];
      smokeIdx = (smokeIdx + 1) % smoke.length;
      p.life = 1; p.sp.visible = true;
      p.sp.position.set(_sp.x, _sp.y + 0.4, _sp.z);
      p.sp.scale.set(1, 1, 1);
    }
  }
  skidMesh.instanceMatrix.needsUpdate = true;
}
function updateSmoke(dt) {
  for (const p of smoke) {
    if (p.life <= 0) continue;
    p.life -= dt * 0.9;
    if (p.life <= 0) { p.sp.visible = false; continue; }
    p.sp.position.y += dt * 1.2;
    const s = 1 + (1 - p.life) * 4;
    p.sp.scale.set(s, s, 1);
    p.sp.material.opacity = p.life * 0.35;
  }
}

// ---------- Collectible updates ----------
const _carCenter = new THREE.Vector3();
function updateCollectibles(dt) {
  const t = performance.now() * 0.001;
  _carCenter.set(carState.pos.x, carState.pos.y + 0.8, carState.pos.z);
  for (const st of hiddenStars) {
    if (st.found || !st.mesh) continue;
    const dx = st.x - _carCenter.x, dz = st.z - _carCenter.z;
    if (Math.abs(dx) > 160 || Math.abs(dz) > 160) { st.mesh.visible = false; continue; }
    st.mesh.visible = true;
    st.mesh.userData.spin.rotation.y = t * 2.2;
    st.mesh.position.y = st.y + Math.sin(t * 2 + st.id) * 0.25;
    if (mode !== 'drive' && mode !== 'fly') continue;
    if (Math.hypot(dx, st.mesh.position.y - _carCenter.y, dz) < 3.4) {
      st.found = true;
      save.stars[st.id] = Date.now();
      scene.remove(st.mesh);
      markDirty(); persist();
      showBanner('⭐ HIDDEN STAR', starsFound() + ' / ' + hiddenStars.length + ' found', 'gold');
      earn(250, 120);
      sfx('star');
      dailyEvent('star', 1);
      checkAchievements();
    }
  }
  for (const b of cashBags) {
    if (b.respawn > 0) { b.respawn -= dt; if (b.respawn <= 0) b.mesh.visible = true; continue; }
    b.mesh.position.y = b.y + Math.sin(t * 3 + b.x) * 0.2;
    if (mode !== 'drive') continue;
    if (Math.abs(b.x - carState.pos.x) < 3 && Math.abs(b.z - carState.pos.z) < 3 && Math.abs(b.y - _carCenter.y) < 3) {
      b.mesh.visible = false; b.respawn = 75;
      addStat('cashBags', 1);
      dailyEvent('cashBag', 1);
      earn(b.value, 15, 'CASH');
      sfx('coin');
    }
  }
}

// ---------- HUD ----------
const hudEls = {};
function hudEl(id) { return hudEls[id] || (hudEls[id] = document.getElementById(id)); }
function showCountdown(text) {
  const el = hudEl('countdown');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
let _lastHud = '';
function updateActivityHud() {
  // combo meter
  const cb = hudEl('combo');
  const live = combo.pts > 0 || stunt.driftPts > 150;
  if (cb) {
    cb.classList.toggle('show', live);
    if (live) {
      const drifting = stunt.driftPts > 150;
      cb.querySelector('.c-label').textContent = drifting ? 'DRIFT ' + fmtNum(stunt.driftPts) : combo.label;
      cb.querySelector('.c-pts').textContent = fmtNum(combo.pts);
      cb.querySelector('.c-mult').textContent = 'x' + combo.mult;
      cb.querySelector('.c-bar i').style.width = (drifting ? 100 : (combo.timer / COMBO_WINDOW) * 100) + '%';
    }
  }
  // mission panel
  const mp = hudEl('mission');
  let html = '';
  if (activity && activity.type === 'race') {
    const a = activity, r = a.race, rec = save.races[r.id];
    html = '<div class="m-title">' + r.icon + ' ' + r.name + '</div>' +
      '<div class="m-big">' + fmtTime(a.time) + '</div>' +
      '<div class="m-row">Checkpoint <b>' + Math.min(a.cp + 1, r.cps.length) + '/' + r.cps.length + '</b></div>' +
      '<div class="m-row">🥇 ' + fmtTime(r.medals[2]) + ' · 🥈 ' + fmtTime(r.medals[1]) + ' · 🥉 ' + fmtTime(r.medals[0]) + '</div>' +
      (rec && rec.best ? '<div class="m-row">Best <b>' + fmtTime(rec.best) + '</b></div>' : '') +
      '<div class="m-hint">R to abandon</div>';
  } else if (activity && activity.type === 'delivery') {
    const a = activity;
    html = '<div class="m-title">📦 Delivery' + (a.streak > 1 ? ' · streak x' + a.streak : '') + '</div>' +
      '<div class="m-big' + (a.timer < 10 ? ' warn' : '') + '">' + Math.ceil(a.timer) + 's</div>' +
      '<div class="m-row">' + a.cargo + '</div><div class="m-row">to <b>' + a.addr + '</b></div>' +
      '<div class="m-hint">Stop in the green ring · R to quit</div>';
  }
  if (mp && html !== _lastHud) { _lastHud = html; mp.innerHTML = html; mp.classList.toggle('show', !!html); }
  // objective arrow
  const ar = hudEl('objArrow');
  const tgt = activityTarget();
  if (ar) {
    ar.classList.toggle('show', !!tgt);
    if (tgt) {
      const dx = tgt.x - carState.pos.x, dz = tgt.z - carState.pos.z;
      let rel = Math.atan2(dx, dz) - carState.heading;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      ar.querySelector('.a-ico').style.transform = 'rotate(' + (-rel) + 'rad)';
      ar.querySelector('.a-dist').textContent = Math.round(Math.hypot(dx, dz)) + ' m';
    }
  }
  // nitro gauge
  const nf = hudEl('fuelFill'), np = hudEl('fuelPct');
  if (nf) nf.style.width = (nitro / nitroCap() * 100) + '%';
  if (np) np.textContent = Math.round(nitro / nitroCap() * 100) + '%';
}

// ---------- Main update ----------
let achTimer = 0;
function updateActivities(dt) {
  updateStunts(dt);
  updateProps(dt);
  updateCollectibles(dt);
  updateSpeedTraps(dt);
  updateActivity(dt);
  updateChase();
  updateSmoke(dt);
  camShake = Math.max(0, camShake - dt * 2.5);
  const t = performance.now() * 0.001;
  for (const r of RACES) { r.marker.visible = !activity; r.marker.userData.ring.rotation.z = t; }
  for (const m of depotMarkers) { m.visible = !activity; m.userData.ring.rotation.z = -t; }
  if (gate.visible) gate.userData.ring.rotation.z = t * 0.5;
  achTimer += dt;
  if (achTimer > 1) { achTimer = 0; checkAchievements(); }
  updateActivityHud();
}
function resetActivities() {
  abortActivity();
  combo.pts = 0; combo.mult = 1; combo.tricks = 0; combo.timer = 0;
  stunt.drifting = false; stunt.driftPts = 0; stunt.airborne = false; stunt.lastRamp = null;
  chase.active = false; chase.max = 0;
  nitro = nitroCap();
  speedReported = 0;
}
