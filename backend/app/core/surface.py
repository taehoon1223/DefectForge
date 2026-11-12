"""Local surface statistics for scratch surface matching (config 1.1).

Computed once per request on the *normalised source* RGB (never the image being composed), and only
from pixels of the stats domain (include regions minus exclude regions, or the whole image):

    valid(p)   = p ∈ domain and no channel is near clipping (≤ CLIP_LOW or ≥ CLIP_HIGH)
    g          = Gaussian window, σ = window_sigma_px (zero outside the analysed crop)
    W(p)       = (g * valid)(p)                                  — share of the window that is valid
    mean(p)    = (g * (valid·RGB))(p) / W(p)                     — normalised convolution: no background mixing
    std_L(p)   = sqrt((g * (valid·L²))/W − ((g * (valid·L))/W)²), L = 0.299R + 0.587G + 0.114B

Fallbacks (deterministic, recorded): where W(p) < MIN_SUPPORT the local statistics are replaced by
the global statistics of the valid domain pixels; when fewer than MIN_GLOBAL_VALID valid pixels exist
the global statistics use all domain pixels, saturated ones included. std_L is floored at
LUMA_STD_FLOOR so flat surfaces never produce divisions by ~0.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

ANALYSIS_VERSION = "1.0"
CLIP_LOW = 5
CLIP_HIGH = 250
MIN_SUPPORT = 0.2
MIN_GLOBAL_VALID = 16
LUMA_STD_FLOOR = 2.0
LUMA_WEIGHTS = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb @ LUMA_WEIGHTS


@dataclass(frozen=True)
class SurfaceAnalysis:
    x0: int
    y0: int
    mean_rgb: np.ndarray  # (h, w, 3) float32
    luma_std: np.ndarray  # (h, w) float32, floored
    fallback: np.ndarray  # (h, w) bool — global statistics were used
    flat: np.ndarray  # (h, w) bool — std floor was applied
    global_mean_rgb: np.ndarray  # (3,) float32
    global_luma_std: float
    summary: dict[str, Any]

    def window(self, x0: int, y0: int, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Statistics for an arbitrary patch; pixels outside the analysed crop get the global values."""
        h, w = shape
        mean = np.empty((h, w, 3), dtype=np.float32)
        mean[...] = self.global_mean_rgb
        std = np.full((h, w), self.global_luma_std, dtype=np.float32)
        fallback = np.ones((h, w), dtype=bool)
        flat = np.full((h, w), self.global_luma_std <= LUMA_STD_FLOOR, dtype=bool)

        ah, aw = self.luma_std.shape
        ix0, iy0 = max(x0, self.x0), max(y0, self.y0)
        ix1, iy1 = min(x0 + w, self.x0 + aw), min(y0 + h, self.y0 + ah)
        if ix0 < ix1 and iy0 < iy1:
            dst = (slice(iy0 - y0, iy1 - y0), slice(ix0 - x0, ix1 - x0))
            src = (slice(iy0 - self.y0, iy1 - self.y0), slice(ix0 - self.x0, ix1 - self.x0))
            mean[dst] = self.mean_rgb[src]
            std[dst] = self.luma_std[src]
            fallback[dst] = self.fallback[src]
            flat[dst] = self.flat[src]
        return mean, std, fallback, flat


def analyze_surface(source_rgb: np.ndarray, domain: np.ndarray, window_sigma_px: float) -> SurfaceAnalysis:
    ys, xs = np.nonzero(domain)
    if ys.size == 0:
        raise ValueError("analysis domain is empty")
    height, width = domain.shape
    pad = int(math.ceil(4.0 * window_sigma_px)) + 1
    x0, y0 = max(int(xs.min()) - pad, 0), max(int(ys.min()) - pad, 0)
    x1, y1 = min(int(xs.max()) + pad + 1, width), min(int(ys.max()) + pad + 1, height)

    rgb = source_rgb[y0:y1, x0:x1].astype(np.float32)
    dom = domain[y0:y1, x0:x1]
    saturated = ((rgb <= CLIP_LOW) | (rgb >= CLIP_HIGH)).any(axis=2)
    valid = dom & ~saturated
    lum = luma(rgb)

    def blur(a: np.ndarray) -> np.ndarray:
        return cv2.GaussianBlur(a, (0, 0), sigmaX=float(window_sigma_px), borderType=cv2.BORDER_CONSTANT)

    weight = valid.astype(np.float32)
    support = blur(weight)
    sum_rgb = blur(rgb * weight[..., None])
    sum_l = blur(lum * weight)
    sum_l2 = blur(lum * lum * weight)

    n_valid = int(valid.sum())
    global_from_saturated = n_valid < MIN_GLOBAL_VALID
    pool = rgb[dom] if global_from_saturated else rgb[valid]
    global_mean = pool.mean(axis=0).astype(np.float32)
    global_std = float(max(float(luma(pool).std()), LUMA_STD_FLOOR))

    ok = support >= MIN_SUPPORT
    safe = np.where(ok, support, 1.0).astype(np.float32)
    mean = sum_rgb / safe[..., None]
    mean_l = sum_l / safe
    std = np.sqrt(np.maximum(sum_l2 / safe - mean_l * mean_l, 0.0))
    mean[~ok] = global_mean
    std[~ok] = global_std
    flat = std < LUMA_STD_FLOOR
    std = np.maximum(std, LUMA_STD_FLOOR).astype(np.float32)
    fallback = ~ok

    n_domain = int(dom.sum())
    summary = {
        "version": ANALYSIS_VERSION,
        "source": "normalised source RGB (before any synthesis)",
        "window_sigma_px": float(window_sigma_px),
        "clip_thresholds": [CLIP_LOW, CLIP_HIGH],
        "min_support": MIN_SUPPORT,
        "luma_std_floor": LUMA_STD_FLOOR,
        "domain_pixel_count": n_domain,
        "valid_pixel_count": n_valid,
        "saturated_pixel_fraction": round(float((dom & saturated).sum()) / n_domain, 4),
        "fallback_pixel_fraction": round(float((dom & fallback).sum()) / n_domain, 4),
        "flat_pixel_fraction": round(float((dom & flat).sum()) / n_domain, 4),
        "global_mean_rgb": [round(float(c), 4) for c in global_mean],
        "global_luma_std": round(global_std, 4),
        "global_stats_include_saturated": global_from_saturated,
    }
    for array in (mean, std, fallback, flat):
        array.setflags(write=False)
    return SurfaceAnalysis(x0, y0, mean, std, fallback, flat, global_mean, global_std, summary)
