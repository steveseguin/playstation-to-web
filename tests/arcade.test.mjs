import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { games, findGame } from '../arcade/games.js';
import { applyMods, defaultMods, modWrites, modDefinitions, gridfallMods } from '../arcade/mods.js';
import { createHash } from 'node:crypto';

async function load(game) {
  const bytes = await readFile(`dist/${game.binary}`);
  let rectangles = [], labels = [];
  const { instance, module } = await WebAssembly.instantiate(bytes, { arcade: {
    rect: (...args) => rectangles.push(args),
    text: (x, y, pointer) => {
      const memory = new Uint8Array(instance.exports.memory.buffer);
      let end = pointer;
      while (memory[end]) end++;
      labels.push([x, y, new TextDecoder().decode(memory.subarray(pointer, end))]);
    },
  } });
  const wasm = instance.exports;
  wasm.game_init();
  return { bytes, module, wasm,
    read: name => new DataView(wasm.memory.buffer).getInt32(wasm[name].value, true),
    render() { rectangles = []; labels = []; wasm.game_render(); return { rectangles, labels }; },
  };
}

test('only original compiled Wasm games are packaged; commercial title stays build-only', async () => {
  const playable = games.filter(game => game.available);
  assert.equal(playable.length, 3);
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  assert.equal(findGame('untrusted-input'), games[0]);
  assert.equal(findGame('btn').available, false);
  for (const game of playable.filter(game => game.engine === 'wasm')) {
    assert.equal(game.engine, 'wasm');
    const { module, bytes } = await load(game);
    assert.ok(WebAssembly.validate(bytes));
    assert.deepEqual(WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`).sort(), ['arcade.rect', 'arcade.text']);
    assert.ok(game.controls.length >= 3);
    assert.equal(game.mods.length, 3);
  }
  assert.deepEqual((await readdir('dist/games')).sort(), ['brick-shift.wasm', 'gridfall', 'paddle-rally.wasm']);
});

test('mods write the running compiled game; invalid selections cannot partially apply', async () => {
  const manifest = JSON.parse(await readFile('dist/mod-manifest.json', 'utf8'));
  for (const game of games.filter(game => game.available && game.engine === 'wasm')) {
    const { wasm, bytes, read, render } = await load(game);
    assert.equal(manifest[game.id].sha256, createHash('sha256').update(bytes).digest('hex'));
    for (const [name, value] of Object.entries(modWrites(game, defaultMods()))) assert.equal(read(name), value);
    const original = render();
    applyMods(game, { color: 'mint', size: 'large', speed: 'fast' }, wasm);
    assert.equal(read('ball_speed'), 200);
    assert.equal(read('accent_green'), 240);
    const paddle = render().rectangles.find(r => r[4] === 80 && r[5] === 240);
    assert.ok(paddle);
    assert.equal(paddle[game.id === 'brick-shift' ? 2 : 3], game.id === 'brick-shift' ? 80 : 72);
    const beforeInvalid = Buffer.from(wasm.memory.buffer).slice();
    assert.throws(() => applyMods(game, { ...defaultMods(), speed: 'arbitrary' }, wasm));
    assert.throws(() => applyMods(game, { ...defaultMods(), address: 123 }, wasm));
    assert.throws(() => applyMods(game, defaultMods(), { ...wasm, ball_speed: { value: -1 } }));
    assert.deepEqual(Buffer.from(wasm.memory.buffer), beforeInvalid);
    applyMods(game, defaultMods(), wasm);
    assert.deepEqual(render(), original);
  }
  assert.throws(() => modWrites(findGame('btn'), defaultMods()));
});

test('compiled physics, pause, reset, and speed changes preserve the same session', async () => {
  for (const game of games.filter(game => game.available && game.engine === 'wasm')) {
    const ball = state => state.rectangles.find(r => r[2] === 6 && r[3] === 6);
    const motion = [];
    for (const speed of ['slow', 'normal', 'fast']) {
      const { wasm, render } = await load(game);
      applyMods(game, { ...defaultMods(), speed }, wasm);
      const initial = ball(render());
      wasm.game_tick(16384); // launch
      for (let i = 0; i < 10; i++) wasm.game_tick(0);
      motion.push(ball(render())[0] - initial[0]);
      wasm.game_tick(8); // pause
      const paused = render();
      for (let i = 0; i < 10; i++) wasm.game_tick(0);
      assert.deepEqual(render(), paused);
      applyMods(game, { color: 'pink', size: 'large', speed }, wasm);
      assert.deepEqual(ball(render()), ball(paused), 'mods preserve ball position');
      wasm.game_tick(1); // in-game reset retains mods
      assert.equal(new DataView(wasm.memory.buffer).getInt32(wasm.accent_green.value, true), 80);
      assert.ok(render().labels.some(label => label[2] === 'CROSS TO LAUNCH'));
    }
    assert.deepEqual(motion, [10, 20, 40], `${game.id}: speed affects compiled physics`);
  }
});

test('every mod combination preserves earned progress and only changes selected globals', async () => {
  for (const game of games.filter(game => game.available && game.engine === 'wasm')) {
    const { wasm, render } = await load(game);
    wasm.game_tick(16384);
    const startingScore = render().labels[0][2];
    for (let i = 0; i < 1000 && render().labels[0][2] === startingScore; i++) wasm.game_tick(0);
    const earnedScore = render().labels[0][2];
    assert.notEqual(earnedScore, startingScore, `${game.id}: establish real gameplay progress`);
    // Start another ball if scoring ended the previous rally.
    wasm.game_tick(16384);
    wasm.game_tick(0);
    for (const color of modDefinitions[0].options) {
      for (const size of modDefinitions[1].options) {
        for (const speed of modDefinitions[2].options) {
          const selection = { color: color.id, size: size.id, speed: speed.id };
          const expectedMemory = Buffer.from(new Uint8Array(wasm.memory.buffer));
          for (const [name, value] of Object.entries(modWrites(game, selection))) expectedMemory.writeInt32LE(value, wasm[name].value);
          applyMods(game, selection, wasm);
          assert.deepEqual(Buffer.from(wasm.memory.buffer), expectedMemory, `${game.id}: only selected globals change`);
          assert.equal(render().labels[0][2], earnedScore, 'earned score and lives survive every mod combination');
        }
      }
    }
    applyMods(game, defaultMods(), wasm);
    assert.equal(render().labels[0][2], earnedScore, 'restoring defaults keeps earned progress');
  }
});

test('speed can change repeatedly while the same compiled game is running', async () => {
  for (const game of games.filter(game => game.available && game.engine === 'wasm')) {
    const { wasm, render } = await load(game);
    const ballX = () => render().rectangles.find(r => r[2] === 6 && r[3] === 6)[0];
    wasm.game_tick(16384);
    for (const [speed, distance] of [['slow', 4], ['normal', 8], ['fast', 16], ['normal', 8]]) {
      const before = ballX();
      applyMods(game, { ...defaultMods(), speed }, wasm);
      assert.equal(ballX(), before, 'applying speed does not move or reset the ball');
      for (let i = 0; i < 4; i++) wasm.game_tick(0);
      assert.equal(ballX() - before, distance, `${game.id}: ${speed} immediately changes compiled physics`);
    }
  }
});

test('all local entry-point assets and license notices are packaged', async () => {
  for (const page of ['index.html', 'player.html', 'gridfall-player.html', 'sample.html', 'credits.html']) {
    const html = await readFile(`dist/${page}`, 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const path = match[1];
      if (path.includes('://') || path.startsWith('./')) continue;
      assert.ok((await readFile(`dist/${path}`)).length, `${page}: ${path}`);
    }
  }
  assert.match(await readFile('dist/licenses/demos-MIT.txt', 'utf8'), /MIT License/);
  assert.match(await readFile('dist/licenses/gridfall-MIT.txt', 'utf8'), /MIT License/);
  assert.match(await readFile('dist/licenses/PSn00bSDK.txt', 'utf8'), /MPL 2.0/);
  assert.equal(createHash('sha256').update(await readFile('dist/assets/debug-font.png')).digest('hex'), '2a807bb41892e0b90f1792d5a128dc9c6c099f0890cacbf1459392200cc4c05e');
  for (const file of ['player.js', 'games.js', 'app.js', 'index.html', 'credits.html']) {
    assert.doesNotMatch(await readFile(`dist/${file}`, 'utf8'), /EmulatorJS|EJS_|pcsx_rearmed|\.exe\b/);
  }
});

test('GRIDFALL runs translated PS1 code and live mods preserve gameplay', async () => {
  const { createGame, decodeSoundBank } = await import('../dist/games/gridfall/engine.mjs');
  const manifest = JSON.parse(await readFile('dist/games/gridfall/build.json', 'utf8'));
  const sample = JSON.parse(await readFile('dist/samples/gridfall.json', 'utf8'));
  const archive = await readFile('dist/samples/gridfall-ps1.zip');
  assert.equal(createHash('sha256').update(archive).digest('hex'), sample.sha256);
  assert.equal(manifest.compiler, 'psxw-lift');
  assert.equal(manifest.compiler_revision, sample.compiler_revision);
  assert.ok(manifest.translated_functions > 300);
  const files = {};
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    const bytes = await readFile(`dist/games/gridfall/${name}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    files[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  assert.equal(new TextDecoder().decode(files['gridfall.exe'].slice(0, 8)), 'PS-X EXE');
  const bundle = { manifest, exe: files['gridfall.exe'], wasm: files['gridfall.wasm'], data: files['GRIDFALL.DAT'], sound: files['SOUND.BNK'] };
  const events = [];
  const game = await createGame(bundle, (...args) => events.push(args));
  assert.equal(game.intro(), 1);
  game.step(game.buttons.pause); game.step(0); game.step(0);
  assert.equal(game.intro(), 0);
  const originalState = game.state();
  const originalPixels = game.render().slice();
  const mods = gridfallMods({ movement: 'fast', palette: 'full' });
  game.setSpeed(mods.movement); game.setTint(mods.palette);
  assert.deepEqual(game.state(), originalState, 'live edits preserve all game state');
  assert.notDeepEqual(game.render(), originalPixels, 'palette reaches translated renderer');
  const defaults = gridfallMods(defaultMods(findGame('gridfall')));
  game.setTint(defaults.palette);
  assert.deepEqual(game.render(), originalPixels, 'palette restoration is exact');
  const normal = await createGame(bundle); normal.restart(); game.restart();
  const start = game.state()[10];
  for (let i = 0; i < 5; i++) { normal.step(normal.buttons.up); game.step(game.buttons.up); }
  assert.ok(Math.abs(game.state()[10] - start) > Math.abs(normal.state()[10] - start) * 1.5, 'live speed changes PS1 movement');
  for (let i = 0; i < 15; i++) game.step(game.buttons.fire);
  assert.ok(game.state()[4] < originalState[4], 'shooting spends ammunition');
  assert.ok(events.some(event => event[1] === 1), 'native game produces sound events');
  assert.ok([...decodeSoundBank(bundle.sound).values()].some(sound => sound.samples.some(value => value !== 0)));
  const progress = game.state();
  game.setSpeed(defaults.movement); game.setTint(defaults.palette);
  assert.deepEqual(game.state(), progress, 'resetting mods retains earned progress');
  game.step(0); game.step(game.buttons.pause);
  assert.equal(game.state()[14], 1);
  const position = game.state().slice(9, 12);
  for (let i = 0; i < 15; i++) game.step(game.buttons.up);
  assert.deepEqual(game.state().slice(9, 12), position);
  assert.throws(() => gridfallMods({ movement: 'fast', palette: 'invalid' }));
  assert.throws(() => gridfallMods({ movement: 'fast', palette: 'full', address: 1 }));
});
