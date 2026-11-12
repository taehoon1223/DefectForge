"""DefectGenerator extension point.

A generator turns (rng, sampled params, centre) into a local *effect*: one or more alpha layers that
pull pixels toward a target colour. It never writes to the image; the compositor decides whether the
proposal is valid (inside image, inside ROI, no overlap, visible change) and applies it.

To add a defect type: subclass DefectGenerator, give it a unique ``type_name``/``class_id``, add its
params schema in ``app/schemas/generation.py`` and register it in ``app/defects/__init__.py``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar

import numpy as np

# Alpha below this can never change an integer pixel value (|a * (t - x)| < 0.25 for 8-bit data),
# so it is zeroed to keep each defect's support compact and exact.
ALPHA_EPS = 1.0 / 1024.0


@dataclass(frozen=True)
class EffectLayer:
    """``out = in + alpha * (target - in)`` evaluated per pixel inside the patch."""

    alpha: np.ndarray  # (h, w) float32 in [0, 1]
    target: np.ndarray  # (3,) or (h, w, 3) float32 RGB


@dataclass
class RenderedDefect:
    x0: int  # patch top-left in image pixel coordinates (may be negative; compositor crops/rejects)
    y0: int
    layers: list[EffectLayer]
    params: dict[str, Any]  # actually-sampled, JSON-serialisable parameters
    center_xy: tuple[float, float]

    @property
    def shape(self) -> tuple[int, int]:
        return self.layers[0].alpha.shape  # type: ignore[return-value]

    def support(self) -> np.ndarray:
        out = np.zeros(self.shape, dtype=bool)
        for layer in self.layers:
            out |= layer.alpha > 0
        return out


@dataclass(frozen=True)
class Rejected:
    """Cheap early rejection (before rasterisation). ``reason`` is one of REJECTION_REASONS."""

    reason: str


REJECTION_REASONS = ("out_of_image", "outside_roi", "overlap", "no_visible_change")


@dataclass(frozen=True)
class DefectContext:
    """Read-only view of the composition state offered to generators."""

    image: np.ndarray  # current working image (H, W, 3) uint8 — read-only
    roi_mask: np.ndarray  # (H, W) bool
    occupied: np.ndarray  # (H, W) bool, already-used area (dilated by 1px)
    allow_overlap: bool

    @property
    def width(self) -> int:
        return int(self.roi_mask.shape[1])

    @property
    def height(self) -> int:
        return int(self.roi_mask.shape[0])

    def precheck(self, points_xy: np.ndarray) -> Rejected | None:
        """Necessary-condition test on key geometry points (continuous coords)."""
        px = np.floor(points_xy).astype(np.int64)
        x, y = px[:, 0], px[:, 1]
        if (x < 0).any() or (y < 0).any() or (x >= self.width).any() or (y >= self.height).any():
            return Rejected("out_of_image")
        if not self.roi_mask[y, x].all():
            return Rejected("outside_roi")
        if not self.allow_overlap and self.occupied[y, x].any():
            return Rejected("overlap")
        return None


class DefectGenerator(ABC):
    type_name: ClassVar[str]
    class_id: ClassVar[int]

    @abstractmethod
    def render(
        self,
        rng: np.random.Generator,
        params: Any,
        center_xy: tuple[float, float],
        ctx: DefectContext,
    ) -> RenderedDefect | Rejected:
        """Sample one instance at ``center_xy``. Must draw randomness only from ``rng``."""


def resolve_polarity(rng: np.random.Generator, polarity: str) -> str:
    if polarity == "random":
        return "dark" if rng.random() < 0.5 else "bright"
    return polarity


def finalize_alpha(alpha: np.ndarray) -> np.ndarray:
    alpha = np.clip(alpha, 0.0, 1.0).astype(np.float32, copy=False)
    alpha[alpha < ALPHA_EPS] = 0.0
    return alpha


def r4(value: float) -> float:
    return round(float(value), 4)
