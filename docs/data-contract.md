# Data contract & pipeline

## Configuration source of truth

`public/data/catalog.config.json` defines the fire once, for both the frontend and
the pipeline. `tools/generate_catalog.js` expands it into the served
`public/data/catalog.json`. Top-level blocks:

- `event`: id, name, `startedAt`, `center`, `bounds` (the pipeline's bounding box).
- `timeline`: `startAt`/`endAt`/`cadenceHours` (a positive divisor of 24).
- `app`: frontend presentation: `title`, `tagline`, `initialZoom`, `baseImagery`
  (`tiles`/`attribution`/`maxzoom`), and `simplifyToleranceMeters` (SAM-2 output).
- `feeds`: per-feed observation lists, populated by the pipeline tools.

The `app` and `event` blocks are carried into `catalog.json`; the frontend reads them
to brand the page, focus the map, and choose the base imagery. The ⋮ → **Settings**
form edits `event`/`app`/`timeline` (never `feeds`); see [development](development.md).

## Two catalog producers, one contract

The frontend consumes the same catalog shape from either producer:

- **Static**: `tools/generate_catalog.js` expands the config into `dist/data/catalog.json`
  at build time (the curated-fire path).
- **Live**: `GET /api/catalog?fire=irwin:<id>` synthesizes a catalog on demand from NIFC
  and FIRMS (see [Engine](engine.md)). The frontend selects it automatically when the URL
  carries a `fire` parameter.

## Snapshot catalog

`catalog.json` is the frontend/backend contract. Snapshots are chronological and use
source observation times. Layer kinds are:

- `firms`: VIIRS GeoJSON points, rendered as an age/FRP-weighted thermal field.
- `sentinel-raster`: optional georeferenced image or XYZ tiles from a publisher.
- `sam-mask`: optional native ncnn/Vulkan segmentation polygons.
- `kml`: optional raw KML or pre-parsed GeoJSON vectors.

The frontend polls the catalog every 30 s with ETag and falls back to the last known good copy. Only layers marked `ready` with real source assets are shown; the build never fabricates data.

Layer order is deterministic: satellite base, Sentinel, VIIRS field, SAM-2 body, KML,
event outline. In 3D mode the Sentinel raster hides when a matching terrain splat carries
its colors. Publishers write immutable assets first and replace catalogs atomically last.

## Pipeline boundary

Acquisition and native ncnn/Vulkan inference are excluded from `npm run build`. They run
as asynchronous publishers with retries and explicit model assets. On failure, the latest
valid snapshot remains available.

## Production notes

- **Base tile endpoint is config-driven** (`app.baseImagery`); the deployed CSP in
  `dist/_headers` is generated from that host at build (`tools/generate_headers.js`).
  Still replace the default public Esri endpoint with your own before real traffic.
- **Sentinel supports XYZ tiles**: a sentinel observation with `format:"xyz"` and a
  `tiles` array renders as a tiled raster; whole-image `url`+`bounds` remains supported.
  Prefer tiles over whole PNGs at scale.
- **SAM-2 geometry** is produced by native ncnn/Vulkan publishers and should be
  simplified or tiled before catalog publication.
- **Remaining follow-up:** simplify or tile large KML geometries before serving them.
