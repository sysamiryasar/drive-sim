'use strict';
// ============================================================
// entities.js — player vehicles, traffic AI, pedestrians
// ============================================================

const headLightMat = new THREE.MeshLambertMaterial({
  color: srgb(0x888888), emissive: srgb(0xfff2cc), emissiveIntensity: 0,
});
const tailLightMat = new THREE.MeshLambertMaterial({
  color: srgb(0x551111), emissive: srgb(0xff3b30), emissiveIntensity: 0,
});
const signalMat = new THREE.MeshLambertMaterial({
  color: srgb(0x886600), emissive: srgb(0xffaa00), emissiveIntensity: 0,
});

// ---------- 3D Model loading ----------
const modelCache = {};
let modelsLoaded = false;

function loadAllModels() {
  if (typeof THREE.GLTFLoader === 'undefined') {
    console.warn('GLTFLoader not available — using primitive models');
    return;
  }
  const loader = new THREE.GLTFLoader();
  const names = Object.keys(VEHICLES).concat(['helicopter', 'plane']);
  let pending = names.length;
  for (const name of names) {
    loader.load('models/' + name + '.glb',
      function(gltf) {
        modelCache[name] = gltf.scene;
        if (--pending === 0) {
          modelsLoaded = true;
          console.log('Models loaded:', Object.keys(modelCache));
        }
      },
      undefined,
      function() {
        console.log('No model: models/' + name + '.glb — using primitives');
        if (--pending === 0) modelsLoaded = true;
      }
    );
  }
}
loadAllModels();

