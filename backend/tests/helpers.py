from __future__ import annotations

import io
import json
from typing import Any

import cv2
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.core.image_io import SourceImage, decode_image, encode_png

RECT_ROI = [[40, 40], [460, 40], [460, 400], [40, 400]]


def textured_rgb(height: int = 448, width: int = 512, seed: int = 0) -> np.ndarray:
    """Brushed-metal-like grey surface (synthetic, no licensing concerns)."""
    rng = np.random.default_rng(seed)
    base = cv2.blur(150 + 18 * rng.standard_normal((height, width)), (9, 1)) + 5 * rng.standard_normal((height, width))
    rgb = np.stack([base, base * 0.98, base * 0.95], axis=-1)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def to_bytes(rgb: np.ndarray, fmt: str = "PNG", **kwargs: Any) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def make_source(rgb: np.ndarray) -> SourceImage:
    return decode_image(encode_png(rgb), 32, 2048)


def full_config(**overrides: Any) -> dict[str, Any]:
    cfg: dict[str, Any] = {
        "version": "1.0",
        "seed": 42,
        "roi": None,
        "allow_overlap": False,
        "defects": [
            {"type": "scratch", "count": 2, "params": {"length_px": [45, 110], "width_px": [1, 3], "angle_deg": [0, 180], "contrast": [0.2, 0.65], "polarity": "dark", "curvature": 0.2}},
            {"type": "pinhole", "count": 3, "params": {"radius_px": [2, 6], "irregularity": 0.35, "contrast": [0.3, 0.9], "polarity": "bright", "rim_strength": 0.2}},
            {"type": "contamination", "count": 2, "params": {"radius_px": [8, 20], "irregularity": 0.5, "opacity": [0.3, 0.7], "blur_sigma": 1.5, "polarity": "dark"}},
        ],
    }
    cfg.update(overrides)
    return cfg


def decode_png(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def post_preview(client: TestClient, file_bytes: bytes, config: dict[str, Any] | str, filename: str = "surface.png"):
    body = config if isinstance(config, str) else json.dumps(config)
    return client.post("/api/v1/preview", files={"file": (filename, file_bytes, "application/octet-stream")}, data={"config": body})


def post_export(client: TestClient, file_bytes: bytes, config: dict[str, Any], sample_count: int | str):
    return client.post(
        "/api/v1/export",
        files={"file": ("surface.png", file_bytes, "image/png")},
        data={"config": json.dumps(config), "sample_count": str(sample_count)},
    )
