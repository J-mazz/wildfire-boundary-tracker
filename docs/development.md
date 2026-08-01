# Development

Requires Node.js 22+, Emscripten 6.0.3, a C++26 compiler, and `uv` for offline geospatial
tools.

```bash
npm install
uv sync
npm run typecheck
npm test
```

## WebAssembly

Two independent C++26 modules are built:

```bash
npm run build:wasm         # browser DEM geosplat decoder
npm run build:worker-wasm  # import-free FIRMS parser and footprint engine
```

`npm run build:pages` builds both before Wrangler bundles the Pages Functions.
`npm run dev` builds that same artifact and serves it through `wrangler pages dev`, so
the `/api/incidents`, `/api/catalog`, and `/api/firms` paths run in the local loop. It
loads the uncommitted `.env.local` file, which must define `FIRMS_MAP_KEY` for live VIIRS
requests.

## ncnn and Vulkan

Install and build the native inference executor locally:

```bash
bash tools/install_ncnn_local.sh
npm run build:ncnn
.tools/bin/ncnn-vulkan-batch --list-devices
```

The executor accepts converted ncnn `.param` and `.bin` model shards plus one or more
NCT1 float32 input tensors. It dispatches tensors through concurrent extractors:

```bash
bash tools/run_sam2_ncnn.sh \
  --param MODEL.param \
  --model MODEL.bin \
  --input-name INPUT \
  --output-name OUTPUT \
  --output-dir OUTPUT_DIR \
  INPUT_1.nct INPUT_2.nct
```

NCT1 is five little-endian `uint32` values (`magic`, width, height, channels, elements)
followed by channel-major float32 data. Outputs use the NCO1 header documented by
`src/native/ncnn_vulkan_batch.cpp`.

Model conversion is an explicit preparation step and converted weights are not committed.
The tracker does not include a Python inference backend or silently fall back from Vulkan.

## Offline geospatial tools

Python remains only for deterministic geospatial preparation. Geosplat generation
requires explicit bounds, source imagery, output directory, and public payload URL:

```bash
uv run python tools/build_geosplat.py \
  --bounds WEST SOUTH EAST NORTH \
  --sentinel PATH_TO_SENTINEL_IMAGE \
  --output OUTPUT_DIRECTORY \
  --public-url terrain.splat
```
