from __future__ import annotations

import numpy as np
import pytest

from app.core.roi import build_roi_mask, find_self_intersection, polygon_area, segments_intersect, validate_roi
from app.error_codes import DefectForgeError, ErrorCode
from tests.helpers import RECT_ROI

W, H = 512, 448


def test_none_roi_is_full_image():  # T03
    roi = build_roi_mask(None, W, H)
    assert roi.mask.shape == (H, W)
    assert roi.mask.all()
    assert roi.pixel_count == W * H
    assert roi.points is None


def test_rectangle_mask_includes_boundary_pixels():
    roi = build_roi_mask(RECT_ROI, W, H)
    expected = np.zeros((H, W), bool)
    expected[40:401, 40:461] = True
    assert np.array_equal(roi.mask, expected)
    assert roi.pixel_count == 421 * 361


def test_concave_polygon_is_accepted_and_rasterised():
    l_shape = [[10, 10], [100, 10], [100, 40], [40, 40], [40, 100], [10, 100]]
    roi = build_roi_mask(l_shape, W, H)
    assert roi.mask[20, 20] and roi.mask[90, 20] and roi.mask[20, 90]
    assert not roi.mask[80, 80]  # inside the notch


@pytest.mark.parametrize(
    ("points", "fragment"),
    [
        ([], "비어"),
        ([[0, 0], [10, 10]], "최소 3개"),
        ([[0, 0], [W, 0], [0, 10]], "범위"),  # x == width is out of range
        ([[0, 0], [10, -1], [0, 10]], "범위"),
        ([[0, 0], [10, 10], [20, 20]], "면적"),  # collinear
        ([[10, 10], [10, 10], [50, 10], [10, 50]], "중복"),
        ([[10, 10], [100, 100], [100, 10], [10, 100]], "교차"),  # bow-tie
        ([[10, 10], [50, 10], [30, 10], [30, 40]], "교차"),  # collinear fold-back spike
    ],
)
def test_invalid_roi_rejected(points, fragment):  # T12 (empty / invalid ROI)
    with pytest.raises(DefectForgeError) as info:
        validate_roi(points, W, H)
    assert info.value.code is ErrorCode.INVALID_ROI
    assert fragment in info.value.message


def test_polygon_area_and_intersection_helpers():
    assert polygon_area([(0, 0), (10, 0), (10, 10), (0, 10)]) == 100
    assert segments_intersect((0, 0), (10, 10), (0, 10), (10, 0))
    assert not segments_intersect((0, 0), (10, 0), (0, 5), (10, 5))
    assert segments_intersect((0, 0), (10, 0), (5, 0), (15, 0))  # collinear overlap
    assert find_self_intersection([(0, 0), (10, 0), (10, 10), (0, 10)]) is None


def test_sampled_centres_lie_inside_roi():
    roi = build_roi_mask([[30, 30], [200, 60], [120, 300]], W, H)
    rng = np.random.default_rng(0)
    for _ in range(2000):
        x, y = roi.sample_center(rng)
        assert roi.mask[int(y), int(x)]
