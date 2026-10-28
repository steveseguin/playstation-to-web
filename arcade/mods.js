// Curated game-memory edits only. Addresses come from each matching PS1 build.
export const modDefinitions = [
  { id: 'color', label: 'Paddle color', default: 'original', options: [
    { id: 'original', label: 'Original orange', values: [255, 125, 74] },
    { id: 'mint', label: 'Electric mint', values: [80, 240, 170] },
    { id: 'purple', label: 'Arcade purple', values: [185, 120, 255] },
    { id: 'pink', label: 'Hot pink', values: [255, 80, 170] },
  ] },
  { id: 'size', label: 'Paddle size', default: 'normal', options: [
    { id: 'small', label: 'Small · harder', values: [24, 20] },
    { id: 'normal', label: 'Normal', values: [48, 40] },
    { id: 'large', label: 'Large · easier', values: [80, 72] },
  ] },
  { id: 'speed', label: 'Ball speed', default: 'normal', options: [
    { id: 'slow', label: 'Slow · ½ speed', values: [50] },
    { id: 'normal', label: 'Normal', values: [100] },
    { id: 'fast', label: 'Fast · 2× speed', values: [200] },
  ] },
];
export const defaultMods = () => Object.fromEntries(modDefinitions.map(mod => [mod.id, mod.default]));

export function modWrites(game, selection) {
  if (!game.available || game.engine !== 'emulator' || !selection ||
      Object.keys(selection).sort().join() !== game.mods.slice().sort().join()) throw new Error('Invalid mod selection');
  const options = Object.fromEntries(modDefinitions.map(mod => {
    const option = mod.options.find(option => option.id === selection[mod.id]);
    if (!option) throw new Error('Unknown mod option');
    return [mod.id, option.values];
  }));
  return {
    accent_red: options.color[0], accent_green: options.color[1], accent_blue: options.color[2],
    [game.id === 'brick-shift' ? 'paddle_width' : 'paddle_height']: options.size[game.id === 'brick-shift' ? 0 : 1],
    ball_speed: options.speed[0],
  };
}

export function cheatCodes(game, selection, symbols) {
  return Object.entries(modWrites(game, selection)).map(([name, value]) => {
    const address = symbols[name];
    if (!Number.isInteger(address) || address < 0x80000000 || address >= 0x80200000 || address % 4) throw new Error('Invalid mod address');
    // GameShark 80 writes the low 16 bits. These nonnegative int globals have
    // zero upper halves and are only ever written by this curated mod bridge.
    return `${address.toString(16).toUpperCase()} ${value.toString(16).padStart(4, '0').toUpperCase()}`;
  });
}
