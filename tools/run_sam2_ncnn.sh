#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/ncnn_env.sh

runner="$PWD/.tools/bin/ncnn-vulkan-batch"
if [[ ! -x "$runner" ]]; then
  bash tools/build_ncnn_vulkan.sh
fi

# Converted SAM-2 model shards and prepacked NCT1 tensors are explicit inputs.
# Multiple tensors are submitted concurrently through independent ncnn extractors.
exec "$runner" \
  --device "${WILDFIRE_VULKAN_DEVICE_INDEX:-0}" \
  --workers "${WILDFIRE_NCNN_WORKERS:-2}" \
  "$@"
