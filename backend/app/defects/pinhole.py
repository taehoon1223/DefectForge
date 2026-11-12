"""Pinhole-like appearance: a small bright/dark spot with an optional shallow opposite-polarity rim.

This is an appearance model only; it does not simulate the physical optics of a through-hole.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4, resolve_polarity
from app.defects.raster import blur_margin, gaussian_blur, grain, harmonic_outline, patch_bounds, pixel_centers, rasterize_polygons
from app.schemas.generation import PinholeParams

_RING_CUTOFF = 0.1  # fraction of the rim peak


class PinholeGenerator(DefectGenerator):
    type_name = "pinhole"
    class_id = 2

    def render(
        self, rng: np.random.Generator, params: PinholeParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        radius = float(rng.uniform(*params.radius_px))
        contrast = float(rng.uniform(*params.contrast))
        polarity = resolve_polarity(rng, params.polarity)
        outline, info = harmonic_outline(rng, radius, params.irregularity, range(2, 6), 0.18, 0.35, 72)
        center = np.asarray(center_xy, dtype=np.float64)
        boundary = center + outline

        early = ctx.precheck(np.vstack([boundary, center[None, :]]))
        if early is not None:
            return early

        rim = params.rim_strength
        rim_width = max(1.0, 0.45 * radius) if rim > 0 else 0.0
        rim_sigma = max(0.6, 0.6 * rim_width) if rim > 0 else 0.0
        x0, y0, x1, y1 = patch_bounds(boundary, rim_width + blur_margin(rim_sigma) + 2.0)
        shape = (y1 - y0, x1 - x0)
        coverage = rasterize_polygons([boundary - np.array([x0, y0])], shape)

        # Centre-weighted profile in the ellipse's own frame.
        gx, gy = pixel_centers(x0, y0, shape)
        ax, ay = info["semi_axes"]
        c, s = math.cos(info["rotation"]), math.sin(info["rotation"])
        dx, dy = gx - center[0], gy - center[1]
        u, v = c * dx + s * dy, -s * dx + c * dy
        profile = np.clip(1.0 - 0.5 * ((u / ax) ** 2 + (v / ay) ** 2), 0.4, 1.0)
        core_alpha = finalize_alpha(contrast * coverage * profile * grain(rng, shape, 0.08))

        dark = np.zeros(3, dtype=np.float32)
        bright = np.full(3, 255.0, dtype=np.float32)
        core_target, rim_target = (dark, bright) if polarity == "dark" else (bright, dark)

        layers: list[EffectLayer] = []
        if rim > 0:
            k = 2 * int(math.ceil(rim_width)) + 1
            grown = gaussian_blur(cv2.dilate(coverage, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))), rim_sigma)
            ring = np.clip(grown - coverage, 0.0, 1.0)
            peak = float(ring.max())
            if peak > 0:
                ring /= peak
                ring[ring < _RING_CUTOFF] = 0.0  # drop imperceptible blur tails that would bloat the mask
                layers.append(EffectLayer(finalize_alpha(rim * contrast * 0.5 * ring), rim_target))
        layers.append(EffectLayer(core_alpha, core_target))  # core last so it dominates its own pixels

        sampled = {
            "radius_px": r4(radius),
            "semi_axes_px": [r4(ax), r4(ay)],
            "rotation_deg": r4(math.degrees(info["rotation"])),
            "irregularity": params.irregularity,
            "contrast": r4(contrast),
            "polarity": polarity,
            "rim_strength": rim,
            "rim_width_px": r4(rim_width),
        }
        return RenderedDefect(x0, y0, layers, sampled, (float(center[0]), float(center[1])))
