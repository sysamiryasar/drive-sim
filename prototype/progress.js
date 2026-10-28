'use strict';
// ============================================================
// progress.js — save data, cash & XP, levels, achievements,
// daily challenges, login streak, reward popups
// ============================================================

// ---------- Save data ----------
const SAVE_KEY = 'realmdrive.save.v1';
function defaultSave() {
  return {
    cash: 500, xp: 0, level: 1,
    owned: { hatch: true, sedan: true },
    paints: { 0: true, 1: true, 2: true, 3: true },
    selected: 'hatch', paintOf: {},
    stats: {
      distance: 0, topSpeed: 0, bestDrift: 0, totalDrift: 0, nearMisses: 0,
      bestAir: 0, totalAir: 0, smashed: 0, cashBags: 0, deliveries: 0,
      bestDeliveryStreak: 0, racesFinished: 0, escapes: 0, bestEscape: 0,
      bestCombo: 0, bestComboScore: 0, honks: 0, blocks: 0, nightDist: 0,
      snowDist: 0, planeFlights: 0, playTime: 0, sessions: 0, busted: 0,
      stuntJumps: 0, cashEarned: 0, dailiesDone: 0,
    },
    stars: {},
    jumps: {},
    traps: {},
    races: {},
    achievements: {},
    daily: { date: '', items: [], swept: false },
    streak: { count: 0, last: '', claimed: '' },
  };
}
function deepMerge(base, over) {
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return deepMerge(defaultSave(), JSON.parse(raw));
  } catch (e) { /* private mode or corrupt save: start fresh */ }
  return defaultSave();
}
let save = loadSave();
let saveDirty = false;
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
  saveDirty = false;
}
function markDirty() { saveDirty = true; }
setInterval(() => { if (saveDirty) persist(); }, 3000);
addEventListener('beforeunload', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

// ---------- Formatting ----------
function fmtCash(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtTime(s) {
  if (s == null || !isFinite(s)) return '--:--.-';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- Levels ----------
function xpForLevel(L) { return L <= 1 ? 0 : Math.round(400 * Math.pow(L - 1, 1.6)); }
function levelProgress() {
  const a = xpForLevel(save.level), b = xpForLevel(save.level + 1);
  return { into: save.xp - a, need: b - a, frac: Math.max(0, Math.min(1, (save.xp - a) / (b - a))) };
}

// ---------- Earning ----------
let sessionEarned = 0;
function earn(cash, xp, reason) {
  cash = Math.round(cash || 0); xp = Math.round(xp || 0);
  save.cash += cash; save.xp += xp;
  save.stats.cashEarned += Math.max(0, cash);
  sessionEarned += cash;
  if (reason && (cash || xp)) popup((cash ? '+' + fmtCash(cash) : '') + (xp ? '  +' + fmtNum(xp) + ' XP' : '') + '  ' + reason, 'cash');
  let leveled = false;
  while (save.xp >= xpForLevel(save.level + 1)) { save.level++; leveled = true; onLevelUp(save.level); }
  markDirty();
  updateProfileHud();
  if (leveled) checkAchievements();
}
function spend(amount) {
  if (save.cash < amount) return false;
  save.cash -= amount;
  markDirty(); persist();
  updateProfileHud();
  return true;
}
function onLevelUp(L) {
  const bonus = 250 * L;
  save.cash += bonus;
  const unlocks = Object.values(VEHICLES).filter(v => v.level === L).map(v => v.name);
  showBanner('LEVEL ' + L, (unlocks.length ? 'Unlocked: ' + unlocks.join(', ') + ' · ' : '') + 'Bonus ' + fmtCash(bonus), 'level');
  if (typeof sfx === 'function') sfx('levelup');
}

// ---------- Stats ----------
function addStat(name, v) { save.stats[name] = (save.stats[name] || 0) + v; markDirty(); }
function maxStat(name, v) { if (v > (save.stats[name] || 0)) { save.stats[name] = v; markDirty(); return true; } return false; }

// ---------- Achievements ----------
const S = () => save.stats;
const ACHIEVEMENTS = [
  { id: 'first',      icon: '🔑', name: 'Turn the Key',          desc: 'Start your first drive',             reward: 100,   test: () => S().sessions >= 1 },
  { id: 'km1',        icon: '🛣️', name: 'Sunday Driver',         desc: 'Drive 1 km',                         reward: 200,   test: () => S().distance >= 1000, prog: () => [S().distance / 1000, 1] },
  { id: 'km10',       icon: '🗺️', name: 'Road Tripper',          desc: 'Drive 10 km',                        reward: 1000,  test: () => S().distance >= 10000, prog: () => [S().distance / 1000, 10] },
  { id: 'km50',       icon: '🌍', name: 'Mileage Monster',       desc: 'Drive 50 km',                        reward: 5000,  test: () => S().distance >= 50000, prog: () => [S().distance / 1000, 50] },
  { id: 'spd120',     icon: '💨', name: 'Need for Speed',        desc: 'Hit 120 km/h',                       reward: 250,   test: () => S().topSpeed >= 120 },
  { id: 'spd180',     icon: '⚡', name: 'Speed Demon',           desc: 'Hit 180 km/h',                       reward: 750,   test: () => S().topSpeed >= 180 },
  { id: 'spd240',     icon: '🚀', name: 'Warp Drive',            desc: 'Hit 240 km/h',                       reward: 3000,  test: () => S().topSpeed >= 240 },
  { id: 'drift1k',    icon: '🌀', name: 'Sideways',              desc: 'Score a 1,000 pt drift',             reward: 300,   test: () => S().bestDrift >= 1000 },
  { id: 'drift10k',   icon: '🔥', name: 'Drift King',            desc: 'Score a 10,000 pt drift',            reward: 2500,  test: () => S().bestDrift >= 10000 },
  { id: 'nm10',       icon: '😬', name: 'Close Shave',           desc: '10 near misses',                     reward: 300,   test: () => S().nearMisses >= 10, prog: () => [S().nearMisses, 10] },
  { id: 'nm100',      icon: '🎯', name: 'Thread the Needle',     desc: '100 near misses',                    reward: 2500,  test: () => S().nearMisses >= 100, prog: () => [S().nearMisses, 100] },
  { id: 'air2',       icon: '🦅', name: 'Frequent Flyer',        desc: '1.5s airtime in one jump',           reward: 400,   test: () => S().bestAir >= 1.5 },
  { id: 'air3',       icon: '🛸', name: 'We Have Liftoff',       desc: '3s airtime in one jump',             reward: 2500,  test: () => S().bestAir >= 3 },
  { id: 'jumps',      icon: '🏗️', name: 'Daredevil',             desc: 'Clear every stunt ramp',             reward: 3000,  test: () => Object.keys(save.jumps).length >= RAMP_COUNT(), prog: () => [Object.keys(save.jumps).length, RAMP_COUNT()] },
  { id: 'smash25',    icon: '💥', name: 'Bull in a China Shop',  desc: 'Smash 25 street props',              reward: 300,   test: () => S().smashed >= 25, prog: () => [S().smashed, 25] },
  { id: 'smash250',   icon: '🧨', name: 'Wrecking Ball',         desc: 'Smash 250 street props',             reward: 2500,  test: () => S().smashed >= 250, prog: () => [S().smashed, 250] },
  { id: 'star1',      icon: '⭐', name: 'Stargazer',             desc: 'Find a hidden star',                 reward: 250,   test: () => Object.keys(save.stars).length >= 1 },
  { id: 'star10',     icon: '🌟', name: 'Star Collector',        desc: 'Find 10 hidden stars',               reward: 1500,  test: () => Object.keys(save.stars).length >= 10, prog: () => [Object.keys(save.stars).length, 10] },
  { id: 'starall',    icon: '🌠', name: 'Constellation',         desc: 'Find every hidden star',             reward: 10000, test: () => Object.keys(save.stars).length >= STAR_COUNT(), prog: () => [Object.keys(save.stars).length, STAR_COUNT()] },
  { id: 'bags10',     icon: '💰', name: 'Pocket Money',          desc: 'Grab 10 cash bags',                  reward: 300,   test: () => S().cashBags >= 10, prog: () => [S().cashBags, 10] },
  { id: 'del1',       icon: '📦', name: 'Special Delivery',      desc: 'Complete a delivery',                reward: 200,   test: () => S().deliveries >= 1 },
  { id: 'del25',      icon: '🚚', name: 'Logistics Legend',      desc: 'Complete 25 deliveries',             reward: 3000,  test: () => S().deliveries >= 25, prog: () => [S().deliveries, 25] },
  { id: 'delstreak',  icon: '⏱️', name: 'Rush Hour Hero',        desc: '5 deliveries in a row',              reward: 1500,  test: () => S().bestDeliveryStreak >= 5, prog: () => [S().bestDeliveryStreak, 5] },
  { id: 'race1',      icon: '🏁', name: 'Off the Line',          desc: 'Finish a race',                      reward: 300,   test: () => S().racesFinished >= 1 },
  { id: 'gold1',      icon: '🥇', name: 'Podium Finish',         desc: 'Win gold in any race',               reward: 1000,  test: () => Object.values(save.races).some(r => r.medal >= 3) },
  { id: 'goldall',    icon: '🏆', name: 'Champion',              desc: 'Win gold in every race',             reward: 6000,  test: () => RACE_IDS().every(id => save.races[id] && save.races[id].medal >= 3), prog: () => [RACE_IDS().filter(id => save.races[id] && save.races[id].medal >= 3).length, RACE_IDS().length] },
  { id: 'escape1',    icon: '🚨', name: 'Slippery',              desc: 'Escape a police chase',              reward: 500,   test: () => S().escapes >= 1 },
  { id: 'escape5',    icon: '🕶️', name: 'Most Wanted',           desc: 'Escape at 5+ wanted stars',          reward: 2500,  test: () => S().bestEscape >= 5 },
  { id: 'combo10',    icon: '✖️', name: 'Combo Master',          desc: 'Reach a x10 multiplier',             reward: 1500,  test: () => S().bestCombo >= 10 },
  { id: 'combo25k',   icon: '🎰', name: 'Jackpot',               desc: 'Bank a 25,000 pt combo',             reward: 3000,  test: () => S().bestComboScore >= 25000 },
  { id: 'plane',      icon: '🛩️', name: 'Wheels Up',             desc: 'Take off in the plane (P)',          reward: 500,   test: () => S().planeFlights >= 1 },
  { id: 'lvl5',       icon: '🎖️', name: 'Rising Star',           desc: 'Reach level 5',                      reward: 1000,  test: () => save.level >= 5, prog: () => [save.level, 5] },
  { id: 'lvl10',      icon: '🏅', name: 'Road Veteran',          desc: 'Reach level 10',                     reward: 4000,  test: () => save.level >= 10, prog: () => [save.level, 10] },
  { id: 'lvl15',      icon: '👑', name: 'Legend',                desc: 'Reach level 15',                     reward: 10000, test: () => save.level >= 15, prog: () => [save.level, 15] },
  { id: 'buy',        icon: '🛒', name: 'New Wheels',            desc: 'Buy a vehicle',                      reward: 500,   test: () => Object.keys(save.owned).length >= 3 },
  { id: 'garage',     icon: '🏎️', name: 'Collector',             desc: 'Own every vehicle',                  reward: 20000, test: () => Object.keys(VEHICLES).every(k => save.owned[k]), prog: () => [Object.keys(save.owned).length, Object.keys(VEHICLES).length] },
  { id: 'streak3',    icon: '📅', name: 'Regular',               desc: 'Play 3 days in a row',               reward: 750,   test: () => save.streak.count >= 3, prog: () => [save.streak.count, 3] },
  { id: 'streak7',    icon: '🗓️', name: 'Dedicated',             desc: 'Play 7 days in a row',               reward: 3000,  test: () => save.streak.count >= 7, prog: () => [save.streak.count, 7] },
  { id: 'daily',      icon: '✅', name: 'Overachiever',          desc: 'Complete all 3 daily challenges',    reward: 1000,  test: () => save.daily.swept },
  { id: 'honk',       icon: '📯', name: 'Honk If You\'re Happy', desc: 'Honk 50 times',                      reward: 150,   test: () => S().honks >= 50, prog: () => [S().honks, 50] },
  { id: 'build',      icon: '🧱', name: 'Architect',             desc: 'Place 50 blocks in build mode (B)',  reward: 500,   test: () => S().blocks >= 50, prog: () => [S().blocks, 50] },
  { id: 'night',      icon: '🌙', name: 'Night Owl',             desc: 'Drive 2 km at night',                reward: 500,   test: () => S().nightDist >= 2000, prog: () => [S().nightDist / 1000, 2] },
  { id: 'snow',       icon: '🌨️', name: 'Winter Warrior',        desc: 'Drive 1 km in the snow',             reward: 500,   test: () => S().snowDist >= 1000, prog: () => [S().snowDist / 1000, 1] },
];
// counts provided by activities.js once it has built the world
function STAR_COUNT() { return typeof hiddenStars !== 'undefined' ? hiddenStars.length : 40; }
function RAMP_COUNT() { return typeof ramps !== 'undefined' ? ramps.length : 10; }
function RACE_IDS() { return typeof RACES !== 'undefined' ? RACES.map(r => r.id) : []; }

const achQueue = [];
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id]) continue;
    let ok = false;
    try { ok = a.test(); } catch (e) { ok = false; }
    if (!ok) continue;
    save.achievements[a.id] = Date.now();
    save.cash += a.reward;
    markDirty();
    achQueue.push(a);
  }
  if (achQueue.length && !achShowing) showNextAchievement();
  updateProfileHud();
}
let achShowing = false;
function showNextAchievement() {
  const a = achQueue.shift();
  if (!a) { achShowing = false; return; }
  achShowing = true;
  const el = document.getElementById('achToast');
  if (!el) { achShowing = false; return; }
  el.innerHTML = '<div class="ach-icon">' + a.icon + '</div><div><div class="ach-kicker">Achievement unlocked</div>' +
    '<div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + ' · <b>+' + fmtCash(a.reward) + '</b></div></div>';
  el.classList.add('show');
  if (typeof sfx === 'function') sfx('achievement');
  setTimeout(() => { el.classList.remove('show'); setTimeout(showNextAchievement, 450); }, 3600);
}

