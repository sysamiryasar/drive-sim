'use strict';
// ============================================================
// world.js — renderer, terrain, biomes, city, sky, roads,
// traffic infrastructure, garage, ground queries
// ============================================================

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, Math.max(1, innerWidth) / Math.max(1, innerHeight), 0.1, 1800);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(Math.max(2, innerWidth), Math.max(2, innerHeight));
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);

function srgb(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
function lambert(hex, opts) {
  return new THREE.MeshLambertMaterial(Object.assign({ color: srgb(hex) }, opts || {}));
}
function standard(hex, rough, metal, opts) {
  return new THREE.MeshStandardMaterial(Object.assign(
    { color: srgb(hex), roughness: rough, metalness: metal }, opts || {}));
}

scene.fog = new THREE.Fog(new THREE.Color(0x9db8cc), 90, 700);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.color = srgb(0xfff0d8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 450;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x46543c, 0.8);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);

// ---------- World constants ----------
const MAP = 900, WATER_Y = 0.4, CITY_Y = 2, CITY_EDGE = 186, BLOCK = 2;
const ROADS = [-180, -120, -60, 0, 60, 120, 180];
const BLOCK_CENTERS = [-150, -90, -30, 30, 90, 150];

// ---------- Biomes ----------
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function tempAt(x, z) {
  return clamp01(0.5 + 0.42 * Math.sin(x * 0.006 + 1.7) * Math.cos(z * 0.0052 + 0.4)
                     + 0.22 * Math.sin(z * 0.011 - 2.1));
}
function moistAt(x, z) {
  return clamp01(0.5 + 0.42 * Math.cos(x * 0.008 - 0.8) * Math.sin(z * 0.0066 + 2.6)
                     + 0.22 * Math.sin((x + z) * 0.009 + 0.5));
}
const BIOME_TEMPS = ['Frozen', 'Cold', 'Temperate', 'Warm', 'Scorching'];
const BIOME_MOISTS = ['Barren', 'Arid', 'Fertile', 'Lush', 'Drenched'];
const BIOME_ELEVS = ['Flats', 'Plains', 'Hills', 'Highlands', 'Peaks'];
function biomeName(x, z, y) {
  if (cityMask(x, z) > 0.5) return 'Urban';
  const h = countrysideHeight(x, z);
  if (h < WATER_Y + 0.9) return 'Coastal Beach';
  const t = Math.min(4, Math.floor(tempAt(x, z) * 5));
  const m = Math.min(4, Math.floor(moistAt(x, z) * 5));
  const e = h < 1.5 ? 0 : h < 4.5 ? 1 : h < 7 ? 2 : h < 10 ? 3 : 4;
  return BIOME_TEMPS[t] + ' ' + BIOME_MOISTS[m] + ' ' + BIOME_ELEVS[e];
}

// ---------- Terrain ----------
function countrysideHeight(x, z) {
  let h = 1.5;
  h += Math.sin(x * 0.012 + 0.5) * Math.cos(z * 0.014 + 1.2) * 9.0;
  h += Math.sin(x * 0.025 + 3.1) * Math.cos(z * 0.022 + 0.7) * 4.5;
  h += Math.sin(x * 0.055 + 7.0) * Math.cos(z * 0.048 + 2.2) * 2.0;
  h += Math.sin(x * 0.110 + 1.3) * Math.cos(z * 0.095 + 4.1) * 0.6;
  return Math.max(0.2, h);
}
function cityMask(x, z) {
  const dx = Math.max(0, Math.abs(x) - 195), dz = Math.max(0, Math.abs(z) - 195);
  return 1 - Math.min(1, Math.max(dx, dz) / 60);
}
function terrainHeight(x, z) {
  const m = cityMask(x, z);
  return countrysideHeight(x, z) * (1 - m) + CITY_Y * m;
}
function terrainNormal(x, z) {
  const e = 0.6;
  return new THREE.Vector3(
    terrainHeight(x - e, z) - terrainHeight(x + e, z),
    2 * e,
    terrainHeight(x, z - e) - terrainHeight(x, z + e)
  ).normalize();
}
function inCity(x, z) { return Math.abs(x) < CITY_EDGE && Math.abs(z) < CITY_EDGE; }
function nearRoad(x, z) {
  if (!inCity(x, z)) return false;
  for (const L of ROADS) if (Math.abs(x - L) < 7 || Math.abs(z - L) < 7) return true;
  return false;
}
function surfaceGroundY(x, z) {
  if (inCity(x, z)) return nearRoad(x, z) ? CITY_Y : CITY_Y + 0.3;
  return terrainHeight(x, z);
}

