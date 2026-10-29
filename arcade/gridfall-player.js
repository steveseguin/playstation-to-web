import { loadBundle, createGame, decodeSoundBank } from './games/gridfall/engine.mjs';
import { wantsTouchControls } from './input.js';
import { gridfallMods, defaultMods } from './mods.js';
import { findGame } from './games.js';

const mount = document.getElementById('game');
const send = (type, extra = {}) => parent.postMessage({ type, modsReady: ready, ...extra }, location.origin);
const canvas = document.createElement('canvas');
canvas.width = 320; canvas.height = 240; canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'GRIDFALL. Arrows move and turn, Space fires, E opens doors, P pauses.');
const context = canvas.getContext('2d');
const image = context.createImageData(320, 240);
const keys = new Set(), pointers = new Map(), voices = [], buffers = new Map(), weaponButtons = new Set();
let game, bank, audio, ready = false, pending = 0, last = null, elapsed = 0;
const keyMap = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'strafeLeft', KeyD: 'strafeRight',
  Space: 'fire', KeyE: 'use', ShiftLeft: 'run', ShiftRight: 'run', KeyP: 'pause', Enter: 'pause' };

function unlockAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (Audio && !audio) audio = new Audio();
  audio?.resume().catch(() => {});
}
function sound(id, on) {
  if (!audio) return;
  if (!on) { voices.filter(v => v.id === id).forEach(v => v.source.stop()); return; }
  const data = bank.get(id);
  if (!data) return;
  if (!buffers.has(id)) {
    const buffer = audio.createBuffer(1, data.samples.length, data.rate);
    buffer.copyToChannel(data.samples, 0); buffers.set(id, buffer);
  }
  while (voices.length >= 16) voices.shift().source.stop();
  const source = audio.createBufferSource(), volume = audio.createGain();
  source.buffer = buffers.get(id); volume.gain.value = 0.45;
  source.connect(volume).connect(audio.destination);
  const voice = { id, source }; voices.push(voice);
  source.onended = () => { const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); };
  source.start();
}
function paint(fraction = 1) {
  const pixels = game.render(fraction);
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i], p = i * 4;
    image.data[p] = (pixel & 31) * 255 / 31;
    image.data[p + 1] = ((pixel >> 5) & 31) * 255 / 31;
    image.data[p + 2] = ((pixel >> 10) & 31) * 255 / 31;
    image.data[p + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function release() {
  keys.clear(); pointers.clear(); weaponButtons.clear(); pending = 0; last = null; elapsed = 0;
  document.querySelectorAll('.pressed').forEach(button => button.classList.remove('pressed'));
}
addEventListener('blur', release);
document.addEventListener('visibilitychange', release);
addEventListener('keydown', event => {
  if (!ready || event.ctrlKey || event.altKey || event.metaKey) return;
  const action = keyMap[event.code];
  if (!action && !/^Digit[1-8]$/.test(event.code) && event.code !== 'KeyQ') return;
  event.preventDefault(); unlockAudio();
  if (action) { keys.add(action); if (!event.repeat) pending |= game.buttons[action]; }
  else if (!event.repeat) {
    if (game.intro()) pending |= game.buttons.pause;
    else if (event.code === 'KeyQ') cycleWeapon();
    else game.weapon(Number(event.code.slice(-1)) - 1);
  }
});
addEventListener('keyup', event => keys.delete(keyMap[event.code]));
canvas.addEventListener('pointerdown', () => {
  canvas.focus(); unlockAudio();
  if (ready && game.intro()) pending |= game.buttons.pause;
});
function cycleWeapon() {
  if (game.intro()) { pending |= game.buttons.pause; return; }
  const state = game.state();
  for (let offset = 1; offset <= 8; offset++) {
    const next = (state[3] + offset) % 8;
    if (state[16] & (1 << next)) { game.weapon(next); return; }
  }
}
function input() {
  let buttons = pending; pending = 0;
  for (const action of keys) buttons |= game.buttons[action];
  for (const bit of pointers.values()) buttons |= bit;
  for (const pad of navigator.getGamepads?.() || []) {
    if (!pad || pad.mapping !== 'standard') continue;
    const down = index => pad.buttons[index]?.pressed;
    if (down(3)) {
      if (game.intro()) buttons |= game.buttons.pause;
      else if (!weaponButtons.has(pad.index)) cycleWeapon();
      weaponButtons.add(pad.index);
    } else weaponButtons.delete(pad.index);
    for (const [index, action] of [[0, 'fire'], [1, 'use'], [2, 'run'], [4, 'strafeLeft'], [5, 'strafeRight'], [9, 'pause']]) {
      if (down(index)) buttons |= game.buttons[action];
    }
    if (down(12) || pad.axes[1] < -.4) buttons |= game.buttons.up;
    if (down(13) || pad.axes[1] > .4) buttons |= game.buttons.down;
    if (down(14) || pad.axes[0] < -.4) buttons |= game.buttons.left;
    if (down(15) || pad.axes[0] > .4) buttons |= game.buttons.right;
  }
  return buttons;
}
function fail(error) {
  ready = false; release(); voices.slice().forEach(v => v.source.stop());
  console.error('GRIDFALL load/playback failed:', error);
  send('arcade-error');
  const message = document.createElement('p'); message.id = 'message';
  message.textContent = 'The game could not run. Use Restart to try again.';
  mount.replaceChildren(message);
}
function animate(time) {
  if (!ready) return;
  try {
    if (last !== null) elapsed += Math.min(time - last, 250);
    last = time;
    while (elapsed >= 1000 / 15) { game.step(input()); elapsed -= 1000 / 15; }
    paint(elapsed / (1000 / 15)); requestAnimationFrame(animate);
  } catch (error) { fail(error); }
}
function touchControls() {
  const controls = document.createElement('div'); controls.id = 'touch-controls';
  for (const [id, label, action] of [['up', '↑', 'up'], ['left', '←', 'left'], ['down', '↓', 'down'], ['right', '→', 'right'],
    ['cross', 'Fire', 'fire'], ['use', 'Use', 'use'], ['start', 'Pause', 'pause'],
    ['strafe-left', 'Strafe ←', 'strafeLeft'], ['strafe-right', 'Strafe →', 'strafeRight'], ['weapon', 'Weapon', null]]) {
    const button = document.createElement('button'); button.id = `pad-${id}`; button.textContent = label;
    button.style.fontSize = action === 'fire' ? '16px' : '';
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId); unlockAudio(); canvas.focus();
      if (!action) { cycleWeapon(); return; }
      const bit = game.buttons[action]; pointers.set(event.pointerId, bit); pending |= bit;
      button.classList.add('pressed');
    });
    const up = event => { pointers.delete(event.pointerId); button.classList.remove('pressed'); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, up);
    controls.append(button);
  }
  mount.append(controls);
}
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'arcade-apply-mods') return;
  const { request, selection } = event.data;
  try {
    if (!ready) throw new Error('Wait for the game to load.');
    const values = gridfallMods(selection);
    game.setSpeed(values.movement); game.setTint(values.palette); paint();
    send('arcade-mods-applied', { request, selection });
  } catch (error) { send('arcade-mods-error', { request, message: error.message }); }
});
try {
  const bundle = await loadBundle(); bank = decodeSoundBank(bundle.sound);
  game = await createGame(bundle, sound);
  window.gridfall = game;
  const values = gridfallMods(defaultMods(findGame('gridfall')));
  game.setSpeed(values.movement); game.setTint(values.palette);
  mount.replaceChildren(canvas);
  if (new URLSearchParams(location.search).get('touch') === '1' || wantsTouchControls()) touchControls();
  paint(); ready = true; canvas.focus(); send('arcade-started'); requestAnimationFrame(animate);
} catch (error) { fail(error); }