// ---------- Daily challenges ----------
const DAILY_POOL = [
  { id: 'drift',  text: 'Rack up {n} drift points',     tiers: [3000, 6000, 12000], ev: 'drift' },
  { id: 'near',   text: 'Pull off {n} near misses',     tiers: [5, 10, 18],         ev: 'nearMiss' },
  { id: 'air',    text: 'Catch {n}s of total airtime',  tiers: [3, 6, 10],          ev: 'air' },
  { id: 'smash',  text: 'Smash {n} street props',       tiers: [15, 30, 60],        ev: 'smash' },
  { id: 'deliv',  text: 'Complete {n} deliveries',      tiers: [2, 3, 5],           ev: 'delivery' },
  { id: 'race',   text: 'Finish {n} races',             tiers: [1, 2, 3],           ev: 'race' },
  { id: 'bags',   text: 'Grab {n} cash bags',           tiers: [4, 8, 12],          ev: 'cashBag' },
  { id: 'dist',   text: 'Drive {n} km',                 tiers: [3, 6, 10],          ev: 'km' },
  { id: 'speed',  text: 'Hit {n} km/h',                 tiers: [140, 180, 220],     ev: 'speed', max: true },
  { id: 'escape', text: 'Escape the cops {n}x',         tiers: [1, 1, 2],           ev: 'escape' },
  { id: 'combo',  text: 'Bank a {n} pt combo',          tiers: [2500, 6000, 12000], ev: 'combo', max: true },
];
function seededRand(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function rollDailies() {
  const today = dayKey();
  if (save.daily.date === today && save.daily.items.length) return;
  const rnd = seededRand('realmdrive-' + today);
  const tier = Math.min(2, Math.floor((save.level - 1) / 5));
  const pool = DAILY_POOL.slice();
  const items = [];
  while (items.length < 3 && pool.length) {
    const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const n = c.tiers[tier];
    items.push({ id: c.id, ev: c.ev, max: !!c.max, n, text: c.text.replace('{n}', fmtNum(n)), progress: 0, done: false,
      cash: 600 + tier * 400, xp: 200 + tier * 150 });
  }
  save.daily = { date: today, items, swept: false };
  markDirty();
}
function dailyEvent(ev, amount) {
  rollDailies();
  let changed = false;
  for (const it of save.daily.items) {
    if (it.done || it.ev !== ev) continue;
    it.progress = it.max ? Math.max(it.progress, amount) : it.progress + amount;
    changed = true;
    if (it.progress >= it.n) {
      it.done = true;
      save.stats.dailiesDone++;
      showBanner('DAILY CHALLENGE', it.text + ' · +' + fmtCash(it.cash), 'daily');
      earn(it.cash, it.xp);
      if (typeof sfx === 'function') sfx('achievement');
    }
  }
  if (changed && !save.daily.swept && save.daily.items.every(i => i.done)) {
    save.daily.swept = true;
    setTimeout(() => { showBanner('DAILY SWEEP!', 'All 3 challenges done · +' + fmtCash(1000), 'daily'); earn(1000, 500); checkAchievements(); }, 2600);
  }
  if (changed) markDirty();
}
function msUntilTomorrow() {
  const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  return t - n;
}

// ---------- Login streak ----------
const STREAK_REWARDS = [250, 400, 600, 800, 1000, 1300, 2000];
function touchStreak() {
  const today = dayKey();
  if (save.streak.last === today) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  save.streak.count = save.streak.last === dayKey(y) ? save.streak.count + 1 : 1;
  save.streak.last = today;
  markDirty();
}
function streakReward() { return STREAK_REWARDS[Math.min(save.streak.count, 7) - 1] || STREAK_REWARDS[0]; }
function canClaimStreak() { return save.streak.claimed !== dayKey(); }
function claimStreak() {
  if (!canClaimStreak()) return 0;
  const r = streakReward();
  save.streak.claimed = dayKey();
  earn(r, 100);
  persist();
  return r;
}
touchStreak();
rollDailies();

// ---------- Popups & banners ----------
function popup(text, cls) {
  const box = document.getElementById('popups');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'popup ' + (cls || '');
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 5) box.removeChild(box.firstChild);
  setTimeout(() => el.remove(), 2200);
}
let bannerTimer = null;
function showBanner(title, sub, cls) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.className = 'show ' + (cls || '');
  el.innerHTML = '<div class="b-title">' + title + '</div><div class="b-sub">' + sub + '</div>';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.className = ''; }, 2800);
}
function updateProfileHud() {
  const c = document.getElementById('hudCash');
  if (c) c.textContent = fmtCash(save.cash);
  const l = document.getElementById('hudLevel');
  if (l) l.textContent = save.level;
  const x = document.getElementById('hudXpFill');
  if (x) x.style.width = (levelProgress().frac * 100) + '%';
  if (typeof refreshProfileBar === 'function') refreshProfileBar();
}