// Auto-scale and center a loaded model to target length
function fitModel(model, targetLen) {
  const box = new THREE.Box3().setFromObject(model);
  const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.1);
  model.scale.setScalar(targetLen / len);
  const ctr = box.getCenter(new THREE.Vector3()).multiplyScalar(model.scale.x);
  model.position.sub(ctr);
  model.traverse(function(c) { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

// Find nodes by name pattern
function findNodes(model, patterns) {
  const result = [];
  model.traverse(function(c) {
    const n = (c.name || '').toLowerCase();
    for (const p of patterns) { if (n.indexOf(p) >= 0) { result.push(c); return; } }
  });
  return result;
}

function buildWheels(group, wx, wzF, wzR, r) {
  const geo = new THREE.CylinderGeometry(r, r, 0.34, 14);
  geo.rotateZ(Math.PI / 2);
  const mat = standard(0x17191e, 0.9, 0.1);
  const wheels = [], fronts = [];
  [[-wx, wzF, true], [wx, wzF, true], [-wx, wzR, false], [wx, wzR, false]].forEach(([x, z, front]) => {
    const w = new THREE.Mesh(geo, mat);
    w.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    pivot.add(w);
    group.add(pivot);
    wheels.push(w);
    if (front) fronts.push(pivot);
  });
  return { wheels, fronts };
}

function buildMotorcycleWheels(group, r) {
  const geo = new THREE.CylinderGeometry(r, r, 0.18, 12);
  geo.rotateZ(Math.PI / 2);
  const mat = standard(0x17191e, 0.9, 0.1);
  const wheels = [], fronts = [];
  const fp = new THREE.Group();
  fp.position.set(0, r, 1.05);
  const fw = new THREE.Mesh(geo, mat); fw.castShadow = true; fp.add(fw);
  group.add(fp);
  const rp = new THREE.Group();
  rp.position.set(0, r, -1.05);
  const rw = new THREE.Mesh(geo, mat); rw.castShadow = true; rp.add(rw);
  group.add(rp);
  wheels.push(fw, rw);
  fronts.push(fp);
  return { wheels, fronts };
}

const VEHICLES = {
  sports:    { name: 'Sports',      accel: 19, maxSpeed: 50, grip: 9,   turn: 1.55, wheelR: 0.4,  offroadPenalty: 0.4, weight: 1.0,  icon: '🏎️' },
  muscle:    { name: 'Muscle',      accel: 23, maxSpeed: 44, grip: 6.5, turn: 1.45, wheelR: 0.42, offroadPenalty: 0.4, weight: 1.15, icon: '🚗' },
  offroad:   { name: 'Off-Roader',  accel: 14, maxSpeed: 38, grip: 10,  turn: 1.35, wheelR: 0.52, offroadPenalty: 0.05, weight: 1.2, icon: '🚙' },
  truck:     { name: 'Truck',       accel: 11, maxSpeed: 34, grip: 7.5, turn: 1.1,  wheelR: 0.55, offroadPenalty: 0.15, weight: 1.6, icon: '🛻' },
  suv:       { name: 'SUV',         accel: 16, maxSpeed: 42, grip: 8.5, turn: 1.3,  wheelR: 0.48, offroadPenalty: 0.2,  weight: 1.3, icon: '🚙' },
  van:       { name: 'Van',         accel: 13, maxSpeed: 36, grip: 8,   turn: 1.2,  wheelR: 0.44, offroadPenalty: 0.25, weight: 1.4, icon: '🚐' },
  motorcycle:{ name: 'Motorcycle',  accel: 22, maxSpeed: 58, grip: 7,   turn: 1.8,  wheelR: 0.36, offroadPenalty: 0.35, weight: 0.5, icon: '🏍️' },
  police:    { name: 'Police',      accel: 20, maxSpeed: 48, grip: 9.5, turn: 1.5,  wheelR: 0.42, offroadPenalty: 0.35, weight: 1.1, icon: '🚔' },
};

function buildPlayerCar(styleKey, colorHex) {
  const spec = VEHICLES[styleKey];
  const car = new THREE.Group();

  // Try cached .glb model first
  if (modelCache[styleKey]) {
    const model = modelCache[styleKey].clone();
    fitModel(model, styleKey === 'motorcycle' ? 2.4 : 4.4);
    car.add(model);
    const wheels = findNodes(model, ['wheel', 'tire', 'tyre', 'rim']);
    const fronts = findNodes(model, ['fl', 'fr', 'front']);
    const headlight = new THREE.SpotLight(0xfff4c8, 0, 70, 0.5, 0.45);
    headlight.position.set(0, 0.9, 2.0);
    const hlTarget = new THREE.Object3D(); hlTarget.position.set(0, 0, 25);
    car.add(headlight, hlTarget); headlight.target = hlTarget;
    car.userData = { wheels: wheels, fronts: fronts, steeringWheel: null, headlight: headlight, bodyMat: null };
    return car;
  }

  const bodyMat = standard(colorHex, 0.32, 0.65);
  const darkMat = standard(0x15171c, 0.6, 0.3);
  const glassMat = standard(0x1e2a36, 0.1, 0.9, { transparent: true, opacity: 0.55 });
  const chromeMat = standard(0xaaaaaa, 0.15, 0.9);
  const parts = { bodyMat };

  if (styleKey === 'motorcycle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 2.4), bodyMat);
    body.position.y = 0.7; body.castShadow = true;
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.7), bodyMat);
    tank.position.set(0, 0.95, 0.2);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.5), darkMat);
    seat.position.set(0, 0.98, -0.2);
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.4), darkMat);
    fender.position.set(0, 0.55, 1.0);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), headLightMat);
    hl.position.set(0, 0.85, 1.25);
    car.add(body, tank, seat, fender, hl);
    const wp = buildMotorcycleWheels(car, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.15, 0.3), darkMat);
    dash.position.set(0, 1.05, 0.6);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 14), darkMat);
    wheel.position.set(0, 1.15, 0.45); wheel.rotation.x = -0.6;
    car.add(dash, wheel);
    parts.steeringWheel = wheel;
  } else if (styleKey === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 2.5), bodyMat);
    cab.position.y = 1.2; cab.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 1.6), glassMat);
    cabin.position.set(0, 1.9, -0.3); cabin.castShadow = true;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 3.2), darkMat);
    bed.position.set(0, 0.85, -2.2);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.2), chromeMat);
    bumper.position.set(0, 0.7, 2.3);
    car.add(cab, cabin, bed, bumper);
    const wp = buildWheels(car, 1.2, 1.6, -1.8, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'suv') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.7, 4.3), bodyMat);
    body.position.y = 0.9; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 2.6), glassMat);
    cabin.position.set(0, 1.55, -0.3); cabin.castShadow = true;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 1.2), darkMat);
    rack.position.set(0, 1.92, -0.3);
    car.add(body, cabin, rack);
    const wp = buildWheels(car, 1.08, 1.5, -1.5, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'van') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 4.8), bodyMat);
    body.position.y = 1.15; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 1.3), glassMat);
    cabin.position.set(0, 1.9, 1.2); cabin.castShadow = true;
    car.add(body, cabin);
    const wp = buildWheels(car, 1.02, 1.6, -1.6, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'police') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 4.5), standard(0x1a1a2e, 0.3, 0.6));
    body.position.y = 0.68; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.48, 2.0), glassMat);
    cabin.position.set(0, 1.08, -0.3); cabin.castShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.25), standard(0x2244aa, 0.4, 0.3));
    bar.position.set(0, 1.32, -0.1);
    const lightL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: srgb(0x2244ff), emissive: srgb(0x2244ff), emissiveIntensity: 0 }));
    lightL.position.set(-0.65, 1.42, -0.1);
    const lightR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: srgb(0xff2222), emissive: srgb(0xff2222), emissiveIntensity: 0 }));
    lightR.position.set(0.65, 1.42, -0.1);
    const pushbar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.15), chromeMat);
    pushbar.position.set(0, 0.72, 2.3);
    car.add(body, cabin, bar, lightL, lightR, pushbar);
    const wp = buildWheels(car, 1.02, 1.5, -1.5, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
    parts.policeLightL = lightL; parts.policeLightR = lightR;
  } else if (styleKey === 'offroad') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.3), bodyMat);
    body.position.y = 0.95; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 2.2), glassMat);
    cabin.position.set(0, 1.55, -0.2); cabin.castShadow = true;
    car.add(body, cabin);
    const wp = buildWheels(car, 1.12, 1.45, -1.45, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'muscle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.6, 4.6), bodyMat);
    body.position.y = 0.68; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.7), glassMat);
    cabin.position.set(0, 1.2, -0.5); cabin.castShadow = true;
    car.add(body, cabin);
    const wp = buildWheels(car, 1.02, 1.45, -1.45, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.4), bodyMat);
    body.position.y = 0.62; body.castShadow = true;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 1.5), bodyMat);
    hood.position.set(0, 0.84, 1.35); hood.rotation.x = 0.055; hood.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 2.0), glassMat);
    cabin.position.set(0, 1.05, -0.35); cabin.castShadow = true;
    car.add(body, hood, cabin);
    const wp = buildWheels(car, 1.02, 1.45, -1.45, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  }

  if (styleKey !== 'motorcycle') {
    const hlGeo = new THREE.BoxGeometry(0.42, 0.14, 0.08);
    const fy = 0.78;
    const fz = 2.21;
    [[-0.62, headLightMat, fz], [0.62, headLightMat, fz],
     [-0.62, tailLightMat, -fz], [0.62, tailLightMat, -fz]].forEach(([x, m, z]) => {
      const l = new THREE.Mesh(hlGeo, m);
      l.position.set(x, fy, z);
      car.add(l);
    });
  }

  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.5), darkMat);
  dash.position.set(0, 1.0, 0.55);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 20), darkMat);
  wheel.position.set(-0.42, 0.98, 0.42);
  wheel.rotation.x = -0.35;
  const seatL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.6), darkMat);
  seatL.position.set(-0.42, 0.85, -0.5);
  car.add(dash, wheel, seatL);
  parts.steeringWheel = wheel;

  const headlight = new THREE.SpotLight(0xfff4c8, 0, 70, 0.5, 0.45);
  headlight.position.set(0, 0.9, 2.0);
  const hlTarget = new THREE.Object3D(); hlTarget.position.set(0, 0, 25);
  car.add(headlight, hlTarget);
  headlight.target = hlTarget;
  parts.headlight = headlight;

  car.userData = parts;
  return car;
}

