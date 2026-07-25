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
npm run build:wasm         # browser renderer and DEM geosplat decoder
npm run build:worker-wasm  # import-free FIRMS parser and footprint engine
```

`npm run build:pages` builds both before Wrangler bundles the Pages Functions.

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

Python remains only for deterministic geospatial preparation such as Sentinel mosaics
and DEM splats:

```bash
uv run python tools/build_geosplat.py
```

Context KML conversion uses native C++26 and simdjson:

```bash
bash tools/install_simdjson_local.sh
bash tools/fetch_context_kml.sh
```
