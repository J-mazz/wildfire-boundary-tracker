# Live engine

The tracker synthesizes a fire view on demand. Nothing is persisted and nothing is
committed: every request derives from NIFC and NASA FIRMS upstream data, held only in
the Cloudflare edge cache.

## Data flow

1. **Seed**: the NIFC/IRWIN incident record supplies the name, discovery date, and origin
   point. The initial footprint is a 12 km buffer around the origin.
2. **Grow**: VIIRS detections inside the footprint expand it (padded, capped at a 4 degree
   span so a bad request can never cover a continent).
3. **Frame**: detections are bucketed into 3-hour frames from discovery (bounded by the
   10-day FIRMS history limit) to now. Only frames containing real detections are `ready`;
   empty frames carry an honest `statusReason`.

## Endpoints (Pages Functions)

- `GET /api/incidents`
  Current wildfire incidents from the NIFC WFIGS FeatureServer (public, no key).
  Trimmed to name, IrwinID, discovery date, size, containment, state, and location.
  Edge-cached 10 minutes. Drives the landing page.

- `GET /api/catalog?fire=irwin:<IrwinID>`
  Synthesizes a snapshot catalog in the same contract as the static
  `dist/data/catalog.json`, so the frontend cannot tell a live fire from a curated one.
  Edge-cached 15 minutes per fire.

- `GET /api/firms?fire=irwin:<id>&frame=<iso>&days=<n>`
  Per-frame VIIRS GeoJSON with FRP, brightness, confidence, and day/night properties
  (mirrors `tools/import_firms.py`). Returns 404 for empty frames. Edge-cached 30 minutes.

Shared logic lives in `functions/api/_engine.js` (underscore prefix keeps it unrouted).

## FIRMS quota protection

The area API is queried in 4-day batches per constellation (SNPP, NOAA-20, NOAA-21).
Bounds are quantized to a 0.05 degree grid so cache keys collapse across users viewing
the same fire. Closed historical batches cache for 6 hours; the batch containing today
caches for 20 minutes. One popular fire costs one set of upstream calls per window,
regardless of viewer count.

## Credentials

Only one secret exists, `FIRMS_MAP_KEY`, held as a Pages project secret and used solely
inside the Functions. The browser never sees a key; NIFC requires none. Without the
secret the catalog still works, with each frame reporting that FIRMS is unconfigured.

## Frontend selection

`src/ts/main.ts` picks the catalog source by URL: with a valid `?fire=irwin:<id>` it polls
`/api/catalog`, otherwise it serves the static catalog. A fire view is therefore just a
shareable URL.
