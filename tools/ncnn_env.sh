#!/usr/bin/env bash

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NCNN_ROOT="$project_root/.tools/ncnn/root/usr"

if [[ ! -x "$NCNN_ROOT/bin/onnx2ncnn" ]]; then
  echo "Project-local ncnn is missing; run: bash tools/install_ncnn_local.sh" >&2
  return 1 2>/dev/null || exit 1
fi

export PATH="$NCNN_ROOT/bin:$PATH"
export LD_LIBRARY_PATH="$NCNN_ROOT/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export CMAKE_PREFIX_PATH="$NCNN_ROOT${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"

# Vulkan and CUDA enumerate devices independently. Override either index when needed.
export WILDFIRE_VULKAN_DEVICE_INDEX="${WILDFIRE_VULKAN_DEVICE_INDEX:-0}"
export WILDFIRE_CUDA_DEVICE_INDEX="${WILDFIRE_CUDA_DEVICE_INDEX:-0}"
