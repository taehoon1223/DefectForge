"""Pinhole for config 1.1: the 1.0 pinhole plus surface matching.

Shape (outline, centre-weighted profile, grain, rim ring) is the 1.0 pinhole's, drawn from the random
stream in the same order, so "fixed" and "local" give the same spots at the same places.

``shading.mode = "local"`` uses the scratch formulas of defects/surface_shading.py on the local
statistics of the *source*:

    core:  alpha = coverage · profile · grain,   ΔL = min(max(c·H, min(r·σ, H)), H)   (polarity)
    rim:   alpha = ring,                         ΔL = (rim · c / 2) · H'               (opposite polarity, no floor)

c = sampled contrast, r = min_texture_ratio, H / H' = local headroom toward the core / rim polarity.
Like the 1.0 rim (alpha rim·c/2 toward the opposite colour), the rim stays a shallow halo. The change
is an offset, so the surface texture stays visible inside the spot. ``"fixed"`` is the 1.0 appearance
(toward black/white), so a 1.1 request without "local" gives exactly the 1.0 pixels.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.core.surface import SurfaceAnalysis
from app.defects.base import EffectLayer, finalize_alpha
from app.defects.pinhole import PinholeGenerator, PinholeSpot
from app.defects.surface_shading import shade, shading_info, surface_window
from app.schemas.generation import AdaptivePinholeParams

ADAPTIVE_PINHOLE_VERSION = "1.0"


class AdaptivePinholeGenerator(PinholeGenerator):
    def __init__(self, source_rgb: np.ndarray, analysis: SurfaceAnalysis | None) -> None:
        self.source = source_rgb
        self.analysis = analysis  # required for shading "local"

    def _layers(self, spot: PinholeSpot, params: AdaptivePinholeParams) -> tuple[list[EffectLayer], dict[str, Any] | None]:
        spec = params.shading
        if spec.mode == "fixed":
            layers, _ = super()._layers(spot, params)
            return layers, {"mode": "fixed"}

        assert self.analysis is not None
        win = surface_window(self.analysis, self.source, spot.x0, spot.y0, spot.coverage.shape)
        core_alpha = finalize_alpha(spot.coverage * spot.profile * spot.noise)
        core_target, headroom, delta, floor = shade(win, spot.polarity, spot.contrast, spec.min_texture_ratio)

        layers: list[EffectLayer] = []
        if spot.ring is not None:
            opposite = "bright" if spot.polarity == "dark" else "dark"
            rim_target, *_ = shade(win, opposite, spot.rim * spot.contrast * 0.5, 0.0)
            layers.append(EffectLayer(finalize_alpha(spot.ring), rim_target))
        layers.append(EffectLayer(core_alpha, core_target))  # core last so it dominates its own pixels
        return layers, shading_info(spec, win, spot.contrast, headroom, delta, floor, core_alpha > 0)
