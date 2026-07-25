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

`public/data/catalog.json` is the frontend/backend contract. Snapshots are chronological and use source observation times. Coverage starts July 16, 2026 because the NASA FIRMS VIIRS outage prevented reliable detections between the fire's July 10 start and July 16. Feeds per snapshot:

- `sentinel-raster`: georeferenced image (acquisition-driven; carries forward until a newer pass)
- `firms`: VIIRS GeoJSON points, rendered as a seven-day age/FRP-weighted thermal field
- `sam-mask`: GeoJSON polygons, accumulated as the persistent fire-body progression
- `kml`: raw `.kml` or pre-parsed GeoJSON vectors

The frontend polls the catalog every 30 s with ETag and falls back to the last known good copy. Only layers marked `ready` with real source assets are shown; the build never fabricates data.

Layer order is deterministic: satellite base, Sentinel, VIIRS field, SAM-2 body, KML, event outline. In 3D mode the Sentinel raster hides because the terrain splats carry its colors. Publishers should write immutable assets first and replace the catalog atomically last.

Sentinel display and SAM-2 inference use a contrast-stretched B12/B8A/B04 (SWIR2/NIR/red) composite for smoke penetration and burn-scar contrast. The mosaic footprint is four times the event area, biased southeast toward Shady Cove.

## Pipeline boundary

Acquisition and SAM-2 inference are excluded from `npm run build`; they belong to scheduled services with credentials, retries, and GPU infrastructure. On failure, the latest valid snapshot is preserved.

## Production notes

- **Base tile endpoint is config-driven** (`app.baseImagery`); the deployed CSP in
  `dist/_headers` is generated from that host at build (`tools/generate_headers.js`).
  Still replace the default public Esri endpoint with your own before real traffic.
- **Sentinel supports XYZ tiles**: a sentinel observation with `format:"xyz"` and a
  `tiles` array renders as a tiled raster; whole-image `url`+`bounds` remains supported.
  Prefer tiles over whole PNGs at scale.
- **SAM-2 geometry is simplified** at publish time (Douglas–Peucker, `app.simplifyToleranceMeters`).
- **Remaining follow-up:** simplify or tile large KML geometries before serving them.
