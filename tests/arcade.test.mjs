import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { games, findGame } from '../arcade/games.js';
import { applyMods, defaultMods, modWrites, modDefinitions } from '../arcade/mods.js';
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
  assert.equal(playable.length, 2);
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  assert.equal(findGame('untrusted-input'), games[0]);
  assert.equal(findGame('btn').available, false);
  for (const game of playable) {
    assert.equal(game.engine, 'wasm');
    const { module, bytes } = await load(game);
    assert.ok(WebAssembly.validate(bytes));
    assert.deepEqual(WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`).sort(), ['arcade.rect', 'arcade.text']);
    assert.ok(game.controls.length >= 3);
    assert.equal(game.mods.length, 3);
  }
  assert.deepEqual((await readdir('dist/games')).sort(), playable.map(game => `${game.id}.wasm`).sort());
});

test('mods write the running compiled game; invalid selections cannot partially apply', async () => {
  const manifest = JSON.parse(await readFile('dist/mod-manifest.json', 'utf8'));
  for (const game of games.filter(game => game.available)) {
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
  for (const game of games.filter(game => game.available)) {
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
  for (const game of games.filter(game => game.available)) {
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
  for (const game of games.filter(game => game.available)) {
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
  for (const page of ['index.html', 'player.html', 'credits.html']) {
    const html = await readFile(`dist/${page}`, 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const path = match[1];
      if (path.includes('://') || path === './') continue;
      assert.ok((await readFile(`dist/${path}`)).length, `${page}: ${path}`);
    }
  }
  assert.match(await readFile('dist/licenses/demos-MIT.txt', 'utf8'), /MIT License/);
  assert.match(await readFile('dist/licenses/PSn00bSDK.txt', 'utf8'), /MPL 2.0/);
  assert.equal(createHash('sha256').update(await readFile('dist/assets/debug-font.png')).digest('hex'), '2a807bb41892e0b90f1792d5a128dc9c6c099f0890cacbf1459392200cc4c05e');
  for (const file of ['player.js', 'games.js', 'app.js', 'index.html', 'credits.html']) {
    assert.doesNotMatch(await readFile(`dist/${file}`, 'utf8'), /EmulatorJS|EJS_|pcsx_rearmed|\.exe\b/);
  }
});
