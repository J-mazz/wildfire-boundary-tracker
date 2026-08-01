#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

echo "Type-checking frontend..."
npx tsc --noEmit

echo "Bundling MapLibre application..."
esbuild_args=(
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --minify \
  --outfile=dist/client.js
)
if [[ "${SOURCE_MAPS:-1}" == "1" ]]; then
  esbuild_args+=(--sourcemap)
fi
npx esbuild src/ts/main.ts "${esbuild_args[@]}"

cp src/index.html dist/map.html
cp -R public/. dist/
cp public/fires.html dist/index.html

echo "Build complete:"
find dist -maxdepth 2 -type f -printf '  %p (%s bytes)\n' | sort
