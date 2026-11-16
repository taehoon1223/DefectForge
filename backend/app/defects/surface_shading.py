"""Surface-matched shading (config 1.1, ``shading.mode = "local"``) shared by scratches and pinholes.

Per patch pixel p, with the local statistics of the *source* (core/surface.py):

    μ   = local mean RGB,  Lμ = luma(μ),  σ = local luma std (floored)
    H   = Lμ (dark)  |  255 − Lμ (bright)                       headroom in luma levels
    ΔL  = min(max(c·H, min(r·σ, H)), H)                         c = contrast, r = min_texture_ratio
    Δ   = −ΔL · μ / max(Lμ, 1)                  (dark: a darker shade of the local colour)
        = +ΔL · (255 − μ) / max(255 − Lμ, 1)    (bright: toward white, a highlight)
    T   = clip(source + Δ, 0, 255)

The compositor applies out = in + alpha·(T − in), i.e. source + alpha·Δ: an offset, so the surface
texture under the defect stays visible. luma(Δ) = ∓ΔL exactly (before clipping); with no headroom
Δ = 0 and the proposal is rejected as "no_visible_change".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.core.surface import SurfaceAnalysis, luma
from app.defects.base import r4
from app.schemas.generation import ShadingSpec


@dataclass(frozen=True)
class SurfaceWindow:
    source: np.ndarray  # (h, w, 3) float32 source pixels under the patch (0 outside the image)
    mean: np.ndarray  # (h, w, 3) local mean RGB
    lum: np.ndarray  # (h, w) luma of the local mean
    std: np.ndarray  # (h, w) local luma std
    fallback: np.ndarray  # (h, w) bool
    flat: np.ndarray  # (h, w) bool


def source_patch(source: np.ndarray, x0: int, y0: int, size: tuple[int, int]) -> np.ndarray:
    """Float copy of the source under the patch; zeros outside the image (alpha is 0 there anyway)."""
    h, w = size
    out = np.zeros((h, w, 3), dtype=np.float32)
    height, width = source.shape[:2]
    ix0, iy0, ix1, iy1 = max(x0, 0), max(y0, 0), min(x0 + w, width), min(y0 + h, height)
    if ix0 < ix1 and iy0 < iy1:
        out[iy0 - y0 : iy1 - y0, ix0 - x0 : ix1 - x0] = source[iy0:iy1, ix0:ix1]
    return out


def surface_window(analysis: SurfaceAnalysis, source: np.ndarray, x0: int, y0: int, size: tuple[int, int]) -> SurfaceWindow:
    mean, std, fallback, flat = analysis.window(x0, y0, size)
    return SurfaceWindow(source_patch(source, x0, y0, size), mean, luma(mean), std, fallback, flat)


def shade(win: SurfaceWindow, polarity: str, contrast: float, min_texture_ratio: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(T, H, ΔL, texture floor) per pixel, by the formulas above."""
    mean, lum = win.mean, win.lum
    if polarity == "dark":
        headroom = np.maximum(lum, 0.0)
        direction = -mean / np.maximum(lum, 1.0)[..., None]
    else:
        headroom = np.maximum(255.0 - lum, 0.0)
        direction = (255.0 - mean) / np.maximum(255.0 - lum, 1.0)[..., None]
    floor = np.minimum(min_texture_ratio * win.std, headroom)
    delta = np.minimum(np.maximum(contrast * headroom, floor), headroom)
    target = np.clip(win.source + delta[..., None] * direction, 0.0, 255.0).astype(np.float32)
    return target, headroom, delta, floor


def mean_over(values: np.ndarray, support: np.ndarray) -> float:
    return r4(float(values[support].mean())) if support.any() else 0.0


def shading_info(
    spec: ShadingSpec, win: SurfaceWindow, contrast: float, headroom: np.ndarray, delta: np.ndarray, floor: np.ndarray, support: np.ndarray
) -> dict[str, Any]:
    """Instance metadata: the local surface and the applied change, averaged over ``support``."""
    return {
        "mode": "local",
        "window_sigma_px": spec.window_sigma_px,
        "min_texture_ratio": spec.min_texture_ratio,
        "local_mean_rgb": [r4(float(c)) for c in win.mean[support].mean(axis=0)] if support.any() else [0.0, 0.0, 0.0],
        "local_luma_mean": mean_over(win.lum, support),
        "local_luma_std": mean_over(win.std, support),
        "headroom_luma": mean_over(headroom, support),
        "delta_luma_mean": mean_over(delta, support),
        "delta_luma_max": r4(float(delta[support].max())) if support.any() else 0.0,
        "texture_floor_fraction": mean_over((floor > contrast * headroom).astype(np.float32), support),
        "fallback_fraction": mean_over(win.fallback.astype(np.float32), support),
        "flat_fraction": mean_over(win.flat.astype(np.float32), support),
    }
