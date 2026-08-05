"""Network and image source ownership for geosplat publishing."""

import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject

from .config import Bounds

DEM_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/"
    "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif"
)


def dem_tiles(bounds: Bounds) -> list[str]:
    west, south, east, north = bounds
    tiles = []
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            lat_tag = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
            lon_tag = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
            tiles.append(DEM_URL.format(lat=lat_tag, lon=lon_tag))
    return tiles


def read_dem(bounds: Bounds, grid: int) -> np.ndarray:
    west, south, east, north = bounds
    destination = np.full((grid, grid), np.nan, dtype=np.float32)
    destination_transform = from_bounds(west, south, east, north, grid, grid)
    for url in dem_tiles(bounds):
        with rasterio.open(url) as source:
            reproject(
                source=rasterio.band(source, 1),
                destination=destination,
                dst_transform=destination_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.bilinear,
                init_dest_nodata=False,
            )
    missing = int(np.isnan(destination).sum())
    if missing:
        raise RuntimeError(
            f"DEM mosaic left {missing} cells uncovered; check tile coverage"
        )
    return destination


def read_sentinel_rgb(source: Path, grid: int) -> tuple[np.ndarray, str]:
    if not source.is_file():
        raise RuntimeError(f"Sentinel composite not found: {source}")
    with Image.open(source) as image:
        resized = image.convert("RGB").resize(
            (grid, grid), Image.Resampling.LANCZOS
        )
        return np.asarray(resized, dtype=np.uint8), source.name
