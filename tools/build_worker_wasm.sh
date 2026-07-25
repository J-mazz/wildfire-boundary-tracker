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

output_dir="$PWD/functions/wasm"
mkdir -p "$output_dir"

# Worker-safe, import-free compute module. It deliberately has no Emscripten JS glue,
# filesystem, DOM, WebGL, or mutable state shared between WebAssembly instances.
emcc src/cpp/firms_engine.cpp \
  -O3 \
  -std=c++26 \
  -DNDEBUG \
  -sSTANDALONE_WASM=1 \
  -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=20971520 \
  -sSTACK_SIZE=1048576 \
  -Wl,--no-entry \
  -sEXPORTED_FUNCTIONS='["_firms_input","_firms_input_capacity","_firms_reset","_firms_ingest_csv","_firms_finalize","_firms_records","_firms_count","_firms_record_stride","_firms_bound"]' \
  -o "$output_dir/firms_engine.wasm"

printf 'Built worker C++26 WASM engine:\n  firms_engine.wasm (%s bytes)\n' "$(stat -c %s "$output_dir/firms_engine.wasm")"
