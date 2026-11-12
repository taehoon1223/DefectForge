"""Config 1.1 area rules: include union, exclusions, margin, image border, order/name independence, errors."""

from __future__ import annotations

import random

import numpy as np
import pytest

from app.core.generation_v11 import line_angle_deg
from app.core.regions import mask_sha256, prepare_area
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import GenerationConfigV11
from tests.v11_helpers import box, config, exclude, include, margin_area, part, polygon_mask


def _area(cfg: dict, source):
    parsed = GenerationConfigV11.model_validate(cfg)
    return prepare_area(parsed.regions, parsed.edge_margin_px, source.width, source.height)


def test_allowed_area_is_union_of_includes_minus_excludes_and_margin():
    fixture, source = part()
    a, b = fixture.polygons["electrode_a"], fixture.polygons["electrode_b"]
    ax, ay = [p[0] for p in a], [p[1] for p in a]
    bx, by = [p[0] for p in b], [p[1] for p in b]
    hole = box(min(ax) + 20, min(ay) + 30, min(ax) + 50, min(ay) + 70)
    bite = box(min(bx) - 10, min(by) - 10, min(bx) + 30, max(by) + 10)  # also reaches outside electrode B
    regions = [include("a", a), include("b", b), exclude("hole", hole), exclude("bite", bite)]
    geom = _area(config(fixture, edge_margin_px=3, regions=regions), source)

    union = polygon_mask(a, source) | polygon_mask(b, source)
    base = union & ~polygon_mask(hole, source) & ~polygon_mask(bite, source)
    expected = margin_area(base, 3.0)
    assert np.array_equal(geom.allowed.mask, expected)
    assert np.array_equal(geom.stats_domain, base)  # the margin limits placement only
    meta = geom.metadata
    assert meta["full_image"] is False
    assert meta["include_pixel_count"] == int(union.sum())
    assert meta["excluded_pixel_count"] == int(union.sum() - base.sum()) > 0
    assert meta["allowed_pixel_count"] == int(expected.sum())
    assert meta["allowed_mask_sha256"] == mask_sha256(expected)


def test_overlapping_includes_are_a_plain_union():
    fixture, source = part()
    r1, r2 = box(100, 100, 200, 200), box(150, 150, 260, 240)
    geom = _area(config(fixture, edge_margin_px=0, regions=[include("r1", r1), include("r2", r2)]), source)
    assert np.array_equal(geom.allowed.mask, polygon_mask(r1, source) | polygon_mask(r2, source))


@pytest.mark.parametrize("margin", [0, 4])
def test_no_include_region_means_the_whole_image(margin):
    fixture, source = part()
    hole = box(300, 300, 340, 330)
    geom = _area(config(fixture, edge_margin_px=margin, regions=[exclude("hole", hole)]), source)
    assert geom.metadata["full_image"] is True
    assert geom.metadata["include_pixel_count"] == source.width * source.height
    assert np.array_equal(geom.allowed.mask, margin_area(~polygon_mask(hole, source), margin))


def test_image_border_counts_as_boundary_for_the_margin():
    fixture, source = part()
    geom = _area(config(fixture, edge_margin_px=4, regions=[include("e", box(0, 0, 60, 60))]), source)
    ys, xs = np.nonzero(geom.allowed.mask)
    assert xs.min() >= 4 and ys.min() >= 4 and xs.max() <= 56 and ys.max() <= 56


def test_region_order_and_names_do_not_change_the_geometry():
    fixture, source = part(angle_deg=20)
    regions = [
        include("a", fixture.polygons["electrode_a"]),
        include("b", fixture.polygons["electrode_b"]),
        exclude("x1", [[150, 150], [170, 150], [170, 170]]),
    ]
    reference = _area(config(fixture, regions=regions), source).metadata
    rng = random.Random(0)
    for _ in range(4):
        shuffled = [dict(r, name=f"이름 {rng.random():.3f}") for r in regions]
        rng.shuffle(shuffled)
        meta = _area(config(fixture, regions=shuffled), source).metadata
        for key in ("allowed_mask_sha256", "base_mask_sha256", "allowed_pixel_count", "region_geometry_sha256"):
            assert meta[key] == reference[key]


@pytest.mark.parametrize(
    ("mutate", "code", "fragment"),
    [
        (lambda c: c["regions"].append(dict(c["regions"][0])), ErrorCode.INVALID_REGION, "중복"),
        (lambda c: c["regions"][0].update(polygon=[[10, 10], [100, 100], [100, 10], [10, 100]]), ErrorCode.INVALID_REGION, "영역 '전극 A' 다각형의 변이 서로 교차"),
        (lambda c: c["regions"][0].update(polygon=[[10, 10], [20, 20]]), ErrorCode.INVALID_REGION, "최소 3개"),
        (lambda c: c["regions"][0].update(polygon=[[0, 0], [9999, 0], [0, 10]]), ErrorCode.INVALID_REGION, "범위"),
        (lambda c: c["regions"].append(exclude("all", box(0, 0, 639, 559))), ErrorCode.EMPTY_ALLOWED_AREA, "제외 영역"),
        # A 40px strip leaves nothing more than 20px from a boundary, so a 25px margin empties it.
        (lambda c: c.update(regions=[include("strip", box(0, 180, 639, 220))], edge_margin_px=25), ErrorCode.EMPTY_ALLOWED_AREA, "경계 여유"),
        (lambda c: c.update(regions=[exclude("all", box(0, 0, 639, 559))]), ErrorCode.EMPTY_ALLOWED_AREA, "비어"),
    ],
)
def test_invalid_regions_are_rejected(mutate, code, fragment):
    fixture, source = part()
    cfg = config(fixture)
    mutate(cfg)
    with pytest.raises(DefectForgeError) as info:
        _area(cfg, source)
    assert info.value.code is code
    assert fragment in info.value.message
    if code is ErrorCode.EMPTY_ALLOWED_AREA:
        assert info.value.details["allowed_pixel_count"] == 0


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [((0, 0), (10, 0), 0.0), ((0, 0), (0, 10), 90.0), ((0, 0), (10, 10), 45.0), ((10, 0), (0, 10), 135.0), ((10, 0), (0, 0), 0.0), ((0, 10), (0, 0), 90.0)],
)
def test_line_angle_is_180_periodic_and_endpoint_order_free(start, end, expected):
    assert line_angle_deg(start, end) == pytest.approx(expected)
    assert line_angle_deg(start, end) == line_angle_deg(end, start)  # exactly equal, not just close