const terrainGeo = new THREE.PlaneGeometry(MAP, MAP, 200, 200);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = [];
  const sand = srgb(0xd9c58a), grass = srgb(0x55953f), rock = srgb(0x8a8578),
        snow = srgb(0xeef1f6), urban = srgb(0x6b6e66), redrock = srgb(0xb5673c),
        dryGrass = srgb(0x9aa04f), deepGreen = srgb(0x2f6e33), mud = srgb(0x6b5a45);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    if (h < WATER_Y + 0.9) c.copy(sand);
    else if (h < 4.5) c.copy(grass).lerp(mud, 0.15);
    else if (h < 7.5) c.copy(grass).lerp(rock, Math.max(0, (h - 5.5) / 2));
    else if (h < 10.5) c.copy(rock);
    else c.copy(snow);
    const t = tempAt(x, z), mo = moistAt(x, z);
    if (h > WATER_Y + 0.9) {
      if (t < 0.28) c.lerp(snow, (0.28 - t) / 0.28 * 0.9);
      else if (t > 0.68 && mo < 0.4) { c.lerp(sand, 0.55); c.lerp(redrock, Math.max(0, (t - 0.68)) * 1.4); }
      else if (mo < 0.32) c.lerp(dryGrass, 0.55);
      else if (mo > 0.7) c.lerp(deepGreen, 0.45);
    }
    const m = cityMask(x, z);
    if (m > 0) c.lerp(urban, m);
    colors.push(c.r, c.g, c.b);
  }
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
terrain.receiveShadow = true;
scene.add(terrain);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP * 1.3, MAP * 1.3),
  standard(0x2a6da8, 0.15, 0.6, { transparent: true, opacity: 0.8 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = WATER_Y;
scene.add(water);

// ---------- Snow accumulation ----------
const snowAccumGeo = new THREE.PlaneGeometry(MAP, MAP, 120, 120);
snowAccumGeo.rotateX(-Math.PI / 2);
const snowAccumMat = new THREE.MeshLambertMaterial({ color: srgb(0xeef1f6), transparent: true, opacity: 0 });
const snowAccum = new THREE.Mesh(snowAccumGeo, snowAccumMat);
snowAccum.position.y = 0.08;
scene.add(snowAccum);

// ---------- Rain puddles ----------
const puddles = [];
{
  const pGeo = new THREE.CircleGeometry(1.5, 12);
  pGeo.rotateX(-Math.PI / 2);
  const pMat = standard(0x3a6a8a, 0.05, 0.8, { transparent: true, opacity: 0 });
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * (CITY_EDGE * 2);
    const z = (Math.random() - 0.5) * (CITY_EDGE * 2);
    const p = new THREE.Mesh(pGeo, pMat.clone());
    p.position.set(x, CITY_Y + 0.05, z);
    p.scale.setScalar(0.5 + Math.random() * 1.5);
    scene.add(p);
    puddles.push(p);
  }
}

// ---------- Procedural textures ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}
const roadTex = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#2b2d31'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#26282c' : '#323438';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.fillStyle = '#c9cdd3';
  g.fillRect(0, 6, w, 3); g.fillRect(0, h - 9, w, 3);
  g.fillStyle = '#d8b23c';
  g.fillRect(4, h / 2 - 2, 52, 4);
});
roadTex.repeat.set((CITY_EDGE * 2) / 12, 1);

// Crosswalk texture
const crosswalkTex = canvasTexture(64, 64, (g, w, h) => {
  g.fillStyle = '#2b2d31'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e0e0e0';
  for (let i = 0; i < 6; i++) {
    g.fillRect(0, i * 11 + 2, w, 7);
  }
});

