import { games, EMULATOR_DATA } from './games.js';
import { wantsTouchControls } from './input.js';
const id = new URLSearchParams(location.search).get('game');
const touchControls = new URLSearchParams(location.search).get('touch') === '1' || wantsTouchControls();
const game = games.find(item => item.id === id && item.available && item.engine === 'emulator');
const send = type => parent.postMessage({ type }, location.origin);
// The core requests an optional screen wake lock without catching rejection.
// Background tabs and some browsers deny it; gameplay does not depend on it.
addEventListener('unhandledrejection', event => {
  if (event.reason?.name === 'NotAllowedError' && /wake lock/i.test(event.reason.message)) {
    event.preventDefault();
    console.info('Screen wake lock unavailable; the game can still run.');
  }
});
function failed() {
  send('arcade-error');
  const message = document.createElement('p');
  message.id = 'message';
  message.textContent = 'The game could not load. Check your connection, then use Restart above the controls to try again.';
  document.getElementById('game').replaceChildren(message);
}
if (!game) failed();
else {
  Object.assign(window, {
    EJS_player: '#game', EJS_core: 'pcsx_rearmed',
    EJS_gameUrl: new URL(game.rom, location.href).href,
    EJS_gameName: game.id, EJS_gameID: games.indexOf(game) + 1,
    EJS_pathtodata: EMULATOR_DATA,
    EJS_startOnLoaded: true, EJS_color: game.color,
    EJS_backgroundColor: '#121422', EJS_threads: false,
    EJS_disableDatabases: true, EJS_disableAutoLang: true,
    EJS_volume: 0.5, EJS_startButtonName: 'Start game',
    EJS_defaultOptions: { 'virtual-gamepad': touchControls ? 'enabled' : 'disabled' },
    EJS_VirtualGamepadSettings: [
      { type: 'dpad', location: 'left', left: '50%', right: '50%', joystickInput: false, inputValues: [4, 5, 6, 7] },
      { type: 'button', text: '×', id: 'cross', location: 'right', left: 40, top: 40, bold: true, input_value: 0 },
      { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 14, block: true, input_value: 3 },
      { type: 'button', text: 'Reset', id: 'select', location: 'center', left: -5, fontSize: 14, block: true, input_value: 2 },
    ],
    EJS_defaultControls: { 0: {
      0: { value: 'x', value2: 'BUTTON_2' },
      1: { value: 's', value2: 'BUTTON_4' },
      2: { value: 'v', value2: 'SELECT' },
      3: { value: 'enter', value2: 'START' },
      4: { value: 'up arrow', value2: 'DPAD_UP' },
      5: { value: 'down arrow', value2: 'DPAD_DOWN' },
      6: { value: 'left arrow', value2: 'DPAD_LEFT' },
      7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
      8: { value: 'z', value2: 'BUTTON_1' },
      9: { value: 'a', value2: 'BUTTON_3' },
    }, 1: {}, 2: {}, 3: {} },
    EJS_onGameStart: () => {
      // Pinned 4.2.3 opens its menu on startup, covering the touch controls.
      // Keep it available via the menu button, but start with the game visible.
      window.EJS_emulator.menu.close();
      send('arcade-started');
    },
    EJS_onLoadState: () => send('arcade-started'),
  });
  const loader = document.createElement('script');
  loader.src = EMULATOR_DATA + 'loader.js';
  loader.onerror = failed;
  document.body.append(loader);
}
