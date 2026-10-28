'use strict';
// ============================================================
// entities.js — 3D model pipeline, player vehicles, traffic AI,
// pedestrians, police, helicopters, plane
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

// ---------- 3D model library ----------
// Vehicles, props & characters: Kenney Car Kit / Blocky Characters (CC0).
// Supercar: "Ferrari 458 Italia" by vicent091036, as bundled with the three.js car example.
// See models/CREDITS.md. Everything falls back to primitives if a file is missing.
const MODEL_BASE = /\/prototype(\/|$)/.test(location.pathname) ? '../models/' : 'models/';
const CHAR_KEYS = 'abcdefghijklmnopqr'.split('').map(c => 'char-' + c);
const MODEL_FILES = {
  'sedan': 'vehicles/sedan.glb', 'sedan-sports': 'vehicles/sedan-sports.glb',
  'hatchback-sports': 'vehicles/hatchback-sports.glb', 'taxi': 'vehicles/taxi.glb',
  'suv': 'vehicles/suv.glb', 'suv-luxury': 'vehicles/suv-luxury.glb', 'van': 'vehicles/van.glb',
  'truck': 'vehicles/truck.glb', 'police': 'vehicles/police.glb', 'race': 'vehicles/race.glb',
  'race-future': 'vehicles/race-future.glb', 'ambulance': 'vehicles/ambulance.glb',
  'firetruck': 'vehicles/firetruck.glb', 'delivery': 'vehicles/delivery.glb',
  'garbage-truck': 'vehicles/garbage-truck.glb',
  'cone': 'props/cone.glb', 'box': 'props/box.glb',
  'debris-tire': 'props/debris-tire.glb', 'debris-door': 'props/debris-door.glb',
  'debris-bumper': 'props/debris-bumper.glb',
};
CHAR_KEYS.forEach(k => { MODEL_FILES[k] = 'characters/character-' + k.slice(5) + '.glb'; });
const HEAVY_MODELS = { 'ferrari': 'vehicles/ferrari.glb' };  // Draco-compressed, loaded last

const modelCache = {};
const modelAnims = {};
const modelHue = {};           // dominant body hue per Kenney model (for paint jobs)
let modelsLoaded = false;      // core set finished (success or not)
let modelLoadProgress = 0;
const modelReadyCallbacks = [];
function onModelsReady(fn) { if (modelsLoaded) fn(); else modelReadyCallbacks.push(fn); }

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function loadAllModels() {
  const finish = () => {
    modelsLoaded = true; modelLoadProgress = 1;
    modelReadyCallbacks.splice(0).forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  };
  const failSafe = setTimeout(finish, 15000);
  loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js').then(() => {
    const loader = new THREE.GLTFLoader();
    const names = Object.keys(MODEL_FILES);
    let pending = names.length;
    const done = () => {
      modelLoadProgress = 1 - pending / names.length;
      if (pending === 0) { clearTimeout(failSafe); if (!modelsLoaded) finish(); loadHeavyModels(loader); }
    };
    names.forEach(name => {
      loader.load(MODEL_BASE + MODEL_FILES[name], (gltf) => {
        prepareModel(name, gltf);
        pending--; done();
      }, undefined, () => { console.log('No model: ' + MODEL_FILES[name]); pending--; done(); });
    });
  }).catch(() => { console.warn('GLTFLoader CDN unavailable — using primitive models'); clearTimeout(failSafe); finish(); });
}

function loadHeavyModels(loader) {
  loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js').then(() => {
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
    loader.setDRACOLoader(draco);
    for (const [name, file] of Object.entries(HEAVY_MODELS)) {
      loader.load(MODEL_BASE + file, (gltf) => {
        prepareModel(name, gltf);
        if (typeof onHeavyModelLoaded === 'function') onHeavyModelLoaded(name);
      }, undefined, () => console.log('No model: ' + file));
    }
  }).catch(() => console.warn('DRACOLoader unavailable — supercar uses fallback'));
}

function prepareModel(name, gltf) {
  const root = gltf.scene;
  root.traverse(c => {
    if (!c.isMesh) return;
    c.castShadow = true; c.receiveShadow = true;
    // Blocky characters ship unlit; light them like the rest of the world
    if (c.material && c.material.type === 'MeshBasicMaterial') {
      c.material = new THREE.MeshLambertMaterial({ map: c.material.map, transparent: c.material.transparent });
    }
  });
  modelCache[name] = root;
  modelAnims[name] = gltf.animations || [];
  if (MODEL_FILES[name] && MODEL_FILES[name].startsWith('vehicles/')) modelHue[name] = detectBodyHue(root);
}

loadAllModels();

