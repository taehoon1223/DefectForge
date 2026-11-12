"""Texture defect (config 1.1): a Perlin-noise blob filled with a foreign texture, after DRAEM.

DRAEM (Zavrtanik et al., ICCV 2021) thresholds Perlin noise into an anomaly mask and blends in a
texture from an external dataset. Here the blob is local (a radial falloff keeps it compact around
the sampled centre) and the texture comes from the image itself or from noise, so no extra dataset
is needed:

    field = radial + amp · fractal_noise · √radial,   radial = clip(1 − (d / r)², 0, 1),  amp = 0.15 + 0.6·roughness
    shape = clip((field − 0.35) / 0.1, 0, 1)        (a ~1–2 px soft edge)
    alpha = opacity · shape,   target = texture
    texture "self"  = the same image elsewhere, rotated by k·90°, maybe mirrored, contrast/brightness jittered
    texture "noise" = local source mean colour, tinted, ± amp · fractal noise

The compositor applies out = in + alpha·(target − in); the mask is whatever actually changed.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, finalize_alpha, r4
from app.defects.noise import fractal
from app.defects.raster import pixel_centers
from app.schemas.generation import TextureParams

_THRESHOLD = 0.35
_SOFTNESS = 0.1
_FAR_TRIES = 8


class TextureGenerator(DefectGenerator):
    type_name = "texture"
    class_id = 4

    def __init__(self, source_rgb: np.ndarray) -> None:
        self.source = source_rgb  # textures come from the untouched source, never from earlier defects

    def render(
        self, rng: np.random.Generator, params: TextureParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        radius = float(rng.uniform(*params.radius_px))
        opacity = float(rng.uniform(*params.opacity))
        cells = 2 + int(round(params.roughness * 4))
        cx, cy = center_xy
        half = int(math.ceil(radius)) + 2
        x0, y0 = int(math.floor(cx)) - half, int(math.floor(cy)) - half
        size = 2 * half + 1

        noise = fractal(rng, (size, size), cells)
        gx, gy = pixel_centers(x0, y0, (size, size))
        radial = np.clip(1.0 - (np.hypot(gx - cx, gy - cy) / radius) ** 2, 0.0, 1.0)
        field = radial + (0.15 + 0.6 * params.roughness) * noise * np.sqrt(radial)
        shape = np.clip((field - _THRESHOLD) / _SOFTNESS, 0.0, 1.0)
        if not (shape > 0).any():
            return Rejected("no_visible_change")
        alpha = finalize_alpha(opacity * shape)

        if params.source == "self" and size <= min(self.source.shape[0], self.source.shape[1]):
            target, info = self._self_texture(rng, x0, y0, size, radius)
        else:
            target, info = self._noise_texture(rng, x0, y0, size, cells)

        sampled: dict[str, Any] = {
            "radius_px": r4(radius),
            "opacity": r4(opacity),
            "roughness": params.roughness,
            "noise_cells": cells,
            **info,
        }
        return RenderedDefect(x0, y0, [EffectLayer(alpha, target)], sampled, (float(cx), float(cy)))

    def _self_texture(self, rng: np.random.Generator, x0: int, y0: int, size: int, radius: float) -> tuple[np.ndarray, dict[str, Any]]:
        height, width = self.source.shape[:2]
        for _ in range(_FAR_TRIES):  # prefer content clearly away from the defect itself
            sx, sy = int(rng.integers(0, width - size + 1)), int(rng.integers(0, height - size + 1))
            if math.hypot(sx - x0, sy - y0) >= 2.0 * radius:
                break
        patch = self.source[sy : sy + size, sx : sx + size].astype(np.float32)
        k = int(rng.integers(0, 4))
        flipped = bool(rng.random() < 0.5)
        patch = np.rot90(patch, k)
        if flipped:
            patch = patch[:, ::-1]
        contrast = float(rng.uniform(0.6, 1.6))
        brightness = float(rng.uniform(-30.0, 30.0))
        mean = patch.mean(axis=(0, 1))
        target = np.clip((patch - mean) * contrast + mean + brightness, 0.0, 255.0).astype(np.float32)
        info = {
            "source": "self",
            "source_xy": [sx, sy],
            "rotation_deg": 90 * k,
            "mirrored": flipped,
            "contrast": r4(contrast),
            "brightness": r4(brightness),
        }
        return np.ascontiguousarray(target), info

    def _noise_texture(self, rng: np.random.Generator, x0: int, y0: int, size: int, cells: int) -> tuple[np.ndarray, dict[str, Any]]:
        height, width = self.source.shape[:2]
        ix0, iy0, ix1, iy1 = max(x0, 0), max(y0, 0), min(x0 + size, width), min(y0 + size, height)
        window = self.source[iy0:iy1, ix0:ix1] if ix0 < ix1 and iy0 < iy1 else self.source
        base = window.reshape(-1, 3).astype(np.float32).mean(axis=0)
        tint = rng.uniform(0.85, 1.15, size=3).astype(np.float32)
        amplitude = float(rng.uniform(25.0, 70.0))
        noise = fractal(rng, (size, size), cells * 2)
        target = np.clip(base * tint + amplitude * noise[..., None], 0.0, 255.0).astype(np.float32)
        info = {
            "source": "noise",
            "base_rgb": [r4(c) for c in base * tint],
            "amplitude": r4(amplitude),
        }
        return target, info
