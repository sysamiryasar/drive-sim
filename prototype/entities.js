'use strict';
// ============================================================
// entities.js — player vehicles, cockpit, traffic AI,
// pedestrians, on-foot character, battle-royale bots
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
  const front = new THREE.Mesh(geo, mat);
  front.castShadow = true;
  const fp = new THREE.Group();
  fp.position.set(0, r, 1.05);
  fp.add(front);
  group.add(fp);
  const rear = new THREE.Mesh(geo, mat);
  rear.castShadow = true;
  const rp = new THREE.Group();
  rp.position.set(0, r, -1.05);
  rp.add(rear);
  group.add(rp);
  wheels.push(front, rear);
  fronts.push(fp);
  return { wheels, fronts };
}

// ---------- Player vehicles ----------
const VEHICLES = {
  sports:   { name: 'Sports',     accel: 19, maxSpeed: 50, grip: 9,   turn: 1.55, wheelR: 0.4,  offroadPenalty: 0.4, weight: 1.0 },
  muscle:   { name: 'Muscle',     accel: 23, maxSpeed: 44, grip: 6.5, turn: 1.45, wheelR: 0.42, offroadPenalty: 0.4, weight: 1.15 },
  offroad:  { name: 'Off-Roader', accel: 14, maxSpeed: 38, grip: 10,  turn: 1.35, wheelR: 0.52, offroadPenalty: 0.05, weight: 1.2 },
  truck:    { name: 'Truck',      accel: 11, maxSpeed: 34, grip: 7.5, turn: 1.1,  wheelR: 0.55, offroadPenalty: 0.15, weight: 1.6 },
  suv:      { name: 'SUV',        accel: 16, maxSpeed: 42, grip: 8.5, turn: 1.3,  wheelR: 0.48, offroadPenalty: 0.2,  weight: 1.3 },
  van:      { name: 'Van',        accel: 13, maxSpeed: 36, grip: 8,   turn: 1.2,  wheelR: 0.44, offroadPenalty: 0.25, weight: 1.4 },
  motorcycle: { name: 'Motorcycle', accel: 22, maxSpeed: 58, grip: 7, turn: 1.8,  wheelR: 0.36, offroadPenalty: 0.35, weight: 0.5 },
  police:   { name: 'Police',     accel: 20, maxSpeed: 48, grip: 9.5, turn: 1.5,  wheelR: 0.42, offroadPenalty: 0.35, weight: 1.1 },
};

