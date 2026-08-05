#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/ncnn_env.sh

export PKG_CONFIG_PATH="$NCNN_ROOT/lib64/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
node tools/cpp_build.mjs native-ncnn

printf 'Built native ncnn Vulkan batch executor:\n  %s\n' "$PWD/.tools/bin/ncnn-vulkan-batch"
