#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/ncnn_env.sh
export PKG_CONFIG_PATH="$NCNN_ROOT/lib64/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
node tools/cpp_build.mjs native-ncnn

.tools/bin/ncnn-vulkan-batch --help >/dev/null 2>&1
set +e
.tools/bin/ncnn-vulkan-batch --workers 0 >/dev/null 2>&1
invalid_status=$?
set -e
if [[ "$invalid_status" -ne 2 ]]; then
  echo "Expected invalid CLI options to exit 2, got $invalid_status" >&2
  exit 1
fi

.tools/bin/ncnn-vulkan-batch --list-devices

required=(
  WILDFIRE_NCNN_PARAM
  WILDFIRE_NCNN_MODEL
  WILDFIRE_NCNN_INPUT_NAME
  WILDFIRE_NCNN_OUTPUT_NAME
  WILDFIRE_NCNN_INPUT
  WILDFIRE_NCNN_OUTPUT_DIR
)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Provisioned smoke inference skipped; $variable is unset."
    exit 0
  fi
done

.tools/bin/ncnn-vulkan-batch \
  --param "$WILDFIRE_NCNN_PARAM" \
  --model "$WILDFIRE_NCNN_MODEL" \
  --input-name "$WILDFIRE_NCNN_INPUT_NAME" \
  --output-name "$WILDFIRE_NCNN_OUTPUT_NAME" \
  --output-dir "$WILDFIRE_NCNN_OUTPUT_DIR" \
  --device "${WILDFIRE_VULKAN_DEVICE_INDEX:-0}" \
  "$WILDFIRE_NCNN_INPUT"
