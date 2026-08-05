"""Pure terrain transformation and quantization."""

from dataclasses import dataclass

import numpy as np

from .config import Bounds


@dataclass(frozen=True)
class TerrainPlanes:
    quantized_heights: np.ndarray
    normal_xy: np.ndarray
    minimum_height: float
    maximum_height: float


def quantize_heights(heights: np.ndarray) -> tuple[np.ndarray, float, float]:
    minimum = float(heights.min())
    maximum = float(heights.max())
    span = max(maximum - minimum, 1.0)
    quantized = np.clip(
        (heights - minimum) / span * 65535.0, 0, 65535
    ).astype("<u2")
    return quantized, minimum, maximum


def quantize_surface_normals(
    heights: np.ndarray, bounds: Bounds, grid: int
) -> np.ndarray:
    west, south, east, north = bounds
    middle_latitude = np.radians((south + north) / 2)
    meters_x = (east - west) * 111_320 * np.cos(middle_latitude) / grid
    meters_y = (north - south) * 111_320 / grid
    slope_y, slope_x = np.gradient(heights, meters_y, meters_x)
    normal_x = -slope_x
    normal_y = slope_y
    magnitude = np.sqrt(normal_x * normal_x + normal_y * normal_y + 1.0)
    normal_xy = np.stack((normal_x / magnitude, normal_y / magnitude), axis=-1)
    return np.clip(np.round(normal_xy * 127.0), -127, 127).astype(np.int8)


def transform_terrain(
    heights: np.ndarray, bounds: Bounds, grid: int
) -> TerrainPlanes:
    expected_shape = (grid, grid)
    if heights.shape != expected_shape:
        raise ValueError(
            f"DEM shape {heights.shape} does not match grid {expected_shape}"
        )
    if not np.isfinite(heights).all():
        raise ValueError("DEM contains non-finite heights")
    quantized, minimum, maximum = quantize_heights(heights)
    return TerrainPlanes(
        quantized_heights=quantized,
        normal_xy=quantize_surface_normals(heights, bounds, grid),
        minimum_height=minimum,
        maximum_height=maximum,
    )