function facadeMaterial(bg, winDay, litRatio) {
  const cols = 6, rows = 12, mx = 8, my = 8;
  const cw = (256 - mx * 2) / cols, ch = (512 - my * 2) / rows;
  const lit = [];
  for (let i = 0; i < cols * rows; i++) lit.push(Math.random() < litRatio);
  const map = canvasTexture(256, 512, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 512);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winDay;
      g.fillRect(mx + c * cw + 3, my + r * ch + 4, cw - 6, ch - 9);
    }
  });
  const emis = canvasTexture(256, 512, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 512);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!lit[r * cols + c]) continue;
      g.fillStyle = Math.random() < 0.75 ? '#ffd98a' : '#bcd6ff';
      g.fillRect(mx + c * cw + 3, my + r * ch + 4, cw - 6, ch - 9);
    }
  });
  return new THREE.MeshLambertMaterial({
    map, emissiveMap: emis, emissive: srgb(0xffffff), emissiveIntensity: 0,
  });
}
const facadeMats = [
  facadeMaterial('#8d99a6', '#31404f', 0.4), facadeMaterial('#6e7f8d', '#22303c', 0.35),
  facadeMaterial('#a89f91', '#3a3f46', 0.45), facadeMaterial('#4f5d6e', '#1d2733', 0.5),
  facadeMaterial('#9a8f83', '#333a41', 0.3), facadeMaterial('#7a8a96', '#2a3845', 0.38),
];
const roofMat = lambert(0x3a3f44);
const sidewalkMat = lambert(0x9a9da2);
const lampHeadMat = new THREE.MeshLambertMaterial({
  color: srgb(0x333333), emissive: srgb(0xffdf9e), emissiveIntensity: 0,
});

const buildingAABBs = [];
const buildingMeshes = [];
const cityGround = [];
const treeObstacles = [];
const pillarObstacles = [];

// ---------- Trees ----------
const trunkMat = lambert(0x6b4a2b);
const coniferMat = lambert(0x39763a);
const broadleafMat = lambert(0x4c8f3c);
const palmMat = lambert(0x55a044);
const cactusMat = lambert(0x4e7d3a);
const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.4, 7);
const coneGeo = new THREE.ConeGeometry(1.8, 4.2, 8);
const blobGeo = new THREE.SphereGeometry(1.7, 8, 6);
const frondGeo = new THREE.BoxGeometry(0.25, 0.08, 2.2);

const grassTufts = [];
const grassMats = [lambert(0x4a8a35), lambert(0x5a9a45), lambert(0x3a7a2a)];

function addTree(x, y, z, s, kind) {
  const g = new THREE.Group();
  if (kind === 'cactus') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 2.8, 8), cactusMat);
    body.position.y = 1.4; body.castShadow = true;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.1, 6), cactusMat);
    arm.position.set(0.55, 1.7, 0); arm.rotation.z = 0.5;
    g.add(body, arm);
  } else if (kind === 'palm') {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 4.4, 7), trunkMat);
    tr.position.y = 2.2; tr.rotation.z = 0.12; tr.castShadow = true;
    g.add(tr);
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(frondGeo, palmMat);
      f.position.set(0.5, 4.4, 0); f.rotation.y = (i / 6) * Math.PI * 2; f.rotation.x = 0.45;
      g.add(f);
    }
  } else if (kind === 'broadleaf') {
    const tr = new THREE.Mesh(trunkGeo, trunkMat);
    tr.position.y = 1.2; tr.castShadow = true;
    const lv = new THREE.Mesh(blobGeo, broadleafMat);
    lv.position.y = 3.2; lv.scale.set(1, 0.85, 1); lv.castShadow = true;
    g.add(tr, lv);
  } else {
    const tr = new THREE.Mesh(trunkGeo, trunkMat);
    tr.position.y = 1.2; tr.castShadow = true;
    const lv = new THREE.Mesh(coneGeo, coniferMat);
    lv.position.y = 4.2; lv.castShadow = true;
    g.add(tr, lv);
  }
  g.scale.setScalar(s);
  g.position.set(x, y, z);
  scene.add(g);
  treeObstacles.push({ x, z, r: 0.55 * s });
}
function biomeTreeKind(x, z) {
  const t = tempAt(x, z), m = moistAt(x, z);
  if (t < 0.32) return 'conifer';
  if (t > 0.7 && m < 0.38) return 'cactus';
  if (t > 0.62 && m >= 0.45) return 'palm';
  return 'broadleaf';
}

