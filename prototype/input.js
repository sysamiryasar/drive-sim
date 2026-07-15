'use strict';
// ============================================================
// input.js — unified input: keyboard, touch, gamepad
// ============================================================

// ---------- Unified input state ----------
const input = {
  moveX: 0, moveZ: 0,       // -1..1 analog stick / WASD
  brake: false,              // Space / L-trigger / brake button
  sprint: false,             // Shift / L-bumper / sprint button
  lookDX: 0, lookDY: 0,     // per-frame look delta (mouse / right stick / touch)
  fire: false,               // LMB / R-trigger
  _edgeQueue: [],            // edge-triggered actions this frame
};

function inputEdge(action) { return input._edgeQueue.includes(action); }
function queueEdge(action) { if (!input._edgeQueue.includes(action)) input._edgeQueue.push(action); }

// ---------- Detect touch device ----------
const isTouchDevice = (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
  && matchMedia('(pointer: coarse)').matches;

// ---------- Touch controls ----------
let touchUI = null;
const activeTouches = {};  // id -> {zone, startX, startY, curX, curY}

const TOUCH_ZONES = {
  joystick: null,   // left side
  look: null,       // right side (above buttons)
  buttons: {},      // named button elements
};

function buildTouchUI() {
  if (touchUI) return;
  touchUI = document.getElementById('touch-ui');
  if (!touchUI) return;

  const joyArea = document.getElementById('joy-area');
  const joyBase = document.getElementById('joy-base');
  const joyKnob = document.getElementById('joy-knob');
  const lookArea = document.getElementById('look-area');
  const btnPanel = document.getElementById('touch-btns');

  if (joyArea) TOUCH_ZONES.joystick = joyArea;
  if (joyBase) TOUCH_ZONES.joyBase = joyBase;
  if (joyKnob) TOUCH_ZONES.joyKnob = joyKnob;
  if (lookArea) TOUCH_ZONES.look = lookArea;

  if (btnPanel) {
    btnPanel.querySelectorAll('.tbtn').forEach((btn) => {
      const action = btn.dataset.action;
      if (action) TOUCH_ZONES.buttons[action] = btn;
    });
  }

  document.body.classList.add('touch-device');

  if (joyArea) {
    joyArea.addEventListener('touchstart', onJoyStart, { passive: false });
    joyArea.addEventListener('touchmove', onJoyMove, { passive: false });
    joyArea.addEventListener('touchend', onJoyEnd, { passive: false });
    joyArea.addEventListener('touchcancel', onJoyEnd, { passive: false });
  }
  if (lookArea) {
    lookArea.addEventListener('touchstart', onLookStart, { passive: false });
    lookArea.addEventListener('touchmove', onLookMove, { passive: false });
    lookArea.addEventListener('touchend', onLookEnd, { passive: false });
    lookArea.addEventListener('touchcancel', onLookEnd, { passive: false });
  }
  if (btnPanel) {
    btnPanel.addEventListener('touchstart', onBtnStart, { passive: false });
    btnPanel.addEventListener('touchend', onBtnEnd, { passive: false });
    btnPanel.addEventListener('touchcancel', onBtnEnd, { passive: false });
  }
}

let joyTouchId = null;
let joyCenter = { x: 0, y: 0 };
const JOY_RADIUS = 50;

function onJoyStart(e) {
  e.preventDefault();
  if (joyTouchId !== null) return;
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  const rect = TOUCH_ZONES.joyBase.getBoundingClientRect();
  joyCenter.x = rect.left + rect.width / 2;
  joyCenter.y = rect.top + rect.height / 2;
  updateJoy(t);
}
function onJoyMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) updateJoy(t);
  }
}
function onJoyEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      joyTouchId = null;
      input.moveX = 0;
      input.moveZ = 0;
      TOUCH_ZONES.joyKnob.style.transform = 'translate(-50%, -50%)';
    }
  }
}
function updateJoy(t) {
  let dx = t.clientX - joyCenter.x;
  let dy = t.clientY - joyCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist > JOY_RADIUS) { dx *= JOY_RADIUS / dist; dy *= JOY_RADIUS / dist; }
  TOUCH_ZONES.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  input.moveX = -(dx / JOY_RADIUS);  // left = positive (matches A key)
  input.moveZ = -(dy / JOY_RADIUS);  // up = positive (matches W key)
}