// ---------- Paint jobs (hue swap on Kenney palette textures) ----------
let _paletteData = null;
function paletteData(tex) {
  if (_paletteData) return _paletteData;
  const img = tex && tex.image;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  _paletteData = { w: cv.width, h: cv.height, d: g.getImageData(0, 0, cv.width, cv.height).data };
  return _paletteData;
}
function detectBodyHue(root) {
  const body = root.getObjectByName('body');
  if (!body || !body.isMesh || !body.material.map) return -1;
  const pal = paletteData(body.material.map);
  const uv = body.geometry.attributes.uv;
  if (!pal || !uv) return -1;
  const bins = new Float32Array(36);
  const c = new THREE.Color(), hsl = {};
  for (let i = 0; i < uv.count; i++) {
    const px = Math.min(pal.w - 1, Math.max(0, Math.floor(uv.getX(i) * pal.w)));
    const py = Math.min(pal.h - 1, Math.max(0, Math.floor(uv.getY(i) * pal.h)));
    const o = (py * pal.w + px) * 4;
    c.setRGB(pal.d[o] / 255, pal.d[o + 1] / 255, pal.d[o + 2] / 255).getHSL(hsl);
    if (hsl.s > 0.35 && hsl.l > 0.2 && hsl.l < 0.85) bins[Math.floor(hsl.h * 36) % 36] += hsl.s;
  }
  let best = -1, bw = uv.count * 0.04;
  for (let i = 0; i < 36; i++) if (bins[i] > bw) { bw = bins[i]; best = i; }
  return best < 0 ? -1 : (best + 0.5) / 36;
}
const HSV_GLSL = `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
uniform float uSrcHue; uniform vec3 uDstHsv;
`;
function paintMaterial(base, srcHue, colorHex) {
  const m = base.clone();
  const hsl = {};
  new THREE.Color(colorHex).getHSL(hsl);
  const v = hsl.l + hsl.s * Math.min(hsl.l, 1 - hsl.l);
  const sv = v > 0 ? 2 * (1 - hsl.l / v) : 0;
  m.userData.paintUniforms = {
    uSrcHue: { value: srcHue },
    uDstHsv: { value: new THREE.Vector3(hsl.h, sv, v) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.paintUniforms);
    sh.fragmentShader = HSV_GLSL + sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 texelColor = texture2D( map, vUv );
  vec3 hsv = rgb2hsv( texelColor.rgb );
  float dh = abs( hsv.x - uSrcHue ); dh = min( dh, 1.0 - dh );
  if ( uSrcHue >= 0.0 && dh < 0.06 && hsv.y > 0.3 ) {
    float shade = hsv.z / 0.85;
    texelColor.rgb = hsv2rgb( vec3( uDstHsv.x, uDstHsv.y, clamp( uDstHsv.z * shade, 0.04, 1.0 ) ) );
  }
  texelColor = mapTexelToLinear( texelColor );
  diffuseColor *= texelColor;
#endif`);
  };
  m.customProgramCacheKey = () => 'kenney-paint';
  return m;
}
function applyPaint(model, modelKey, colorHex) {
  const hue = modelHue[modelKey];
  if (hue === undefined || hue < 0 || colorHex == null) return;
  const cache = new Map();
  model.traverse(c => {
    if (!c.isMesh || !c.material || !c.material.map) return;
    if (!cache.has(c.material)) cache.set(c.material, paintMaterial(c.material, hue, colorHex));
    c.material = cache.get(c.material);
  });
}
function setPaint(model, colorHex) {
  const hsl = {};
  new THREE.Color(colorHex).getHSL(hsl);
  const v = hsl.l + hsl.s * Math.min(hsl.l, 1 - hsl.l);
  model.traverse(c => {
    if (c.isMesh && c.material && c.material.userData.paintUniforms)
      c.material.userData.paintUniforms.uDstHsv.value.set(hsl.h, v > 0 ? 2 * (1 - hsl.l / v) : 0, v);
  });
}

// Clone a cached model, scale it, rest it on y=0 and center it on x/z.
function instanceModel(key, scale, rotY) {
  const src = modelCache[key];
  if (!src) return null;
  const model = src.clone();
  const wrap = new THREE.Group();
  model.rotation.y = rotY || 0;
  model.scale.setScalar(scale);
  wrap.add(model);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  model.position.y -= box.min.y;
  wrap.userData.size = box.getSize(new THREE.Vector3());
  wrap.userData.model = model;
  return wrap;
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

function addLightDetails(group, size, opts) {
  const o = opts || {};
  const w = size.x, l = size.z, h = size.y;
  const hlGeo = new THREE.BoxGeometry(w * 0.16, h * 0.07, 0.05);
  const y = h * (o.lightY || 0.42);
  const zf = l / 2 - 0.02;
  [[-w * 0.3, headLightMat, zf], [w * 0.3, headLightMat, zf],
   [-w * 0.3, tailLightMat, -zf], [w * 0.3, tailLightMat, -zf]].forEach(([x, m, z]) => {
    const lt = new THREE.Mesh(hlGeo, m);
    lt.position.set(x, y, z);
    group.add(lt);
  });
}

function addSirens(group, size) {
  const sirenL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0x001133 }));
  sirenL.position.set(-0.35, size.y + 0.06, -0.1);
  const sirenR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0x330000 }));
  sirenR.position.set(0.35, size.y + 0.06, -0.1);
  group.add(sirenL, sirenR);
  return { sirenL, sirenR };
}

