# Development

Requires Node.js 22+ and [uv](https://docs.astral.sh/uv/) (Python 3.13 and geospatial/SAM-2 dependencies are pinned in `pyproject.toml`/`uv.lock`).

```bash
npm install
uv sync
npm run dev     # http://localhost:8787
npm test
```

Run every Python tool through uv, e.g. `uv run python tools/import_firms.py --help`.

`npm run dev` serves the built `dist/` on `http://localhost:8787` via
`tools/dev_server.js`, which also exposes a **dev-only** config endpoint:

- `GET /api/config`: returns `public/data/catalog.config.json`.
- `PUT /api/config`: validates `{event, app, timeline}`, merges it into the config
  (preserving pipeline-populated `feeds`), and regenerates `dist/data/catalog.json`.

## Retargeting to another fire (⋮ → Settings)

The in-app **Settings** tab writes directly to `catalog.config.json` through that
endpoint. Frame the fire on the map, click **Use current map view**, set the timeline,
and **Save**; the map re-focuses via the catalog poller. Then run the pipeline
(FIRMS/SAM-2/geosplat/context, below) so the data layers match the new bounds.

Save is dev-only: the static Pages build strips `catalog.config.json` and has no write
endpoint, so Settings there is read-only and offers **Copy config JSON** instead.

## WASM (C++26, Emscripten)

```bash
npm run build:wasm
```

Sources the vendored `emsdk`, precompiles the `wildfire.*` C++26 modules, and writes the ES module + `.wasm` binary to `public/wasm/` (git-ignored). There is no Rust build path. The geosplat terrain decoder (`src/cpp/geosplat.cppm`) runs through this module in the browser.

## 3D terrain data

```bash
uv run python tools/build_geosplat.py
```

Regenerates `public/data/geosplat/terrain.splat` + `meta.json` (GSP1 binary: 512×512 grid of quantized heights, RGB, and surface normals) from the Copernicus GLO-30 DEM and the newest Sentinel scene. Requires network access.

## Contextual KML

```bash
bash tools/install_simdjson_local.sh
bash tools/fetch_context_kml.sh
```

Fetches OSM context, converts it with the native C++26/simdjson utility, and atomically publishes the four KML documents under `public/data/context/`. OpenStreetMap attribution remains visible in the map controls.

## Authenticated SAM-2 processing

Set `HF_TOKEN` in the git-ignored `.env.local`, then:

```bash
bash tools/run_hotspot_sam2.sh
```

The token is exported only to the uv-managed process and never appears in arguments or generated assets.

## Local GPU tools

ncnn/Vulkan tools install into the persistent, git-ignored `.tools/` directory:

```bash
bash tools/install_ncnn_local.sh
source tools/ncnn_env.sh
```

`tools/ncnn_env.sh` exports `WILDFIRE_VULKAN_DEVICE_INDEX` and `WILDFIRE_CUDA_DEVICE_INDEX` to select the GPU; note that Vulkan and CUDA enumerate devices independently.
