#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source tools/load_emsdk.sh

output_dir="$PWD/public/wasm"
node tools/cpp_build.mjs browser-wasm

printf 'Built Emscripten artifacts:\n'
find "$output_dir" -maxdepth 1 -type f -printf '  %f (%s bytes)\n' | sort
