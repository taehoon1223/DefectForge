"""Helpers for config 1.1 tests (synthetic chip-part fixture — not real component data)."""

from __future__ import annotations

import copy
from typing import Any

import cv2
import numpy as np

from app.core.image_io import SourceImage, decode_image, encode_png
from app.core.pipeline import make_sampler
from app.core.roi import rasterize_polygon
from app.schemas.generation import GenerationConfigV11
from scripts.synthetic_part import PartFixture, synthetic_part, v11_config


def part(angle_deg: float = 0.0, **kwargs: Any) -> tuple[PartFixture, SourceImage]:
    """640x560 so the 440px part stays inside the image at any rotation."""
    kwargs.setdefault("height", 560)
    fixture = synthetic_part(angle_deg=angle_deg, **kwargs)
    return fixture, decode_image(encode_png(fixture.rgb), 32, 2048)


def include(region_id: str, polygon: list[list[int]]) -> dict:
    return {"id": region_id, "name": region_id, "kind": "include", "polygon": polygon}


def exclude(region_id: str, polygon: list[list[int]]) -> dict:
    return {"id": region_id, "name": region_id, "kind": "exclude", "polygon": polygon}


def box(x0: int, y0: int, x1: int, y1: int) -> list[list[int]]:
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def config(fixture: PartFixture, scratch_params: dict | None = None, count: int = 2, **overrides: Any) -> dict:
    """Scratches in electrode A (parallel to the part, local shading); ``scratch_params`` patch the defaults.

    ``orientation`` / ``shading`` patches are merged into the default sub-objects.
    """
    cfg = v11_config(fixture, **overrides)
    params = copy.deepcopy(cfg["defects"][0]["params"])
    for key, value in copy.deepcopy(scratch_params or {}).items():
        params[key] = {**params[key], **value} if key in ("orientation", "shading") else value
    cfg["defects"] = [{"type": "scratch", "count": count, "params": params}]
    return cfg


def as_v11(cfg10: dict) -> dict:
    """The config 1.1 equivalent of a 1.0 config: ROI -> one include region, everything else as is."""
    roi = cfg10.get("roi")
    return {
        "version": "1.1",
        "seed": cfg10.get("seed", 42),
        "allow_overlap": cfg10.get("allow_overlap", False),
        "regions": [] if roi is None else [include("roi", roi)],
        "defects": copy.deepcopy(cfg10["defects"]),
    }


def run(source: SourceImage, cfg: dict, seed: int | None = None):
    parsed = GenerationConfigV11.model_validate(cfg)
    return make_sampler(source, parsed).generate(parsed.seed if seed is None else seed)


def polygon_mask(points: list[list[int]], source: SourceImage) -> np.ndarray:
    return rasterize_polygon([tuple(p) for p in points], source.width, source.height)


def disk(radius: float) -> np.ndarray:
    r = int(np.floor(radius))
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    return ((xx * xx + yy * yy) <= radius * radius).astype(np.uint8)


def margin_area(base: np.ndarray, margin: float) -> np.ndarray:
    """``base`` minus every pixel within ``margin`` (Euclidean) of a pixel outside it, image border included.

    Independent of the engine's distance transform.
    """
    if margin <= 0:
        return base.copy()
    outside = np.pad(~base, 1, constant_values=True).astype(np.uint8)
    near = cv2.dilate(outside, disk(margin)).astype(bool)[1:-1, 1:-1]
    return base & ~near


def principal_angle(mask: np.ndarray) -> float:
    """Orientation of the pixel cloud in [0, 180), image coordinates."""
    ys, xs = np.nonzero(mask)
    coords = np.stack([xs - xs.mean(), ys - ys.mean()])
    w, v = np.linalg.eigh(np.cov(coords))
    vx, vy = v[:, np.argmax(w)]
    return float(np.degrees(np.arctan2(vy, vx)) % 180.0)


def angle_diff(a: float, b: float) -> float:
    """Distance between two axial directions (180-degree periodic)."""
    return abs((a - b + 90.0) % 180.0 - 90.0)
