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

# Worker-safe, import-free compute module. It deliberately has no Emscripten JS glue,
# filesystem, DOM, WebGL, or mutable state shared between WebAssembly instances.
node tools/cpp_build.mjs worker-wasm

printf 'Built worker C++26 WASM engine:\n  firms_engine.wasm (%s bytes)\n' "$(stat -c %s functions/wasm/firms_engine.wasm)"