// ---------- Procedural fallback geometry ----------
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

// ---------- Vehicle roster ----------
// accel m/s², maxSpeed m/s (×3.6 = km/h). price in $, level = required player level.
const VEHICLES = {
  hatch:     { name: 'Hatchback',     model: 'hatchback-sports', accel: 17, maxSpeed: 42, grip: 9,    turn: 1.65, offroadPenalty: 0.35, weight: 0.95, price: 0,     level: 1,  icon: '🚗', perk: 'Zippy and forgiving' },
  sedan:     { name: 'Sedan',         model: 'sedan',            accel: 16, maxSpeed: 45, grip: 8.5,  turn: 1.5,  offroadPenalty: 0.35, weight: 1.0,  price: 0,     level: 1,  icon: '🚘', perk: 'Reliable all-rounder' },
  taxi:      { name: 'Taxi',          model: 'taxi',             accel: 17, maxSpeed: 46, grip: 8.5,  turn: 1.55, offroadPenalty: 0.35, weight: 1.0,  price: 1500,  level: 2,  icon: '🚕', perk: '+30% delivery pay', paint: false, deliveryBonus: 0.3 },
  van:       { name: 'Delivery Van',  model: 'delivery',         accel: 13, maxSpeed: 40, grip: 8,    turn: 1.25, offroadPenalty: 0.3,  weight: 1.5,  price: 2500,  level: 2,  icon: '🚐', perk: '+60% delivery pay', deliveryBonus: 0.6 },
  suv:       { name: 'SUV',           model: 'suv',              accel: 16, maxSpeed: 44, grip: 8.5,  turn: 1.35, offroadPenalty: 0.1,  weight: 1.3,  price: 4000,  level: 3,  icon: '🚙', perk: 'Great off-road' },
  pickup:    { name: 'Pickup',        model: 'truck',            accel: 15, maxSpeed: 45, grip: 8,    turn: 1.3,  offroadPenalty: 0.08, weight: 1.6,  price: 5500,  level: 4,  icon: '🛻', perk: 'Off-road beast, heavy hitter' },
  muscle:    { name: 'Street Sport',  model: 'sedan-sports',     accel: 22, maxSpeed: 54, grip: 6.8,  turn: 1.55, offroadPenalty: 0.4,  weight: 1.1,  price: 9000,  level: 5,  icon: '🏁', perk: '+30% drift points', driftBonus: 0.3 },
  moto:      { name: 'Motorcycle',    model: null, proc: 'motorcycle', accel: 23, maxSpeed: 58, grip: 7.5, turn: 1.85, offroadPenalty: 0.35, weight: 0.5, price: 11000, level: 6, icon: '🏍️', perk: 'Tiny, agile, explosive launch' },
  ambulance: { name: 'Ambulance',     model: 'ambulance',        accel: 17, maxSpeed: 48, grip: 8.5,  turn: 1.35, offroadPenalty: 0.3,  weight: 1.6,  price: 13000, level: 7,  icon: '🚑', perk: 'Siren scatters pedestrians', paint: false, siren: true },
  luxury:    { name: 'Luxury SUV',    model: 'suv-luxury',       accel: 20, maxSpeed: 52, grip: 9,    turn: 1.45, offroadPenalty: 0.1,  weight: 1.3,  price: 16000, level: 8,  icon: '💎', perk: 'Fast, plush and off-road ready' },
  police:    { name: 'Interceptor',   model: 'police',           accel: 22, maxSpeed: 56, grip: 9.5,  turn: 1.55, offroadPenalty: 0.35, weight: 1.15, price: 22000, level: 9,  icon: '🚓', perk: 'Wanted level cools 2x faster', paint: false, siren: true, copPerk: true },
  firetruck: { name: 'Fire Truck',    model: 'firetruck',        accel: 14, maxSpeed: 42, grip: 8,    turn: 1.15, offroadPenalty: 0.2,  weight: 2.4,  price: 18000, level: 10, icon: '🚒', perk: 'Bulldozes props, double smash pts', paint: false, siren: true, smashBonus: 1 },
  rally:     { name: 'Rally Racer',   model: 'race',             accel: 27, maxSpeed: 62, grip: 9.8,  turn: 1.75, offroadPenalty: 0.12, weight: 0.9,  price: 32000, level: 11, icon: '🏎️', perk: 'Race-tuned, flies off-road' },
  hyper:     { name: 'Hyper Concept', model: 'race-future',      accel: 31, maxSpeed: 68, grip: 10,   turn: 1.75, offroadPenalty: 0.35, weight: 0.9,  price: 55000, level: 13, icon: '🛸', perk: '+50% nitro tank', nitroBonus: 0.5 },
  italia:    { name: 'Italia 458',    model: 'ferrari', heavy: true, accel: 33, maxSpeed: 74, grip: 10.5, turn: 1.7, offroadPenalty: 0.4, weight: 1.0, price: 90000, level: 15, icon: '🏆', perk: 'Photoreal V8 supercar' },
};
const KENNEY_SCALE = 1.5;
const PAINTS = [
  { name: 'Factory', hex: null,     price: 0 },
  { name: 'Racing Red', hex: 0xd8342c, price: 0 },
  { name: 'Ocean Blue', hex: 0x2e7fd4, price: 0 },
  { name: 'Snow White', hex: 0xe8e6e0, price: 0 },
  { name: 'Midnight', hex: 0x22252c, price: 600 },
  { name: 'Lime Rush', hex: 0x7ed321, price: 900 },
  { name: 'Sunburst', hex: 0xf2a33a, price: 900 },
  { name: 'Hot Pink', hex: 0xff4fa3, price: 1200 },
  { name: 'Royal Purple', hex: 0x7b3fe4, price: 1200 },
  { name: 'Teal Dream', hex: 0x18b7a5, price: 1500 },
  { name: 'Gold Rush', hex: 0xd4af37, price: 5000 },
];

