"""Measure single-preview CPU time on a 1024x1024 image (spec section 12, quality target).

    python scripts/benchmark_preview.py [--runs 20]

Reports generation (engine only) and the full preview path (generation + 3 PNG encodes + base64).
"""

from __future__ import annotations

import argparse
import platform
import statistics
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.generation import generate_sample  # noqa: E402
from app.core.image_io import b64, decode_image, encode_png  # noqa: E402
from app.schemas.generation import GenerationConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args()

    rng = np.random.default_rng(0)
    base = cv2.blur(150 + 20 * rng.standard_normal((1024, 1024)), (31, 1)) + 5 * rng.standard_normal((1024, 1024))
    rgb = np.clip(np.stack([base, base, base], axis=-1), 0, 255).astype(np.uint8)
    source = decode_image(encode_png(rgb), 32, 2048)
    config = GenerationConfig.model_validate({"defects": [{"type": "scratch"}, {"type": "pinhole"}, {"type": "contamination"}]})

    engine, full = [], []
    for i in range(args.runs):
        t0 = time.perf_counter()
        result = generate_sample(source, config, 42 + i)
        t1 = time.perf_counter()
        for array in (result.image, result.class_mask, result.binary_mask):
            b64(encode_png(array))
        t2 = time.perf_counter()
        engine.append((t1 - t0) * 1000)
        full.append((t2 - t0) * 1000)

    print(f"platform : {platform.platform()} | {platform.processor() or platform.machine()}")
    print(f"python   : {platform.python_version()} | numpy {np.__version__} | opencv {cv2.__version__}")
    print(f"config   : defaults (scratch 2 + pinhole 3 + contamination 2), 1024x1024, {args.runs} seeds")
    print(f"engine   : median {statistics.median(engine):.1f} ms, p90 {sorted(engine)[int(0.9 * len(engine)) - 1]:.1f} ms")
    print(f"preview  : median {statistics.median(full):.1f} ms, p90 {sorted(full)[int(0.9 * len(full)) - 1]:.1f} ms (engine + 3 PNG encodes + base64)")


if __name__ == "__main__":
    main()
