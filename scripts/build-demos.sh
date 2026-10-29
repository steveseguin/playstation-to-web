#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root on Linux or WSL with Clang and LLD installed.
compiler="${CLANG:-clang}"
mkdir -p out/arcade-demos
for game in paddle-rally brick-shift; do
  bricks=0
  if [ "$game" = brick-shift ]; then bricks=1; fi
  "$compiler" --target=wasm32 -std=c11 -O2 -ffreestanding -nostdlib \
    -Wall -Wextra -Werror -DGAME_BRICKS="$bricks" demos/arcade.c \
    -Wl,--no-entry,--export-memory,--initial-memory=131072,--max-memory=131072 \
    -Wl,--export=paddle_width,--export=paddle_height,--export=paddle_speed \
    -Wl,--export=ball_speed,--export=accent_red,--export=accent_green,--export=accent_blue \
    -Wl,--threads=1 -o "out/arcade-demos/$game.wasm"
done
