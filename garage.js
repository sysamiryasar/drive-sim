'use strict';
// ============================================================
// garage.js — home screen: profile, garage & paint shop with a
// live 3D preview, daily challenges, login streak, awards, records
// ============================================================

let selectedVehicle = save.owned[save.selected] ? save.selected : 'hatch';
let previewPaint = save.paintOf[selectedVehicle] || 0;
let homeTab = 'garage';
let lastSession = null;

function vehicleLocked(key) { return save.level < VEHICLES[key].level; }
function statBar(label, frac, text) {
  return '<div class="sb"><span>' + label + '</span><div class="sb-bar"><i style="width:' + Math.round(Math.max(0.04, Math.min(1, frac)) * 100) + '%"></i></div><b>' + text + '</b></div>';
}

// ---------- Profile bar ----------
function refreshProfileBar() {
  const $h = (id) => document.getElementById(id);
  if (!$h('pLevel')) return;
  const lp = levelProgress();
  $h('pLevel').textContent = save.level;
  $h('pCash').textContent = fmtCash(save.cash);
  $h('pStreak').textContent = '🔥 ' + save.streak.count + (save.streak.count === 1 ? ' day' : ' days');
  $h('pXp').style.width = (lp.frac * 100) + '%';
  $h('pXpText').textContent = fmtNum(lp.into) + ' / ' + fmtNum(lp.need) + ' XP to level ' + (save.level + 1);
  const got = Object.keys(save.achievements).length;
  $h('achCount').textContent = got + '/' + ACHIEVEMENTS.length;
  const dailyOpen = canClaimStreak() || save.daily.items.some(i => !i.done);
  $h('dailyDot').style.display = canClaimStreak() ? 'inline-block' : 'none';
  $h('dailyDot').title = dailyOpen ? 'Rewards waiting' : '';
}