function buildPlayerCar(styleKey, colorHex) {
  const spec = VEHICLES[styleKey];
  const car = new THREE.Group();
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
    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), headLightMat);
    headlight.position.set(0, 0.85, 1.25);
    car.add(body, tank, seat, fender, headlight);
    const wp = buildMotorcycleWheels(car, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.15, 0.3), darkMat);
    dash.position.set(0, 1.05, 0.6);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 14), darkMat);
    wheel.position.set(0, 1.15, 0.45);
    wheel.rotation.x = -0.6;
    car.add(dash, wheel);
    parts.steeringWheel = wheel;
  } else if (styleKey === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 2.5), bodyMat);
    cab.position.y = 1.2; cab.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 1.6), glassMat);
    cabin.position.set(0, 1.9, -0.3); cabin.castShadow = true;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 3.2), darkMat);
    bed.position.set(0, 0.85, -2.2);
    const bedSide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 3.2), darkMat);
    bedSide.position.set(1.15, 1.15, -2.2);
    const bedSide2 = bedSide.clone();
    bedSide2.position.x = -1.15;
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.2), chromeMat);
    bumper.position.set(0, 0.7, 2.3);
    car.add(cab, cabin, bed, bedSide, bedSide2, bumper);
    const wp = buildWheels(car, 1.2, 1.6, -1.8, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'suv') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.7, 4.3), bodyMat);
    body.position.y = 0.9; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 2.6), glassMat);
    cabin.position.set(0, 1.55, -0.3); cabin.castShadow = true;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 1.2), darkMat);
    rack.position.set(0, 1.92, -0.3);
    const bullbar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 0.15), chromeMat);
    bullbar.position.set(0, 0.85, 2.2);
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.35), darkMat);
    step.position.set(0, 0.52, 0);
    car.add(body, cabin, rack, bullbar, step);
    const wp = buildWheels(car, 1.08, 1.5, -1.5, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'van') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 4.8), bodyMat);
    body.position.y = 1.15; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 1.3), glassMat);
    cabin.position.set(0, 1.9, 1.2); cabin.castShadow = true;
    const rear = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.12), darkMat);
    rear.position.set(0, 1.2, -2.45);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.15, 4.82), standard(0xdddddd, 0.5, 0.1));
    stripe.position.set(0, 1.15, 0);
    car.add(body, cabin, rear, stripe);
    const wp = buildWheels(car, 1.02, 1.6, -1.6, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
  } else if (styleKey === 'police') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 4.5), standard(0x1a1a2e, 0.3, 0.6));
    body.position.y = 0.68; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.48, 2.0), glassMat);
    cabin.position.set(0, 1.08, -0.3); cabin.castShadow = true;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 1.4), standard(0x1a1a2e, 0.3, 0.6));
    hood.position.set(0, 0.88, 1.35);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.5), darkMat);
    wing.position.set(0, 1.08, -2.15);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.25), standard(0x2244aa, 0.4, 0.3));
    bar.position.set(0, 1.32, -0.1);
    const lightL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: srgb(0x2244ff), emissive: srgb(0x2244ff), emissiveIntensity: 0 }));
    lightL.position.set(-0.65, 1.42, -0.1);
    const lightR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: srgb(0xff2222), emissive: srgb(0xff2222), emissiveIntensity: 0 }));
    lightR.position.set(0.65, 1.42, -0.1);
    const pushbar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.15), chromeMat);
    pushbar.position.set(0, 0.72, 2.3);
    car.add(body, cabin, hood, wing, bar, lightL, lightR, pushbar);
    const wp = buildWheels(car, 1.02, 1.5, -1.5, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
    parts.policeLightL = lightL;
    parts.policeLightR = lightR;
  } else if (styleKey === 'offroad') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.3), bodyMat);
    body.position.y = 0.95; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 2.2), glassMat);
    cabin.position.set(0, 1.55, -0.2); cabin.castShadow = true;
    const bull = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.25), darkMat);
    bull.position.set(0, 0.85, 2.25);
    const rollbar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 2.0), chromeMat);
    rollbar.position.set(0, 1.88, -0.2);
    car.add(body, cabin, bull, rollbar);
  } else if (styleKey === 'muscle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.6, 4.6), bodyMat);
    body.position.y = 0.68; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.7), glassMat);
    cabin.position.set(0, 1.2, -0.5); cabin.castShadow = true;
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.9), darkMat);
    scoop.position.set(0, 1.03, 1.3);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6), chromeMat);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(0.7, 0.42, -2.35);
    car.add(body, cabin, scoop, exhaust);
  } else { // sports
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.4), bodyMat);
    body.position.y = 0.62; body.castShadow = true;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 1.5), bodyMat);
    hood.position.set(0, 0.84, 1.35); hood.rotation.x = 0.055; hood.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 2.0), glassMat);
    cabin.position.set(0, 1.05, -0.35); cabin.castShadow = true;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.55), darkMat);
    wing.position.set(0, 1.06, -2.15);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.14, 0.5), darkMat);
    splitter.position.set(0, 0.38, 2.1);
    car.add(body, hood, cabin, wing, splitter);
  }

  if (styleKey !== 'motorcycle') {
    const hlGeo = new THREE.BoxGeometry(0.42, 0.14, 0.08);
    const fy = styleKey === 'offroad' || styleKey === 'truck' || styleKey === 'suv' ? 1.0 : 0.78;
    const fz = styleKey === 'muscle' ? 2.31 : styleKey === 'truck' ? 2.35 : styleKey === 'van' ? 2.45 : 2.21;
    [[-0.62, headLightMat, fz], [0.62, headLightMat, fz],
     [-0.62, tailLightMat, -fz], [0.62, tailLightMat, -fz]].forEach(([x, m, z]) => {
      const l = new THREE.Mesh(hlGeo, m);
      l.position.set(x, fy, z);
      car.add(l);
    });
  }

  if (styleKey !== 'motorcycle') {
    const wp = buildWheels(car, styleKey === 'offroad' ? 1.12 : styleKey === 'truck' ? 1.18 : styleKey === 'suv' ? 1.08 : 1.02, 1.45, -1.45, spec.wheelR);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts;
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
  const pick = (straight && Math.random() < 0.55) ? straight
             : opts[Math.floor(Math.random() * opts.length)];
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
  g.userData.sigL = sigL;
  g.userData.sigR = sigR;
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
    const want = blocked === 2 ? 0 : blocked === 1 ? 3 : c.targetSpeed;
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
      if (c.dir === 0 || c.dir === 2) {
        c.signalL.material.emissiveIntensity = blink ? 1.5 : 0;
        c.signalR.material.emissiveIntensity = blink ? 1.5 : 0;
      } else {
        c.signalL.material.emissiveIntensity = blink ? 1.5 : 0;
        c.signalR.material.emissiveIntensity = blink ? 1.5 : 0;
      }
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
  const skinMat = lambert(0xd9a77c);
  const skinTones = [0xd9a77c, 0xc49060, 0xe8c4a0, 0xb08050, 0x8b6040];
  const shirtColors = [0x2e7fd4, 0xd4444e, 0x44aa66, 0xddaa33, 0x8844aa, 0x44aadd, 0xdd6644, 0x66bb88];
  for (let i = 0; i < 35; i++) {
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
    const walkStyle = Math.random();
    peds.push({ g, bx, bz, t: Math.random() * 180, speed: 1.1 + Math.random() * 1.1, walkStyle });
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
    p.g.rotation.y = h;
    if (p.g.userData.legL) {
      const sw = Math.sin(p.t * p.speed * 2) * 0.5;
      p.g.userData.legL.rotation.x = sw;
      p.g.userData.legR.rotation.x = -sw;
    }
  }
}