// ---------- Rocks ----------
const rockGeo = new THREE.DodecahedronGeometry(1, 1);
const rockMats = [lambert(0x7a7268), lambert(0x8a8278), lambert(0x6a6258)];
const rockObstacles = [];
function addRock(x, y, z, s) {
  const mat = rockMats[Math.floor(Math.random() * rockMats.length)];
  const rock = new THREE.Mesh(rockGeo, mat);
  rock.position.set(x, y + s * 0.4, z);
  rock.scale.set(s, s * 0.6, s);
  rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, 0);
  rock.castShadow = true;
  scene.add(rock);
  rockObstacles.push({ x, z, r: s * 0.7 });
}

// ---------- City ----------
function addBuilding(x, z, w, d, h) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const ru = Math.max(1, Math.round(Math.max(w, d) / 14));
  const rv = Math.max(1, Math.round(h / 34));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
  const side = facadeMats[Math.floor(Math.random() * facadeMats.length)];
  const mesh = new THREE.Mesh(geo, [side, side, roofMat, roofMat, side, side]);
  mesh.position.set(x, CITY_Y + 0.3 + h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  buildingMeshes.push(mesh);
  buildingAABBs.push({
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
    topY: CITY_Y + 0.3 + h,
  });
}

// ---------- Roads & traffic infrastructure ----------
const trafficLights = [];
const stopSigns = [];
const roadSigns = [];
const crosswalkZones = [];
const constructionZones = [];

