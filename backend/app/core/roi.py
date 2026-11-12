"""ROI polygon validation and rasterisation.

Coordinates are integer pixel indices ``[x, y]`` of the normalised image (0 <= x < W, 0 <= y < H).
The rasterised ROI includes the pixels the polygon boundary passes through.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np

from app.error_codes import DefectForgeError, ErrorCode

Point = tuple[int, int]


def _roi_error(message: str, **details: object) -> DefectForgeError:
    return DefectForgeError(ErrorCode.INVALID_ROI, message, dict(details))


def polygon_area(points: Sequence[Point]) -> float:
    """Signed shoelace area."""
    pts = np.asarray(points, dtype=np.float64)
    x, y = pts[:, 0], pts[:, 1]
    return float(0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _orient(a: Point, b: Point, c: Point) -> int:
    v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return (v > 0) - (v < 0)


def _on_segment(a: Point, b: Point, p: Point) -> bool:
    return min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])


def segments_intersect(p1: Point, p2: Point, p3: Point, p4: Point) -> bool:
    """True if closed segments p1p2 and p3p4 share at least one point."""
    o1, o2, o3, o4 = _orient(p1, p2, p3), _orient(p1, p2, p4), _orient(p3, p4, p1), _orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    return (
        (o1 == 0 and _on_segment(p1, p2, p3))
        or (o2 == 0 and _on_segment(p1, p2, p4))
        or (o3 == 0 and _on_segment(p3, p4, p1))
        or (o4 == 0 and _on_segment(p3, p4, p2))
    )


def find_self_intersection(points: Sequence[Point]) -> tuple[int, int] | None:
    """Return indices of the first pair of edges that intersect improperly, else None."""
    n = len(points)
    edges = [(points[i], points[(i + 1) % n]) for i in range(n)]
    for i in range(n):
        a1, a2 = edges[i]
        for j in range(i + 1, n):
            b1, b2 = edges[j]
            adjacent = j == i + 1 or (i == 0 and j == n - 1)
            if adjacent:
                # Shared vertex is fine; a collinear fold-back ("spike") is not.
                shared, a_other, b_other = (a2, a1, b2) if j == i + 1 else (a1, a2, b1)
                if _orient(a_other, shared, b_other) == 0:
                    da = (a_other[0] - shared[0], a_other[1] - shared[1])
                    db = (b_other[0] - shared[0], b_other[1] - shared[1])
                    if da[0] * db[0] + da[1] * db[1] > 0:
                        return (i, j)
                continue
            if segments_intersect(a1, a2, b1, b2):
                return (i, j)
    return None


def validate_roi(points: Sequence[Sequence[int]] | None, width: int, height: int) -> list[Point] | None:
    if points is None:
        return None
    pts: list[Point] = [(int(p[0]), int(p[1])) for p in points]
    if len(pts) == 0:
        raise _roi_error("ROI가 비어 있습니다. 다각형을 3개 이상의 점으로 그리거나 ROI를 삭제해 전체 이미지를 사용하세요.")
    if len(pts) < 3:
        raise _roi_error("ROI 다각형은 최소 3개의 점이 필요합니다.", point_count=len(pts))
    outside = [i for i, (x, y) in enumerate(pts) if not (0 <= x < width and 0 <= y < height)]
    if outside:
        raise _roi_error(
            f"ROI 점이 이미지 범위(0~{width - 1}, 0~{height - 1})를 벗어났습니다.",
            point_indices=outside,
        )
    for i in range(len(pts)):
        if pts[i] == pts[(i + 1) % len(pts)]:
            raise _roi_error("ROI에 연속으로 중복된 점이 있습니다.", point_index=i)
    zero_area_message = "ROI 다각형의 면적이 0입니다. 한 직선 위에 있지 않은 점들로 그려주세요."
    if all(_orient(pts[0], pts[1], p) == 0 for p in pts[2:]):
        raise _roi_error(zero_area_message)
    # Self-intersection before area: a symmetric bow-tie has zero signed area but "crossing" is the real problem.
    crossing = find_self_intersection(pts)
    if crossing is not None:
        raise _roi_error("ROI 다각형의 변이 서로 교차합니다. 자기 교차가 없는 단순 다각형으로 그려주세요.", edges=list(crossing))
    if abs(polygon_area(pts)) <= 0:
        raise _roi_error(zero_area_message)
    return pts


@dataclass(frozen=True)
class RoiMask:
    mask: np.ndarray  # (H, W) bool
    flat_indices: np.ndarray  # flat indices of ROI pixels, for uniform sampling
    points: list[Point] | None

    @property
    def pixel_count(self) -> int:
        return int(self.flat_indices.size)

    def sample_center(self, rng: np.random.Generator) -> tuple[float, float]:
        """Uniform ROI pixel + sub-pixel jitter, as continuous coords (pixel i spans [i, i+1))."""
        width = self.mask.shape[1]
        y, x = divmod(int(self.flat_indices[rng.integers(self.flat_indices.size)]), width)
        jx, jy = rng.random(2)
        return (x + float(jx), y + float(jy))


def build_roi_mask(points: Sequence[Sequence[int]] | None, width: int, height: int) -> RoiMask:
    pts = validate_roi(points, width, height)
    if pts is None:
        mask = np.ones((height, width), dtype=bool)
    else:
        canvas = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(canvas, [np.asarray(pts, dtype=np.int32).reshape(-1, 1, 2)], 1, lineType=cv2.LINE_8)
        mask = canvas.astype(bool)
    flat = np.flatnonzero(mask)
    if flat.size == 0:  # unreachable for a validated polygon, kept as a hard guard
        raise _roi_error("ROI 영역에 포함된 픽셀이 없습니다.")
    mask.setflags(write=False)
    return RoiMask(mask=mask, flat_indices=flat, points=pts)
