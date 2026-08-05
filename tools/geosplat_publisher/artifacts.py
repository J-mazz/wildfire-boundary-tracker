"""Binary and metadata artifact writing for geosplat publishing."""

import json
import struct
from datetime import datetime
from pathlib import Path

import numpy as np

from .config import Options
from .transform import TerrainPlanes

MAGIC = 0x31505347


def byte_view(array: np.ndarray) -> memoryview:
    return memoryview(np.ascontiguousarray(array)).cast("B")


def metadata(
    options: Options,
    terrain: TerrainPlanes,
    sentinel_name: str,
    generated_at: datetime,
) -> dict[str, object]:
    return {
        "version": 1,
        "bounds": options.bounds,
        "grid": [options.grid, options.grid],
        "minHeightMeters": round(terrain.minimum_height, 2),
        "maxHeightMeters": round(terrain.maximum_height, 2),
        "url": options.public_url,
        "colorSource": sentinel_name,
        "demSource": "Copernicus GLO-30 DSM via AWS Open Data",
        "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
    }


def write_artifacts(
    options: Options,
    terrain: TerrainPlanes,
    rgb: np.ndarray,
    sentinel_name: str,
    generated_at: datetime,
) -> Path:
    expected_rgb_shape = (options.grid, options.grid, 3)
    if rgb.shape != expected_rgb_shape or rgb.dtype != np.uint8:
        raise ValueError(
            f"Sentinel RGB must be uint8 with shape {expected_rgb_shape}"
        )
    options.output.mkdir(parents=True, exist_ok=True)
    splat_path = options.output / "terrain.splat"
    header = struct.pack(
        "<IHHff",
        MAGIC,
        options.grid,
        options.grid,
        terrain.minimum_height,
        terrain.maximum_height,
    )
    with splat_path.open("wb") as handle:
        handle.write(header)
        handle.write(byte_view(terrain.quantized_heights))
        handle.write(byte_view(rgb))
        handle.write(byte_view(terrain.normal_xy))
    metadata_path = options.output / "meta.json"
    metadata_path.write_text(
        json.dumps(
            metadata(options, terrain, sentinel_name, generated_at),
            indent=2,
        )
        + "\n"
    )
    return splat_path
