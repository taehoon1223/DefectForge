"""V2 extension point — NOT implemented in the MVP (spec section 14).

A future ONNX Runtime / PatchCore adapter implements this protocol so the API can compare a model's
prediction against DefectForge's synthetic GT mask (pixel IoU / Dice, per-instance detection).
Model-specific shapes, preprocessing and postprocessing must stay inside the adapter.

Caveats to respect when implementing:
* PatchCore needs a memory bank built from a *set* of normal images; a pretrained backbone alone is
  not a valid detector for a single uploaded image.
* Image-level AUROC cannot be computed from one sample.
* Scores on synthetic defects do not replace evaluation on real production data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class InferenceResult:
    latency_ms: float
    anomaly_map: np.ndarray | None = None  # (H, W) float32, same size as the input
    score: float | None = None
    mask: np.ndarray | None = None  # (H, W) uint8, 0/255


class InferenceAdapter(Protocol):
    name: str

    def infer(self, image_rgb: np.ndarray) -> InferenceResult: ...
