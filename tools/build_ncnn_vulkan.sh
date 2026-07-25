#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/ncnn_env.sh

export PKG_CONFIG_PATH="$NCNN_ROOT/lib64/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
mkdir -p .tools/bin

cflags="$(pkg-config --cflags ncnn)"
libs="$(pkg-config --libs ncnn)"

# shellcheck disable=SC2086
g++ \
  -std=c++26 \
  -O3 \
  -march=native \
  -DNDEBUG \
  -Wall -Wextra -Wpedantic \
  -pthread \
  $cflags \
  src/native/ncnn_vulkan_batch.cpp \
  $libs \
  -Wl,-rpath,"$NCNN_ROOT/lib64" \
  -o .tools/bin/ncnn-vulkan-batch

printf 'Built native ncnn Vulkan batch executor:\n  %s\n' "$PWD/.tools/bin/ncnn-vulkan-batch"
