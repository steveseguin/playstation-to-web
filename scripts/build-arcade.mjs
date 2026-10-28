import { cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { games } from '../arcade/games.js';
// Clear only this workspace's generated output; reject a redirected/symlinked directory.
const output = resolve('dist');
if (dirname(output) !== process.cwd()) throw new Error('Output must be inside the workspace');
const actual = await realpath(output).catch(error => { if (error.code === 'ENOENT') return output; throw error; });
if (actual.toLowerCase() !== output.toLowerCase()) throw new Error('Refusing to clear redirected output');
await rm(output, { recursive: true, force: true });
await mkdir('dist/games', { recursive: true });
await cp('arcade', 'dist', { recursive: true });
for (const game of games.filter(game => game.available)) {
  const source = `out/arcade-demos/${game.id}.exe`;
  const bytes = await readFile(source);
  if (bytes.subarray(0, 8).toString() !== 'PS-X EXE') throw new Error(`${source} is not a PS1 executable`);
  await writeFile(`dist/${game.rom}`, bytes);
}
await mkdir('dist/licenses', { recursive: true });
await cp('demos/LICENSE', 'dist/licenses/demos-MIT.txt');
await cp('demos/PSn00bSDK-LICENSE.txt', 'dist/licenses/PSn00bSDK.txt');
await writeFile('dist/.nojekyll', '');
console.log('Built dist/ with two original PS1 homebrew executables. No commercial game assets included.');