function buildProceduralCar(styleKey, colorHex) {
  const car = new THREE.Group();
  const bodyMat = standard(colorHex == null ? 0xd8342c : colorHex, 0.32, 0.65);
  const darkMat = standard(0x15171c, 0.6, 0.3);
  const glassMat = standard(0x1e2a36, 0.1, 0.9, { transparent: true, opacity: 0.55 });
  const parts = { bodyMat, spinSign: 1 };
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
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8), standard(0xaaaaaa, 0.15, 0.9));
    exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0.25, 0.5, -0.7);
    car.add(body, tank, seat, fender, hl, exhaust);
    const wp = buildMotorcycleWheels(car, 0.36);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts; parts.wheelR = 0.36;
    // rider
    const riderMat = lambert(0x24303c);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.3), riderMat);
    torso.position.set(0, 1.35, -0.1); torso.rotation.x = 0.35;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), standard(colorHex == null ? 0xd8342c : colorHex, 0.3, 0.5));
    helmet.position.set(0, 1.78, 0.08);
    car.add(torso, helmet);
    parts.size = new THREE.Vector3(0.6, 1.9, 2.4);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.4), bodyMat);
    body.position.y = 0.62; body.castShadow = true;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 1.5), bodyMat);
    hood.position.set(0, 0.84, 1.35); hood.rotation.x = 0.055; hood.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 2.0), glassMat);
    cabin.position.set(0, 1.05, -0.35); cabin.castShadow = true;
    car.add(body, hood, cabin);
    const wp = buildWheels(car, 1.02, 1.45, -1.45, 0.4);
    parts.wheels = wp.wheels; parts.fronts = wp.fronts; parts.wheelR = 0.4;
    parts.size = new THREE.Vector3(2.0, 1.3, 4.4);
    addLightDetails(car, parts.size, { lightY: 0.6 });
  }
  car.userData = parts;
  return car;
}

function tagWheels(nodes) {
  nodes.forEach(n => { n.rotation.order = 'YXZ'; });
  return nodes;
}

function buildModelCar(spec, colorHex) {
  if (spec.model === 'ferrari') {
    const wrap = instanceModel('ferrari', 1.0, Math.PI);
    if (!wrap) return null;
    const model = wrap.userData.model;
    const paint = new THREE.MeshPhysicalMaterial({
      color: colorHex == null ? 0xc8101e : colorHex, metalness: 0.9, roughness: 0.45,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
    });
    const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.5 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transparent: true, opacity: 0.25 });
    const body = model.getObjectByName('body');
    if (body) body.traverse(c => { if (c.isMesh) c.material = paint; });
    ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim'].forEach(n => {
      const o = model.getObjectByName(n);
      if (o) o.traverse(c => { if (c.isMesh) c.material = details; });
    });
    const gl = model.getObjectByName('glass');
    if (gl) gl.traverse(c => { if (c.isMesh) c.material = glass; });
    // baked ambient-occlusion contact shadow, as in the three.js car demo
    const ao = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load(MODEL_BASE + 'vehicles/ferrari_ao.png'),
        blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, depthWrite: false }));
    ao.rotation.x = -Math.PI / 2; ao.position.y = 0.02; ao.renderOrder = 2;
    wrap.add(ao);
    const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(n => model.getObjectByName(n)).filter(Boolean);
    wrap.userData = Object.assign(wrap.userData, {
      wheels: tagWheels(wheels), fronts: wheels.slice(0, 2), wheelR: 0.36, spinSign: -1,
      bodyMat: paint, paintMode: 'physical',
      steeringWheel: null,
    });
    return wrap;
  }
  const wrap = instanceModel(spec.model, KENNEY_SCALE, 0);
  if (!wrap) return null;
  const model = wrap.userData.model;
  if (spec.paint !== false && colorHex != null) applyPaint(model, spec.model, colorHex);
  const wheels = tagWheels(findNodes(model, ['wheel-']));
  wrap.userData = Object.assign(wrap.userData, {
    wheels, fronts: wheels.filter(w => w.name.indexOf('front') >= 0),
    wheelR: 0.3 * KENNEY_SCALE, spinSign: 1, paintMode: 'hue', steeringWheel: null,
  });
  addLightDetails(wrap, wrap.userData.size);
  if (spec.siren) Object.assign(wrap.userData, addSirens(wrap, wrap.userData.size));
  return wrap;
}