let lookTouchId = null;
let lookPrev = { x: 0, y: 0 };

function onLookStart(e) {
  e.preventDefault();
  if (lookTouchId !== null) return;
  const t = e.changedTouches[0];
  lookTouchId = t.identifier;
  lookPrev.x = t.clientX;
  lookPrev.y = t.clientY;
}
function onLookMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) {
      input.lookDX += (t.clientX - lookPrev.x) * 0.006;
      input.lookDY += (t.clientY - lookPrev.y) * 0.006;
      lookPrev.x = t.clientX;
      lookPrev.y = t.clientY;
    }
  }
}
function onLookEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) lookTouchId = null;
  }
}

const heldButtons = new Set();
function onBtnStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el || !el.classList.contains('tbtn')) continue;
    const action = el.dataset.action;
    if (!action) continue;
    el.classList.add('active');
    if (el.dataset.hold === 'true') {
      heldButtons.add(action);
      if (action === 'brake') input.brake = true;
    } else {
      queueEdge(action);
    }
    activeTouches[t.identifier] = { action, el };
  }
}
function onBtnEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const info = activeTouches[t.identifier];
    if (!info) continue;
    info.el.classList.remove('active');
    if (info.el.dataset.hold === 'true') {
      heldButtons.delete(info.action);
      if (info.action === 'brake') input.brake = false;
    }
    delete activeTouches[t.identifier];
  }
}

// ---------- Gamepad ----------
let gamepadIndex = null;
const gpPrev = {};   // previous button states for edge detection
const GP_DEADZONE = 0.18;

const GP_MAP = {
  0: 'horn',        // A / Cross
  1: 'camera',      // B / Circle
  2: 'reset',       // X / Square
  4: 'brake',       // LB
  5: 'fullscreen',  // RB
  8: 'reset',       // Select/Back
  9: 'fullscreen',  // Start
};

function pollGamepad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of gps) {
    if (g && g.connected) { gp = g; gamepadIndex = g.index; break; }
  }
  if (!gp) { gamepadIndex = null; return; }

  // sticks
  const lx = Math.abs(gp.axes[0]) > GP_DEADZONE ? gp.axes[0] : 0;
  const ly = Math.abs(gp.axes[1]) > GP_DEADZONE ? gp.axes[1] : 0;
  input.moveX = -lx;  // left positive
  input.moveZ = -ly;  // up positive

  const rx = Math.abs(gp.axes[2]) > GP_DEADZONE ? gp.axes[2] : 0;
  const ry = Math.abs(gp.axes[3]) > GP_DEADZONE ? gp.axes[3] : 0;
  input.lookDX += rx * 0.05;
  input.lookDY += ry * 0.05;

  // triggers
  input.brake = gp.buttons[6] && gp.buttons[6].value > 0.3;   // LT

  // buttons (edge detect)
  for (const [idx, action] of Object.entries(GP_MAP)) {
    const b = gp.buttons[idx];
    if (!b) continue;
    const wasPressed = gpPrev[idx] || false;
    gpPrev[idx] = b.pressed;
    if (b.pressed && !wasPressed) queueEdge(action);
  }
}

// ---------- Keyboard -> unified input (used by main.js) ----------
function keyboardToInput(keysMap) {
  if (joyTouchId !== null) return;
  let mx = 0, mz = 0;
  if (keysMap['KeyA']) mx += 1;
  if (keysMap['KeyD']) mx -= 1;
  if (keysMap['KeyW']) mz += 1;
  if (keysMap['KeyS']) mz -= 1;
  input.moveX = mx;
  input.moveZ = mz;
  input.brake = !!keysMap['Space'];
}

// ---------- Per-frame bookkeeping ----------
function inputEndFrame() {
  input._edgeQueue.length = 0;
  input.lookDX = 0;
  input.lookDY = 0;
}

// ---------- Fullscreen ----------
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

// ---------- Init ----------
function initInput() {
  if (isTouchDevice) buildTouchUI();
  window.addEventListener('gamepadconnected', (e) => {
    gamepadIndex = e.gamepad.index;
    if (typeof toast === 'function') toast('Gamepad connected: ' + e.gamepad.id.slice(0, 30));
  });
  window.addEventListener('gamepaddisconnected', () => {
    gamepadIndex = null;
    if (typeof toast === 'function') toast('Gamepad disconnected');
  });
}
