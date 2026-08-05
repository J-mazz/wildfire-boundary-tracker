#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

emsdk_env="${EMSDK_ENV:-$PWD/emsdk/emsdk_env.sh}"
export EMSDK_QUIET=1
if [[ -f "$emsdk_env" ]]; then
  source "$emsdk_env"
elif command -v emcc >/dev/null 2>&1; then
  echo "Using Emscripten from PATH: $(command -v emcc)"
else
  echo "Emscripten not found. Install emsdk locally or provision emcc in CI." >&2
  exit 1
fi

output_dir="$PWD/public/wasm"
node tools/cpp_build.mjs browser-wasm

printf 'Built Emscripten artifacts:\n'
find "$output_dir" -maxdepth 1 -type f -printf '  %f (%s bytes)\n' | sort