{
  const stripGeo = new THREE.PlaneGeometry(CITY_EDGE * 2, 12);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  for (const L of ROADS) {
    const rx = new THREE.Mesh(stripGeo, roadMat);
    rx.rotation.x = -Math.PI / 2;
    rx.position.set(0, CITY_Y + 0.02, L);
    rx.receiveShadow = true;
    scene.add(rx); cityGround.push(rx);
    const rz = new THREE.Mesh(stripGeo, roadMat);
    rz.rotation.x = -Math.PI / 2; rz.rotation.z = Math.PI / 2;
    rz.position.set(L, CITY_Y + 0.026, 0);
    rz.receiveShadow = true;
    scene.add(rz); cityGround.push(rz);
  }
  const patchGeo = new THREE.PlaneGeometry(12.6, 12.6);
  const patchMat = lambert(0x2b2d31);
  for (const ix of ROADS) for (const iz of ROADS) {
    const p = new THREE.Mesh(patchGeo, patchMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(ix, CITY_Y + 0.032, iz);
    p.receiveShadow = true;
    scene.add(p);
  }

  // Sidewalks
  const sidewalkGeo = new THREE.BoxGeometry(60, 0.22, 3);
  for (const L of ROADS) {
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(sidewalkGeo, sidewalkMat);
      sw.position.set(0, CITY_Y + 0.11, L + side * 7.5);
      sw.receiveShadow = true;
      scene.add(sw);
      const swx = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 60), sidewalkMat);
      swx.position.set(L + side * 7.5, CITY_Y + 0.11, 0);
      swx.receiveShadow = true;
      scene.add(swx);
    }
  }

  // Street lamps
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6, 6);
  const poleMat = lambert(0x24262a);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 8);
  for (const ix of ROADS) for (const iz of ROADS) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(ix + 7.2, CITY_Y + 3, iz + 7.2);
    pole.castShadow = true;
    const head = new THREE.Mesh(headGeo, lampHeadMat);
    head.position.set(ix + 7.2, CITY_Y + 6.1, iz + 7.2);
    scene.add(pole, head);
  }

  // Parks
  const slabGeo = new THREE.BoxGeometry(48, 0.3, 48);
  const parkGeo = new THREE.PlaneGeometry(46, 46);
  const parkMat = lambert(0x4d8c3c);
  for (const cx of BLOCK_CENTERS) for (const cz of BLOCK_CENTERS) {
    const slab = new THREE.Mesh(slabGeo, sidewalkMat);
    slab.position.set(cx, CITY_Y + 0.15, cz);
    slab.receiveShadow = true;
    scene.add(slab); cityGround.push(slab);
    const isGarageBlock = cx === -150 && cz === -30;
    if (!isGarageBlock && Math.random() < 0.13) {
      const park = new THREE.Mesh(parkGeo, parkMat);
      park.rotation.x = -Math.PI / 2;
      park.position.set(cx, CITY_Y + 0.32, cz);
      park.receiveShadow = true;
      scene.add(park); cityGround.push(park);
      for (let i = 0; i < 5; i++) {
        addTree(cx + (Math.random() - 0.5) * 36, CITY_Y + 0.3,
                cz + (Math.random() - 0.5) * 36, 0.8 + Math.random() * 0.7, 'broadleaf');
      }
      continue;
    }
    const downtown = Math.max(Math.abs(cx), Math.abs(cz));
    const maxH = downtown < 40 ? 85 : downtown < 100 ? 48 : 24;
    for (const qx of [-11.5, 11.5]) for (const qz of [-11.5, 11.5]) {
      if (isGarageBlock && qx < 0 && qz > 0) continue;
      if (Math.random() < 0.25) continue;
      const w = 13 + Math.random() * 7, d = 13 + Math.random() * 7;
      const h = 9 + Math.random() * maxH;
      addBuilding(cx + qx, cz + qz, w, d, h);
    }
  }

  // === STOP SIGNS ===
  const stopSignTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#cc0000'; g.fillRect(0, 0, 64, 64);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
      const r = 28;
      if (i === 0) g.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      else g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', 32, 34);
  });
  const stopSignMat = new THREE.MeshLambertMaterial({ map: stopSignTex, side: THREE.DoubleSide });
  function addStopSign(x, z, rotY) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), poleMat);
    pole.position.set(x, CITY_Y + 1.5, z);
    scene.add(pole);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), stopSignMat);
    sign.position.set(x, CITY_Y + 3.2, z);
    sign.rotation.y = rotY;
    scene.add(sign);
    stopSigns.push({ x, z, radius: 8 });
  }

  // === TRAFFIC LIGHTS ===
  function addTrafficLight(x, z, rotY) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 6), lambert(0x222222));
    pole.position.y = 2.75;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.2), lambert(0x222222));
    arm.position.set(0, 5.2, 1.1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.4), lambert(0x1a1a1a));
    box.position.set(0, 5.0, 2.2);
    const rMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const yMat = new THREE.MeshBasicMaterial({ color: 0x332200 });
    const gMat = new THREE.MeshBasicMaterial({ color: 0x003300 });
    const rLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), rMat);
    rLight.position.set(0, 5.55, 2.41);
    const yLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), yMat);
    yLight.position.set(0, 5.0, 2.41);
    const gLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), gMat);
    gLight.position.set(0, 4.45, 2.41);
    g.add(pole, arm, box, rLight, yLight, gLight);
    g.position.set(x, CITY_Y, z);
    g.rotation.y = rotY;
    scene.add(g);
    const tl = {
      mesh: g, x, z, rotY,
      state: 'green', timer: Math.random() * 20 + 5,
      rMat, yMat, gMat,
      redDist: 18, yellowDist: 8,
    };
    trafficLights.push(tl);
  }

  // === CROSSWALKS ===
  function addCrosswalk(x, z, axis) {
    const cwGeo = new THREE.PlaneGeometry(axis === 'x' ? 10 : 2.5, axis === 'x' ? 2.5 : 10);
    cwGeo.rotateX(-Math.PI / 2);
    const cw = new THREE.Mesh(cwGeo, new THREE.MeshLambertMaterial({ map: crosswalkTex }));
    cw.position.set(x, CITY_Y + 0.035, z);
    scene.add(cw);
    crosswalkZones.push({ x, z, radius: 6, axis });
  }

  // === CONSTRUCTION ZONES ===
  function addConstruction(x, z, size) {
    const coneGeo2 = new THREE.ConeGeometry(0.25, 0.7, 6);
    const coneMat = new THREE.MeshLambertMaterial({ color: srgb(0xff6600) });
    const stripeMat = new THREE.MeshLambertMaterial({ color: srgb(0xffcc00) });
    for (let i = 0; i < 8; i++) {
      const cone = new THREE.Mesh(coneGeo2, coneMat);
      const cx2 = x + (Math.random() - 0.5) * size;
      const cz2 = z + (Math.random() - 0.5) * size;
      cone.position.set(cx2, CITY_Y + 0.35, cz2);
      scene.add(cone);
    }
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(size, 0.8, 0.3), stripeMat);
    barrier.position.set(x, CITY_Y + 0.4, z);
    scene.add(barrier);
    const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 5), poleMat);
    signPole.position.set(x + size * 0.6, CITY_Y + 1.25, z);
    scene.add(signPole);
    const detourTex = canvasTexture(64, 64, (g) => {
      g.fillStyle = '#ff6600'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#fff'; g.font = 'bold 12px Arial'; g.textAlign = 'center';
      g.fillText('ROAD', 32, 24); g.fillText('WORK', 32, 40);
    });
    const detourSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshLambertMaterial({ map: detourTex, side: THREE.DoubleSide }));
    detourSign.position.set(x + size * 0.6, CITY_Y + 2.5, z);
    detourSign.rotation.y = Math.PI / 4;
    scene.add(detourSign);
    constructionZones.push({ x, z, r: size * 0.7 });
  }

  // === ROAD SIGNS ===
  function addRoadSign(x, z, rotY, text, bgColor) {
    const tex = canvasTexture(64, 64, (g) => {
      g.fillStyle = bgColor || '#0066cc'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#fff'; g.font = 'bold 10px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const words = text.split(' ');
      if (words.length <= 2) { g.font = 'bold 14px Arial'; g.fillText(text, 32, 32); }
      else { g.font = 'bold 10px Arial'; words.forEach((w, i) => g.fillText(w, 32, 16 + i * 14)); }
    });
    const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 5), poleMat);
    pole2.position.set(x, CITY_Y + 1.4, z);
    scene.add(pole2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    sign.position.set(x, CITY_Y + 3.0, z);
    sign.rotation.y = rotY;
    scene.add(sign);
    roadSigns.push({ x, z, text });
  }

  // Place stop signs at key intersections
  for (const rx of ROADS) {
    for (const rz of ROADS) {
      if (rx === 0 && rz === 0) continue;
      const r = Math.random();
      if (r < 0.2) {
        addStopSign(rx + 8, rz + 4, 0);
        addStopSign(rx - 4, rz - 8, Math.PI);
      }
    }
  }

  // Place traffic lights at major intersections
  const majorIntersections = [
    [0, 0], [0, 60], [0, -60], [60, 0], [-60, 0],
    [0, 120], [0, -120], [120, 0], [-120, 0],
  ];
  for (const [tx, tz] of majorIntersections) {
    addTrafficLight(tx + 9, tz + 4, Math.PI / 2);
    addTrafficLight(tx - 4, tz - 9, -Math.PI / 2);
  }

  // Place crosswalks near intersections
  for (const rx of ROADS) {
    for (const rz of ROADS) {
      if (Math.random() < 0.4) {
        addCrosswalk(rx, rz + 8, 'x');
        addCrosswalk(rx + 8, rz, 'z');
      }
    }
  }

  // Place construction zones
  const constructionSpots = [
    [30, -90, 14], [-120, 60, 12], [90, 120, 10], [-60, -120, 11], [150, 0, 9],
  ];
  for (const [cx, cz, cs] of constructionSpots) addConstruction(cx, cz, cs);

  // Road signs
  addRoadSign(-185, 3, 0, 'CITY CENTER', '#0066cc');
  addRoadSign(185, -3, Math.PI, 'CITY LIMIT', '#0066cc');
  addRoadSign(0, -185, 0, 'NORTH AVE', '#0066cc');
  addRoadSign(0, 185, Math.PI, 'SOUTH AVE', '#0066cc');
  addRoadSign(-60, 190, Math.PI, 'PARKING\nAHEAD', '#0066cc');
  addRoadSign(120, -188, 0, 'YIELD\nAHEAD', '#cccc00');
}

