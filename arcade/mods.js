// Curated game-memory edits. Addresses are exports of the loaded Wasm module.
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
  if (!game.available || game.engine !== 'wasm' || !selection ||
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

export function applyMods(game, selection, exports) {
  const memory = new DataView(exports.memory.buffer);
  const writes = Object.entries(modWrites(game, selection)).map(([name, value]) => {
    const address = exports[name]?.value;
    if (!Number.isInteger(address) || address < 0 || address % 4 || address + 4 > memory.byteLength) throw new Error('Invalid mod export');
    return [address, value];
  });
  for (const [address, value] of writes) memory.setInt32(address, value, true);
}
