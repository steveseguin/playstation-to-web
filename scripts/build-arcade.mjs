import { cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { games } from '../arcade/games.js';
import { defaultMods, modWrites } from '../arcade/mods.js';
import { createHash } from 'node:crypto';
// Clear only this workspace's generated output; reject a redirected/symlinked directory.
const output = resolve('dist');
if (dirname(output) !== process.cwd()) throw new Error('Output must be inside the workspace');
const actual = await realpath(output).catch(error => { if (error.code === 'ENOENT') return output; throw error; });
if (actual.toLowerCase() !== output.toLowerCase()) throw new Error('Refusing to clear redirected output');
await rm(output, { recursive: true, force: true });
await mkdir('dist/games', { recursive: true });
await cp('arcade', 'dist', { recursive: true });
const manifest = {};
for (const game of games.filter(game => game.available)) {
  const source = `out/arcade-demos/${game.id}.exe`;
  const bytes = await readFile(source);
  if (bytes.subarray(0, 8).toString() !== 'PS-X EXE') throw new Error(`${source} is not a PS1 executable`);
  const symbolText = await readFile(`out/arcade-demos/${game.id}.sym`, 'utf8');
  const symbols = {};
  for (const [name, expected] of Object.entries(modWrites(game, defaultMods()))) {
    const match = symbolText.match(new RegExp(`^([0-9a-fA-F]+) [Dd] ${name}$`, 'm'));
    if (!match) throw new Error(`Missing mod symbol: ${game.id}/${name}`);
    // This SDK's nm sign-extends 32-bit MIPS addresses to 64 bits.
    const address = Number(BigInt('0x' + match[1]) & 0xffffffffn);
    const offset = address - bytes.readUInt32LE(0x18) + 2048;
    if (address < 0x80000000 || address >= 0x80200000 || address % 4 || offset < 2048 ||
        offset + 4 > bytes.length || bytes.readUInt32LE(offset) !== expected) throw new Error(`Mod symbol does not match executable: ${name}`);
    symbols[name] = address;
  }
  manifest[game.id] = { symbols, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(`dist/${game.rom}`, bytes);
}
await writeFile('dist/mod-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await mkdir('dist/licenses', { recursive: true });
await cp('demos/LICENSE', 'dist/licenses/demos-MIT.txt');
await cp('demos/PSn00bSDK-LICENSE.txt', 'dist/licenses/PSn00bSDK.txt');
await writeFile('dist/.nojekyll', '');
console.log('Built dist/ with two original PS1 homebrew executables. No commercial game assets included.');
