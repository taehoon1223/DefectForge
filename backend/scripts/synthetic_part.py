"""Procedural chip-component top view (two end electrodes + body) for tests and the demo sample.

This is NOT a real component photograph: it is a quality/geometry fixture with known region geometry.
Layout in the part frame (u along the part length, v across it), rotated by ``angle_deg``:

    [ electrode A | body | electrode B ]   on a dark background

Electrodes are bright metallic grey with streaks running along u (electrode B is darker than A so
brightness adaptation can be observed); the body is beige with fine grain.
Returned polygons are the rendered rectangles inset by ``inset_px`` so they never include another
material, and the axis runs along the part length through its centre.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class PartFixture:
    rgb: np.ndarray  # (H, W, 3) uint8
    polygons: dict[str, list[list[int]]]  # electrode_a, body, electrode_b
    axis: tuple[list[int], list[int]]  # start, end (pixel indices)
    angle_deg: float


def _to_pixel(x: float, y: float) -> list[int]:
    return [int(round(x - 0.5)), int(round(y - 0.5))]


def synthetic_part(
    height: int = 400,
    width: int = 640,
    angle_deg: float = 0.0,
    part_length: float = 440.0,
    part_width: float = 200.0,
    electrode_fraction: float = 0.24,
    electrode_levels: tuple[float, float] = (205.0, 150.0),
    inset_px: float = 1.5,
    seed: int = 3,
) -> PartFixture:
    rng = np.random.default_rng(seed)
    cx, cy = width / 2.0, height / 2.0
    theta = math.radians(angle_deg)
    c, s = math.cos(theta), math.sin(theta)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32) + 0.5
    u = (xx - cx) * c + (yy - cy) * s
    v = -(xx - cx) * s + (yy - cy) * c

    half_l, half_w = part_length / 2.0, part_width / 2.0
    e_len = part_length * electrode_fraction
    inside = (np.abs(u) <= half_l) & (np.abs(v) <= half_w)
    elec_a = inside & (u <= -half_l + e_len)
    elec_b = inside & (u >= half_l - e_len)
    body = inside & ~elec_a & ~elec_b

    rgb = np.empty((height, width, 3), dtype=np.float32)
    rgb[...] = (34.0, 39.0, 37.0)
    rgb += 4.0 * rng.standard_normal((height, width, 1)).astype(np.float32)

    # Body: beige with low-frequency mottling and fine grain.
    mottling = cv2.resize(rng.normal(0, 6, (8, 8)).astype(np.float32), (width, height), interpolation=cv2.INTER_CUBIC)
    body_rgb = np.array([178.0, 150.0, 118.0], dtype=np.float32) + (mottling + 5.0 * rng.standard_normal((height, width)).astype(np.float32))[..., None]
    rgb[body] = body_rgb[body]

    # Electrodes: streaks along the part length = 1-D noise indexed by v, plus fine noise.
    v_index = np.clip(np.round(v + half_w + 2).astype(np.int32), 0, int(part_width) + 4)
    streaks = cv2.GaussianBlur(rng.normal(0, 7, (int(part_width) + 5, 1)).astype(np.float32), (0, 0), 1.2).ravel()
    for mask, level in ((elec_a, electrode_levels[0]), (elec_b, electrode_levels[1])):
        value = level + streaks[v_index] + 3.0 * rng.standard_normal((height, width)).astype(np.float32)
        tint = np.stack([value * 0.98, value * 0.99, value * 1.02], axis=-1)
        rgb[mask] = tint[mask]

    def rect(u0: float, u1: float) -> list[list[int]]:
        corners = [(u0 + inset_px, -half_w + inset_px), (u1 - inset_px, -half_w + inset_px), (u1 - inset_px, half_w - inset_px), (u0 + inset_px, half_w - inset_px)]
        return [_to_pixel(cx + uu * c - vv * s, cy + uu * s + vv * c) for uu, vv in corners]

    polygons = {
        "electrode_a": rect(-half_l, -half_l + e_len),
        "body": rect(-half_l + e_len, half_l - e_len),
        "electrode_b": rect(half_l - e_len, half_l),
    }
    axis = (_to_pixel(cx - half_l * 0.9 * c, cy - half_l * 0.9 * s), _to_pixel(cx + half_l * 0.9 * c, cy + half_l * 0.9 * s))
    return PartFixture(np.clip(rgb, 0, 255).astype(np.uint8), polygons, axis, angle_deg)


def v11_config(fixture: PartFixture, **overrides: object) -> dict:
    """Config 1.1: scratches inside electrode A, parallel to the part's long axis (tests and examples)."""
    config: dict = {
        "version": "1.1",
        "seed": 42,
        "allow_overlap": False,
        "regions": [{"id": "electrode_a", "name": "전극 A", "kind": "include", "polygon": fixture.polygons["electrode_a"]}],
        "edge_margin_px": 2,
        "reference_line": {"start": fixture.axis[0], "end": fixture.axis[1]},
        "defects": [
            {
                "type": "scratch",
                "count": 2,
                "params": {"length_px": [20, 60], "width_px": [1, 2.5], "contrast": [0.2, 0.5], "curvature": 0.1, "orientation": {"mode": "parallel", "jitter_deg": 5}, "shading": {"mode": "local"}},
            }
        ],
    }
    config.update(overrides)
    return config
