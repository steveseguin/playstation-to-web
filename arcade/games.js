// Explicit, reviewed entries only. Do not accept executable URLs from query strings.
export const games = [
  {
    id: 'paddle-rally', title: 'Paddle Rally', subtitle: 'A classic rivalry. One more rally.',
    category: 'SPORTS / ARCADE', year: '2026', color: '#ff865b', art: 'paddle',
    description: 'You, a paddle, and a worthy opponent. Keep the ball alive and be the first to seven. Simple to learn. Surprisingly hard to leave.',
    engine: 'emulator', rom: 'games/paddle-rally.exe', available: true,
    controls: [{ keys: ['↑', '↓'], label: 'Move paddle' }, { keys: ['X'], label: 'Launch / play again' }, { keys: ['Enter'], label: 'Pause' }, { keys: ['V'], label: 'New game' }],
    mods: ['color', 'size', 'speed'],
  },
  {
    id: 'brick-shift', title: 'Brick Shift', subtitle: 'Clear the wall. Find your rhythm.',
    category: 'ACTION / ARCADE', year: '2026', color: '#b9a0ff', art: 'bricks',
    description: 'Forty bricks. Three chances. Angle your shots, chase the last block, and turn a wall of color into a clean slate.',
    engine: 'emulator', rom: 'games/brick-shift.exe', available: true,
    controls: [{ keys: ['←', '→'], label: 'Move paddle' }, { keys: ['X'], label: 'Launch / play again' }, { keys: ['Enter'], label: 'Pause' }, { keys: ['V'], label: 'New game' }],
    mods: ['color', 'size', 'speed'],
  },
  {
    id: 'btn', title: 'Harvest Moon', subtitle: 'Back to Nature',
    category: 'FARMING / LIFE SIM', year: '2000', color: '#a9c99a', art: 'farm',
    description: 'The first game supported by the PlayStation to Web compiler. Run your own browser build with your matching disc, then experiment with live JavaScript mods.',
    engine: 'psxw', available: false,
    controls: [{ keys: ['↑', '←', '↓', '→'], label: 'Move' }, { keys: ['S'], label: 'Cross / confirm' }, { keys: ['Z', 'X', 'W'], label: 'Square / circle / triangle' }, { keys: ['Enter'], label: 'Start' }],
    mods: [],
  },
];

export const findGame = id => games.find(game => game.id === id) || games[0];
export const EMULATOR_VERSION = '4.2.3';
export const EMULATOR_DATA = `https://cdn.emulatorjs.org/${EMULATOR_VERSION}/data/`;
