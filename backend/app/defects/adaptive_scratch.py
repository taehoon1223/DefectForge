"""Scratch for config 1.1: the 1.0 scratch plus direction and surface-matching options.

Shape: identical to the 1.0 scratch (shared ``sample_scratch_shape``/``scratch_profile``); only the
angle source differs by ``orientation.mode``:

    random                            angle = U(angle_deg range)              (exactly the 1.0 draw)
    parallel / perpendicular / absolute angle = (base_angle + U(−jitter, +jitter)) mod 180

Appearance with ``shading.mode = "local"`` — per patch pixel p, using statistics of the *source*:

    μ   = local mean RGB,  Lμ = luma(μ),  σ = local luma std (floored, see core/surface.py)
    H   = Lμ (dark)  |  255 − Lμ (bright)                       headroom in luma levels
    ΔL  = min(max(c·H, min(r·σ, H)), H)                         c = sampled contrast, r = min_texture_ratio
    Δ   = −ΔL · μ / max(Lμ, 1)                  (dark: a darker shade of the local colour)
        = +ΔL · (255 − μ) / max(255 − Lμ, 1)    (bright: toward white, a highlight)
    T   = clip(source + Δ, 0, 255),   alpha = coverage · taper · along · grain

The compositor applies out = in + alpha·(T − in), i.e. source + alpha·Δ where nothing was applied
before. luma(Δ) = ∓ΔL exactly (before clipping). With no headroom (bright on a saturated surface,
dark on black) Δ = 0, the proposal changes nothing and is rejected as "no_visible_change".
``shading.mode = "fixed"`` reproduces the 1.0 appearance (alpha·contrast toward black/white), so
random + fixed consumes the random stream exactly like the 1.0 generator and gives the same pixels.
This is an appearance heuristic driven by local image statistics, not a lighting or 3D model.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.core.surface import SurfaceAnalysis, luma
from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4
from app.defects.raster import grain
from app.defects.scratch import GRAIN_STRENGTH, ScratchShape, sample_scratch_shape, scratch_profile, shape_params
from app.schemas.generation import AdaptiveScratchParams, ShadingSpec

ADAPTIVE_SCRATCH_VERSION = "1.0"


def _source_patch(source: np.ndarray, x0: int, y0: int, size: tuple[int, int]) -> np.ndarray:
    """Float copy of the source under the patch; zeros outside the image (alpha is 0 there anyway)."""
    h, w = size
    out = np.zeros((h, w, 3), dtype=np.float32)
    height, width = source.shape[:2]
    ix0, iy0, ix1, iy1 = max(x0, 0), max(y0, 0), min(x0 + w, width), min(y0 + h, height)
    if ix0 < ix1 and iy0 < iy1:
        out[iy0 - y0 : iy1 - y0, ix0 - x0 : ix1 - x0] = source[iy0:iy1, ix0:ix1]
    return out


def _mean_over(values: np.ndarray, support: np.ndarray) -> float:
    return r4(float(values[support].mean())) if support.any() else 0.0


class AdaptiveScratchGenerator(DefectGenerator):
    type_name = "scratch"
    class_id = 1

    def __init__(
        self,
        source_rgb: np.ndarray,
        analysis: SurfaceAnalysis | None,
        base_angle_deg: float | None,  # None for orientation mode "random"
        distance_to_edge: np.ndarray,
    ) -> None:
        self.source = source_rgb
        self.analysis = analysis
        self.base_angle = base_angle_deg
        self.distance_to_edge = distance_to_edge

    def render(
        self, rng: np.random.Generator, params: AdaptiveScratchParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        jitter = params.orientation.jitter_deg
        base = self.base_angle
        offsets: list[float] = []

        def draw_angle(r: np.random.Generator) -> float:
            if base is None:
                return float(r.uniform(*params.angle_deg))
            offsets.append(float(r.uniform(-jitter, jitter)))
            return (base + offsets[-1]) % 180.0

        shape = sample_scratch_shape(
            rng, params.length_px, params.width_px, draw_angle, params.contrast, params.polarity, params.curvature, center_xy
        )
        early = ctx.precheck(shape.points)
        if early is not None:
            return early

        x0, y0, size, coverage, taper, along = scratch_profile(rng, shape)
        noise = grain(rng, size, GRAIN_STRENGTH)
        if params.shading.mode == "fixed":
            alpha = finalize_alpha(coverage * shape.contrast * taper * along * noise)
            target = np.full(3, 0.0 if shape.polarity == "dark" else 255.0, dtype=np.float32)
            shading: dict[str, Any] = {"mode": "fixed"}
        else:
            alpha = finalize_alpha(coverage * taper * along * noise)
            target, shading = self._local_target(x0, y0, size, shape, params.shading, alpha > 0)

        sampled = {
            **shape_params(shape),
            "generator": "adaptive_scratch",
            "orientation_mode": params.orientation.mode,
            "base_angle_deg": None if base is None else r4(base),
            "angle_offset_deg": r4(offsets[0]) if offsets else None,
            "min_edge_distance_px": self._min_edge_distance(x0, y0, alpha > 0),
            "shading": shading,
        }
        center = shape.center
        return RenderedDefect(x0, y0, [EffectLayer(alpha, target)], sampled, (float(center[0]), float(center[1])))

    def _local_target(
        self, x0: int, y0: int, size: tuple[int, int], shape: ScratchShape, spec: ShadingSpec, support: np.ndarray
    ) -> tuple[np.ndarray, dict[str, Any]]:
        assert self.analysis is not None
        mean, std, fallback, flat = self.analysis.window(x0, y0, size)
        source = _source_patch(self.source, x0, y0, size)
        lum = luma(mean)
        if shape.polarity == "dark":
            headroom = np.maximum(lum, 0.0)
            direction = -mean / np.maximum(lum, 1.0)[..., None]
        else:
            headroom = np.maximum(255.0 - lum, 0.0)
            direction = (255.0 - mean) / np.maximum(255.0 - lum, 1.0)[..., None]
        floor = np.minimum(spec.min_texture_ratio * std, headroom)
        delta = np.minimum(np.maximum(shape.contrast * headroom, floor), headroom)
        target = np.clip(source + delta[..., None] * direction, 0.0, 255.0).astype(np.float32)

        info = {
            "mode": "local",
            "window_sigma_px": spec.window_sigma_px,
            "min_texture_ratio": spec.min_texture_ratio,
            "local_mean_rgb": [r4(float(c)) for c in mean[support].mean(axis=0)] if support.any() else [0.0, 0.0, 0.0],
            "local_luma_mean": _mean_over(lum, support),
            "local_luma_std": _mean_over(std, support),
            "headroom_luma": _mean_over(headroom, support),
            "delta_luma_mean": _mean_over(delta, support),
            "delta_luma_max": r4(float(delta[support].max())) if support.any() else 0.0,
            "texture_floor_fraction": _mean_over((floor > shape.contrast * headroom).astype(np.float32), support),
            "fallback_fraction": _mean_over(fallback.astype(np.float32), support),
            "flat_fraction": _mean_over(flat.astype(np.float32), support),
        }
        return target, info

    def _min_edge_distance(self, x0: int, y0: int, support: np.ndarray) -> float:
        height, width = self.distance_to_edge.shape
        h, w = support.shape
        ix0, iy0, ix1, iy1 = max(x0, 0), max(y0, 0), min(x0 + w, width), min(y0 + h, height)
        if ix0 >= ix1 or iy0 >= iy1:
            return 0.0
        inner = support[iy0 - y0 : iy1 - y0, ix0 - x0 : ix1 - x0]
        if not inner.any():
            return 0.0
        return r4(float(self.distance_to_edge[iy0:iy1, ix0:ix1][inner].min()))
