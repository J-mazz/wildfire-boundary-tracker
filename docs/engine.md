# Live engine

The tracker synthesizes each fire view on demand. NIFC supplies the initial scope; NASA
FIRMS supplies the recurring VIIRS observations that grow it.

## Data flow

1. NIFC/IRWIN supplies the incident name, discovery time, and origin point.
2. A buffer around that point seeds the FIRMS request. Its radius is at least 12 km and
  grows with the incident acreage reported by NIFC.
3. TypeScript middleware fetches VIIRS data in parallel four-day batch lanes, then
  serially streams each valid response
  bytes directly into a fresh C++26 WebAssembly instance.
4. C++ parses CSV using raw `const char*` cursors and pointer arithmetic, sorts and
  deduplicates fixed 64-byte records in place, then grows the footprint with a bounded
  padding rule.
5. TypeScript reads the fixed record ABI with `DataView` and serializes catalog and
  per-frame GeoJSON. It does not parse FIRMS CSV.

The WASM module is import-free, has a fixed 32 MiB heap, and is instantiated per engine
operation so mutable linear memory never crosses requests.

## Endpoints (Pages Functions)

- `GET /api/incidents`
  Current wildfire incidents from the NIFC WFIGS FeatureServer (public, no key).
  Trimmed to name, IrwinID, discovery date, size, containment, state, and location.
  Edge-cached 10 minutes. Drives the landing page.

- `GET /api/catalog?fire=irwin:<IrwinID>`
  Synthesizes a snapshot catalog in the same contract as the static
  `dist/data/catalog.json`, so the frontend cannot tell a live fire from a curated one.
  Edge-cached 5 minutes per fire, matching its live polling interval.

- `GET /api/firms?fire=irwin:<id>&frame=<iso>&days=<n>`
  Per-frame VIIRS GeoJSON with FRP, brightness, confidence, and day/night properties
  (mirrors `tools/import_firms.py`). Returns 404 for empty frames. Edge-cached 30 minutes.

All Functions are strict TypeScript. Shared middleware is `functions/api/_engine.ts`;
the compute module is `src/cpp/firms_engine.cpp` and builds to
`functions/wasm/firms_engine.wasm`.

## FIRMS quota protection

- FIRMS requests use four-day batches across SNPP, NOAA-20, and NOAA-21.
- Batch fetches run concurrently; ingestion remains serial because one request-local
  WASM instance owns the input buffer.
- Bounds are quantized to 0.05 degrees so users viewing the same fire share cache keys.
- Closed historical batches cache for 6 hours; the batch containing today caches for
  20 minutes.
- A batch is cached only after the WASM parser accepts it. Invalid HTTP 200 error bodies
  are skipped, and invalid legacy cache entries are evicted without sinking other lanes.
- CSV is streamed into an 8 MiB WASM input buffer. Oversized responses fail explicitly.
- The record arena holds 131,072 detections and the footprint has a 4 degree span cap.

## Credentials

`FIRMS_MAP_KEY` is a Pages secret used only by TypeScript middleware. It is never sent to
the browser or stored in WASM. NIFC requires no key.

## Native inference

SAM-2 is not executed inside a Pages request. Converted ncnn model shards run through
the C++26 `ncnn-vulkan-batch` executable on Vulkan-capable native publishers. Multiple
input tensors are dispatched through concurrent ncnn extractors, and immutable output
assets are published before a catalog swap. Cloudflare continues serving the last valid
assets while a publisher is unavailable.
