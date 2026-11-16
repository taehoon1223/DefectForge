"""Real defect (config 1.1): a labelled defect from an uploaded sample, moved onto the surface.

Each exemplar (core/samples.py) holds ``delta`` = sample - estimated background inside the defect.
Per instance:

    exemplar ~ uniform over every defect of every sample
    scale ~ U(params.scale), intensity ~ U(params.intensity)
    rotation "free": angle ~ U(0, 360), mirrored with p = 0.5;  "keep": angle 0, never mirrored
    A = scale · R(angle) · (mirrored ? diag(-1, 1) : I), exemplar centre -> placement pixel centre
    w = warp(mask), d = warp(delta)   bilinear; delta is 0 outside the defect, so d fades out with w
    support = w > ALPHA_EPS, target = current + intensity · d, alpha = 1 on the support

The new surface keeps its own colour and texture, the defect keeps its shape and shading, and only
the pixels the transferred change actually alters end up in the mask (compositor rule). Each instance
keeps its sample's label class k: class-mask id = REAL_CLASS_OFFSET + k.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import TYPE_CHECKING

import cv2
import numpy as np

from app.defects.base import ALPHA_EPS, DefectContext, DefectGenerator, EffectLayer, Rejected, RenderedDefect, r4
from app.schemas.generation import RealParams

if TYPE_CHECKING:
    from app.core.samples import Exemplar

REAL_DEFECT_VERSION = "1.1"
REAL_CLASS_OFFSET = 6  # class-mask id of label class 0; ids 1-5 are the rule-based types


def _window(image: np.ndarray, x0: int, y0: int, width: int, height: int) -> np.ndarray:
    """float32 copy of image[y0:y0+h, x0:x0+w]; zeros where the window leaves the image."""
    out = np.zeros((height, width, 3), dtype=np.float32)
    ih, iw = image.shape[:2]
    ix0, iy0, ix1, iy1 = max(x0, 0), max(y0, 0), min(x0 + width, iw), min(y0 + height, ih)
    if ix0 < ix1 and iy0 < iy1:
        out[iy0 - y0 : iy1 - y0, ix0 - x0 : ix1 - x0] = image[iy0:iy1, ix0:ix1]
    return out


class RealDefectGenerator(DefectGenerator):
    type_name = "real"
    class_id = REAL_CLASS_OFFSET  # per instance: REAL_CLASS_OFFSET + the exemplar's label class

    def __init__(self, exemplars: Sequence[Exemplar], class_names: Sequence[str]) -> None:
        self.exemplars = exemplars
        self.class_names = class_names

    def render(
        self, rng: np.random.Generator, params: RealParams, center_xy: tuple[float, float], ctx: DefectContext
    ) -> RenderedDefect | Rejected:
        exemplar = self.exemplars[int(rng.integers(len(self.exemplars)))]
        scale = float(rng.uniform(*params.scale))
        intensity = float(rng.uniform(*params.intensity))
        if params.rotation == "free":
            angle = float(rng.uniform(0.0, 360.0))
            mirrored = bool(rng.random() < 0.5)
        else:
            angle, mirrored = 0.0, False

        theta = math.radians(angle)
        c, s = math.cos(theta), math.sin(theta)
        a = scale * np.array([[c, -s], [s, c]]) @ np.diag([-1.0 if mirrored else 1.0, 1.0])
        h, w = exemplar.mask.shape
        # Exemplar centre on a whole pixel (cv2 puts pixel k's centre at k) and the placement snapped to
        # a pixel centre: without rotation at scale 1 the shift is integral, so the copy is exact.
        centre = np.array([(w - 1) // 2, (h - 1) // 2], dtype=np.float64)
        corners = np.array([[-0.5, -0.5], [w - 0.5, -0.5], [w - 0.5, h - 0.5], [-0.5, h - 0.5]]) - centre
        cx, cy = math.floor(center_xy[0]) + 0.5, math.floor(center_xy[1]) + 0.5
        mapped = corners @ a.T + np.array([cx, cy])
        x0, y0 = math.floor(mapped[:, 0].min()) - 1, math.floor(mapped[:, 1].min()) - 1
        x1, y1 = math.ceil(mapped[:, 0].max()) + 1, math.ceil(mapped[:, 1].max()) + 1
        size = (x1 - x0, y1 - y0)
        # Continuous image point P is at cv2 coordinate P - (x0 + 0.5, y0 + 0.5) inside the patch.
        shift = np.array([cx - x0 - 0.5, cy - y0 - 0.5]) - a @ centre
        matrix = np.hstack([a, shift[:, None]])

        def warp(img: np.ndarray) -> np.ndarray:
            return cv2.warpAffine(img, matrix, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        support = warp(exemplar.mask) > ALPHA_EPS
        if not support.any():
            return Rejected("no_visible_change")
        target = _window(ctx.image, x0, y0, *size) + np.float32(intensity) * warp(exemplar.delta)

        sampled = {
            "sample_index": exemplar.sample_index,
            "defect_index": exemplar.defect_index,
            "label_class": exemplar.class_id,
            "class_name": self.class_names[exemplar.class_id],
            "scale": r4(scale),
            "intensity": r4(intensity),
            "rotation": params.rotation,
            "angle_deg": r4(angle),
            "mirrored": mirrored,
        }
        layer = EffectLayer(support.astype(np.float32), target)
        return RenderedDefect(x0, y0, [layer], sampled, (float(cx), float(cy)), REAL_CLASS_OFFSET + exemplar.class_id)
