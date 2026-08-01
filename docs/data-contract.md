# Live data contract

`GET /api/catalog?fire=irwin:<id>` is the only catalog producer. It derives incident
metadata from NIFC and frame coverage from NASA FIRMS. There is no static catalog,
browser configuration editor, or checked-in observation fixture path.

## Snapshot catalog

The catalog response is the frontend/backend contract. Snapshots are chronological and use
source observation times. Layer kinds are:

- `firms`: VIIRS GeoJSON points, rendered as an age/FRP-weighted thermal field.
- `sentinel-raster`: optional georeferenced image or XYZ tiles from a publisher.
- `sam-mask`: optional native ncnn/Vulkan segmentation polygons.
- `kml`: optional raw KML or pre-parsed GeoJSON vectors.

The frontend polls at `pollIntervalSeconds`, uses ETags, and falls back to the last known
good copy. Only layers marked `ready` with real source assets are shown.

Layer order is deterministic: satellite base, Sentinel, VIIRS field, SAM-2 body, KML,
event outline. In 3D mode the Sentinel raster hides when a matching terrain splat carries
its colors. Publishers write immutable assets first and replace catalogs atomically last.

## Publisher boundary

Optional Sentinel, geosplat, and native ncnn/Vulkan products are external immutable
assets. Publisher tools require explicit input and output paths. They never write browser
configuration or modify the live NIFC/FIRMS catalog implicitly.

## Production notes

- **Base imagery** is selected by the live catalog. The CSP currently allows the default
  Esri imagery endpoint and OpenFreeMap glyph endpoint.
- **Sentinel supports XYZ tiles**: a sentinel observation with `format:"xyz"` and a
  `tiles` array renders as a tiled raster; whole-image `url`+`bounds` remains supported.
  Prefer tiles over whole PNGs at scale.
- **SAM-2 geometry** is produced by native ncnn/Vulkan publishers and should be
  simplified or tiled before catalog publication.
- **Large geometry:** simplify or tile large vector products before publication.
