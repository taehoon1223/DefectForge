"""Applies defect proposals to the working image and keeps label maps pixel-exact.

Invariants maintained here (spec section 5):
* every proposal is blended and *quantised to uint8 immediately*, so "changed" is decided on the
  same integer values that end up in the PNG;
* pixels outside the ROI are never written;
* a class / instance label is written only where that instance actually changed the RGB value,
  so later instances win on overlap;
* ``finalize`` recomputes ``binary = any(out != src)`` and zeroes labels wherever binary == 0.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.defects.base import DefectContext, EffectLayer, RenderedDefect

_DILATE_3x3 = np.ones((3, 3), dtype=np.uint8)


def blend_layers(patch: np.ndarray, layers: list[EffectLayer]) -> np.ndarray:
    out = patch.astype(np.float32)
    for layer in layers:
        out += layer.alpha[..., None] * (layer.target - out)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


@dataclass(frozen=True)
class Applied:
    changed_pixel_count: int
    bbox_xyxy: list[int]  # inclusive


@dataclass(frozen=True)
class FinalOutput:
    image: np.ndarray  # (H, W, 3) uint8
    class_mask: np.ndarray  # (H, W) uint8, 0..3
    binary_mask: np.ndarray  # (H, W) uint8, 0/255
    instance_map: np.ndarray  # (H, W) uint16, 0 = none


class CompositeCanvas:
    def __init__(self, source_rgb: np.ndarray, roi_mask: np.ndarray, allow_overlap: bool) -> None:
        h, w = roi_mask.shape
        self.source = source_rgb
        self.image = np.array(source_rgb, copy=True)
        self.roi = roi_mask
        self.allow_overlap = allow_overlap
        self.class_mask = np.zeros((h, w), dtype=np.uint8)
        self.instance_map = np.zeros((h, w), dtype=np.uint16)
        self.occupied = np.zeros((h, w), dtype=bool)
        image_view, occupied_view = self.image.view(), self.occupied.view()
        image_view.setflags(write=False)
        occupied_view.setflags(write=False)
        self.context = DefectContext(image=image_view, roi_mask=roi_mask, occupied=occupied_view, allow_overlap=allow_overlap)

    def try_apply(self, rendered: RenderedDefect, class_id: int, instance_id: int) -> Applied | str:
        """Apply if valid, else return a rejection reason without touching any state."""
        height, width = self.roi.shape
        ph, pw = rendered.shape
        x0, y0 = rendered.x0, rendered.y0
        cx0, cy0, cx1, cy1 = max(x0, 0), max(y0, 0), min(x0 + pw, width), min(y0 + ph, height)
        if cx0 >= cx1 or cy0 >= cy1:
            return "out_of_image"
        sy, sx = slice(cy0 - y0, cy1 - y0), slice(cx0 - x0, cx1 - x0)

        support = rendered.support()
        inner = support[sy, sx]
        if int(inner.sum()) != int(support.sum()):
            return "out_of_image"  # would be clipped by the image border
        win = (slice(cy0, cy1), slice(cx0, cx1))
        roi = self.roi[win]
        if (inner & ~roi).any():
            return "outside_roi"  # would be clipped by the ROI
        if not self.allow_overlap and (inner & self.occupied[win]).any():
            return "overlap"

        layers = [
            EffectLayer(layer.alpha[sy, sx], layer.target[sy, sx] if layer.target.ndim == 3 else layer.target)
            for layer in rendered.layers
        ]
        before = self.image[win]
        after = blend_layers(before, layers)
        after = np.where((inner & roi)[..., None], after, before)
        changed = np.any(after != before, axis=2)
        count = int(changed.sum())
        if count == 0:
            return "no_visible_change"

        before[...] = after
        self.class_mask[win][changed] = class_id
        self.instance_map[win][changed] = instance_id
        self._mark_occupied(inner, cx0, cy0)
        ys, xs = np.nonzero(changed)
        return Applied(count, [cx0 + int(xs.min()), cy0 + int(ys.min()), cx0 + int(xs.max()), cy0 + int(ys.max())])

    def _mark_occupied(self, support: np.ndarray, x0: int, y0: int) -> None:
        """Occupy the support grown by 1px so non-overlapping instances never touch."""
        height, width = self.occupied.shape
        h, w = support.shape
        ex0, ey0, ex1, ey1 = max(x0 - 1, 0), max(y0 - 1, 0), min(x0 + w + 1, width), min(y0 + h + 1, height)
        grown = np.zeros((ey1 - ey0, ex1 - ex0), dtype=np.uint8)
        grown[y0 - ey0 : y0 - ey0 + h, x0 - ex0 : x0 - ex0 + w] = support
        self.occupied[ey0:ey1, ex0:ex1] |= cv2.dilate(grown, _DILATE_3x3).astype(bool)

    def finalize(self) -> FinalOutput:
        binary = np.any(self.image != self.source, axis=2)
        class_mask = np.where(binary, self.class_mask, 0).astype(np.uint8)
        instance_map = np.where(binary, self.instance_map, 0).astype(np.uint16)
        return FinalOutput(self.image, class_mask, binary.astype(np.uint8) * np.uint8(255), instance_map)