function buildPlayerCar(styleKey, colorHex) {
  const spec = VEHICLES[styleKey];
  let car = spec.model ? buildModelCar(spec, colorHex) : null;
  if (!car) car = buildProceduralCar(spec.proc || 'car', colorHex);
  const size = car.userData.size;
  const headlight = new THREE.SpotLight(0xfff4c8, 0, 70, 0.5, 0.45);
  headlight.position.set(0, size.y * 0.5, size.z / 2);
  const hlTarget = new THREE.Object3D(); hlTarget.position.set(0, 0, 25);
  car.add(headlight, hlTarget);
  headlight.target = hlTarget;
  car.userData.headlight = headlight;
  // nitro flames
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.14, 0.9, 8);
  flameGeo.rotateX(-Math.PI / 2);
  const flames = [];
  const fx = spec.proc === 'motorcycle' ? [0.25] : [-size.x * 0.25, size.x * 0.25];
  fx.forEach(x => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(x, size.y * 0.22, -size.z / 2 - 0.45);
    f.visible = false;
    car.add(f); flames.push(f);
  });
  car.userData.flames = flames;
  car.userData.styleKey = styleKey;
  return car;
}

let carStyle = 'hatch';
let carColor = null;
let car = buildPlayerCar(carStyle, carColor);
scene.add(car);

