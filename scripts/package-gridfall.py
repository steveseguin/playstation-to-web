"""Package a committed GRIDFALL PS1 source tree and its built sample for the arcade."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

source = Path(sys.argv[1]).resolve()
repo = source.parent
destination = Path(__file__).resolve().parents[1] / 'samples' / 'gridfall'
revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
if source.name != 'ps1' or subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain', '--', 'ps1'], text=True).strip():
    raise SystemExit('Use a committed, clean GRIDFALL ps1/ source tree.')
files = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z', 'ps1'], text=True).split('\0')
inputs = ['gridfall.exe', 'gridfall.elf', 'gridfall.sym', 'manifest.json', 'GRIDFALL.DAT', 'SOUND.BNK', 'gridfall.bin', 'gridfall.cue']
build = json.loads((source / 'web' / 'build.json').read_text())
for name, expected in build['sha256'].items():
    if hashlib.sha256((source / 'web' / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Browser build hash mismatch: {name}')
native = json.loads((source / 'build' / 'manifest.json').read_text())
for name, expected in native['sha256'].items():
    if hashlib.sha256((source / 'build' / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f'PS1 build hash mismatch: {name}')
for name in ['gridfall.exe', 'GRIDFALL.DAT', 'SOUND.BNK']:
    if build['sha256'][name] != native['sha256'][name]:
        raise SystemExit(f'PS1 and browser builds differ: {name}')
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'gridfall-ps1.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as out:
    entries = [(repo / name, 'gridfall-ps1/' + Path(name).relative_to('ps1').as_posix()) for name in files if name]
    entries += [(source / 'build' / name, 'gridfall-ps1/build/' + name) for name in inputs]
    for path, name in sorted(entries, key=lambda entry: entry[1]):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        out.writestr(info, path.read_bytes())
web = destination / 'web'
web.mkdir(exist_ok=True)
for name in ['engine.mjs', 'build.json', *build['sha256']]:
    shutil.copyfile(source / 'web' / name, web / name)
(destination / 'LICENSE').write_bytes((source / 'LICENSE').read_bytes().rstrip() + b'\n')
shutil.copyfile(source / 'PSn00bSDK-LICENSE.txt', destination / 'PSn00bSDK-LICENSE.txt')
metadata = {
    'source': 'https://github.com/steveseguin/gridfall', 'source_revision': revision, 'source_directory': 'ps1',
    'compiler_revision': build['compiler_revision'], 'archive': archive.name,
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'web_sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(web.iterdir()) if path.is_file()},
}
(destination / 'sample.json').write_bytes((json.dumps(metadata, indent=2) + '\n').encode('utf-8'))
print(f'Packaged GRIDFALL {revision}: {archive.stat().st_size:,} bytes')
