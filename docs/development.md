# Development

Requires Node.js 22+, Emscripten 6.0.3, Clang 21 for the explicit module build graph, and
`uv` for offline geospatial tools. CI pins LLVM 21.1.8. Set `CLANGXX` to another modern
Clang binary for local host builds.

```bash
npm install
uv sync
npm run test:cpp
npm test
```

## C++26 module graph

`tools/cpp_build_manifest.json` is the source of truth for named-module imports, sources,
flags, and outputs. `tools/cpp_build.mjs` topologically orders the module interfaces,
precompiles `.pcm` BMIs, compiles interface and implementation objects with the target's
optimization flags, and links host, browser Wasm, Worker Wasm, and native ncnn targets.
BMIs and objects stay under ignored `build/cpp/` directories.

The explicit Clang graph is intentional: Emscripten 6.0.3 support for CMake `CXX_MODULES`
could not be proven across all four target shapes. The checked-in manifest avoids a second
hand-maintained dependency order while keeping the npm commands stable.

The shared foundation modules are:

- `wildfire.core`: overflow-checked size arithmetic, alignment, little-endian loads, and a
  transactional bounded reader.
- `wildfire.memory`: allocator-injected bounded arena, PMR resource, aligned slab pool,
  optional allocation telemetry/high-water marks, and host/Worker/browser/native layouts.

The native executable adds four modules:

- `wildfire.tensor`: checked NCT1/NCO1 layouts and little-endian file I/O without ncnn types.
- `wildfire.inference.options`: declarative flags, typed validation, defaults, paths, and
  stable CLI exit mapping.
- `wildfire.inference.scheduler`: total CPU-budget partitioning, a PMR bounded FIFO, ordered
  reports, and scheduler allocation sizing.
- `wildfire.inference.runtime`: ncnn/Vulkan ownership, pool allocators, model loading, and
  concurrent extraction. ncnn and Vulkan headers occur only in this implementation unit.

FIRMS and geosplat retain their existing storage strategies. The native scheduler injects a
`wildfire.memory::ArenaResource` with no upstream fallback into its queue and report
containers; allocation telemetry therefore covers those app structures. ncnn tensor storage
uses explicit thread-safe `ncnn::PoolAllocator` instances for blob and workspace memory.

## WebAssembly

Two independent C++26 modules are built:

```bash
npm run build:wasm         # browser DEM geosplat decoder
npm run build:worker-wasm  # import-free FIRMS parser and footprint engine
```

The browser decoder validates every grid, payload, and output-size calculation with checked
`size_t` arithmetic before pointer offsets or allocation. It rejects grids above 4,194,304
splats, keeping the input plus 36-byte output records within the browser Wasm memory budget.

`npm run build:pages` builds both before Wrangler bundles the Pages Functions.
`npm run dev` builds that same artifact and serves it through `wrangler pages dev`, so
the `/api/incidents`, `/api/catalog`, and `/api/firms` paths run in the local loop. It
loads the uncommitted `.env.local` file, which must define `FIRMS_MAP_KEY` for live VIIRS
requests.

## Characterization and performance gates

`npm run test:cpp` runs assert-based host tests for module helpers, allocator exhaustion and
reset semantics, the FIRMS record ABI/parser boundary cases, and geosplat binary decoding.
The Node test entry point separately runs deployment/source, Worker Wasm ABI, and TypeScript
behavior suites.

```bash
npm run benchmark:cpp
```

The FIRMS parse/sort/dedupe, geosplat decode, native tensor I/O, and native scheduler
harnesses write
`build/benchmarks/cpp-current.json`, including throughput, allocation or working-set
high-water, reserved storage, and executable-size metrics. FIRMS is static-storage-only, so
its reserved and occupied storage are measured instead of claiming an unobservable heap
allocation count. `benchmarks/cpp_baseline.json` owns the comparison
directions and tolerances. Update that baseline only after reviewing an intentional ratchet;
the comparison tool has no performance limits compiled into its code. Throughput is reported
with a wide warning ratchet because shared CI hardware is noisy; deterministic allocation,
memory, complexity, and binary-size regressions fail the build.

`npm run check:cpp-complexity` measures the foundation, native modules, host harnesses, and
characterized domain files with a limit of 10. The three pre-existing FIRMS parser
exceptions are isolated in `benchmarks/cpp_complexity_baseline.json` and may not increase;
domain decomposition is intentionally deferred beyond this foundation layer.

## ncnn and Vulkan

Install and build the native inference executor locally:

```bash
bash tools/install_ncnn_local.sh
npm run build:ncnn
.tools/bin/ncnn-vulkan-batch --list-devices
```

The executor accepts converted ncnn `.param` and `.bin` model shards plus one or more
NCT1 float32 input tensors. All existing flags and defaults are retained: `--device` defaults
to `0`, `--workers` defaults to `2` and accepts `1..32`, and `--list-devices` still requires
Vulkan initialization. It dispatches tensors through concurrent extractors:

```bash
bash tools/run_sam2_ncnn.sh \
  --param MODEL.param \
  --model MODEL.bin \
  --input-name INPUT \
  --output-name OUTPUT \
  --output-dir OUTPUT_DIR \
  INPUT_1.nct INPUT_2.nct
```

`hardware_concurrency()` is one total CPU budget, not a per-extractor setting. Active
extractors are capped by requested workers, pending inputs, and that total. The scheduler
divides the budget as evenly as possible, gives every extractor at least one thread, and
assigns any remainder to lower worker indexes. For example, three workers on eight logical
CPUs receive `3,3,2`, never `8,8,8`. Work completion may be concurrent, but failures and the
final report are emitted in original input order.

NCT1 is five little-endian `uint32` values (`"NCT1"`, width, height, channels, elements)
followed by channel-major little-endian float32 data. NCO1 is seven little-endian `uint32`
values (`"NCO1"`, dimensions, width, height, depth, channels, elements) followed by the
unpacked little-endian float32 storage returned by ncnn. Its element count remains
`ncnn::Mat::total()` for binary compatibility and may include ncnn channel-stride padding.
Checked products reject zero, inconsistent, overflowing, or truncated inputs before ncnn
receives them. Packed NCT1 channels are read directly into each ncnn `cstep`, so aligned
pool storage does not shift later channels. Outputs whose storage is smaller than their
logical dimensions are rejected.

Host coverage does not require ncnn or Vulkan:

```bash
npm run test:cpp
npm run benchmark:cpp
```

On a provisioned publisher, `npm run test:ncnn-integration` builds the native target, checks
CLI exit behavior, enumerates Vulkan devices, and optionally runs one real model/input smoke
inference when all `WILDFIRE_NCNN_*` paths and tensor names are set. This repository does not
bundle those model assets. A machine without the project-local ncnn install, its pkg-config
metadata, and a Vulkan device cannot compile or run that integration hook.

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
