"""Measure config 1.1 (area-restricted, surface-matched scratches) on a 1024x1024 synthetic part image.

    python scripts/benchmark_regions.py [--runs 20] [--zip-runs 5] [--zip-count 10]

Stages (reported separately):
    area       regions -> allowed area (rasterise, set ops, distance transform)
    analysis   local surface statistics of the source (once per request)
    synthesis  one sample with the prepared context (engine only)
    preview    synthesis + 3 PNG encodes + base64 (what /preview does after preparation)
    zip        a full N-sample export into memory (preparation once + N samples + PNG + ZIP)
"""

from __future__ import annotations

import argparse
import io
import platform
import statistics
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.exporter import write_dataset_zip  # noqa: E402
from app.core.image_io import b64, decode_image, encode_png  # noqa: E402
from app.core.generation_v11 import generate_v11_sample, prepare_v11_context  # noqa: E402
from app.core.regions import prepare_area  # noqa: E402
from app.core.surface import analyze_surface  # noqa: E402
from app.schemas.generation import GenerationConfigV11  # noqa: E402
from synthetic_part import synthetic_part, v11_config  # noqa: E402


def _ms(samples: list[float]) -> str:
    ordered = sorted(samples)
    p90 = ordered[max(0, int(round(0.9 * len(ordered))) - 1)]
    return f"median {statistics.median(samples):7.1f} ms, p90 {p90:7.1f} ms (n={len(samples)})"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--zip-runs", type=int, default=5)
    parser.add_argument("--zip-count", type=int, default=10)
    args = parser.parse_args()

    fixture = synthetic_part(height=1024, width=1024, angle_deg=8.0, part_length=760.0, part_width=380.0)
    source = decode_image(encode_png(fixture.rgb), 32, 2048)
    config = GenerationConfigV11.model_validate(v11_config(fixture))  # 2 scratches, parallel, local shading
    assert config.scratch is not None
    sigma = config.scratch.params.shading.window_sigma_px

    geometry_ms, analysis_ms, synthesis_ms, preview_ms, zip_ms = [], [], [], [], []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        area = prepare_area(config.regions, config.edge_margin_px, source.width, source.height)
        t1 = time.perf_counter()
        analyze_surface(source.rgb, area.stats_domain, sigma)
        t2 = time.perf_counter()
        geometry_ms.append((t1 - t0) * 1000)
        analysis_ms.append((t2 - t1) * 1000)

    ctx = prepare_v11_context(source, config)
    for i in range(args.runs):
        t0 = time.perf_counter()
        result = generate_v11_sample(source, config, 42 + i, ctx)
        t1 = time.perf_counter()
        for array in (result.image, result.class_mask, result.binary_mask):
            b64(encode_png(array))
        t2 = time.perf_counter()
        synthesis_ms.append((t1 - t0) * 1000)
        preview_ms.append((t2 - t0) * 1000)

    for _ in range(args.zip_runs):
        t0 = time.perf_counter()
        write_dataset_zip(source, config, args.zip_count, io.BytesIO())
        zip_ms.append((time.perf_counter() - t0) * 1000)

    area = ctx.metadata["area"]
    print(f"platform  : {platform.platform()} | {platform.processor() or platform.machine()}")
    print(f"python    : {platform.python_version()} | numpy {np.__version__} | opencv {cv2.__version__}")
    print(f"input     : 1024x1024 synthetic part (8 deg), include area {area['include_pixel_count']} px, allowed {area['allowed_pixel_count']} px")
    print(f"config    : 2 scratches, length 20-60 px, local shading sigma {sigma:g}, margin {config.edge_margin_px:g} px")
    print(f"area      : {_ms(geometry_ms)}")
    print(f"analysis  : {_ms(analysis_ms)}")
    print(f"synthesis : {_ms(synthesis_ms)}")
    print(f"preview   : {_ms(preview_ms)}  (synthesis + 3 PNG + base64; add area + analysis for a /preview call)")
    print(f"zip x{args.zip_count:<3}  : {_ms(zip_ms)}  (prepare once + {args.zip_count} samples + PNG + ZIP)")


if __name__ == "__main__":
    main()