// ---------- Humanoid builder (player character + bots) ----------
function buildHumanoid(shirtHex, withGun) {
  const g = new THREE.Group();
  const shirt = lambert(shirtHex);
  const pants = lambert(0x2c3340);
  const skin = lambert(0xd9a77c);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), shirt);
  torso.position.y = 1.16; torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skin);
  head.position.y = 1.66;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eyeL.position.set(-0.07, 1.68, 0.17);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.07;
  const limbs = {};
  const armGeo = new THREE.BoxGeometry(0.14, 0.56, 0.14);
  armGeo.translate(0, -0.28, 0);
  const legGeo = new THREE.BoxGeometry(0.17, 0.62, 0.17);
  legGeo.translate(0, -0.31, 0);
  limbs.armL = new THREE.Mesh(armGeo, shirt); limbs.armL.position.set(-0.36, 1.42, 0);
  limbs.armR = new THREE.Mesh(armGeo, shirt); limbs.armR.position.set(0.36, 1.42, 0);
  limbs.legL = new THREE.Mesh(legGeo, pants); limbs.legL.position.set(-0.15, 0.86, 0);
  limbs.legR = new THREE.Mesh(legGeo, pants); limbs.legR.position.set(0.15, 0.86, 0);
  [limbs.armL, limbs.armR, limbs.legL, limbs.legR].forEach(m => { m.castShadow = true; g.add(m); });
  g.add(torso, head, eyeL, eyeR);
  let gun = null;
  if (withGun) {
    const gunGroup = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), lambert(0x1a1d22));
    barrel.position.z = 0.28;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), lambert(0x2a2d32));
    grip.position.set(0, -0.1, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.15), lambert(0x3a3530));
    stock.position.set(0, 0, -0.2);
    gunGroup.add(barrel, grip, stock);
    gunGroup.position.set(0.36, 0.82, 0.34);
    gun = gunGroup;
    g.add(gunGroup);
  }
  g.userData = { limbs, gun, torso, head };
  return g;
}
function animateHumanoid(g, walkPhase, moving, aiming) {
  const { limbs, gun } = g.userData;
  const sw = moving ? Math.sin(walkPhase) * 0.7 : 0;
  limbs.legL.rotation.x = sw;
  limbs.legR.rotation.x = -sw;
  if (aiming && gun) {
    limbs.armR.rotation.x = -1.35;
    limbs.armL.rotation.x = -1.1;
    gun.position.set(0.36, 1.32, 0.5);
  } else {
    limbs.armL.rotation.x = -sw * 0.8;
    limbs.armR.rotation.x = sw * 0.8;
    if (gun) gun.position.set(0.36, 0.82, 0.34);
  }
}

// player character
const character = buildHumanoid(0x2e7fd4, true);
character.visible = false;
character.userData.gun.visible = false;
scene.add(character);
const charState = {
  pos: new THREE.Vector3(-150, CITY_Y, 8),
  vel: new THREE.Vector3(),
  heading: 0,
  grounded: true,
  jumps: 0,
  walkPhase: 0,
  hp: 100,
  lastHurt: -99,
};

// ---------- Battle-royale bots ----------
const bots = [];
function spawnBots(n) {
  for (let i = 0; i < n; i++) {
    const g = buildHumanoid(new THREE.Color().setHSL(Math.random(), 0.6, 0.45).getHex(), true);
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 110;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.position.set(x, groundAt(x, z, 50), z);
    scene.add(g);
    bots.push({
      g, hp: 100, cd: 1 + Math.random() * 2, alive: true, walkPhase: 0,
      strafeDir: Math.random() < 0.5 ? 1 : -1, retarget: 0, target: null,
      id: i + 1, accuracy: 0.3 + Math.random() * 0.4, aggression: Math.random(),
    });
  }
}
function clearBots() {
  for (const b of bots) scene.remove(b.g);
  bots.length = 0;
}