const carState = {
  pos: new THREE.Vector3(-150, CITY_Y, 3),
  vel: new THREE.Vector3(),
  heading: Math.PI / 2,
  wheelSpin: 0,
  grounded: true,
  visualRoll: 0, visualPitch: 0,
  airTime: 0, slopeVy: 0,
};
function swapCar(styleKey, colorHex) {
  const wasVisible = car.visible;
  scene.remove(car);
  carStyle = styleKey; carColor = colorHex;
  car = buildPlayerCar(styleKey, colorHex);
  car.visible = wasVisible;
  scene.add(car);
  car.position.copy(carState.pos);
  car.rotation.set(0, carState.heading, 0);
}
function repaintCar(colorHex) {
  carColor = colorHex;
  const ud = car.userData;
  if (ud.paintMode === 'physical' && ud.bodyMat) ud.bodyMat.color.set(colorHex == null ? 0xc8101e : colorHex);
  else swapCar(carStyle, colorHex);
}
function carSupportsPaint(styleKey) {
  const spec = VEHICLES[styleKey];
  if (spec.paint === false) return false;
  if (!spec.model) return true;
  if (spec.model === 'ferrari') return true;
  return modelHue[spec.model] === undefined || modelHue[spec.model] >= 0;
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
const TRAFFIC_MODELS = ['sedan', 'sedan', 'hatchback-sports', 'suv', 'van', 'truck', 'taxi', 'taxi', 'delivery',
  'sedan-sports', 'suv-luxury', 'garbage-truck', 'ambulance'];
const NO_PAINT_MODELS = { taxi: 1, police: 1, ambulance: 1, firetruck: 1, 'garbage-truck': 1 };

function buildProceduralTraffic(colorHex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.0), lambert(colorHex));
  body.position.y = 0.68; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 1.8), lambert(0x20242b));
  cabin.position.set(0, 1.15, -0.2);
  g.add(body, cabin);
  const parts = buildWheels(g, 0.98, 1.3, -1.35, 0.36);
  g.userData = { wheels: parts.wheels, size: new THREE.Vector3(1.9, 1.4, 4.0), wheelR: 0.36 };
  addLightDetails(g, g.userData.size, { lightY: 0.5 });
  return g;
}
// Returns a visual (Group) with userData {wheels, sigL, sigR, size}
function buildTrafficVisual(colorHex, modelKey) {
  let v = null;
  if (modelKey && modelCache[modelKey]) {
    v = instanceModel(modelKey, KENNEY_SCALE, 0);
    const model = v.userData.model;
    if (!NO_PAINT_MODELS[modelKey]) applyPaint(model, modelKey, colorHex);
    const wheels = tagWheels(findNodes(model, ['wheel-']));
    v.userData.wheels = wheels;
    v.userData.wheelR = 0.3 * KENNEY_SCALE;
    addLightDetails(v, v.userData.size);
  } else {
    v = buildProceduralTraffic(colorHex);
  }
  const size = v.userData.size;
  const sigGeo = new THREE.BoxGeometry(0.15, 0.1, 0.06);
  const sigL = new THREE.Mesh(sigGeo, signalMat);
  sigL.position.set(size.x / 2 - 0.1, size.y * 0.42, size.z / 2);
  const sigR = new THREE.Mesh(sigGeo, signalMat);
  sigR.position.set(-size.x / 2 + 0.1, size.y * 0.42, size.z / 2);
  v.add(sigL, sigR);
  v.userData.sigL = sigL; v.userData.sigR = sigR;
  return v;
}
function setCarVisual(c, visual) {
  if (c.visual) c.group.remove(c.visual);
  c.visual = visual;
  c.group.add(visual);
  c.wheels = visual.userData.wheels;
  c.wheelR = visual.userData.wheelR || 0.36;
  c.signalL = visual.userData.sigL;
  c.signalR = visual.userData.sigR;
}
for (let i = 0; i < 24; i++) {
  const dir = Math.floor(Math.random() * 4);
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const s = (Math.random() - 0.5) * 340;
  const nI = nextIntersection(s, dir);
  if (nI === null) { i--; continue; }
  const color = trafficColors[i % trafficColors.length];
  const c = {
    dir, road, s, nextI: nI,
    speed: 0, targetSpeed: 8 + Math.random() * 5,
    heading: dirAngle[dir], spin: 0,
    group: new THREE.Group(), color,
    modelKey: TRAFFIC_MODELS[i % TRAFFIC_MODELS.length],
    pos: new THREE.Vector3(),
    turnSignal: 0,
    stopped: false, stopTimer: 0,
  };
  const p = aiXZ(c);
  if (Math.abs(p.x - carState.pos.x) < 16 && Math.abs(p.z - carState.pos.z) < 16) { i--; continue; }
  setCarVisual(c, buildTrafficVisual(color, null));
  c.pos.set(p.x, CITY_Y, p.z);
  c.group.position.copy(c.pos);
  c.group.rotation.y = c.heading;
  scene.add(c.group);
  aiCars.push(c);
}
onModelsReady(() => {
  for (const c of aiCars) setCarVisual(c, buildTrafficVisual(c.color, c.modelKey));
});

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
    if (Math.abs(carState.pos.y - CITY_Y) < 3) check(carState.pos.x, carState.pos.z);
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
    c.spin += c.speed * dt / c.wheelR;
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
const PED_PATH = 180;  // perimeter of a block's sidewalk loop
function buildProceduralPed() {
  const g = new THREE.Group();
  const skinTones = [0xd9a77c, 0xc49060, 0xe8c4a0, 0xb08050, 0x8b6040];
  const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.55, 0.45).convertSRGBToLinear() });
  const pants = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(Math.random() * 0.1 + 0.6, 0.2, 0.25).convertSRGBToLinear() });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8), shirt);
  body.position.y = 0.8; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 8), lambert(skinTones[Math.floor(Math.random() * skinTones.length)]));
  head.position.y = 1.5;
  const legGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
  legGeo.translate(0, -0.2, 0);
  const legL = new THREE.Mesh(legGeo, pants); legL.position.set(-0.1, 0.6, 0);
  const legR = new THREE.Mesh(legGeo, pants); legR.position.set(0.1, 0.6, 0);
  g.add(body, head, legL, legR);
  g.userData = { legL, legR };
  return g;
}
function setPedVisual(p) {
  if (p.visual) p.g.remove(p.visual);
  p.mixer = null; p.actions = {}; p.anim = null; p.cur = null;
  const key = CHAR_KEYS[p.charIdx % CHAR_KEYS.length];
  if (modelCache[key]) {
    const wrap = instanceModel(key, 1, 0);
    const h = wrap.userData.size.y || 1;
    wrap.scale.setScalar(1.75 / h);
    p.visual = wrap;
    p.mixer = new THREE.AnimationMixer(wrap.userData.model);
    for (const clip of modelAnims[key]) p.actions[clip.name] = p.mixer.clipAction(clip);
    const die = p.actions['die'];
    if (die) { die.setLoop(THREE.LoopOnce); die.clampWhenFinished = true; }
    setPedAnim(p, 'walk');
  } else {
    p.visual = buildProceduralPed();
  }
  p.g.add(p.visual);
}
function setPedAnim(p, name) {
  if (!p.mixer || p.anim === name) return;
  const next = p.actions[name];
  if (!next) return;
  next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
  if (p.cur) p.cur.fadeOut(0.2);
  p.cur = next; p.anim = name;
}
for (let i = 0; i < 40; i++) {
  const p = {
    g: new THREE.Group(),
    bx: BLOCK_CENTERS[Math.floor(Math.random() * BLOCK_CENTERS.length)],
    bz: BLOCK_CENTERS[Math.floor(Math.random() * BLOCK_CENTERS.length)],
    t: Math.random() * PED_PATH, speed: 1.1 + Math.random() * 0.9,
    charIdx: i, state: 'walk', stateT: 0, ko: null,
  };
  setPedVisual(p);
  scene.add(p.g);
  peds.push(p);
}
onModelsReady(() => { for (const p of peds) setPedVisual(p); });

