#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
import hashlib, json, zipfile
sample = Path('samples/gridfall')
metadata = json.loads((sample / 'sample.json').read_text())
archive = sample / metadata['archive']
if hashlib.sha256(archive.read_bytes()).hexdigest() != metadata['sha256']:
    raise SystemExit('Sample archive does not match sample.json')
output = Path('out/gridfall-sample')
if not (output / 'gridfall-ps1').exists():
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            target = (output / member.filename).resolve()
            if not target.is_relative_to(output.resolve()):
                raise SystemExit('Invalid sample archive path')
        package.extractall(output)
PY
# Existing extracted sources are retained so users can edit and rebuild them.
cd out/gridfall-sample/gridfall-ps1
if [ "${1:-}" = "--from-source" ]; then bash tools/build.sh; fi
bash tools/build-web.sh
printf '\nSample compiled. Preview it with:\n  python3 out/gridfall-sample/gridfall-ps1/tools/serve.py\n'
