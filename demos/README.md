# Free homebrew arcade

Play **Paddle Rally** (paddle vs. computer, first to seven) and **Brick Shift**
(40-brick breakout, three lives) in the browser. Both games compile directly
from [arcade.c](arcade.c) into WebAssembly. Their rules, physics, score, and
live mod values run in the compiled game. No emulator, BIOS, or disc is needed.
The same source also supports PS1 builds.

## Build and play

On Ubuntu or Debian, install Clang and LLD (`sudo apt-get install clang lld`),
and Node.js 22, then run from the repository root:

```sh
bash scripts/build-demos.sh
npm ci
npm run build
npm run dev
```

On Windows, run the first command through WSL, then run the npm commands in
PowerShell. Open `http://127.0.0.1:4173`. Set `CLANG` to select a different Clang
executable. Builds run sequentially with one linker thread.

The build produces `paddle-rally.wasm` and `brick-shift.wasm` in
`out/arcade-demos/`; packaging copies them into `dist/games/`. The Pages workflow
builds and publishes `dist/`. All player assets are served with the arcade.

For optional PS1 executables, run `bash scripts/build-ps1-demos.sh` on Linux or
WSL with CMake, curl, and unzip installed. It downloads the version and
SHA-256-pinned PSn00bSDK 0.24 toolchain. The browser uses the Wasm builds.

## Controls and live mods

- Paddle Rally: Up/Down to move.
- Brick Shift: Left/Right to move.
- Both: X to launch or play again, Enter to pause, V for a new game.
- Standard gamepads: D-pad or left stick to move, bottom face button to launch,
  Start to pause, Select/Back for a new game. Touch controls appear on mobile.
- No sound effects are implemented yet.

Open **Apply mod** during play to change paddle color, paddle size, or ball
speed. **Apply changes** takes effect immediately; **Restore defaults** puts
the original settings back without restarting. The panel itself does not pause
play. In-game New game keeps mods; Restart or switching games clears them.

The player writes reviewed settings into exported globals in the running
module's WebAssembly memory. It uses the loaded module's own symbol addresses
and verifies the binary's build hash. Ball speed changes physics steps only;
paddle input stays responsive and collisions are checked at each step.

The homebrew builds use Clang directly. Games built through `psxw` have their
own [JavaScript mod tools](../web/README.md#script-mods).

## Source and licenses

The original games and geometric title-card artwork were created for this
project with AI coding assistance and are [MIT licensed](LICENSE). The artwork
is not a screenshot. There are no commercial game assets or Sony SDK files.

The browser includes the unmodified `libpsn00b/psxgpu/dbugfont.png` from
[PSn00bSDK v0.24](https://github.com/Lameguy64/PSn00bSDK/tree/v0.24), under
[MPL 2.0](PSn00bSDK-LICENSE.txt). Optional PS1 builds also link its libraries.
The arcade includes the font's license and source link in its credits.