let carStyle = 'sports';
let carColor = 0xd8342c;
let car = buildPlayerCar(carStyle, carColor);
scene.add(car);

const carState = {
  pos: new THREE.Vector3(-150, CITY_Y, 3),
  vel: new THREE.Vector3(),
  heading: Math.PI / 2,
  wheelSpin: 0,
  grounded: true,
  visualRoll: 0, visualPitch: 0,
};
function swapCar(styleKey, colorHex) {
  scene.remove(car);
  carStyle = styleKey; carColor = colorHex;
  car = buildPlayerCar(styleKey, colorHex);
  scene.add(car);
  car.position.copy(carState.pos);
}

// ---------- AI traffic ----------
const laneOff = [3, -3, -3, 3];
const dirAngle = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
const dirSign = [1, 1, -1, -1];
const aiCars = [];

function nextIntersection(s, dir) {
  if (dirSign[dir] > 0) { const n = Math.floor(s / 60) * 60 + 60; return n <= 180 ? n : null; }
  const n = Math.ceil(s / 60) * 60 - 60;
  return n >= -180 ? n : null;
}
function aiXZ(c) {
  if (c.dir % 2 === 0) return { x: c.s, z: c.road + laneOff[c.dir] };
  return { x: c.road + laneOff[c.dir], z: c.s };
}
function aiDecide(c) {
  const I = c.nextI;
  const opts = [];
  for (let d = 0; d < 4; d++) {
    if (d === (c.dir + 2) % 4) continue;
    let s2, road2;
    if (d === c.dir) { s2 = I; road2 = c.road; }
    else { s2 = c.road; road2 = I; }
    const nI = nextIntersection(s2, d);
    if (nI !== null) opts.push({ d, s2, road2, nI });
  }
  if (!opts.length) {
    c.dir = (c.dir + 2) % 4;
    c.nextI = nextIntersection(c.s, c.dir);
    return;
  }
  const straight = opts.find(o => o.d === c.dir);
  const pick = (straight && Math.random() < 0.55) ? straight : opts[Math.floor(Math.random() * opts.length)];
  c.dir = pick.d; c.road = pick.road2; c.s = pick.s2; c.nextI = pick.nI;
  c.targetSpeed = 8 + Math.random() * 5;
  c.turnSignal = 3;
}
const trafficColors = [0x3b6fd4, 0xc7cdd6, 0x2f3338, 0xd49a3b, 0x74b06d, 0xb0413e, 0xe8e6e0, 0x4a6e8a, 0x8b4a6e, 0x6e8b4a];
function buildTrafficCar(colorHex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.0), lambert(colorHex));
  body.position.y = 0.68; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 1.8), lambert(0x20242b));
  cabin.position.set(0, 1.15, -0.2);
  const liteGeo = new THREE.BoxGeometry(0.3, 0.12, 0.08);
  [[-0.6, 2.01, headLightMat], [0.6, 2.01, headLightMat],
   [-0.6, -2.01, tailLightMat], [0.6, -2.01, tailLightMat]].forEach(([x, z, m]) => {
    const l = new THREE.Mesh(liteGeo, m);
    l.position.set(x, 0.72, z);
    g.add(l);
  });
  const sigGeo = new THREE.BoxGeometry(0.15, 0.1, 0.06);
  const sigL = new THREE.Mesh(sigGeo, signalMat);
  sigL.position.set(-0.85, 0.7, 2.0);
  const sigR = new THREE.Mesh(sigGeo, signalMat);
  sigR.position.set(0.85, 0.7, 2.0);
  g.add(sigL, sigR);
  g.add(body, cabin);
  const parts = buildWheels(g, 0.98, 1.3, -1.35, 0.36);
  g.userData.wheels = parts.wheels;
  g.userData.sigL = sigL; g.userData.sigR = sigR;
  return g;
}
for (let i = 0; i < 22; i++) {
  const dir = Math.floor(Math.random() * 4);
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const s = (Math.random() - 0.5) * 340;
  const nI = nextIntersection(s, dir);
  if (nI === null) { i--; continue; }
  const group = buildTrafficCar(trafficColors[i % trafficColors.length]);
  const c = {
    dir, road, s, nextI: nI,
    speed: 0, targetSpeed: 8 + Math.random() * 5,
    heading: dirAngle[dir], spin: 0,
    group, wheels: group.userData.wheels,
    pos: new THREE.Vector3(),
    turnSignal: 0,
    signalL: group.userData.sigL,
    signalR: group.userData.sigR,
    stopped: false, stopTimer: 0,
  };
  const p = aiXZ(c);
  if (Math.abs(p.x - carState.pos.x) < 16 && Math.abs(p.z - carState.pos.z) < 16) { i--; continue; }
  c.pos.set(p.x, CITY_Y, p.z);
  group.position.copy(c.pos);
  group.rotation.y = c.heading;
  scene.add(group);
  aiCars.push(c);
}

