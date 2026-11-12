"""Scratch: linear surface damage along a (weakly) curved polyline."""

from __future__ import annotations

import math

import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4, resolve_polarity
from app.defects.raster import grain, patch_bounds, pixel_centers, rasterize_polyline
from app.schemas.generation import ScratchParams

_CONTROL_POINTS = 7  # along-length intensity variation


class ScratchGenerator(DefectGenerator):
    type_name = "scratch"
    class_id = 1

    def render(
        self, rng: np.random.Generator, params: ScratchParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        length = float(rng.uniform(*params.length_px))
        width = float(rng.uniform(*params.width_px))
        angle = float(rng.uniform(*params.angle_deg))
        contrast = float(rng.uniform(*params.contrast))
        polarity = resolve_polarity(rng, params.polarity)
        # curvature=1 allows a sagitta of up to L/4 plus a small S-shaped component.
        bend = params.curvature * float(rng.uniform(-0.25, 0.25)) * length
        wiggle = params.curvature * float(rng.uniform(-0.06, 0.06)) * length

        n = int(np.clip(length / 3.0, 8, 160))
        t = np.linspace(0.0, 1.0, n)
        theta = math.radians(angle)
        direction = np.array([math.cos(theta), math.sin(theta)])
        normal = np.array([-direction[1], direction[0]])
        lateral = bend * (np.sin(np.pi * t) - 2.0 / np.pi) + wiggle * np.sin(2.0 * np.pi * t)
        center = np.asarray(center_xy, dtype=np.float64)
        points = center + ((t - 0.5) * length)[:, None] * direction + lateral[:, None] * normal

        early = ctx.precheck(points)
        if early is not None:
            return early

        x0, y0, x1, y1 = patch_bounds(points, width / 2.0 + 2.0)
        shape = (y1 - y0, x1 - x0)
        coverage = rasterize_polyline(points - np.array([x0, y0]), width, shape)

        # Position along the scratch (0..1) for each pixel: ends fade, intensity varies smoothly.
        gx, gy = pixel_centers(x0, y0, shape)
        s = np.clip(((gx - center[0]) * direction[0] + (gy - center[1]) * direction[1]) / length + 0.5, 0.0, 1.0)
        taper = 0.35 + 0.65 * np.clip(np.minimum(s, 1.0 - s) / 0.15, 0.0, 1.0)
        along = np.interp(s, np.linspace(0.0, 1.0, _CONTROL_POINTS), rng.uniform(0.55, 1.0, size=_CONTROL_POINTS))
        alpha = finalize_alpha(coverage * contrast * taper * along * grain(rng, shape, 0.15))

        target = np.full(3, 0.0 if polarity == "dark" else 255.0, dtype=np.float32)
        sampled = {
            "length_px": r4(length),
            "width_px": r4(width),
            "angle_deg": r4(angle),
            "contrast": r4(contrast),
            "polarity": polarity,
            "curvature": params.curvature,
            "bend_px": r4(bend),
            "wiggle_px": r4(wiggle),
            "start_xy": [r4(points[0, 0]), r4(points[0, 1])],
            "end_xy": [r4(points[-1, 0]), r4(points[-1, 1])],
        }
        return RenderedDefect(x0, y0, [EffectLayer(alpha, target)], sampled, (float(center[0]), float(center[1])))
