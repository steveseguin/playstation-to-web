#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root on Linux or WSL. The release includes its compiler.
sdk_archive=.toolchain/arcade/sdk.zip
sdk_root="$PWD/.toolchain/arcade/PSn00bSDK-0.24-Linux"
mkdir -p .toolchain/arcade
if [ ! -f "$sdk_archive" ]; then
  curl --fail --location --retry 3 'https://github.com/Lameguy64/PSn00bSDK/releases/download/v0.24/PSn00bSDK-0.24-Linux.zip' --output "$sdk_archive"
fi
printf '%s  %s\n' '5ada7c9478d795b22bde96ee23d6869290c14a740bcde3d57c01c342a26ded35' "$sdk_archive" | sha256sum --check
if [ ! -f "$sdk_root/lib/libpsn00b/cmake/sdk.cmake" ]; then
  unzip -q "$sdk_archive" -d .toolchain/arcade
fi
chmod -R u+x "$sdk_root/bin" "$sdk_root/libexec"
cmake -S demos -B out/arcade-demos \
  -DCMAKE_TOOLCHAIN_FILE="$sdk_root/lib/libpsn00b/cmake/sdk.cmake" \
  -DPSN00BSDK_TC="$sdk_root/bin" -DCMAKE_BUILD_TYPE=Release
cmake --build out/arcade-demos --parallel 2
