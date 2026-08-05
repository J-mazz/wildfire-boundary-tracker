"""CLI orchestration for the geosplat publishing pipeline."""

from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .artifacts import write_artifacts
from .config import Bounds, Options, parse_args
from .sources import read_dem, read_sentinel_rgb
from .transform import transform_terrain

DemReader = Callable[[Bounds, int], np.ndarray]
ImageReader = Callable[[Path, int], tuple[np.ndarray, str]]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build(
    options: Options,
    dem_reader: DemReader = read_dem,
    image_reader: ImageReader = read_sentinel_rgb,
    now: Callable[[], datetime] = utc_now,
) -> None:
    print(
        f"Reading Copernicus GLO-30 DEM for bounds {options.bounds} "
        f"at {options.grid}x{options.grid}..."
    )
    heights = dem_reader(options.bounds, options.grid)
    terrain = transform_terrain(heights, options.bounds, options.grid)
    rgb, sentinel_name = image_reader(options.sentinel, options.grid)
    splat_path = write_artifacts(
        options, terrain, rgb, sentinel_name, now()
    )
    size_mb = splat_path.stat().st_size / 1_048_576
    print(
        f"Wrote {splat_path} ({size_mb:.2f} MiB), heights "
        f"{terrain.minimum_height:.0f}-{terrain.maximum_height:.0f} m, "
        f"color from {sentinel_name}"
    )


def main(arguments: Sequence[str] | None = None) -> None:
    build(parse_args(arguments))