// ---------- Garage ----------
function renderGarage() {
  const grid = document.getElementById('carCards');
  grid.innerHTML = '';
  for (const [key, v] of Object.entries(VEHICLES)) {
    const owned = !!save.owned[key], locked = vehicleLocked(key);
    const card = document.createElement('button');
    card.className = 'car-card' + (key === selectedVehicle ? ' selected' : '') + (owned ? ' owned' : '') + (locked ? ' locked' : '');
    card.innerHTML = '<div class="icon">' + v.icon + '</div><div class="name">' + v.name + '</div>' +
      '<div class="tag">' + (owned ? (key === save.selected ? 'DRIVING' : 'OWNED') : locked ? '🔒 LVL ' + v.level : fmtCash(v.price)) + '</div>';
    card.addEventListener('click', () => selectVehicle(key));
    grid.appendChild(card);
  }
  renderCarDetail();
}
function renderCarDetail() {
  const key = selectedVehicle, v = VEHICLES[key];
  const owned = !!save.owned[key], locked = vehicleLocked(key);
  const kmh = Math.round(v.maxSpeed * 3.6);
  let html = '<div class="cd-head"><div><div class="cd-name">' + v.icon + ' ' + v.name + '</div><div class="cd-perk">' + v.perk + '</div></div>';
  if (!owned) {
    if (locked) html += '<div class="cd-buy locked">🔒 Level ' + v.level + '</div>';
    else html += '<button class="cd-buy' + (save.cash >= v.price ? '' : ' poor') + '" id="buyCarBtn">Buy ' + fmtCash(v.price) + '</button>';
  }
  html += '</div>';
  html += statBar('Top speed', v.maxSpeed / 74, kmh + ' km/h') + statBar('Acceleration', v.accel / 33, Math.round(v.accel / 33 * 100)) +
    statBar('Handling', (v.grip * v.turn) / 18, Math.round((v.grip * v.turn) / 18 * 100)) +
    statBar('Off-road', 1 - v.offroadPenalty, Math.round((1 - v.offroadPenalty) * 100));
  if (carSupportsPaint(key)) {
    html += '<div class="paint-title">Paint <span>' + PAINTS[previewPaint].name + '</span></div><div class="paints">';
    PAINTS.forEach((p, i) => {
      const bg = p.hex == null ? 'linear-gradient(135deg,#888,#ddd 50%,#555)' : '#' + new THREE.Color(p.hex).getHexString();
      html += '<button class="sw' + (i === previewPaint ? ' on' : '') + (save.paints[i] ? '' : ' lock') + '" data-paint="' + i + '" title="' + p.name + (save.paints[i] ? '' : ' · ' + fmtCash(p.price)) + '" style="background:' + bg + '"></button>';
    });
    html += '</div>';
    if (!save.paints[previewPaint]) html += '<button class="cd-buy small' + (save.cash >= PAINTS[previewPaint].price ? '' : ' poor') + '" id="buyPaintBtn">Unlock ' + PAINTS[previewPaint].name + ' for every car · ' + fmtCash(PAINTS[previewPaint].price) + '</button>';
  } else {
    html += '<div class="paint-title">Official livery — paint locked</div>';
  }
  if (v.heavy && !modelCache[v.model]) html += '<div class="cd-note">Loading photoreal model…</div>';
  const el = document.getElementById('carDetail');
  el.innerHTML = html;
  const bb = document.getElementById('buyCarBtn');
  if (bb) bb.addEventListener('click', () => buyVehicle(key));
  const bp = document.getElementById('buyPaintBtn');
  if (bp) bp.addEventListener('click', () => buyPaint(previewPaint));
  el.querySelectorAll('.sw').forEach(b => b.addEventListener('click', () => choosePaint(+b.dataset.paint)));
  updateStartButton();
}
function selectVehicle(key) {
  selectedVehicle = key;
  previewPaint = save.paintOf[key] || 0;
  if (save.owned[key]) { save.selected = key; markDirty(); }
  swapCar(key, PAINTS[previewPaint].hex);
  sfx('click');
  renderGarage();
}
function choosePaint(i) {
  previewPaint = i;
  repaintCar(PAINTS[i].hex);
  if (save.paints[i] && save.owned[selectedVehicle]) { save.paintOf[selectedVehicle] = i; markDirty(); }
  sfx('click');
  renderCarDetail();
}
function buyVehicle(key) {
  const v = VEHICLES[key];
  if (save.owned[key] || vehicleLocked(key)) return;
  if (!spend(v.price)) { popup('Not enough cash — complete jobs, races & combos!', 'lost'); sfx('fail'); return; }
  save.owned[key] = true; save.selected = key;
  if (save.paints[previewPaint]) save.paintOf[key] = previewPaint;
  persist();
  showBanner('NEW RIDE!', v.name + ' is in your garage', 'gold');
  sfx('levelup');
  checkAchievements();
  renderGarage(); refreshProfileBar();
}
function buyPaint(i) {
  const p = PAINTS[i];
  if (save.paints[i]) return;
  if (!spend(p.price)) { popup('Not enough cash for ' + p.name, 'lost'); sfx('fail'); return; }
  save.paints[i] = true;
  if (save.owned[selectedVehicle]) save.paintOf[selectedVehicle] = i;
  persist();
  sfx('coin');
  renderCarDetail(); refreshProfileBar();
}
function updateStartButton() {
  const b = document.getElementById('startBtn');
  if (!b) return;
  const v = VEHICLES[selectedVehicle];
  if (!modelsLoaded) {
    b.disabled = true;
    b.textContent = 'Loading 3D models… ' + Math.round(modelLoadProgress * 100) + '%';
    return;
  }
  if (save.owned[selectedVehicle]) { b.disabled = false; b.textContent = 'START DRIVING'; }
  else if (vehicleLocked(selectedVehicle)) { b.disabled = true; b.textContent = '🔒 Reach level ' + v.level; }
  else { b.disabled = true; b.textContent = 'Buy this car to drive it'; }
}
function onHeavyModelLoaded() {
  if (mode === 'menu' && VEHICLES[selectedVehicle].heavy) { swapCar(selectedVehicle, PAINTS[previewPaint].hex); renderCarDetail(); }
}