// ---------- Garage ----------
const GARAGE = { x: -161.5, z: -18.5, hw: 8, hd: 7 };
{
  const wallMat = lambert(0x5a636e);
  const gx = GARAGE.x, gz = GARAGE.z;
  const back = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 0.6), wallMat);
  back.position.set(gx, CITY_Y + 3.3, gz - 7);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 14), wallMat);
  left.position.set(gx - 8, CITY_Y + 3.3, gz);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 14), wallMat);
  right.position.set(gx + 8, CITY_Y + 3.3, gz);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 15), lambert(0x2e343c));
  roof.position.set(gx, CITY_Y + 6.5, gz);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 0.3),
    new THREE.MeshLambertMaterial({ color: srgb(0x222222), emissive: srgb(0xffc94d), emissiveIntensity: 0.9 }));
  sign.position.set(gx, CITY_Y + 6, gz + 7.2);
  [back, left, right, roof].forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  scene.add(back, left, right, roof, sign);
  buildingAABBs.push({ minX: gx - 8.3, maxX: gx - 7.7, minZ: gz - 7, maxZ: gz + 7, topY: CITY_Y + 6.3 });
  buildingAABBs.push({ minX: gx + 7.7, maxX: gx + 8.3, minZ: gz - 7, maxZ: gz + 7, topY: CITY_Y + 6.3 });
  buildingAABBs.push({ minX: gx - 8, maxX: gx + 8, minZ: gz - 7.3, maxZ: gz - 6.7, topY: CITY_Y + 6.3 });
}

