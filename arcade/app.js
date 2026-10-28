import { games, findGame } from './games.js';
import { artwork } from './art.js';

const $ = id => document.getElementById(id);
let selected = findGame(new URLSearchParams(location.search).get('game'));
let active = null;
let filter = 'all';
let loadTimer;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };

function renderLibrary() {
  $('game-list').replaceChildren();
  games.filter(game => filter === 'all' || game.available).forEach(game => {
    const button = document.createElement('button');
    button.className = 'game-card';
    button.style.setProperty('--accent', game.color);
    button.setAttribute('aria-pressed', String(game.id === selected.id));
    button.setAttribute('aria-label', `${game.title}${game.available ? ', ready to play' : ', your own build required'}`);
    button.innerHTML = `<div class="card-art" aria-hidden="true">${artwork(game.art)}<span class="card-number">0${games.indexOf(game) + 1} / PS1</span></div><div class="card-body"><div class="card-title">${game.title}</div><div class="card-meta"><span>${game.category.split(' / ')[0]}</span><span class="card-tag ${game.available ? '' : 'unavailable'}">${game.available ? 'Ready to play' : 'Build required'}</span></div></div>`;
    button.addEventListener('click', () => select(game));
    $('game-list').append(button);
  });
}

function stop(message = 'Game stopped. Ready for another round?') {
  clearTimeout(loadTimer);
  // Removing the frame tears down the entire engine, including audio and input.
  $('game-mount').replaceChildren();
  $('game-mount').hidden = true;
  $('preview').hidden = false;
  $('restart').disabled = $('stop').disabled = true;
  active = null;
  $('session-label').textContent = 'ON THE MARQUEE';
  status(message);
}

function select(game, updateHistory = true) {
  if (game.id !== selected.id) stop();
  selected = game;
  document.documentElement.style.setProperty('--accent', game.color);
  $('game-title').textContent = $('screen-title').textContent = game.title;
  $('game-subtitle').textContent = $('screen-description').textContent = game.subtitle;
  $('game-category').textContent = `${game.category} · ${game.year}`;
  $('game-description').textContent = game.description;
  $('screen-art').innerHTML = artwork(game.art, true);
  $('play').innerHTML = game.available ? '<span aria-hidden="true">▶</span> Play now' : '<span aria-hidden="true">↗</span> Build & play';
  $('play-note').textContent = game.available ? 'Free homebrew · No download or disc needed' : 'Requires your own compiled build and matching disc';
  $('screen-kicker').textContent = game.available ? "PLAYER ONE, YOU'RE UP" : 'BRING YOUR OWN ADVENTURE';
  $('engine-label').textContent = game.engine === 'emulator' ? 'PS1 HOMEBREW · EMULATOR' : 'PSXW · COMPILED GAME';
  $('engine-note').textContent = game.engine === 'emulator'
    ? 'These original PS1 homebrew demos use EmulatorJS. They are not yet compiled with psxw.'
    : 'This game runs through the psxw compiler. Commercial game code and assets are not hosted here.';
  $('mod-count').textContent = game.mods.length;
  $('controls-list').replaceChildren();
  for (const control of game.controls) {
    const item = document.createElement('div');
    item.className = 'control';
    const keys = document.createElement('div');
    for (const key of control.keys) { const kbd = document.createElement('kbd'); kbd.textContent = key; keys.append(kbd); }
    const label = document.createElement('span'); label.textContent = control.label;
    item.append(keys, label); $('controls-list').append(item);
  }
  if (!active) status(game.available ? 'Ready when you are. Press Play now to load the game.' : 'Build this game locally with psxw. The setup guide opens in a new tab.');
  if (updateHistory) {
    const url = new URL(location.href);
    url.searchParams.set('game', game.id);
    history.replaceState(null, '', url);
  }
  renderLibrary();
}

function play() {
  if (!selected.available) {
    window.open('https://github.com/steveseguin/playstation-to-web/blob/main/README.slop.md', '_blank', 'noopener,noreferrer');
    return;
  }
  stop();
  const frame = document.createElement('iframe');
  frame.title = `${selected.title} game player`;
  frame.allow = 'autoplay; fullscreen; gamepad; screen-wake-lock';
  frame.allowFullscreen = true;
  // Carry touch capability from the top-level page into the isolated player.
  // Some browsers report zero touch points inside a newly created frame.
  frame.src = `player.html?game=${encodeURIComponent(selected.id)}&touch=${navigator.maxTouchPoints > 0 ? 1 : 0}`;
  $('preview').hidden = true;
  $('game-mount').hidden = false;
  $('game-mount').append(frame);
  active = { game: selected, frame };
  $('restart').disabled = $('stop').disabled = false;
  $('session-label').textContent = 'LOADING THE GOOD STUFF';
  status('Loading the player and game. The first visit may take a moment…');
  loadTimer = setTimeout(() => status('Still loading? The player downloads from EmulatorJS. Check your connection, or press Restart to try again.', true), 60000);
}

addEventListener('message', event => {
  if (!active || event.origin !== location.origin || event.source !== active.frame.contentWindow) return;
  if (event.data?.type === 'arcade-started') {
    clearTimeout(loadTimer);
    $('session-label').textContent = 'NOW PLAYING';
    status('Game loaded. Press X or tap × to launch. Enter / Start pauses.');
    active.frame.focus();
  } else if (event.data?.type === 'arcade-error') {
    clearTimeout(loadTimer);
    $('session-label').textContent = 'COULD NOT LOAD';
    status('The player could not load. Check your connection and press Restart to try again.', true);
  }
});

$('play').addEventListener('click', play);
$('restart').addEventListener('click', play);
$('stop').addEventListener('click', () => stop());
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('cabinet').requestFullscreen) await $('cabinet').requestFullscreen();
    else status('Fullscreen is not available in this browser. Rotate your device for a larger view.');
  } catch { status('Your browser could not enter fullscreen. You can keep playing here.', true); }
});
function openMods() {
  $('mods-game').textContent = selected.title + ' · 0 mods available';
  $('mods-dialog').showModal();
}
$('open-mods').addEventListener('click', openMods);
$('explore-mods').addEventListener('click', openMods);
$('close-mods').addEventListener('click', () => $('mods-dialog').close());
$('mods-dialog').addEventListener('click', event => {
  const rect = $('mods-dialog').getBoundingClientRect();
  if (event.target === $('mods-dialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('mods-dialog').close();
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => { const chosen = item === button; item.classList.toggle('active', chosen); item.setAttribute('aria-pressed', chosen); });
  renderLibrary();
}));
const updatePads = () => { $('gamepad-status').textContent = [...(navigator.getGamepads?.() || [])].some(Boolean) ? 'Gamepad connected' : 'Keyboard + gamepad'; };
addEventListener('gamepadconnected', updatePads);
addEventListener('gamepaddisconnected', updatePads);
addEventListener('pagehide', () => stop());
select(selected, false);
updatePads();
