# Wildfire Boundary Tracker

Live map of current US wildfires. Pick a fire and the tracker derives its initial scope
from NIFC, then follows three-hour VIIRS observations from NASA FIRMS. No account or GIS
setup is required.

## Runtime

- **TypeScript frontend**: MapLibre map, timeline, UI, and catalog client.
- **TypeScript middleware**: Cloudflare Pages Functions handle upstream fetches, cache
	control, validation, and catalog/GeoJSON serialization.
- **C++26 WebAssembly**: the edge engine streams FIRMS CSV bytes into fixed linear
	memory, parses with raw C-string cursors and pointer arithmetic, deduplicates records,
	and computes the growing footprint. The browser WASM module also retains DEM geosplat
	decoding and rendering support.
- **C++26 ncnn/Vulkan**: native, concurrent inference for converted SAM-2 model shards.
	This is an asynchronous publisher, never a request-time Python backend.
- **Shared C++26 foundation**: `wildfire.core` provides checked bounded/endian helpers and
	`wildfire.memory` provides bounded arenas, a slab pool, PMR integration, telemetry, and
	target memory layouts. Existing domain engines are not migrated onto these allocators yet.

Every rendered layer comes from real observations. Nothing is fabricated.

## Using it

1. Open the current-fire landing page and search by incident name or state.
2. Pick an incident. Its shareable URL contains only the NIFC IRWIN identifier.
3. Scrub the three-hour timeline, press Play, or select Live.

## Documentation

- [Engine](docs/engine.md): edge WASM ABI, middleware, caching, and footprint growth
- [Development](docs/development.md): builds, local tools, ncnn/Vulkan, and geosplat
- [Data contract](docs/data-contract.md): catalog and optional layer capabilities
- [Deployment](docs/deployment.md): Cloudflare Pages, Functions, and secrets

The curated East Evans Creek visualization remains in
[fire-progression-NRTDV](https://github.com/J-mazz/fire-progression-NRTDV).
