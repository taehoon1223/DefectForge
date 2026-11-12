"""Generate the bundled example images (and the config 1.1 example that matches the part image).

Both images are fully synthetic (procedural noise produced by these scripts), so they carry no
third-party licensing concerns. The chip-part image is a geometry/quality fixture, not a real part.

    python scripts/generate_sample_image.py

Outputs:
    frontend/public/samples/brushed_metal_512x448.png
    frontend/public/samples/part_synthetic_640x400.png
    examples/configs/regions_scratch.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import cv2
import numpy as np
from synthetic_part import synthetic_part, v11_config

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "frontend" / "public" / "samples"
OUT = SAMPLES / "brushed_metal_512x448.png"
PART_OUT = SAMPLES / "part_synthetic_640x400.png"
PART_CONFIG = ROOT / "examples" / "configs" / "regions_scratch.json"
PART_ANGLE_DEG = 8.0


def brushed_metal(height: int, width: int, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = cv2.blur(150 + 22 * rng.standard_normal((height, width)), (41, 1))  # horizontal brushing
    base += 5 * rng.standard_normal((height, width))
    yy, xx = np.mgrid[0:height, 0:width]
    base += 16 * (xx / width - 0.5) - 40 * (yy / height - 0.5) ** 2  # soft illumination falloff
    rgb = np.stack([base, base * 0.985, base * 0.955], axis=-1)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def main() -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT), cv2.cvtColor(brushed_metal(448, 512), cv2.COLOR_RGB2BGR))
    print(f"wrote {OUT.relative_to(ROOT)}")

    fixture = synthetic_part(angle_deg=PART_ANGLE_DEG)
    cv2.imwrite(str(PART_OUT), cv2.cvtColor(fixture.rgb, cv2.COLOR_RGB2BGR))
    print(f"wrote {PART_OUT.relative_to(ROOT)}")

    config = v11_config(fixture)
    config["defects"][0]["params"].update(length_px=[30, 70], contrast=[0.25, 0.5])
    text = json.dumps(config, ensure_ascii=False, indent=2)
    text = re.sub(r"\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]", r"[\1, \2]", text)  # one [x, y] pair per line
    PART_CONFIG.write_text(text + "\n", encoding="utf-8")
    print(f"wrote {PART_CONFIG.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