function updateTraffic(dt) {
  for (const c of aiCars) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let blocked = 0;
    const check = (px, pz) => {
      const dx = px - c.group.position.x, dz = pz - c.group.position.z;
      const proj = dx * fx + dz * fz;
      if (proj < 1 || proj > 12) return;
      if (Math.abs(dx * fz - dz * fx) < 2.6) blocked = Math.max(blocked, proj < 6 ? 2 : 1);
    };
    for (const o of aiCars) if (o !== c) check(o.group.position.x, o.group.position.z);
    check(carState.pos.x, carState.pos.z);
    let shouldStop = false;
    for (const tl of trafficLights) {
      if (tl.state === 'red' || tl.state === 'yellow') {
        const tdx = tl.x - c.group.position.x, tdz = tl.z - c.group.position.z;
        const tDist = Math.hypot(tdx, tdz);
        if (tDist < tl.redDist && tl.state === 'red') shouldStop = true;
        if (tDist < tl.yellowDist && tl.state === 'yellow') shouldStop = true;
      }
    }
    for (const ss of stopSigns) {
      const sdx = ss.x - c.group.position.x, sdz = ss.z - c.group.position.z;
      if (Math.hypot(sdx, sdz) < ss.radius) shouldStop = true;
    }
    for (const cz of constructionZones) {
      const cdx = cz.x - c.group.position.x, cdz = cz.z - c.group.position.z;
      if (Math.hypot(cdx, cdz) < cz.r) shouldStop = true;
    }
    const want = shouldStop ? 0 : blocked === 2 ? 0 : blocked === 1 ? 3 : c.targetSpeed;
    c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 6 : 1.2));
    c.s += dirSign[c.dir] * c.speed * dt;
    if (dirSign[c.dir] > 0 ? c.s >= c.nextI : c.s <= c.nextI) aiDecide(c);
    const p = aiXZ(c);
    c.pos.set(p.x, CITY_Y, p.z);
    c.group.position.lerp(c.pos, Math.min(1, dt * 4));
    let dh = dirAngle[c.dir] - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += dh * Math.min(1, dt * 5);
    c.group.rotation.y = c.heading;
    c.spin += c.speed * dt / 0.36;
    c.wheels.forEach(w => { w.rotation.x = c.spin; });
    if (c.turnSignal > 0) {
      c.turnSignal -= dt;
      const blink = Math.sin(c.turnSignal * 8) > 0;
      c.signalL.material.emissiveIntensity = blink ? 1.5 : 0;
      c.signalR.material.emissiveIntensity = blink ? 1.5 : 0;
    } else {
      c.signalL.material.emissiveIntensity = 0;
      c.signalR.material.emissiveIntensity = 0;
    }
  }
}

// ---------- Pedestrians ----------
const peds = [];
{
  const bodyGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8);
  const headGeo = new THREE.SphereGeometry(0.19, 8, 8);
  const skinTones = [0xd9a77c, 0xc49060, 0xe8c4a0, 0xb08050, 0x8b6040];
  for (let i = 0; i < 45; i++) {
    const bx = BLOCK_CENTERS[Math.floor(Math.random() * BLOCK_CENTERS.length)];
    const bz = BLOCK_CENTERS[Math.floor(Math.random() * BLOCK_CENTERS.length)];
    const g = new THREE.Group();
    const skinC = skinTones[Math.floor(Math.random() * skinTones.length)];
    const shirt = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.55, 0.45).convertSRGBToLinear(),
    });
    const pants = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(Math.random() * 0.1 + 0.6, 0.2, 0.25).convertSRGBToLinear(),
    });
    const body = new THREE.Mesh(bodyGeo, shirt);
    body.position.y = 0.8; body.castShadow = true;
    const head = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: srgb(skinC) }));
    head.position.y = 1.5;
    const legGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
    legGeo.translate(0, -0.2, 0);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(-0.1, 0.6, 0);
    const legR = new THREE.Mesh(legGeo, pants);
    legR.position.set(0.1, 0.6, 0);
    g.add(body, head, legL, legR);
    g.userData = { legL, legR };
    scene.add(g);
    peds.push({ g, bx, bz, t: Math.random() * 180, speed: 1.1 + Math.random() * 1.1 });
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    p.t = (p.t + p.speed * dt) % 180;
    const seg = Math.floor(p.t / 45), u = (p.t % 45) - 22.5;
    let x, z, h;
    if (seg === 0) { x = u; z = -22.5; h = Math.PI / 2; }
    else if (seg === 1) { x = 22.5; z = u; h = 0; }
    else if (seg === 2) { x = -u; z = 22.5; h = -Math.PI / 2; }
    else { x = -22.5; z = -u; h = Math.PI; }
    const bounce = Math.abs(Math.sin(p.t * 6)) * 0.04;
    p.g.position.set(p.bx + x, CITY_Y + 0.3 + bounce, p.bz + z);
    p.wx = p.bx + x;
    p.wz = p.bz + z;
    p.g.rotation.y = h;
    if (p.g.userData.legL) {
      const sw = Math.sin(p.t * p.speed * 2) * 0.5;
      p.g.userData.legL.rotation.x = sw;
      p.g.userData.legR.rotation.x = -sw;
    }
  }
}

