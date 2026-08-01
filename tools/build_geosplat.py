#!/usr/bin/env python3
"""Build a DEM-lifted Gaussian splat binary for the event area.

Lifts Copernicus GLO-30 elevation (public AWS COGs, no auth) into a compact
quantized splat grid colored by the latest Sentinel-2 SWIR composite. The
output is decoded at runtime by the C++26 WASM module and rendered as
depth-tested Gaussian surfels in a MapLibre custom layer.

Binary layout (little-endian):
  u32   magic 'GSP1' (0x31505347)
  u16   gridW
  u16   gridH
  f32   minHeightMeters
  f32   maxHeightMeters
  u16[gridW*gridH]     heights (north-first row-major, quantized min..max)
  u8[3*gridW*gridH]    rgb color
  i8[2*gridW*gridH]    normal xy (z reconstructed in shader)
"""

import argparse
import json
import math
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from PIL import Image

MAGIC = 0x31505347  # 'GSP1'
DEM_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/"
    "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif"
)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sentinel", type=Path, required=True)
    parser.add_argument("--public-url", default="terrain.splat")
    parser.add_argument("--grid", type=int, default=512)
    return parser.parse_args()


def dem_tiles(bounds):
    west, south, east, north = bounds
    tiles = []
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            lat_tag = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
            lon_tag = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
            tiles.append(DEM_URL.format(lat=lat_tag, lon=lon_tag))
    return tiles


def read_dem(bounds, grid):
    west, south, east, north = bounds
    dest = np.full((grid, grid), np.nan, dtype=np.float32)
    dst_transform = from_bounds(west, south, east, north, grid, grid)
    for url in dem_tiles(bounds):
        with rasterio.open(url) as src:
            reproject(
                source=rasterio.band(src, 1),
                destination=dest,
                dst_transform=dst_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.bilinear,
                init_dest_nodata=False,
            )
    if np.isnan(dest).any():
        missing = int(np.isnan(dest).sum())
        raise RuntimeError(f"DEM mosaic left {missing} cells uncovered; check tile coverage")
    return dest


def surface_normals(heights, bounds, grid):
    west, south, east, north = bounds
    mid_lat = math.radians((south + north) / 2)
    meters_x = (east - west) * 111_320 * math.cos(mid_lat) / grid
    meters_y = (north - south) * 111_320 / grid
    dz_dy, dz_dx = np.gradient(heights, meters_y, meters_x)
    # Row 0 is north; +y in grid space points south, so flip the y slope.
    normals = np.stack([-dz_dx, dz_dy, np.ones_like(heights)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    return normals


def sentinel_rgb(source, grid):
    if not source.is_file():
        raise RuntimeError(f"Sentinel composite not found: {source}")
    image = Image.open(source).convert("RGB").resize((grid, grid), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.uint8), source.name


def main():
    args = parse_args()
    bounds = args.bounds
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("--bounds must be valid WGS84 west south east north coordinates")
    if args.grid < 2 or args.grid > 4096:
        raise ValueError("--grid must be between 2 and 4096")
    grid = args.grid

    print(f"Reading Copernicus GLO-30 DEM for bounds {bounds} at {grid}x{grid}...")
    heights = read_dem(bounds, grid)
    min_h = float(heights.min())
    max_h = float(heights.max())
    span = max(max_h - min_h, 1.0)
    quantized = np.clip((heights - min_h) / span * 65535.0, 0, 65535).astype("<u2")

    normals = surface_normals(heights, bounds, grid)
    normal_xy = np.clip(np.round(normals[..., :2] * 127.0), -127, 127).astype(np.int8)

    rgb, sentinel_name = sentinel_rgb(args.sentinel, grid)

    args.output.mkdir(parents=True, exist_ok=True)
    splat_path = args.output / "terrain.splat"
    header = struct.pack("<IHHff", MAGIC, grid, grid, min_h, max_h)
    with splat_path.open("wb") as handle:
        handle.write(header)
        handle.write(quantized.tobytes())
        handle.write(rgb.tobytes())
        handle.write(normal_xy.tobytes())

    meta = {
        "version": 1,
        "bounds": bounds,
        "grid": [grid, grid],
        "minHeightMeters": round(min_h, 2),
        "maxHeightMeters": round(max_h, 2),
        "url": args.public_url,
        "colorSource": sentinel_name,
        "demSource": "Copernicus GLO-30 DSM via AWS Open Data",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    (args.output / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")

    size_mb = splat_path.stat().st_size / 1_048_576
    print(f"Wrote {splat_path} ({size_mb:.2f} MiB), heights {min_h:.0f}-{max_h:.0f} m, color from {sentinel_name}")


if __name__ == "__main__":
    sys.exit(main())
