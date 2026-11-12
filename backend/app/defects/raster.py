"""Anti-aliased rasterisation helpers shared by generators.

Continuous coordinate convention: pixel ``i`` covers ``[i, i+1)``; its centre is ``i + 0.5``.
Shapes are drawn on an ``s``-times supersampled canvas and box-filtered down, which gives exact
fractional coverage (anti-aliasing) and sub-pixel widths without depending on cv2.LINE_AA.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

SUPERSAMPLE = 4
_SHIFT = 4
_ONE = 1 << _SHIFT


def _to_fixed(points_xy: np.ndarray, s: int) -> np.ndarray:
    # cv2 puts supersampled pixel k's centre at integer k, i.e. continuous u -> u*s - 0.5.
    return np.rint((np.asarray(points_xy, dtype=np.float64) * s - 0.5) * _ONE).astype(np.int32).reshape(-1, 1, 2)


def _downsample(canvas: np.ndarray, s: int) -> np.ndarray:
    h, w = canvas.shape[0] // s, canvas.shape[1] // s
    return canvas.reshape(h, s, w, s).mean(axis=(1, 3), dtype=np.float32) / np.float32(255.0)


def rasterize_polyline(points_xy: np.ndarray, width_px: float, shape_hw: tuple[int, int], s: int = SUPERSAMPLE) -> np.ndarray:
    h, w = shape_hw
    canvas = np.zeros((h * s, w * s), dtype=np.uint8)
    thickness = max(1, int(round(width_px * s)))
    cv2.polylines(canvas, [_to_fixed(points_xy, s)], False, 255, thickness=thickness, lineType=cv2.LINE_8, shift=_SHIFT)
    return _downsample(canvas, s)


def rasterize_polygons(polygons_xy: list[np.ndarray], shape_hw: tuple[int, int], s: int = SUPERSAMPLE) -> np.ndarray:
    """Union of filled polygons (each filled separately so overlaps never become holes)."""
    h, w = shape_hw
    canvas = np.zeros((h * s, w * s), dtype=np.uint8)
    for poly in polygons_xy:
        cv2.fillPoly(canvas, [_to_fixed(poly, s)], 255, lineType=cv2.LINE_8, shift=_SHIFT)
    return _downsample(canvas, s)


def gaussian_blur(image: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return image
    return cv2.GaussianBlur(image, (0, 0), sigmaX=float(sigma), borderType=cv2.BORDER_CONSTANT)


def blur_margin(sigma: float) -> int:
    # cv2 uses a kernel radius of ~4 sigma for float images.
    return int(math.ceil(4.0 * sigma)) if sigma > 0 else 0


def low_freq_noise(rng: np.random.Generator, shape_hw: tuple[int, int], grid: int, lo: float, hi: float) -> np.ndarray:
    h, w = shape_hw
    coarse = rng.uniform(lo, hi, size=(grid, grid)).astype(np.float32)
    return np.clip(cv2.resize(coarse, (w, h), interpolation=cv2.INTER_CUBIC), lo, hi)


def grain(rng: np.random.Generator, shape_hw: tuple[int, int], strength: float) -> np.ndarray:
    return np.clip(1.0 + strength * rng.standard_normal(shape_hw, dtype=np.float32), 0.0, 2.0)


def pixel_centers(x0: int, y0: int, shape_hw: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Continuous image coordinates of every patch pixel centre."""
    h, w = shape_hw
    xs = np.arange(w, dtype=np.float32) + np.float32(x0 + 0.5)
    ys = np.arange(h, dtype=np.float32) + np.float32(y0 + 0.5)
    return np.meshgrid(xs, ys)


def patch_bounds(points_xy: np.ndarray, margin: float) -> tuple[int, int, int, int]:
    """Integer patch [x0, x1) x [y0, y1) covering points +- margin."""
    x0 = int(math.floor(points_xy[:, 0].min() - margin))
    y0 = int(math.floor(points_xy[:, 1].min() - margin))
    x1 = int(math.ceil(points_xy[:, 0].max() + margin)) + 1
    y1 = int(math.ceil(points_xy[:, 1].max() + margin)) + 1
    return x0, y0, x1, y1


def harmonic_outline(
    rng: np.random.Generator,
    radius: float,
    irregularity: float,
    harmonics: range,
    amp_scale: float,
    aspect_spread: float,
    n_points: int,
) -> tuple[np.ndarray, dict[str, float]]:
    """Closed, randomly perturbed ellipse outline as offsets from its centre."""
    k = np.arange(harmonics.start, harmonics.stop, dtype=np.float64)
    amps = irregularity * rng.uniform(-amp_scale, amp_scale, size=k.size) / np.power(k - 1.0, 0.7)
    phases = rng.uniform(0.0, 2.0 * math.pi, size=k.size)
    aspect = 1.0 + irregularity * rng.uniform(-aspect_spread, aspect_spread)
    rotation = rng.uniform(0.0, math.pi)
    phi = np.linspace(0.0, 2.0 * math.pi, n_points, endpoint=False)
    rho = 1.0 + (amps[:, None] * np.cos(k[:, None] * phi[None, :] + phases[:, None])).sum(axis=0)
    rho = np.clip(rho, 0.45, 1.6)
    ax, ay = radius * math.sqrt(aspect), radius / math.sqrt(aspect)
    ex, ey = ax * rho * np.cos(phi), ay * rho * np.sin(phi)
    c, s = math.cos(rotation), math.sin(rotation)
    outline = np.stack([c * ex - s * ey, s * ex + c * ey], axis=1)
    return outline, {"semi_axes": (ax, ay), "rotation": rotation, "aspect": aspect}
