"""Generation area for config 1.1: include/exclude regions and the edge margin.

    include = union of all include polygons (the whole image when there is none)
    base    = include − union of all exclude polygons
    allowed = base pixels whose Euclidean distance to the nearest pixel outside ``base``
              (the image border counts as outside) is greater than ``edge_margin_px``

Every defect's full support must lie inside ``allowed`` (checked by the compositor, never clipped).
Surface statistics for scratch surface matching come from ``base`` (the margin only limits
placement). Every step is a set operation, so the order of ``regions`` never changes the result;
names never enter any computation or hash.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.core.roi import RoiMask, rasterize_polygon, validate_roi
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import RegionSpec

REGION_GEOMETRY_VERSION = "1.0"
RASTERIZATION_RULE = "cv2.fillPoly LINE_8 on integer pixel vertices, boundary pixels included"
MARGIN_RULE = "keep pixels whose L2 distance (cv2.distanceTransform, DIST_MASK_PRECISE) to the nearest pixel outside include − exclude, image border included, is > edge_margin_px"


def mask_sha256(mask: np.ndarray) -> str:
    """Hash of a boolean mask's pixels and shape (independent of names, colours or list order)."""
    h, w = mask.shape
    return hashlib.sha256(f"{h}x{w}:".encode() + np.packbits(mask.astype(bool), axis=None).tobytes()).hexdigest()


def geometry_sha256(regions: list[dict[str, Any]]) -> str:
    """Order-independent hash of (kind, polygon) pairs."""
    canonical = sorted(json.dumps([r["kind"], r["polygon"]], separators=(",", ":")) for r in regions)
    return hashlib.sha256("\n".join(canonical).encode()).hexdigest()


@dataclass(frozen=True)
class AreaGeometry:
    stats_domain: np.ndarray  # (H, W) bool — include − exclude; feeds surface statistics
    allowed: RoiMask  # final placement area (support of every defect must stay inside)
    distance_to_edge: np.ndarray  # (H, W) float32 — distance used for the margin, 0 outside base
    metadata: dict[str, Any]


def prepare_area(regions: list[RegionSpec], edge_margin_px: float, width: int, height: int) -> AreaGeometry:
    ids = [r.id for r in regions]
    duplicated = sorted({i for i in ids if ids.count(i) > 1})
    if duplicated:
        raise DefectForgeError(ErrorCode.INVALID_REGION, f"영역 ID가 중복되었습니다: {', '.join(duplicated)}", {"duplicated_ids": duplicated})

    include = np.zeros((height, width), dtype=bool)
    exclude = np.zeros((height, width), dtype=bool)
    described: list[dict[str, Any]] = []
    for region in regions:
        points = validate_roi(region.polygon, width, height, label=f"영역 '{region.name}'", code=ErrorCode.INVALID_REGION)
        assert points is not None
        mask = rasterize_polygon(points, width, height)
        (include if region.kind == "include" else exclude)[mask] = True
        described.append(
            {
                "id": region.id,
                "kind": region.kind,
                "polygon": [list(p) for p in points],
                "pixel_count": int(mask.sum()),
                "mask_sha256": mask_sha256(mask),
            }
        )
    full_image = not any(r.kind == "include" for r in regions)
    if full_image:
        include[:] = True

    base = include & ~exclude
    padded = np.pad(base.astype(np.uint8), 1)  # zero ring: the image border is a boundary too
    distance = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    allowed_mask = base & (distance > edge_margin_px)

    area = {
        "full_image": full_image,
        "include_pixel_count": int(include.sum()),
        "excluded_pixel_count": int((include & exclude).sum()),
        "base_pixel_count": int(base.sum()),
        "base_mask_sha256": mask_sha256(base),
        "allowed_pixel_count": int(allowed_mask.sum()),
        "allowed_mask_sha256": mask_sha256(allowed_mask),
    }
    if not allowed_mask.any():
        raise DefectForgeError(
            ErrorCode.EMPTY_ALLOWED_AREA,
            "결함을 놓을 수 있는 영역이 비어 있습니다. 제외 영역이 생성 영역을 모두 덮지 않는지, 경계 여유 거리가 너무 크지 않은지 확인하세요.",
            {**area, "edge_margin_px": edge_margin_px},
        )

    metadata = {
        "version": REGION_GEOMETRY_VERSION,
        "regions": described,
        "region_geometry_sha256": geometry_sha256(described),
        "edge_margin_px": edge_margin_px,
        **area,
        "rasterization": RASTERIZATION_RULE,
        "margin_rule": MARGIN_RULE,
    }
    distance = distance.astype(np.float32)
    distance.setflags(write=False)
    base.setflags(write=False)
    return AreaGeometry(stats_domain=base, allowed=RoiMask.from_mask(allowed_mask, None), distance_to_edge=distance, metadata=metadata)