// ---------- Cop cars ----------
const copCars = [];
let wantedLevel = 0;
let copCooldown = 0;
function buildCopCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.0), standard(0x1a1a2e, 0.4, 0.5));
  body.position.y = 0.68; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 1.8), lambert(0x20242b));
  cabin.position.set(0, 1.15, -0.2);
  const liteGeo = new THREE.BoxGeometry(0.3, 0.12, 0.08);
  [[-0.6, 2.01, headLightMat], [0.6, 2.01, headLightMat],
   [-0.6, -2.01, tailLightMat], [0.6, -2.01, tailLightMat]].forEach(([x, z, m]) => {
    const l = new THREE.Mesh(liteGeo, m);
    l.position.set(x, 0.72, z); g.add(l);
  });
  const barGeo = new THREE.BoxGeometry(1.2, 0.12, 0.3);
  const barMat = new THREE.MeshBasicMaterial({ color: 0x222244 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.set(0, 1.42, -0.1);
  const sirenL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x0044ff }));
  sirenL.position.set(-0.4, 1.52, -0.1);
  const sirenR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
  sirenR.position.set(0.4, 1.52, -0.1);
  g.add(body, cabin, bar, sirenL, sirenR);
  const parts = buildWheels(g, 0.98, 1.3, -1.35, 0.36);
  g.userData.wheels = parts.wheels;
  g.userData.sirenL = sirenL;
  g.userData.sirenR = sirenR;
  return g;
}
function spawnCop() {
  const dir = Math.floor(Math.random() * 4);
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const s = (Math.random() - 0.5) * 300;
  const nI = nextIntersection(s, dir);
  if (nI === null) return;
  const group = buildCopCar();
  const c = {
    dir, road, s, nextI: nI,
    speed: 0, targetSpeed: 14,
    heading: dirAngle[dir], spin: 0,
    group, wheels: group.userData.wheels,
    pos: new THREE.Vector3(),
    chasing: true, active: true,
    sirenL: group.userData.sirenL,
    sirenR: group.userData.sirenR,
  };
  const p = aiXZ(c);
  c.pos.set(p.x, CITY_Y, p.z);
  group.position.copy(c.pos);
  group.rotation.y = c.heading;
  scene.add(group);
  copCars.push(c);
}
function updateCops(dt) {
  copCooldown -= dt;
  for (const c of copCars) {
    if (!c.active) continue;
    const dx = carState.pos.x - c.group.position.x;
    const dz = carState.pos.z - c.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (wantedLevel >= 1 && dist > 250) {
      c.active = false;
      scene.remove(c.group);
      continue;
    }
    if (wantedLevel >= 1 && dist > 40) {
      const angle = Math.atan2(dx, dz);
      let dh = angle - c.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.heading += dh * Math.min(1, dt * 2.5);
      c.targetSpeed = Math.min(22 + wantedLevel * 5, 12 + wantedLevel * 6);
    } else if (dist < 8 && wantedLevel >= 1 && copCooldown <= 0) {
      carState.vel.multiplyScalar(0.2);
      wantedLevel = Math.max(0, wantedLevel - 1);
      copCooldown = 3;
      if (typeof toast === 'function') toast('Pulled over! Wanted level decreased.');
    } else {
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      let blocked = 0;
      for (const o of aiCars) {
        const odx = o.group.position.x - c.group.position.x;
        const odz = o.group.position.z - c.group.position.z;
        const proj = odx * fx + odz * fz;
        if (proj > 1 && proj < 12 && Math.abs(odx * fz - odz * fx) < 2.6) blocked = 1;
      }
      c.targetSpeed = blocked ? 2 : 10;
    }
    if (wantedLevel >= 3 && dist < 22 && dist > 5 && !c.shootCooldown) {
      spawnBullet(c.group.position.x, c.group.position.z, carState.pos.x, carState.pos.z);
      c.shootCooldown = Math.max(0.3, 2.0 - wantedLevel * 0.15);
    }
    if (c.shootCooldown) c.shootCooldown = Math.max(0, c.shootCooldown - dt);
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let shouldStop = false;
    for (const tl of trafficLights) {
      if (tl.state === 'red' || tl.state === 'yellow') {
        const tDist = Math.hypot(tl.x - c.group.position.x, tl.z - c.group.position.z);
        if (tDist < tl.redDist && tl.state === 'red') shouldStop = true;
        if (tDist < tl.yellowDist && tl.state === 'yellow') shouldStop = true;
      }
    }
    const want = shouldStop ? 0 : c.targetSpeed;
    c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 6 : 1.2));
    c.s += dirSign[c.dir] * c.speed * dt;
    if (dirSign[c.dir] > 0 ? c.s >= c.nextI : c.s <= c.nextI) aiDecide(c);
    const p = aiXZ(c);
    c.pos.set(p.x, CITY_Y, p.z);
    c.group.position.lerp(c.pos, Math.min(1, dt * 4));
    let dh = dirAngle[c.dir] - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += dh * Math.min(1, dt * 5);
    c.group.rotation.y = c.heading;
    c.spin += c.speed * dt / 0.36;
    c.wheels.forEach(w => { w.rotation.x = c.spin; });
    if (wantedLevel >= 1) {
      const flash = Math.sin(performance.now() * 0.01) > 0;
      c.sirenL.material.color.set(flash ? 0x0066ff : 0x001133);
      c.sirenR.material.color.set(flash ? 0xff3300 : 0x330000);
    }
  }
  const maxCops = Math.min(8, 1 + Math.floor(wantedLevel / 1.5));
  if (wantedLevel >= 1 && copCars.filter(c => c.active).length < maxCops && copCooldown <= 0) {
    spawnCop();
    copCooldown = Math.max(0.5, 4 - wantedLevel * 0.35);
  }
}

