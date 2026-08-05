#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source tools/load_emsdk.sh

# Worker-safe, import-free compute module. It deliberately has no Emscripten JS glue,
# filesystem, DOM, WebGL, or mutable state shared between WebAssembly instances.
node tools/cpp_build.mjs worker-wasm

printf 'Built worker C++26 WASM engine:\n  firms_engine.wasm (%s bytes)\n' "$(stat -c %s functions/wasm/firms_engine.wasm)"
