#!/usr/bin/env bash

emsdk_env="${EMSDK_ENV:-$PWD/emsdk/emsdk_env.sh}"
export EMSDK_QUIET=1
if [[ -f "$emsdk_env" ]]; then
  source "$emsdk_env"
elif command -v emcc >/dev/null 2>&1; then
  echo "Using Emscripten from PATH: $(command -v emcc)"
else
  echo "Emscripten not found. Install emsdk locally or provision emcc in CI." >&2
  return 1
fi
unset emsdk_env
