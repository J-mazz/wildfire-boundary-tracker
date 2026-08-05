import contextlib
import io
import json
import struct
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from geosplat_publisher.artifacts import MAGIC, write_artifacts
from geosplat_publisher.cli import build
from geosplat_publisher.config import Options, parse_args, parser, validate_options
from geosplat_publisher.sources import dem_tiles
from geosplat_publisher.transform import transform_terrain


class GeosplatPublisherTests(unittest.TestCase):
    def options(self, output: Path, grid: int = 2) -> Options:
        return Options(
            bounds=(-123.0, 42.0, -122.0, 43.0),
            output=output,
            sentinel=Path("sentinel.png"),
            public_url="assets/terrain.splat",
            grid=grid,
        )

    def test_options_preserve_defaults_and_reject_invalid_ranges(self):
        parsed = parse_args(
            [
                "--bounds", "-123", "42", "-122", "43",
                "--output", "out",
                "--sentinel", "source.png",
            ]
        )
        self.assertEqual(parsed.grid, 512)
        self.assertEqual(parsed.public_url, "terrain.splat")
        self.assertIn("Binary layout (little-endian)", parser().format_help())
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as missing_required:
                parse_args([])
        self.assertEqual(missing_required.exception.code, 2)
        with self.assertRaisesRegex(ValueError, "WGS84"):
            validate_options(self.options(Path("out")).__class__(
                bounds=(1.0, 2.0, 1.0, 3.0),
                output=Path("out"),
                sentinel=Path("source.png"),
                grid=2,
            ))
        with self.assertRaisesRegex(ValueError, "between 2 and 4096"):
            validate_options(self.options(Path("out"), grid=1))

    def test_dem_tiles_are_deterministic_and_latitude_major(self):
        urls = dem_tiles((-123.2, 41.8, -121.9, 43.1))
        tags = [url.split("Copernicus_DSM_COG_10_")[1].split("_DEM")[0] for url in urls]
        self.assertEqual(
            tags,
            [
                "N41_00_W124_00", "N41_00_W123_00", "N41_00_W122_00",
                "N42_00_W124_00", "N42_00_W123_00", "N42_00_W122_00",
                "N43_00_W124_00", "N43_00_W123_00", "N43_00_W122_00",
            ],
        )

    def test_transform_quantizes_flat_and_extreme_surfaces(self):
        for seed in range(8):
            generator = np.random.default_rng(seed)
            heights = generator.uniform(-100, 5000, size=(4, 4)).astype(np.float32)
            terrain = transform_terrain(
                heights, (-123.0, 42.0, -122.0, 43.0), 4
            )
            self.assertEqual(terrain.quantized_heights.dtype, np.dtype("<u2"))
            self.assertGreaterEqual(int(terrain.quantized_heights.min()), 0)
            self.assertLessEqual(int(terrain.quantized_heights.max()), 65535)
            self.assertGreaterEqual(int(terrain.normal_xy.min()), -127)
            self.assertLessEqual(int(terrain.normal_xy.max()), 127)
        flat = transform_terrain(
            np.full((2, 2), 100.0, dtype=np.float32),
            (-123.0, 42.0, -122.0, 43.0),
            2,
        )
        np.testing.assert_array_equal(flat.quantized_heights, np.zeros((2, 2)))
        np.testing.assert_array_equal(flat.normal_xy, np.zeros((2, 2, 2)))

    def test_artifacts_keep_wire_layout_and_metadata_order(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            options = self.options(output)
            terrain = transform_terrain(
                np.array([[10, 20], [30, 40]], dtype=np.float32),
                options.bounds,
                options.grid,
            )
            rgb = np.arange(12, dtype=np.uint8).reshape((2, 2, 3))
            generated_at = datetime(2026, 8, 4, 12, tzinfo=timezone.utc)
            splat = write_artifacts(
                options, terrain, rgb, "sentinel.png", generated_at
            )
            payload = splat.read_bytes()
            self.assertEqual(len(payload), 16 + 4 * 2 + 4 * 3 + 4 * 2)
            self.assertEqual(struct.unpack("<IHH", payload[:8]), (MAGIC, 2, 2))
            metadata = json.loads((output / "meta.json").read_text())
            self.assertEqual(list(metadata), [
                "version", "bounds", "grid", "minHeightMeters",
                "maxHeightMeters", "url", "colorSource", "demSource",
                "generatedAt",
            ])
            self.assertEqual(metadata["generatedAt"], "2026-08-04T12:00:00Z")

    def test_build_propagates_source_failures_without_partial_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)

            def fail_dem(_bounds, _grid):
                raise RuntimeError("network failed")

            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "network failed"):
                    build(self.options(output), dem_reader=fail_dem)
            self.assertFalse((output / "terrain.splat").exists())


if __name__ == "__main__":
    unittest.main()