// ---------- Player health ----------
let playerHealth = 100;
const playerMaxHealth = 100;
let damageFlashTimer = 0;
let bustedTimer = 0;

function damagePlayer(amount, source) {
  if (bustedTimer > 0) return;
  playerHealth = Math.max(0, playerHealth - amount);
  damageFlashTimer = 0.35;
  if (typeof toast === 'function') toast(source + '! -' + amount + ' HP');
  if (playerHealth <= 0) {
    bustedTimer = 3;
    wantedLevel = 0;
    if (typeof toast === 'function') toast('BUSTED!');
  }
}

function respawnPlayer() {
  playerHealth = playerMaxHealth;
  carState.pos.set(-150, CITY_Y, 3);
  carState.vel.set(0, 0, 0);
  carState.heading = Math.PI / 2;
  if (car) car.position.copy(carState.pos);
}

// ---------- Bullets ----------
const bullets = [];
const BULLET_SPEED = 55;
const BULLET_LIFE = 2.5;
const bulletGeo = new THREE.SphereGeometry(0.08, 4, 3);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });

function spawnBullet(fromX, fromZ, toX, toZ) {
  const dx = toX - fromX, dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return;
  const vx = (dx / len) * BULLET_SPEED;
  const vz = (dz / len) * BULLET_SPEED;
  const mesh = new THREE.Mesh(bulletGeo, bulletMat);
  mesh.position.set(fromX, CITY_Y + 1.2, fromZ);
  scene.add(mesh);
  const glow = new THREE.PointLight(0xff6600, 1, 8);
  mesh.add(glow);
  bullets.push({ mesh, vx, vz, life: BULLET_LIFE });
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    if (b.life <= 0) { removeBullet(i); continue; }
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.z += b.vz * dt;
    const dx = b.mesh.position.x - carState.pos.x;
    const dz = b.mesh.position.z - carState.pos.z;
    if (dx * dx + dz * dz < 2.2 && Math.abs(carState.pos.y - CITY_Y) < 3) {
      damagePlayer(8 + Math.floor(Math.random() * 8), 'Police gunfire');
      removeBullet(i);
    }
  }
}

function removeBullet(i) {
  scene.remove(bullets[i].mesh);
  bullets.splice(i, 1);
}

// ---------- Roadblocks ----------
const roadblocks = [];

function spawnRoadblock() {
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const s = (Math.random() - 0.5) * 200;
  const horizontal = Math.random() < 0.5;
  const angle = horizontal ? 0 : Math.PI / 2;
  const g = new THREE.Group();
  const barrier = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.8, 0.4),
    new THREE.MeshLambertMaterial({ color: 0xff6600 })
  );
  barrier.position.y = 0.4;
  const stripes = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.3, 0.42),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  stripes.position.y = 0.55;
  const coneGeo = new THREE.ConeGeometry(0.2, 0.6, 6);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff4400 });
  const coneL = new THREE.Mesh(coneGeo, coneMat);
  coneL.position.set(-3, 0.3, 0);
  const coneR = new THREE.Mesh(coneGeo, coneMat);
  coneR.position.set(3, 0.3, 0);
  g.add(barrier, stripes, coneL, coneR);
  const x = horizontal ? s : road;
  const z = horizontal ? road : s;
  g.position.set(x, CITY_Y, z);
  g.rotation.y = angle;
  scene.add(g);
  roadblocks.push({ x, z, r: 3.5, group: g, timer: 25 });
}

function updateRoadblocks(dt) {
  for (let i = roadblocks.length - 1; i >= 0; i--) {
    const rb = roadblocks[i];
    rb.timer -= dt;
    if (rb.timer <= 0) { scene.remove(rb.group); roadblocks.splice(i, 1); continue; }
    const dx = carState.pos.x - rb.x, dz = carState.pos.z - rb.z;
    if (dx * dx + dz * dz < rb.r * rb.r && Math.abs(carState.pos.y - CITY_Y) < 3) {
      carState.vel.multiplyScalar(0.15);
      damagePlayer(15, 'Roadblock collision');
      scene.remove(rb.group);
      roadblocks.splice(i, 1);
    }
  }
}

// ---------- Spike strips ----------
const spikeStrips = [];
let gripPenaltyTimer = 0;

function spawnSpikeStrip() {
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const offset = carState.pos.x + (Math.random() - 0.5) * 80;
  const horizontal = Math.random() < 0.5;
  const angle = horizontal ? 0 : Math.PI / 2;
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.1, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x888888 })
  );
  const spikeGeo = new THREE.ConeGeometry(0.05, 0.25, 4);
  const spikeMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  for (let j = -2; j <= 2; j += 0.5) {
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.set(j, 0.15, 0);
    g.add(spike);
  }
  g.add(base);
  const x = horizontal ? offset : road;
  const z = horizontal ? road : offset;
  g.position.set(x, CITY_Y, z);
  g.rotation.y = angle;
  scene.add(g);
  spikeStrips.push({ x, z, r: 2.8, group: g, timer: 18 });
}

function updateSpikeStrips(dt) {
  gripPenaltyTimer = Math.max(0, gripPenaltyTimer - dt);
  for (let i = spikeStrips.length - 1; i >= 0; i--) {
    const ss = spikeStrips[i];
    ss.timer -= dt;
    if (ss.timer <= 0) { scene.remove(ss.group); spikeStrips.splice(i, 1); continue; }
    const dx = carState.pos.x - ss.x, dz = carState.pos.z - ss.z;
    if (dx * dx + dz * dz < ss.r * ss.r && Math.abs(carState.pos.y - CITY_Y) < 3) {
      gripPenaltyTimer = 8;
      if (typeof toast === 'function') toast('Tires popped! Reduced control 8s');
      scene.remove(ss.group);
      spikeStrips.splice(i, 1);
    }
  }
}

