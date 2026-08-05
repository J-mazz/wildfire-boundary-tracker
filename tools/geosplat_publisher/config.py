"""Command-line options and validation for geosplat publishing."""

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

Bounds = tuple[float, float, float, float]
DESCRIPTION = """Build a DEM-lifted Gaussian splat binary for the event area.

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


@dataclass(frozen=True)
class Options:
    bounds: Bounds
    output: Path
    sentinel: Path
    public_url: str = "terrain.splat"
    grid: int = 512


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(
        description=DESCRIPTION
    )
    argument_parser.add_argument(
        "--bounds",
        type=float,
        nargs=4,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        required=True,
    )
    argument_parser.add_argument("--output", type=Path, required=True)
    argument_parser.add_argument("--sentinel", type=Path, required=True)
    argument_parser.add_argument("--public-url", default="terrain.splat")
    argument_parser.add_argument("--grid", type=int, default=512)
    return argument_parser


def validate_options(options: Options) -> Options:
    west, south, east, north = options.bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError(
            "--bounds must be valid WGS84 west south east north coordinates"
        )
    if not 2 <= options.grid <= 4096:
        raise ValueError("--grid must be between 2 and 4096")
    return options


def parse_args(arguments: Sequence[str] | None = None) -> Options:
    values = parser().parse_args(arguments)
    options = Options(
        bounds=tuple(values.bounds),
        output=values.output,
        sentinel=values.sentinel,
        public_url=values.public_url,
        grid=values.grid,
    )
    return validate_options(options)
