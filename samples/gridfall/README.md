# Compiler sample

Recompile GRIDFALL's bundled PS1 executable into a browser game without supplying
a disc or BIOS. The sample contains the single-map PS1 port, original game
assets, source, symbols, a bootable disc image, and a precompiled browser player.

On Linux or WSL, install Python 3.10+, Git, Rust 1.94.1, and Clang with the
WebAssembly target and `wasm-ld`. From the repository root, run:

```sh
bash scripts/build-gridfall.sh
python3 out/gridfall-sample/gridfall-ps1/tools/serve.py
```

Open **http://localhost:8196/**. The script verifies and extracts
`gridfall-ps1.zip`, downloads the pinned psxw compiler, and translates the native
PS1 executable into WebAssembly. Existing extracted sources are retained for
editing. Set `CLANG` or `CARGO` if those tools are not on your PATH.

To build the PS1 executable from source too, install CMake, Make, curl, and
unzip, then run `bash scripts/build-gridfall.sh --from-source`. This downloads
the pinned PSn00bSDK toolchain. Play the resulting `build/gridfall.cue` with its
matching `gridfall.bin` in a PS1 emulator or compatible homebrew disc loader.

To use your recompiled version in the arcade:

```sh
GRIDFALL_BUNDLE=out/gridfall-sample/gridfall-ps1/web npm run build
npm run dev
```

The arcade's other games must also be built; see [arcade setup](../../demos/README.md).
Use **Apply mod** during play to change movement speed or palette. The standalone
player includes sliders for both, plus `window.gridfall.setSpeed(2)` and
`window.gridfall.setTint(0.5)` for live scripting.

[GRIDFALL PS1 source](https://github.com/steveseguin/gridfall/tree/main/ps1) is
maintained in the GRIDFALL repository. This directory holds a versioned package;
`sample.json` records its source revision, compiler revision, and SHA-256 hashes.
To update it from a clean, committed PS1 source tree with completed native and
web builds, run `python3 scripts/package-gridfall.py ../gridfall/ps1`.

The game uses the [MIT license](LICENSE). Its native executable links the
unmodified [PSn00bSDK 0.24 libraries](https://github.com/Lameguy64/PSn00bSDK/tree/v0.24)
under [MPL 2.0](PSn00bSDK-LICENSE.txt).