// ---------- Daily ----------
function renderDaily() {
  const el = document.getElementById('tab-daily');
  const ms = msUntilTomorrow();
  const hrs = Math.floor(ms / 3600000), mins = Math.floor(ms / 60000) % 60;
  let html = '<div class="sec-title">Login streak</div><div class="streak">';
  for (let d = 1; d <= 7; d++) {
    const cur = Math.min(save.streak.count, 7);
    const cls = d < cur || (d === cur && !canClaimStreak()) ? 'done' : d === cur ? 'today' : '';
    html += '<div class="sd ' + cls + '"><div>Day ' + d + '</div><b>' + fmtCash(STREAK_REWARDS[d - 1]) + '</b></div>';
  }
  html += '</div>';
  if (canClaimStreak()) html += '<button class="cd-buy wide" id="claimBtn">Claim day ' + save.streak.count + ' reward · ' + fmtCash(streakReward()) + '</button>';
  else html += '<div class="muted">Come back tomorrow for ' + fmtCash(STREAK_REWARDS[Math.min(save.streak.count, 6)]) + ' — don\'t break the streak!</div>';
  html += '<div class="sec-title">Today\'s challenges <span class="muted">· new in ' + hrs + 'h ' + mins + 'm</span></div>';
  for (const it of save.daily.items) {
    const f = Math.min(1, it.progress / it.n);
    html += '<div class="ch' + (it.done ? ' done' : '') + '"><div class="ch-top"><span>' + (it.done ? '✅ ' : '') + it.text + '</span><b>' + fmtCash(it.cash) + '</b></div>' +
      '<div class="sb-bar"><i style="width:' + (f * 100) + '%"></i></div><div class="muted">' + (it.ev === 'km' || it.ev === 'air' ? it.progress.toFixed(1) : fmtNum(it.progress)) + ' / ' + fmtNum(it.n) + '</div></div>';
  }
  html += '<div class="muted">Finish all three for a ' + fmtCash(1000) + ' sweep bonus' + (save.daily.swept ? ' — done today! 🎉' : '.') + '</div>';
  el.innerHTML = html;
  const cb = document.getElementById('claimBtn');
  if (cb) cb.addEventListener('click', () => {
    const r = claimStreak();
    showBanner('DAY ' + save.streak.count + ' STREAK', 'Login bonus +' + fmtCash(r), 'gold');
    sfx('coin');
    checkAchievements();
    renderDaily(); refreshProfileBar();
  });
}

// ---------- Achievements ----------
function renderAch() {
  const el = document.getElementById('tab-ach');
  const got = Object.keys(save.achievements).length;
  let html = '<div class="sec-title">' + got + ' / ' + ACHIEVEMENTS.length + ' unlocked</div><div class="ach-grid">';
  const frac = (a) => {
    if (save.achievements[a.id]) return 2;
    try { if (a.prog) { const [v, n] = a.prog(); return Math.min(0.99, v / n); } } catch (e) { /* stats not ready */ }
    return 0;
  };
  const list = ACHIEVEMENTS.slice().sort((x, y) => frac(y) - frac(x));
  for (const a of list) {
    const done = !!save.achievements[a.id];
    let prog = '';
    if (!done && a.prog) {
      try { const [v, n] = a.prog(); prog = '<div class="sb-bar"><i style="width:' + Math.min(100, v / n * 100) + '%"></i></div>'; } catch (e) { prog = ''; }
    }
    html += '<div class="ach' + (done ? ' done' : '') + '"><div class="ach-i">' + (done ? a.icon : '🔒') + '</div><div class="ach-t"><b>' + a.name + '</b><span>' + a.desc + '</span>' + prog + '</div><div class="ach-r">' + fmtCash(a.reward) + '</div></div>';
  }
  el.innerHTML = html + '</div>';
}

