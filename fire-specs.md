# Fire spec sheet: East Evans Creek

The specification for the fire this deployment is currently focused on. Every value
here is sourced from [`public/data/catalog.config.json`](public/data/catalog.config.json);
retargeting the app to another fire (⋮ → **Settings**, or editing that file) is what
changes this sheet. Use it as the template for a new fire's spec sheet.

## Identity

| Field | Value |
| --- | --- |
| Event id | `east-evans-creek-2026` |
| Name | East Evans Creek Fire |
| Location | Near Shady Cove, Jackson County, Oregon, USA |
| Fire start | 2026-07-10 (UTC) |
| Display title / tagline | "East Evans Creek" · "Near-real-time earth view" |

## Geography

| Field | Value |
| --- | --- |
| Center (lon, lat) | −122.9109927, 42.6454545 |
| Bounds (W, S, E, N) | −123.2109927, 42.4454545, −122.6109927, 42.8454545 |
| Approx. extent | ~49 km wide × ~45 km tall |
| Initial map zoom | 9 |
| Sentinel mosaic footprint | 4× the event area, biased southeast toward Shady Cove |

## Timeline

| Field | Value |
| --- | --- |
| Coverage window | 2026-07-16 09:00 UTC → 2026-07-22 21:00 UTC |
| Snapshot cadence | Every 3 hours |
| Coverage gap | 2026-07-10 → 2026-07-16: a NASA FIRMS VIIRS availability outage prevented reliable thermal detections during the fire's first six days. Missing detections do **not** mean there was no fire. |

## Feeds

| Feed | Kind | Source | Notes |
| --- | --- | --- | --- |
| NASA FIRMS VIIRS | thermal points | NASA FIRMS | Rolling 168-hour (7-day) age/FRP-weighted heat field |
| Sentinel-2 SWIR/NIR | raster | Sentinel-2 L2A via Element 84 Earth Search | B12/B8A/B04 contrast-stretched composite; carried forward until a newer pass |
| SAM-2 fire path | polygons | `facebook/sam2.1-hiera-tiny` on the Sentinel composite | Rolling 168-hour accumulated progression body; simplified to ~15 m tolerance |
| Incident perimeter | KML/GeoJSON | (operator-supplied) | Currently empty |
| Major roads · County borders · City limits · Landscape features | KML | OpenStreetMap via Overpass | Contextual reference layers |
| 3D terrain (geosplat) | binary splat | Copernicus GLO-30 DSM via AWS Open Data + latest Sentinel scene | `GSP1` 512×512 quantized height/RGB/normal grid |

## Base imagery

Esri World Imagery (`server.arcgisonline.com`), configured in `app.baseImagery`.
**Replace this public endpoint with your own tile source before significant traffic.**
The deployed CSP (`dist/_headers`) is generated from this host at build time.

## Data provenance

NASA FIRMS · Copernicus Sentinel-2 (ESA) via Element 84 · Copernicus GLO-30 DEM
(ESA/AWS Open Data) · OpenStreetMap contributors · Esri World Imagery.
**Every layer comes from real observations; nothing is fabricated.**
