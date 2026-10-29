import { games } from './games.js';
import { wantsTouchControls } from './input.js';
import { applyMods, defaultMods } from './mods.js';

const params = new URLSearchParams(location.search);
const game = games.find(item => item.id === params.get('game') && item.available && item.engine === 'wasm');
const touchControls = params.get('touch') === '1' || wantsTouchControls();
const mount = document.getElementById('game');
let runtime;
let ready = false;
let keyboard = 0, pending = 0;
const pointers = new Map();
const keys = { ArrowUp: 16, ArrowRight: 32, ArrowDown: 64, ArrowLeft: 128, KeyX: 16384, Enter: 8, KeyV: 1 };
const send = (type, extra = {}) => parent.postMessage({ type, modsReady: ready, ...extra }, location.origin);

addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'arcade-apply-mods') return;
  const { request, selection } = event.data;
  try {
    if (!ready) throw new Error('Mods are unavailable. Restart the game and try again.');
    applyMods(game, selection, runtime);
    draw();
    send('arcade-mods-applied', { request, selection });
  } catch (error) {
    send('arcade-mods-error', { request, message: error.message });
  }
});
addEventListener('keydown', event => {
  const bit = keys[event.code];
  if (!bit) return;
  event.preventDefault();
  if (!event.repeat) pending |= bit;
  keyboard |= bit;
});
addEventListener('keyup', event => {
  const bit = keys[event.code];
  if (!bit) return;
  event.preventDefault();
  keyboard &= ~bit;
});
function releaseInputs() {
  keyboard = pending = 0;
  pointers.clear();
  document.querySelectorAll('.pressed').forEach(button => button.classList.remove('pressed'));
}
addEventListener('blur', releaseInputs);
let lastTime = null, elapsed = 0;
document.addEventListener('visibilitychange', () => {
  releaseInputs();
  lastTime = null;
  elapsed = 0;
});
function heldButtons() {
  let held = keyboard;
  for (const bit of pointers.values()) held |= bit;
  for (const pad of navigator.getGamepads?.() || []) {
    if (!pad || pad.mapping !== 'standard') continue;
    const down = index => pad.buttons[index]?.pressed;
    if (down(0)) held |= 16384;
    if (down(8)) held |= 1;
    if (down(9)) held |= 8;
    if (down(12) || pad.axes[1] < -.4) held |= 16;
    if (down(15) || pad.axes[0] > .4) held |= 32;
    if (down(13) || pad.axes[1] > .4) held |= 64;
    if (down(14) || pad.axes[0] < -.4) held |= 128;
  }
  return held;
}
const canvas = document.createElement('canvas');
canvas.width = 320; canvas.height = 240;
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', game ? `${game.title} game screen` : 'Game screen');
canvas.addEventListener('pointerdown', () => canvas.focus());
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
let rectangles = [], labels = [];
let font;
function draw() {
  rectangles = []; labels = [];
  runtime.game_render();
  ctx.fillStyle = '#121422';
  ctx.fillRect(0, 0, 320, 240);
  // Match the original PS1 ordering table: reverse primitives, then text.
  for (const [x, y, w, h, r, g, b] of rectangles.reverse()) {
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w, h);
  }
  for (const [x, y, value] of labels.reverse()) {
    for (let i = 0; i < value.length; i++) {
      const glyph = value.charCodeAt(i) - 33;
      if (glyph >= 0 && glyph < 64) ctx.drawImage(font, (glyph % 16) * 8, Math.floor(glyph / 16) * 8, 8, 8, x + i * 8, y, 8, 8);
    }
  }
}
function animate(time) {
  if (!ready) return;
  if (lastTime !== null) elapsed += Math.min(time - lastTime, 100);
  lastTime = time;
  while (elapsed >= 1000 / 60) {
    runtime.game_tick(heldButtons() | pending);
    pending = 0;
    elapsed -= 1000 / 60;
  }
  draw();
  requestAnimationFrame(animate);
}
function addTouchControls() {
  const controls = document.createElement('div');
  controls.id = 'touch-controls';
  const definitions = [['up', '↑', 16], ['left', '←', 128], ['down', '↓', 64], ['right', '→', 32], ['select', 'Reset', 1], ['start', 'Start', 8], ['cross', '×', 16384]];
  for (const [id, label, bit] of definitions) {
    const button = document.createElement('button');
    button.id = `pad-${id}`;
    button.textContent = label;
    button.setAttribute('aria-label', id === 'cross' ? 'Launch / play again' : label);
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, bit);
      pending |= bit;
      button.classList.add('pressed');
    });
    const release = event => {
      pointers.delete(event.pointerId);
      if (![...pointers.values()].includes(bit)) button.classList.remove('pressed');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    controls.append(button);
  }
  mount.append(controls);
}
try {
  if (!game) throw new Error('Unknown game');
  const manifestResponse = await fetch('mod-manifest.json');
  if (!manifestResponse.ok) throw new Error('Build manifest unavailable');
  const manifest = (await manifestResponse.json())[game.id];
  if (!/^[a-f0-9]{64}$/.test(manifest?.sha256)) throw new Error('Invalid game build');
  const response = await fetch(`${game.binary}?v=${manifest.sha256}`);
  if (!response.ok) throw new Error('Game binary unavailable');
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.sha256) throw new Error('Game binary does not match this build');
  const result = await WebAssembly.instantiate(bytes, { arcade: {
    rect: (...args) => rectangles.push(args),
    text: (x, y, pointer) => {
      const memory = new Uint8Array(runtime.memory.buffer);
      let end = pointer;
      while (end < memory.length && memory[end]) end++;
      labels.push([x, y, new TextDecoder().decode(memory.subarray(pointer, end))]);
    },
  } });
  runtime = result.instance.exports;
  font = new Image();
  font.src = 'assets/debug-font.png';
  await font.decode();
  mount.replaceChildren(canvas);
  if (touchControls) addTouchControls();
  runtime.game_init();
  applyMods(game, defaultMods(), runtime);
  draw();
  ready = true;
  canvas.focus();
  send('arcade-started');
  requestAnimationFrame(animate);
} catch (error) {
  console.error('Game load failed:', error);
  ready = false;
  send('arcade-error');
  const message = document.createElement('p');
  message.id = 'message';
  message.textContent = 'The game could not load. Check your connection, then use Restart above the controls to try again.';
  mount.replaceChildren(message);
}