// ---------- Helicopter ----------
const helicopters = [];

function buildHelicopter() {
  // Try cached .glb model
  if (modelCache['helicopter']) {
    const g = new THREE.Group();
    const model = modelCache['helicopter'].clone();
    fitModel(model, 5.0);
    g.add(model);
    const blades = findNodes(model, ['blade', 'rotor', 'prop']);
    g.userData = { blade1: blades[0] || null, blade2: blades[1] || null, lightL: null, lightR: null };
    return g;
  }

  const g = new THREE.Group();
  const bodyMat = standard(0x1a2a1a, 0.4, 0.4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4.5), bodyMat);
  body.position.y = 0; body.castShadow = true;
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x334455, transparent: true, opacity: 0.5 })
  );
  glass.position.set(0, 0.2, 1.5); glass.rotation.x = -Math.PI / 6;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.5), bodyMat);
  tail.position.set(0, 0.3, -3.5);
  const tailRotor = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.8, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x444444 })
  );
  tailRotor.position.set(0, 0.3, -5.2);
  const bladeGeo = new THREE.BoxGeometry(7, 0.04, 0.35);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
  blade1.position.set(0, 0.82, 0);
  const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
  blade2.position.set(0, 0.82, 0);
  blade2.rotation.y = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.15, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  hub.position.set(0, 0.75, 0);
  const skidGeo = new THREE.BoxGeometry(0.08, 0.08, 3.8);
  const skidMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const skidL = new THREE.Mesh(skidGeo, skidMat); skidL.position.set(-0.9, -0.7, 0);
  const skidR = new THREE.Mesh(skidGeo, skidMat); skidR.position.set(0.9, -0.7, 0);
  const strutGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06);
  [[-0.9, 1.2], [-0.9, -0.8], [0.9, 1.2], [0.9, -0.8]].forEach(([x, z]) => {
    const s = new THREE.Mesh(strutGeo, skidMat);
    s.position.set(x, -0.5, z); g.add(s);
  });
  const lightL = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0x0044ff })
  );
  lightL.position.set(-0.7, -0.5, 1.8);
  const lightR = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xff2200 })
  );
  lightR.position.set(0.7, -0.5, 1.8);
  g.add(body, glass, tail, tailRotor, hub, blade1, blade2, skidL, skidR, lightL, lightR);
  g.userData = { blade1, blade2, lightL, lightR };
  return g;
}

function spawnHelicopter() {
  const group = buildHelicopter();
  const angle = Math.random() * Math.PI * 2;
  const h = {
    group, active: true,
    pos: new THREE.Vector3(
      carState.pos.x + Math.cos(angle) * 60,
      CITY_Y + 30,
      carState.pos.z + Math.sin(angle) * 60
    ),
    orbitAngle: angle,
    shootTimer: 0,
  };
  group.position.copy(h.pos);
  scene.add(group);
  helicopters.push(h);
}

function updateHelicopters(dt) {
  for (let i = helicopters.length - 1; i >= 0; i--) {
    const h = helicopters[i];
    if (!h.active) { scene.remove(h.group); helicopters.splice(i, 1); continue; }
    if (wantedLevel < 3) {
      h.active = false;
      scene.remove(h.group);
      helicopters.splice(i, 1);
      continue;
    }
    const dist = Math.hypot(carState.pos.x - h.pos.x, carState.pos.z - h.pos.z);
    if (dist > 280 && wantedLevel < 7) {
      h.active = false;
      scene.remove(h.group);
      helicopters.splice(i, 1);
      continue;
    }
    h.orbitAngle += dt * (0.5 + wantedLevel * 0.08);
    const orbitDist = 25 + (wantedLevel - 3) * 6;
    const targetX = carState.pos.x + Math.cos(h.orbitAngle) * orbitDist;
    const targetZ = carState.pos.z + Math.sin(h.orbitAngle) * orbitDist;
    const targetY = CITY_Y + 28 + Math.sin(h.orbitAngle * 0.5) * 4;
    h.pos.lerp(new THREE.Vector3(targetX, targetY, targetZ), dt * 1.8);
    h.group.position.copy(h.pos);
    const dx = carState.pos.x - h.group.position.x;
    const dz = carState.pos.z - h.group.position.z;
    h.group.rotation.y = Math.atan2(dx, dz);
    h.group.userData.blade1.rotation.y += dt * 30;
    h.group.userData.blade2.rotation.y += dt * 30;
    const flash = Math.sin(performance.now() * 0.008) > 0;
    h.group.userData.lightL.material.color.set(flash ? 0x0066ff : 0x001133);
    h.group.userData.lightR.material.color.set(flash ? 0xff3300 : 0x330000);
    if (wantedLevel >= 5) {
      h.shootTimer -= dt;
      if (h.shootTimer <= 0) {
        h.shootTimer = Math.max(0.4, 1.5 - (wantedLevel - 5) * 0.15);
        spawnBullet(h.pos.x, h.pos.z, carState.pos.x, carState.pos.z);
      }
    }
  }
  if (wantedLevel >= 4 && helicopters.length < Math.min(3, Math.floor(wantedLevel / 2))) {
    spawnHelicopter();
  }
}

// ---------- Flyable plane ----------
let plane = null;
let planeState = null;
let inPlane = false;

