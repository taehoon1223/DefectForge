"""Contamination: dust / foreign matter / local stain as an irregular multi-lobe blob."""

from __future__ import annotations

import math

import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4, resolve_polarity
from app.defects.raster import blur_margin, gaussian_blur, grain, harmonic_outline, low_freq_noise, patch_bounds, rasterize_polygons
from app.schemas.generation import ContaminationParams

_COVERAGE_CUTOFF = 0.02


class ContaminationGenerator(DefectGenerator):
    type_name = "contamination"
    class_id = 3

    def render(
        self, rng: np.random.Generator, params: ContaminationParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        radius = float(rng.uniform(*params.radius_px))
        opacity = float(rng.uniform(*params.opacity))
        irregularity = params.irregularity
        sigma = params.blur_sigma
        polarity = resolve_polarity(rng, params.polarity)
        center = np.asarray(center_xy, dtype=np.float64)

        main, _ = harmonic_outline(rng, radius, irregularity, range(2, 8), 0.25, 0.3, 96)
        lobes = [center + main]
        extra_lobes = int(rng.integers(0, int(round(3 * irregularity)) + 1))
        for _ in range(extra_lobes):
            angle = rng.uniform(0.0, 2.0 * math.pi)
            dist = rng.uniform(0.35, 0.85) * radius
            outline, _ = harmonic_outline(rng, radius * rng.uniform(0.3, 0.65), irregularity, range(2, 8), 0.25, 0.3, 64)
            lobes.append(center + np.array([dist * math.cos(angle), dist * math.sin(angle)]) + outline)
        all_points = np.vstack(lobes)

        early = ctx.precheck(np.vstack([all_points, center[None, :]]))
        if early is not None:
            return early

        x0, y0, x1, y1 = patch_bounds(all_points, blur_margin(sigma) + 2.0)
        shape = (y1 - y0, x1 - x0)
        offset = np.array([x0, y0])
        coverage = gaussian_blur(rasterize_polygons([lobe - offset for lobe in lobes], shape), sigma)  # feathering
        coverage[coverage < _COVERAGE_CUTOFF] = 0.0  # drop imperceptible blur tails that would bloat the mask
        density = low_freq_noise(rng, shape, grid=5, lo=0.45, hi=1.0)
        alpha = finalize_alpha(opacity * coverage * density * grain(rng, shape, 0.06))

        if polarity == "dark":  # brownish-grey dirt
            v = rng.uniform(25.0, 75.0)
            target = np.array([v * rng.uniform(1.0, 1.25), v * rng.uniform(0.95, 1.1), v * rng.uniform(0.75, 0.95)])
        else:  # whitish residue
            v = rng.uniform(225.0, 255.0)
            target = np.array([v, v, v * rng.uniform(0.94, 1.0)])
        target = np.clip(target, 0.0, 255.0).astype(np.float32)

        sampled = {
            "radius_px": r4(radius),
            "opacity": r4(opacity),
            "irregularity": irregularity,
            "blur_sigma": sigma,
            "polarity": polarity,
            "lobes": 1 + extra_lobes,
            "color_rgb": [r4(c) for c in target],
        }
        return RenderedDefect(x0, y0, [EffectLayer(alpha, target)], sampled, (float(center[0]), float(center[1])))