// ---------- Countryside vegetation ----------
{
  let placed = 0, tries = 0;
  while (placed < 300 && tries < 3000) {
    tries++;
    const x = (Math.random() - 0.5) * (MAP - 80);
    const z = (Math.random() - 0.5) * (MAP - 80);
    if (cityMask(x, z) > 0.02) continue;
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1.2 || h > 9.5) continue;
    const m = moistAt(x, z);
    if (Math.random() > m * 1.3 + 0.18) continue;
    addTree(x, h, z, 0.7 + Math.random() * 1.0, biomeTreeKind(x, z));
    placed++;
  }
}
{
  let placed = 0;
  while (placed < 80) {
    const x = (Math.random() - 0.5) * (MAP - 100);
    const z = (Math.random() - 0.5) * (MAP - 100);
    if (cityMask(x, z) > 0.02) continue;
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1.5 || h > 10) continue;
    addRock(x, h, z, 0.4 + Math.random() * 1.2);
    placed++;
  }
}
{
  const gGeo = new THREE.ConeGeometry(0.06, 0.35, 4);
  for (let i = 0; i < 400; i++) {
    const x = (Math.random() - 0.5) * (MAP - 100);
    const z = (Math.random() - 0.5) * (MAP - 100);
    if (cityMask(x, z) > 0.02) continue;
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1.5 || h > 8) continue;
    const m = moistAt(x, z);
    if (Math.random() > m * 0.8 + 0.15) continue;
    const mat = grassMats[Math.floor(Math.random() * grassMats.length)];
    const blade = new THREE.Mesh(gGeo, mat);
    blade.position.set(x, h + 0.15, z);
    blade.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    blade.scale.setScalar(0.8 + Math.random() * 0.5);
    scene.add(blade);
    grassTufts.push(blade);
  }
}

// ---------- Sky ----------
const skyGroup = new THREE.Group();
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    uTop: { value: new THREE.Color(0x2e74c4) },
    uBottom: { value: new THREE.Color(0xcfe3f2) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunI: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec3 vPos;
    void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vPos;
    uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir; uniform float uSunI; uniform float uTime;
    void main() {
      vec3 d = normalize(vPos);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uBottom, uTop, pow(h, 0.55));
      float s = max(dot(d, uSunDir), 0.0);
      col += vec3(1.0, 0.83, 0.55) * uSunI * (pow(s, 500.0) * 1.6 + pow(s, 6.0) * 0.13);
      vec3 sunColor = vec3(1.0, 0.6, 0.2);
      col += sunColor * uSunI * pow(s, 20.0) * 0.08;
      float haze = exp(-h * 3.0) * 0.12;
      col += vec3(0.7, 0.8, 0.9) * haze * uSunI;
      gl_FragColor = vec4(col, 1.0);
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 18), skyMat);
skyDome.renderOrder = -3;
skyGroup.add(skyDome);

