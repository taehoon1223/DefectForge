"""Generate the bundled example surface image.

The image is fully synthetic (procedural noise produced by this script), so it carries no third-party
licensing concerns. Output: frontend/public/samples/brushed_metal_512x448.png

    python scripts/generate_sample_image.py
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "samples" / "brushed_metal_512x448.png"


def brushed_metal(height: int, width: int, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = cv2.blur(150 + 22 * rng.standard_normal((height, width)), (41, 1))  # horizontal brushing
    base += 5 * rng.standard_normal((height, width))
    yy, xx = np.mgrid[0:height, 0:width]
    base += 16 * (xx / width - 0.5) - 40 * (yy / height - 0.5) ** 2  # soft illumination falloff
    rgb = np.stack([base, base * 0.985, base * 0.955], axis=-1)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rgb = brushed_metal(448, 512)
    cv2.imwrite(str(OUT), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
