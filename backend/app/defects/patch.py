"""Patch defect (config 1.1): a piece of the image moved elsewhere and Poisson-blended, after NSA.

NSA (Schlüter et al., ECCV 2022) blends rescaled patches from other images with Poisson image
editing so the synthetic anomaly has no visible seam. With a single input image, the patch comes
from another place in the same (untouched source) image, rescaled by ``scale`` and turned by
90° or 270° (maybe mirrored) so it breaks directional structure such as grinding marks:

    region = rotated ellipse, semi-axes (size/2, size/2 · aspect), aspect ∈ [0.5, 1]
    blended = cv2.seamlessClone(src_patch, current_window, region, flag)
              flag = NORMAL_CLONE ("source": the patch's own gradients)
                   | MIXED_CLONE  ("mixed": the stronger of patch and surface gradients)
    alpha = 1 where the region changed by more than 1 level (solver rounding is ignored), else 0
    target = blended

Pixels outside the region are therefore never touched; the mask is whatever actually changed.
"""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from app.defects.base import DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, r4
from app.defects.raster import pixel_centers
from app.schemas.generation import PatchParams

_MARGIN = 3  # seamlessClone needs a border of untouched destination pixels around the region
_SOLVER_NOISE = 1  # max |change| (levels) treated as seamlessClone rounding, not as defect
_FAR_TRIES = 8
_FLAGS = {"source": cv2.NORMAL_CLONE, "mixed": cv2.MIXED_CLONE}


class PatchGenerator(DefectGenerator):
    type_name = "patch"
    class_id = 5

    def __init__(self, source_rgb: np.ndarray) -> None:
        self.source = source_rgb  # patches come from the untouched source, never from earlier defects

    def render(
        self, rng: np.random.Generator, params: PatchParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        size = float(rng.uniform(*params.size_px))
        aspect = float(rng.uniform(0.5, 1.0))
        angle = float(rng.uniform(0.0, 180.0))
        scale = float(rng.uniform(*params.scale))
        cx, cy = center_xy
        ax, ay = size / 2.0, size / 2.0 * aspect
        theta = math.radians(angle)
        c, s = math.cos(theta), math.sin(theta)

        t = np.linspace(0.0, 2.0 * math.pi, 24, endpoint=False)
        outline = np.stack([cx + c * ax * np.cos(t) - s * ay * np.sin(t), cy + s * ax * np.cos(t) + c * ay * np.sin(t)], axis=1)
        early = ctx.precheck(np.vstack([outline, [[cx, cy]]]))
        if early is not None:
            return early

        half = int(math.ceil(ax)) + _MARGIN
        x0, y0 = int(math.floor(cx)) - half, int(math.floor(cy)) - half
        n = 2 * half + 1
        if x0 < 0 or y0 < 0 or x0 + n > ctx.width or y0 + n > ctx.height:
            return Rejected("out_of_image")

        gx, gy = pixel_centers(x0, y0, (n, n))
        u = (gx - cx) * c + (gy - cy) * s
        v = -(gx - cx) * s + (gy - cy) * c
        region = (u / ax) ** 2 + (v / ay) ** 2 <= 1.0
        if not region.any():
            return Rejected("no_visible_change")

        height, width = self.source.shape[:2]
        m = min(max(4, int(round(n / scale))), width, height)
        for _ in range(_FAR_TRIES):  # prefer content clearly away from the target spot
            sx, sy = int(rng.integers(0, width - m + 1)), int(rng.integers(0, height - m + 1))
            if math.hypot(sx + m / 2.0 - cx, sy + m / 2.0 - cy) >= size:
                break
        k = 1 if rng.random() < 0.5 else 3  # always a quarter turn, so directional grain is visibly broken
        mirrored = bool(rng.random() < 0.5)
        src = self.source[sy : sy + m, sx : sx + m]
        src = cv2.resize(src, (n, n), interpolation=cv2.INTER_AREA if m > n else cv2.INTER_LINEAR)
        src = np.rot90(src, k)
        if mirrored:
            src = src[:, ::-1]

        mask = region.astype(np.uint8) * 255
        bx, by, bw, bh = cv2.boundingRect(mask)
        dst = np.ascontiguousarray(ctx.image[y0 : y0 + n, x0 : x0 + n])
        blended = cv2.seamlessClone(np.ascontiguousarray(src), dst, mask, (bx + bw // 2, by + bh // 2), _FLAGS[params.blend])

        sampled: dict[str, Any] = {
            "size_px": r4(size),
            "aspect": r4(aspect),
            "angle_deg": r4(angle),
            "scale": r4(scale),
            "blend": params.blend,
            "source_xy": [sx, sy],
            "source_size_px": m,
            "rotation_deg": 90 * k,
            "mirrored": mirrored,
        }
        # The Poisson solver leaves ±1 rounding noise even where nothing should change (a flat surface
        # comes back with −1 steps); such pixels are not part of the defect and stay untouched.
        delta = np.abs(blended.astype(np.int16) - dst.astype(np.int16)).max(axis=2)
        significant = region & (delta > _SOLVER_NOISE)
        if not significant.any():
            return Rejected("no_visible_change")
        alpha = significant.astype(np.float32)
        return RenderedDefect(x0, y0, [EffectLayer(alpha, blended.astype(np.float32))], sampled, (float(cx), float(cy)))