// Launch a pedestrian like a bowling pin; they dust themselves off a few seconds later.
function knockPed(p, vx, vz) {
  if (p.state === 'ko') return;
  p.state = 'ko'; p.stateT = 0;
  const sp = Math.hypot(vx, vz);
  p.ko = { vx: vx * 0.8, vy: 4 + sp * 0.25, vz: vz * 0.8, spin: (Math.random() - 0.5) * 12 };
  setPedAnim(p, 'die');
}
function scarePeds(x, z, radius, mode) {
  for (const p of peds) {
    if (p.state === 'ko' || !p.wx) continue;
    if (Math.hypot(p.wx - x, p.wz - z) > radius) continue;
    p.state = mode; p.stateT = 0;
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    p.stateT += dt;
    if (p.mixer) p.mixer.update(dt);
    if (p.state === 'ko') {
      const k = p.ko;
      if (p.stateT < 3.5) {
        k.vy -= 20 * dt;
        p.g.position.x += k.vx * dt; p.g.position.z += k.vz * dt;
        p.g.position.y = Math.max(CITY_Y + 0.3, p.g.position.y + k.vy * dt);
        if (p.g.position.y <= CITY_Y + 0.3) { k.vx *= 0.9; k.vz *= 0.9; k.vy = Math.abs(k.vy) * 0.3; k.spin *= 0.7; }
        p.g.rotation.x += k.spin * dt;
        p.wx = null;
        continue;
      }
      p.state = 'walk'; p.g.rotation.x = 0; p.t = Math.random() * PED_PATH;
      setPedAnim(p, 'walk');
    }
    let mult = 1;
    if (p.state === 'flee') { mult = 2.8; setPedAnim(p, 'sprint'); if (p.stateT > 3) { p.state = 'walk'; setPedAnim(p, 'walk'); } }
    else if (p.state === 'wave') { mult = 0; setPedAnim(p, 'emote-yes'); if (p.stateT > 1.8) { p.state = 'walk'; setPedAnim(p, 'walk'); } }
    p.t = (p.t + p.speed * mult * dt) % PED_PATH;
    const seg = Math.floor(p.t / 45), u = (p.t % 45) - 22.5;
    let x, z, h;
    if (seg === 0) { x = u; z = -22.5; h = Math.PI / 2; }
    else if (seg === 1) { x = 22.5; z = u; h = 0; }
    else if (seg === 2) { x = -u; z = 22.5; h = -Math.PI / 2; }
    else { x = -22.5; z = -u; h = Math.PI; }
    p.g.position.set(p.bx + x, CITY_Y + 0.3, p.bz + z);
    p.wx = p.bx + x;
    p.wz = p.bz + z;
    p.g.rotation.y = h;
    const legs = p.visual.userData;
    if (legs.legL) {
      const bounce = Math.abs(Math.sin(p.t * 6)) * 0.04;
      p.g.position.y += bounce;
      const sw = Math.sin(p.t * p.speed * 2) * 0.5;
      legs.legL.rotation.x = sw;
      legs.legR.rotation.x = -sw;
    }
  }
}

