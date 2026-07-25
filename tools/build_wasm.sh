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

module_dir="$PWD/build/wasm/modules"
output_dir="$PWD/public/wasm"
rm -rf "$PWD/build/wasm" "$output_dir"
mkdir -p "$module_dir" "$output_dir"

common=(
  -O3
  -std=c++26
  -I "$PWD/src/cpp"
  -fprebuilt-module-path="$module_dir"
)

echo "Precompiling C++26 modules with $(emcc --version | head -n 1)..."
emcc src/cpp/geosplat.cppm "${common[@]}" --precompile \
  -o "$module_dir/wildfire.geosplat.pcm"

echo "Linking Emscripten WASM runtime..."
emcc src/cpp/main.cpp \
  "$module_dir/wildfire.geosplat.pcm" \
  "${common[@]}" \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sMAXIMUM_MEMORY=268435456 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createWildfireWasm \
  -sENVIRONMENT=web \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS='["_ext_allocate_wasm_buffer","_ext_free_wasm_buffer","_geosplat_decode","_geosplat_data","_geosplat_count","_geosplat_floats_per_splat","_geosplat_release"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -o "$output_dir/wildfire.js"

printf 'Built Emscripten artifacts:\n'
find "$output_dir" -maxdepth 1 -type f -printf '  %f (%s bytes)\n' | sort
