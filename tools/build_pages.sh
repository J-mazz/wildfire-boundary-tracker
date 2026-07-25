#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build:wasm
npm run build:worker-wasm
SOURCE_MAPS=0 bash build.sh

if find dist -type f \( -name '*.map' -o -name 'catalog.config.json' \) -print -quit | grep -q .; then
  echo "Pages build contains private build metadata or source maps" >&2
  exit 1
fi

oversized="$(find dist -type f -size +25M -print -quit)"
if [[ -n "$oversized" ]]; then
  echo "Pages asset exceeds the 25 MiB limit: $oversized" >&2
  exit 1
fi

file_count="$(find dist -type f | wc -l)"
if (( file_count > 20000 )); then
  echo "Pages build exceeds the free-plan 20,000-file limit: $file_count" >&2
  exit 1
fi

if [[ -f .env.local ]]; then
  while IFS='=' read -r name value; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    name="${name#export }"
    value="${value%$'\r'}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
    [[ -z "$value" ]] && continue
    if grep -R --binary-files=without-match -F "$value" dist >/dev/null 2>&1; then
      echo "Secret-like value from .env.local found in dist: $name" >&2
      exit 1
    fi
  done < .env.local
fi

printf 'Pages build ready: %s files, %s total\n' "$file_count" "$(du -sh dist | cut -f1)"