function buildPlane() {
  // Try cached .glb model
  if (modelCache['plane']) {
    const g = new THREE.Group();
    const model = modelCache['plane'].clone();
    fitModel(model, 8.0);
    g.add(model);
    const props = findNodes(model, ['prop', 'propeller']);
    g.userData = { prop: props[0] || null };
    return g;
  }

  const g = new THREE.Group();
  const bodyMat = standard(0xd4d4d4, 0.3, 0.6);
  const accentMat = standard(0xcc2222, 0.3, 0.5);
  const darkMat = standard(0x222222, 0.6, 0.2);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 6.0), bodyMat);
  fuse.position.y = 0; fuse.castShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), bodyMat);
  nose.position.set(0, 0, 3.8); nose.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 1.6), bodyMat);
  wing.position.set(0, 0.1, 0);
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), accentMat);
  tipL.position.set(-5.2, 0.1, 0);
  const tipR = tipL.clone(); tipR.position.set(5.2, 0.1, 0);
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.9), bodyMat);
  tailWing.position.set(0, 0.4, -2.8);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.0), accentMat);
  tailFin.position.set(0, 1.0, -2.8);
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x4488aa, transparent: true, opacity: 0.5 })
  );
  cockpit.position.set(0, 0.6, 1.2);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 8), darkMat);
  hub.position.set(0, 0, 4.6); hub.rotation.x = Math.PI / 2;
  const prop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.15), darkMat);
  prop.position.set(0, 0, 4.7);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.15, 6.02), accentMat);
  stripe.position.set(0, 0.35, 0);
  const gearMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const wheelGeo = new THREE.SphereGeometry(0.15, 6, 4);
  const gearGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6);
  [[-1.5, -0.7, 0.8], [1.5, -0.7, 0.8], [0, -0.7, -2.2]].forEach(([x, y, z]) => {
    const strut = new THREE.Mesh(gearGeo, gearMat);
    strut.position.set(x, y + 0.3, z);
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.position.set(x, y, z);
    g.add(strut, wheel);
  });
  g.add(fuse, nose, wing, tipL, tipR, tailWing, tailFin, cockpit, hub, prop, stripe);
  g.userData = { prop };
  return g;
}

function enterPlane() {
  if (inPlane) return;
  if (!plane) plane = buildPlane();
  inPlane = true;
  car.visible = false;
  plane.visible = true;
  plane.position.copy(carState.pos);
  plane.rotation.set(0, carState.heading, 0);
  scene.add(plane);
  planeState = {
    pos: carState.pos.clone(),
    vel: new THREE.Vector3(0, 0, 0),
    heading: carState.heading,
    pitch: 0,
    roll: 0,
    throttle: 0.3,
    altitude: carState.pos.y,
    onGround: true,
    speed: 0,
  };
  mode = 'fly';
  camStyle = 'chase';
  if (typeof toast === 'function') toast('Plane! W/S throttle, A/D pitch, Q/E roll');
}

function exitPlane() {
  if (!inPlane) return;
  inPlane = false;
  plane.visible = false;
  car.visible = true;
  car.position.copy(carState.pos);
  mode = 'drive';
  if (typeof toast === 'function') toast('Back in car');
}

function updatePlane(dt) {
  if (!planeState) return;
  const ps = planeState;
  ps.throttle = Math.max(0, Math.min(1, ps.throttle + input.moveZ * dt * 0.6));
  const thrust = ps.throttle * 40;
  const drag = 0.018 * ps.speed * ps.speed;
  ps.speed += (thrust - drag) * dt;
  ps.speed = Math.max(0, ps.speed);
  const lift = ps.speed > 12 ? (ps.speed - 12) * 0.4 : 0;
  const gravity = 8.5;
  if (ps.onGround) {
    ps.altitude = Math.max(0, ps.altitude);
    ps.roll *= 0.92;
    ps.pitch *= 0.92;
    if (ps.speed > 30 && lift > gravity * 1.1) {
      ps.onGround = false;
      if (typeof toast === 'function') toast('Takeoff!');
    }
  } else {
    ps.pitch += input.moveX * 2.0 * dt;
    ps.pitch = Math.max(-0.7, Math.min(0.7, ps.pitch));
    ps.roll += (keys['KeyQ'] ? 1 : keys['KeyE'] ? -1 : 0) * 2.8 * dt;
    ps.roll = Math.max(-1.1, Math.min(1.1, ps.roll));
    ps.altitude += (lift - gravity) * dt;
    ps.altitude += -ps.pitch * ps.speed * 0.15 * dt;
    ps.heading += ps.roll * 0.03 * dt * Math.max(1, ps.speed / 25);
    if (ps.altitude <= 0) {
      ps.altitude = 0;
      ps.onGround = true;
      if (ps.speed > 35 || Math.abs(ps.roll) > 0.4) {
        damagePlayer(35, 'Crash landing');
        ps.speed *= 0.3;
        ps.roll = 0;
        ps.pitch = 0;
        if (typeof toast === 'function') toast('Hard landing!');
      }
    }
  }
  ps.pos.x += Math.sin(ps.heading) * ps.speed * dt;
  ps.pos.z += Math.cos(ps.heading) * ps.speed * dt;
  ps.pos.y = ps.altitude;
  ps.pos.x = Math.max(-MAP / 2 + 15, Math.min(MAP / 2 - 15, ps.pos.x));
  ps.pos.z = Math.max(-MAP / 2 + 15, Math.min(MAP / 2 - 15, ps.pos.z));
  plane.position.copy(ps.pos);
  plane.rotation.set(ps.pitch * 0.5, ps.heading, -ps.roll * 0.3);
  if (plane.userData.prop) plane.userData.prop.rotation.z += ps.throttle * 45 * dt;
  carState.pos.copy(ps.pos);
  carState.heading = ps.heading;
}
