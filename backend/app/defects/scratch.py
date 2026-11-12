"""Scratch: linear surface damage along a (weakly) curved polyline.

``sample_scratch_shape`` and ``scratch_profile`` are shared with the surface-adaptive scratch
(config 1.1). They keep the exact random-number order and arithmetic of the 1.0 generator, so
config 1.0 output is bit-identical (see tests/test_regression_v1.py).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4, resolve_polarity
from app.defects.raster import grain, patch_bounds, pixel_centers, rasterize_polyline
from app.schemas.generation import ScratchParams

_CONTROL_POINTS = 7  # along-length intensity variation
GRAIN_STRENGTH = 0.15


@dataclass(frozen=True)
class ScratchShape:
    length: float
    width: float
    angle: float
    contrast: float
    polarity: str
    curvature: float
    bend: float
    wiggle: float
    center: np.ndarray  # (2,) continuous image coords
    direction: np.ndarray  # (2,) unit vector of the chord
    points: np.ndarray  # (n, 2) polyline


def sample_scratch_shape(
    rng: np.random.Generator,
    length_range: tuple[float, float],
    width_range: tuple[float, float],
    draw_angle: Callable[[np.random.Generator], float],
    contrast_range: tuple[float, float],
    polarity: str,
    curvature: float,
    center_xy: tuple[float, float],
) -> ScratchShape:
    length = float(rng.uniform(*length_range))
    width = float(rng.uniform(*width_range))
    angle = draw_angle(rng)
    contrast = float(rng.uniform(*contrast_range))
    resolved = resolve_polarity(rng, polarity)
    # curvature=1 allows a sagitta of up to L/4 plus a small S-shaped component.
    bend = curvature * float(rng.uniform(-0.25, 0.25)) * length
    wiggle = curvature * float(rng.uniform(-0.06, 0.06)) * length

    n = int(np.clip(length / 3.0, 8, 160))
    t = np.linspace(0.0, 1.0, n)
    theta = math.radians(angle)
    direction = np.array([math.cos(theta), math.sin(theta)])
    normal = np.array([-direction[1], direction[0]])
    lateral = bend * (np.sin(np.pi * t) - 2.0 / np.pi) + wiggle * np.sin(2.0 * np.pi * t)
    center = np.asarray(center_xy, dtype=np.float64)
    points = center + ((t - 0.5) * length)[:, None] * direction + lateral[:, None] * normal
    return ScratchShape(length, width, angle, contrast, resolved, curvature, bend, wiggle, center, direction, points)


def scratch_profile(rng: np.random.Generator, shape: ScratchShape) -> tuple[int, int, tuple[int, int], np.ndarray, np.ndarray, np.ndarray]:
    """Patch origin/size, anti-aliased coverage, end taper and along-length variation (draws 7 uniforms)."""
    x0, y0, x1, y1 = patch_bounds(shape.points, shape.width / 2.0 + 2.0)
    size = (y1 - y0, x1 - x0)
    coverage = rasterize_polyline(shape.points - np.array([x0, y0]), shape.width, size)

    # Position along the scratch (0..1) for each pixel: ends fade, intensity varies smoothly.
    gx, gy = pixel_centers(x0, y0, size)
    center, direction = shape.center, shape.direction
    s = np.clip(((gx - center[0]) * direction[0] + (gy - center[1]) * direction[1]) / shape.length + 0.5, 0.0, 1.0)
    taper = 0.35 + 0.65 * np.clip(np.minimum(s, 1.0 - s) / 0.15, 0.0, 1.0)
    along = np.interp(s, np.linspace(0.0, 1.0, _CONTROL_POINTS), rng.uniform(0.55, 1.0, size=_CONTROL_POINTS))
    return x0, y0, size, coverage, taper, along


def shape_params(shape: ScratchShape) -> dict:
    return {
        "length_px": r4(shape.length),
        "width_px": r4(shape.width),
        "angle_deg": r4(shape.angle),
        "contrast": r4(shape.contrast),
        "polarity": shape.polarity,
        "curvature": shape.curvature,
        "bend_px": r4(shape.bend),
        "wiggle_px": r4(shape.wiggle),
        "start_xy": [r4(shape.points[0, 0]), r4(shape.points[0, 1])],
        "end_xy": [r4(shape.points[-1, 0]), r4(shape.points[-1, 1])],
    }


class ScratchGenerator(DefectGenerator):
    type_name = "scratch"
    class_id = 1

    def render(
        self, rng: np.random.Generator, params: ScratchParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        shape = sample_scratch_shape(
            rng,
            params.length_px,
            params.width_px,
            lambda r: float(r.uniform(*params.angle_deg)),
            params.contrast,
            params.polarity,
            params.curvature,
            center_xy,
        )
        early = ctx.precheck(shape.points)
        if early is not None:
            return early

        x0, y0, size, coverage, taper, along = scratch_profile(rng, shape)
        alpha = finalize_alpha(coverage * shape.contrast * taper * along * grain(rng, size, GRAIN_STRENGTH))
        target = np.full(3, 0.0 if shape.polarity == "dark" else 255.0, dtype=np.float32)
        center = shape.center
        return RenderedDefect(x0, y0, [EffectLayer(alpha, target)], shape_params(shape), (float(center[0]), float(center[1])))