const starGeo = new THREE.BufferGeometry();
{
  const pts = [];
  for (let i = 0; i < 800; i++) {
    const t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 0.95);
    pts.push(820 * Math.sin(p) * Math.cos(t), 820 * Math.cos(p), 820 * Math.sin(p) * Math.sin(t));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}
const starMat = new THREE.PointsMaterial({
  color: 0xffffff, size: 1.7, sizeAttenuation: false,
  transparent: true, opacity: 0, fog: false, depthWrite: false,
});
const stars = new THREE.Points(starGeo, starMat);
stars.renderOrder = -2;
skyGroup.add(stars);

const moonMat = new THREE.MeshBasicMaterial({ color: 0xe8edf5, transparent: true, opacity: 0, fog: false });
const moon = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 16), moonMat);
moon.renderOrder = -2;
skyGroup.add(moon);

const auroraMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uIntensity;
    void main() {
      float wave = sin(vUv.x * 6.0 + uTime * 0.3) * 0.3 + sin(vUv.x * 12.0 - uTime * 0.5) * 0.15;
      float band = smoothstep(0.3 + wave, 0.5 + wave, vUv.y) * smoothstep(0.8 - wave * 0.5, 0.6 - wave * 0.5, vUv.y);
      vec3 col = mix(vec3(0.1, 0.8, 0.4), vec3(0.2, 0.4, 0.9), sin(vUv.x * 3.0 + uTime * 0.2) * 0.5 + 0.5);
      gl_FragColor = vec4(col, band * uIntensity * 0.25);
    }`,
  transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
});
const aurora = new THREE.Mesh(new THREE.PlaneGeometry(600, 80, 32, 8), auroraMat);
aurora.position.set(0, 180, -300); aurora.rotation.x = -0.3; aurora.renderOrder = -1;
skyGroup.add(aurora);

const cloudMat = lambert(0xffffff, { transparent: true, opacity: 0.92 });
const clouds = [];
{
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 18; i++) {
    const cl = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.position.set(j * 9 - n * 4.5 + Math.random() * 4, Math.random() * 3, (Math.random() - 0.5) * 8);
      const s = 7 + Math.random() * 6;
      puff.scale.set(s, s * 0.45, s * 0.8);
      cl.add(puff);
    }
    cl.position.set((Math.random() - 0.5) * 800, 100 + Math.random() * 40, (Math.random() - 0.5) * 800);
    scene.add(cl);
    clouds.push(cl);
  }
}

// ---------- Ground query ----------
function groundAt(x, z, y) {
  let g = surfaceGroundY(x, z);
  for (const b of buildingAABBs) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y >= b.topY - 0.7 && b.topY > g) g = b.topY;
  }
  if (typeof blockMap !== 'undefined') {
    for (const m of blockMap.values()) {
      const p = m.position;
      if (Math.abs(x - p.x) < 1.05 && Math.abs(z - p.z) < 1.05) {
        const top = p.y + 1;
        if (y >= top - 0.7 && top > g) g = top;
      }
    }
  }
  return g;
}
function groundNormalAt(x, z, y) {
  if (inCity(x, z) || groundAt(x, z, y) !== surfaceGroundY(x, z)) return new THREE.Vector3(0, 1, 0);
  return terrainNormal(x, z);
}

// ---------- Environment reflections ----------
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 10), new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(0x2e74c4) }, uBottom: { value: new THREE.Color(0xcfe3f2) } },
    vertexShader: skyMat.vertexShader,
    fragmentShader: `varying vec3 vPos; uniform vec3 uTop; uniform vec3 uBottom;
      void main() { gl_FragColor = vec4(mix(uBottom, uTop, pow(clamp(normalize(vPos).y, 0.0, 1.0), 0.55)), 1.0); }`,
    side: THREE.BackSide,
  }));
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0.05).texture;
  pmrem.dispose();
}
