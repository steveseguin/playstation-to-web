import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { games, findGame } from '../arcade/games.js';

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
    assert.equal(game.mods.length, 0);
  }
  assert.deepEqual((await readdir('dist/games')).sort(), playable.map(game => `${game.id}.exe`).sort());
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