// ---------- Cop cars ----------
const copCars = [];
let wantedLevel = 0;
let copCooldown = 0;
function buildCopVisual() {
  let v;
  if (modelCache['police']) {
    v = instanceModel('police', KENNEY_SCALE, 0);
    v.userData.wheels = tagWheels(findNodes(v.userData.model, ['wheel-']));
    v.userData.wheelR = 0.3 * KENNEY_SCALE;
    addLightDetails(v, v.userData.size);
  } else {
    v = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.0), standard(0x1a1a2e, 0.4, 0.5));
    body.position.y = 0.68; body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 1.8), lambert(0x20242b));
    cabin.position.set(0, 1.15, -0.2);
    v.add(body, cabin);
    const parts = buildWheels(v, 0.98, 1.3, -1.35, 0.36);
    v.userData = { wheels: parts.wheels, wheelR: 0.36, size: new THREE.Vector3(1.9, 1.42, 4.0) };
    addLightDetails(v, v.userData.size, { lightY: 0.5 });
  }
  Object.assign(v.userData, addSirens(v, v.userData.size));
  return v;
}
function spawnCop() {
  const dir = Math.floor(Math.random() * 4);
  const road = ROADS[Math.floor(Math.random() * ROADS.length)];
  const s = (Math.random() - 0.5) * 300;
  const nI = nextIntersection(s, dir);
  if (nI === null) return;
  const group = new THREE.Group();
  const v = buildCopVisual();
  group.add(v);
  const c = {
    dir, road, s, nextI: nI,
    speed: 0, targetSpeed: 14,
    heading: dirAngle[dir], spin: 0,
    group, wheels: v.userData.wheels, wheelR: v.userData.wheelR,
    pos: new THREE.Vector3(),
    chasing: true, active: true,
    sirenL: v.userData.sirenL,
    sirenR: v.userData.sirenR,
  };
  const p = aiXZ(c);
  c.pos.set(p.x, CITY_Y, p.z);
  group.position.copy(c.pos);
  group.rotation.y = c.heading;
  scene.add(group);
  copCars.push(c);
}
function clearCops() {
  for (const c of copCars) if (c.active) { c.active = false; scene.remove(c.group); }
  copCars.length = 0;
}
function updateCops(dt) {
  copCooldown -= dt;
  for (const c of copCars) {
    if (!c.active) continue;
    const dx = carState.pos.x - c.group.position.x;
    const dz = carState.pos.z - c.group.position.z;
    const dist = Math.hypot(dx, dz);
    if ((wantedLevel >= 1 && dist > 250) || wantedLevel === 0) {
      c.active = false;
      scene.remove(c.group);
      continue;
    }
    if (dist > 40) {
      const angle = Math.atan2(dx, dz);
      let dh = angle - c.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.heading += dh * Math.min(1, dt * 2.5);
      c.targetSpeed = Math.min(22 + wantedLevel * 5, 12 + wantedLevel * 6);
    } else if (dist < 8 && copCooldown <= 0 && Math.abs(carState.pos.y - CITY_Y) < 3) {
      carState.vel.multiplyScalar(0.2);
      wantedLevel = Math.max(0, wantedLevel - 1);
      copCooldown = 3;
      if (typeof onPulledOver === 'function') onPulledOver();
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
    c.spin += c.speed * dt / c.wheelR;
    c.wheels.forEach(w => { w.rotation.x = c.spin; });
    const flash = Math.sin(performance.now() * 0.01) > 0;
    c.sirenL.material.color.set(flash ? 0x0066ff : 0x001133);
    c.sirenR.material.color.set(flash ? 0x330000 : 0xff3300);
  }
  for (let i = copCars.length - 1; i >= 0; i--) if (!copCars[i].active) copCars.splice(i, 1);
  const maxCops = Math.min(8, 1 + Math.floor(wantedLevel / 1.5));
  if (wantedLevel >= 1 && copCars.length < maxCops && copCooldown <= 0) {
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
    if (typeof onBusted === 'function') onBusted();
    if (typeof toast === 'function') toast('BUSTED!');
  }
}

function respawnPlayer() {
  playerHealth = playerMaxHealth;
  if (inPlane) exitPlane();
  carState.pos.set(-150, CITY_Y, 3);
  carState.vel.set(0, 0, 0);
  carState.heading = Math.PI / 2;
  if (car) { car.position.copy(carState.pos); car.rotation.set(0, carState.heading, 0); }
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
    const hud = h.group.userData;
    if (hud.blade1) hud.blade1.rotation.y += dt * 30;
    if (hud.blade2) hud.blade2.rotation.y += dt * 30;
    const flash = Math.sin(performance.now() * 0.008) > 0;
    if (hud.lightL) hud.lightL.material.color.set(flash ? 0x0066ff : 0x001133);
    if (hud.lightR) hud.lightR.material.color.set(flash ? 0xff3300 : 0x330000);
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
  if (typeof toast === 'function') toast('Plane! W/S throttle, A/D steer, Q/E pitch, P to land & exit');
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
  const thrust = ps.throttle * 45;
  const drag = 0.015 * ps.speed * ps.speed;
  ps.speed += (thrust - drag) * dt;
  ps.speed = Math.max(0, ps.speed);
  const lift = ps.speed > 10 ? (ps.speed - 10) * 0.5 : 0;
  const gravity = 8.0;
  if (ps.onGround) {
    ps.altitude = Math.max(0, ps.altitude);
    ps.roll *= 0.9;
    ps.pitch *= 0.9;
    if (ps.speed > 25 && lift > gravity * 1.05) {
      ps.onGround = false;
      if (typeof onPlaneTakeoff === 'function') onPlaneTakeoff();
      if (typeof toast === 'function') toast('Takeoff!');
    }
  } else {
    // A/D = yaw (steer left/right)
    ps.heading += input.moveX * 1.8 * dt * Math.max(0.5, ps.speed / 20);
    // Q/E = pitch (nose up/down)
    const pitchInput = keys['KeyQ'] ? 1 : keys['KeyE'] ? -1 : 0;
    ps.pitch += pitchInput * 2.5 * dt;
    ps.pitch += -ps.pitch * 1.5 * dt;
    ps.pitch = Math.max(-0.8, Math.min(0.8, ps.pitch));
    // Auto-bank: roll follows yaw input
    const targetRoll = -input.moveX * 0.8 * Math.min(1, ps.speed / 20);
    ps.roll += (targetRoll - ps.roll) * Math.min(1, dt * 5);
    ps.roll = Math.max(-1.2, Math.min(1.2, ps.roll));
    ps.altitude += (lift - gravity) * dt;
    ps.altitude += ps.pitch * ps.speed * 0.12 * dt;
    if (ps.altitude <= 0) {
      ps.altitude = 0;
      ps.onGround = true;
      if (ps.speed > 30 || Math.abs(ps.roll) > 0.5) {
        damagePlayer(30, 'Crash landing');
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
  plane.rotation.set(ps.pitch * 0.6, ps.heading, ps.roll * 0.5);
  if (plane.userData.prop) plane.userData.prop.rotation.z += ps.throttle * 45 * dt;
  carState.pos.copy(ps.pos);
  carState.heading = ps.heading;
}