// ---------- Records ----------
function renderRecords() {
  const el = document.getElementById('tab-records');
  const st = save.stats;
  let html = '<div class="sec-title">Races</div>';
  for (const r of RACES) {
    const rec = save.races[r.id];
    html += '<div class="rec"><span>' + r.icon + ' ' + r.name + '</span><b>' + (rec && rec.best ? fmtTime(rec.best) + ' ' + (['', '🥉', '🥈', '🥇'][rec.medal] || '') : '—') + '</b></div>' +
      '<div class="muted small">Gold ' + fmtTime(r.medals[2]) + ' · Silver ' + fmtTime(r.medals[1]) + ' · Bronze ' + fmtTime(r.medals[0]) + '</div>';
  }
  html += '<div class="sec-title">Speed traps</div>';
  for (const t of SPEED_TRAPS) html += '<div class="rec"><span>📸 ' + t.name + '</span><b>' + (save.traps[t.id] ? save.traps[t.id] + ' km/h' : '—') + '</b></div>';
  html += '<div class="sec-title">Collection</div>' +
    '<div class="rec"><span>⭐ Hidden stars</span><b>' + starsFound() + ' / ' + hiddenStars.length + '</b></div>' +
    '<div class="rec"><span>🏗️ Stunt jumps cleared</span><b>' + Object.keys(save.jumps).length + ' / ' + ramps.length + '</b></div>' +
    '<div class="rec"><span>🚗 Vehicles owned</span><b>' + Object.keys(save.owned).length + ' / ' + Object.keys(VEHICLES).length + '</b></div>';
  html += '<div class="sec-title">Career</div>';
  const rows = [
    ['Distance driven', (st.distance / 1000).toFixed(1) + ' km'], ['Top speed', Math.round(st.topSpeed) + ' km/h'],
    ['Best drift', fmtNum(st.bestDrift) + ' pts'], ['Best combo', fmtNum(st.bestComboScore) + ' pts'],
    ['Longest air', st.bestAir.toFixed(1) + ' s'], ['Near misses', fmtNum(st.nearMisses)],
    ['Props smashed', fmtNum(st.smashed)], ['Deliveries', fmtNum(st.deliveries)],
    ['Cop escapes', fmtNum(st.escapes)], ['Cash earned', fmtCash(st.cashEarned)],
    ['Time played', Math.floor(st.playTime / 3600) + 'h ' + Math.floor(st.playTime / 60) % 60 + 'm'],
  ];
  for (const [a, b] of rows) html += '<div class="rec"><span>' + a + '</span><b>' + b + '</b></div>';
  html += '<div class="muted small credits">3D models: Kenney Car Kit &amp; Blocky Characters (CC0) · Italia 458: "Ferrari 458 Italia" by vicent091036 (via three.js examples)</div>';
  el.innerHTML = html;
}

// ---------- Tabs & screen ----------
function showTab(tab) {
  homeTab = tab;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ['garage', 'daily', 'ach', 'records'].forEach(t => { document.getElementById('tab-' + t).hidden = t !== tab; });
  if (tab === 'garage') renderGarage();
  if (tab === 'daily') renderDaily();
  if (tab === 'ach') renderAch();
  if (tab === 'records') renderRecords();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { sfx('click'); showTab(b.dataset.tab); }));
function renderHome() {
  rollDailies();
  refreshProfileBar();
  const rc = document.getElementById('recap');
  if (rc) {
    if (lastSession) {
      rc.innerHTML = '<b>Last run</b> · ' + (lastSession.cash >= 0 ? '+' : '') + fmtCash(lastSession.cash) + ' · ' + lastSession.achievements + ' new award' + (lastSession.achievements === 1 ? '' : 's') + ' · ' + (lastSession.km).toFixed(1) + ' km';
      rc.style.display = 'block';
    } else if (canClaimStreak()) {
      rc.innerHTML = '🎁 <b>Daily login bonus ready!</b> Open the Daily tab to claim ' + fmtCash(streakReward()) + '.';
      rc.style.display = 'block';
    } else rc.style.display = 'none';
  }
  showTab(homeTab);
}
document.getElementById('startBtn').addEventListener('click', () => { if (save.owned[selectedVehicle]) startGame(); });
const _loadPoll = setInterval(() => {
  updateStartButton();
  if (modelsLoaded) { clearInterval(_loadPoll); if (mode === 'menu') swapCar(selectedVehicle, PAINTS[previewPaint].hex); }
}, 250);
onModelsReady(() => { if (mode === 'menu') { swapCar(selectedVehicle, PAINTS[previewPaint].hex); updateStartButton(); } });
renderHome();
swapCar(selectedVehicle, PAINTS[previewPaint].hex);
