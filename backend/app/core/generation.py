"""Pure-Python generation pipeline (no HTTP dependency).

validate -> normalise (image_io) -> ROI mask -> rng(seed) -> per instance: sample centre, render,
validate+apply (up to 100 attempts) -> finalize masks -> metadata.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config import APP_VERSION, CONFIG_VERSION
from app.core.compositor import Applied, CompositeCanvas
from app.core.image_io import SourceImage
from app.core.roi import RoiMask, build_roi_mask
from app.defects import CLASS_MAP, GENERATORS
from app.defects.base import REJECTION_REASONS, Rejected, r4
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import GenerationConfig

MAX_PLACEMENT_ATTEMPTS = 100

TYPE_LABELS_KO = {"scratch": "스크래치", "pinhole": "핀홀", "contamination": "오염"}

_HINTS_KO = {
    "out_of_image": "결함이 이미지 경계 밖으로 잘립니다. 길이·반지름을 줄이세요.",
    "outside_roi": "결함이 ROI 안에 완전히 들어가지 않습니다. ROI를 넓히거나 길이·반지름을 줄이세요.",
    "overlap": "기존 결함과 겹치지 않는 위치를 찾지 못했습니다. 개수·크기를 줄이거나 '겹침 허용'을 켜세요.",
    "no_visible_change": "현재 극성/대비로는 픽셀 값이 바뀌지 않습니다(예: 흰 배경에 밝은 결함). 극성이나 대비를 바꾸세요.",
}


@dataclass(frozen=True)
class GenerationResult:
    image: np.ndarray
    class_mask: np.ndarray
    binary_mask: np.ndarray
    instance_map: np.ndarray
    metadata: dict[str, Any]


def _placement_error(defect_type: str, index: int, requested: int, reasons: Counter[str], placed: int) -> DefectForgeError:
    # Explain every cause behind at least 20% of the rejections, most frequent first.
    ranked = sorted(REJECTION_REASONS, key=lambda r: -reasons.get(r, 0))
    causes = [r for r in ranked if reasons.get(r, 0) >= 0.2 * MAX_PLACEMENT_ATTEMPTS] or ranked[:1]
    label = TYPE_LABELS_KO[defect_type]
    return DefectForgeError(
        ErrorCode.DEFECT_PLACEMENT_FAILED,
        f"{label} 결함 {requested}개 중 {index + 1}번째를 {MAX_PLACEMENT_ATTEMPTS}회 시도했지만 배치하지 못했습니다. "
        + " ".join(_HINTS_KO[c] for c in causes),
        {
            "defect_type": defect_type,
            "instance_index": index + 1,
            "requested": requested,
            "attempts": MAX_PLACEMENT_ATTEMPTS,
            "rejections": {r: reasons.get(r, 0) for r in REJECTION_REASONS},
            "placed_before_failure": placed,
        },
    )


def generate_sample(
    source: SourceImage,
    config: GenerationConfig,
    seed: int,
    roi: RoiMask | None = None,
) -> GenerationResult:
    """Deterministic for a given (source pixels, config, seed). Raises DefectForgeError on failure."""
    if roi is None:
        roi = build_roi_mask(config.roi, source.width, source.height)
    rng = np.random.default_rng(seed)
    canvas = CompositeCanvas(source.rgb, roi.mask, config.allow_overlap)
    instances: list[dict[str, Any]] = []

    for spec in config.defects:
        generator = GENERATORS[spec.type]
        for index in range(spec.count):
            reasons: Counter[str] = Counter()
            for attempt in range(1, MAX_PLACEMENT_ATTEMPTS + 1):
                center = roi.sample_center(rng)
                proposal = generator.render(rng, spec.params, center, canvas.context)
                if isinstance(proposal, Rejected):
                    reasons[proposal.reason] += 1
                    continue
                outcome = canvas.try_apply(proposal, generator.class_id, len(instances) + 1)
                if not isinstance(outcome, Applied):
                    reasons[outcome] += 1
                    continue
                instances.append(
                    {
                        "id": len(instances) + 1,
                        "class_id": generator.class_id,
                        "type": spec.type,
                        "bbox_xyxy": outcome.bbox_xyxy,
                        "center_xy": [r4(proposal.center_xy[0]), r4(proposal.center_xy[1])],
                        "changed_pixel_count": outcome.changed_pixel_count,
                        "attempts": attempt,
                        "params": proposal.params,
                    }
                )
                break
            else:
                raise _placement_error(spec.type, index, spec.count, reasons, len(instances))

    final = canvas.finalize()
    class_counts = np.bincount(final.class_mask.ravel(), minlength=len(CLASS_MAP))
    metadata = {
        "version": CONFIG_VERSION,
        "engine_version": APP_VERSION,
        "seed": int(seed),
        "source_sha256": source.sha256,
        "width": source.width,
        "height": source.height,
        "class_map": dict(CLASS_MAP),
        "bbox_format": "xyxy_inclusive",
        "roi": [list(p) for p in roi.points] if roi.points is not None else None,
        "roi_pixel_count": roi.pixel_count,
        "allow_overlap": config.allow_overlap,
        "requested_count": config.requested_count,
        "generated_count": len(instances),
        "changed_pixel_count": int(np.count_nonzero(final.binary_mask)),
        "class_pixel_counts": {name: int(class_counts[int(cid)]) for cid, name in CLASS_MAP.items() if cid != "0"},
        "instances": instances,
        "config": config.model_dump(mode="json"),
    }
    return GenerationResult(final.image, final.class_mask, final.binary_mask, final.instance_map, metadata)
