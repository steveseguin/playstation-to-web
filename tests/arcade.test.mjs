import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { games, findGame } from '../arcade/games.js';
import { cheatCodes, defaultMods, modWrites } from '../arcade/mods.js';
import { createHash } from 'node:crypto';

test('only original, available games are packaged; commercial title stays build-only', async () => {
  const playable = games.filter(game => game.available);
  assert.equal(playable.length, 2);
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  assert.equal(findGame('untrusted-input'), games[0]);
  assert.equal(findGame('btn').available, false);
  for (const game of playable) {
    assert.equal(game.engine, 'emulator');
    const bytes = await readFile(`dist/${game.rom}`);
    assert.equal(bytes.subarray(0, 8).toString(), 'PS-X EXE');
    assert.equal(bytes.length % 2048, 0);
    assert.ok(game.controls.length >= 3);
    assert.equal(game.mods.length, 3);
  }
  assert.deepEqual((await readdir('dist/games')).sort(), playable.map(game => `${game.id}.exe`).sort());
});

test('mod addresses and default values match each packaged executable', async () => {
  const manifest = JSON.parse(await readFile('dist/mod-manifest.json', 'utf8'));
  for (const game of games.filter(game => game.available)) {
    const bytes = await readFile(`dist/${game.rom}`);
    const { symbols, sha256 } = manifest[game.id];
    assert.equal(sha256, createHash('sha256').update(bytes).digest('hex'));
    for (const [name, value] of Object.entries(modWrites(game, defaultMods()))) {
      const offset = symbols[name] - bytes.readUInt32LE(0x18) + 2048;
      assert.equal(bytes.readUInt32LE(offset), value);
    }
    assert.equal(cheatCodes(game, defaultMods(), symbols).length, 5);
    assert.throws(() => cheatCodes(game, { ...defaultMods(), speed: 'arbitrary' }, symbols));
    assert.throws(() => cheatCodes(game, { ...defaultMods(), address: 123 }, symbols));
    assert.throws(() => cheatCodes(game, defaultMods(), { ...symbols, ball_speed: 0 }));
  }
  assert.throws(() => modWrites(findGame('btn'), defaultMods()));
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
});
