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
  if (game.id === 'gridfall') {
    const sample = JSON.parse(await readFile('samples/gridfall/sample.json', 'utf8'));
    const archive = await readFile('samples/gridfall/gridfall-ps1.zip');
    if (createHash('sha256').update(archive).digest('hex') !== sample.sha256) throw new Error('GRIDFALL sample archive hash mismatch');
    const bundle = process.env.GRIDFALL_BUNDLE || 'samples/gridfall/web';
    const build = JSON.parse(await readFile(`${bundle}/build.json`, 'utf8'));
    if (build.compiler !== 'psxw-lift' || !build.translated_functions || !build.linked_functions) throw new Error('Missing GRIDFALL compiler provenance');
    await mkdir('dist/games/gridfall', { recursive: true });
    for (const name of ['gridfall.exe', 'gridfall.wasm', 'GRIDFALL.DAT', 'SOUND.BNK', 'engine.mjs', 'build.json']) {
      const bytes = await readFile(`${bundle}/${name}`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (build.sha256[name] && hash !== build.sha256[name]) throw new Error(`GRIDFALL build mismatch: ${name}`);
      if (!process.env.GRIDFALL_BUNDLE && hash !== sample.web_sha256[name]) throw new Error(`GRIDFALL sample mismatch: ${name}`);
      if (name === 'gridfall.wasm') {
        const module = await WebAssembly.compile(bytes);
        const imports = WebAssembly.Module.imports(module).map(item => `${item.module}.${item.name}`).sort();
        if (imports.join() !== 'host.fatal,host.read,host.sound') throw new Error('Unexpected GRIDFALL runtime dependency');
      }
      await writeFile(`dist/games/gridfall/${name}`, bytes);
    }
    await mkdir('dist/samples', { recursive: true });
    await writeFile('dist/samples/gridfall-ps1.zip', archive);
    await writeFile('dist/samples/gridfall.json', JSON.stringify(sample, null, 2) + '\n');
    continue;
  }
  const source = `out/arcade-demos/${game.id}.wasm`;
  const bytes = await readFile(source);
  if (!WebAssembly.validate(bytes)) throw new Error(`${source} is not a WebAssembly module`);
  const module = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 2 || imports.some(item => item.module !== 'arcade' || item.kind !== 'function' || !['rect', 'text'].includes(item.name))) throw new Error('Unexpected game runtime dependency');
  const { exports } = await WebAssembly.instantiate(module, { arcade: { rect() {}, text() {} } });
  for (const name of ['game_init', 'game_tick', 'game_render']) {
    if (typeof exports[name] !== 'function') throw new Error(`Missing game export: ${name}`);
  }
  const memory = new DataView(exports.memory.buffer);
  for (const [name, expected] of Object.entries(modWrites(game, defaultMods()))) {
    const address = exports[name]?.value;
    if (!Number.isInteger(address) || address < 0 || address % 4 || address + 4 > memory.byteLength ||
        memory.getInt32(address, true) !== expected) throw new Error(`Invalid mod export: ${game.id}/${name}`);
  }
  manifest[game.id] = { sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(`dist/${game.binary}`, bytes);
}
await writeFile('dist/mod-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await mkdir('dist/licenses', { recursive: true });
await cp('demos/LICENSE', 'dist/licenses/demos-MIT.txt');
await cp('demos/PSn00bSDK-LICENSE.txt', 'dist/licenses/PSn00bSDK.txt');
await cp('samples/gridfall/LICENSE', 'dist/licenses/gridfall-MIT.txt');
await writeFile('dist/.nojekyll', '');
console.log('Built dist/ with three WebAssembly games and the PS1 compiler sample. No commercial game assets included.');
