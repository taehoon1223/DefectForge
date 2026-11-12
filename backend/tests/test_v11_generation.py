"""Config 1.1 generation on synthetic images (geometry/appearance rules, not real-defect similarity)."""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from app.core.compositor import CompositeCanvas
from app.core.generation_v11 import prepare_v11_context
from app.core.image_io import decode_image, encode_png
from app.core.pipeline import make_sampler
from app.core.surface import analyze_surface
from app.defects.adaptive_scratch import AdaptiveScratchGenerator
from app.defects.base import Rejected
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import AdaptiveScratchParams, GenerationConfigV11
from tests.helpers import RECT_ROI, full_config, make_source, textured_rgb
from tests.test_regression_v1 import GOLDEN, _cases
from tests.v11_helpers import angle_diff, as_v11, box, config, exclude, include, margin_area, part, polygon_mask, principal_angle, run

STRAIGHT = {"curvature": 0.0, "length_px": [40, 60], "width_px": [1.5, 2.0]}


def _sha(*arrays: np.ndarray) -> str:
    return hashlib.sha256(b"".join(encode_png(a) for a in arrays)).hexdigest()


def _assert_mask_contract(result, source, classes=(0, 1)):
    changed = (result.image != source.rgb).any(axis=2)
    assert np.array_equal(result.binary_mask, changed.astype(np.uint8) * 255)
    assert np.array_equal(result.class_mask > 0, result.binary_mask == 255)
    assert set(np.unique(result.class_mask).tolist()) <= set(classes)
    assert result.image.shape[:2] == result.class_mask.shape == result.binary_mask.shape == (source.height, source.width)


# ---------------------------------------------------------------- 1.1 is a superset of 1.0


@pytest.mark.parametrize("case", list(_cases()), ids=lambda c: c[0])
def test_v11_with_only_v10_features_gives_the_v10_pixels(case):
    """ROI -> one include region, no other option: identical PNG bytes to the 1.0 golden outputs."""
    name, source, cfg10, seed = case
    result = run(source, as_v11(cfg10), seed)
    assert _sha(result.image, result.class_mask, result.binary_mask) == GOLDEN[name][0]
    assert result.metadata["version"] == "1.1" and "roi" not in result.metadata


def test_v11_defaults_add_nothing_beyond_v10():
    cfg = GenerationConfigV11.model_validate(as_v11(full_config(roi=RECT_ROI)))
    assert cfg.edge_margin_px == 0 and cfg.reference_line is None
    assert cfg.scratch is not None
    assert cfg.scratch.params.orientation.mode == "random" and cfg.scratch.params.shading.mode == "fixed"


# ---------------------------------------------------------------- area restriction for every defect type


def test_all_defect_types_change_pixels_only_inside_the_allowed_area():
    source = make_source(textured_rgb())
    hole = box(200, 150, 300, 260)
    cfg = as_v11(full_config())
    cfg["regions"] = [include("left", box(10, 10, 330, 430)), include("right", box(300, 60, 500, 300)), exclude("hole", hole)]
    cfg["edge_margin_px"] = 2.5
    result = run(source, cfg)
    _assert_mask_contract(result, source, classes=(0, 1, 2, 3))
    assert result.metadata["generated_count"] == 7
    assert {i["type"] for i in result.metadata["instances"]} == {"scratch", "pinhole", "contamination"}

    base = (polygon_mask(box(10, 10, 330, 430), source) | polygon_mask(box(300, 60, 500, 300), source)) & ~polygon_mask(hole, source)
    allowed = margin_area(base, 2.5)
    changed = result.binary_mask == 255
    assert changed.any()
    assert not (changed & ~allowed).any()
    assert np.array_equal(result.image[~allowed], source.rgb[~allowed])
    assert result.metadata["area"]["allowed_pixel_count"] == int(allowed.sum())


def test_scratches_stay_inside_the_electrode_minus_exclusion_and_margin():
    fixture, source = part(angle_deg=15)
    a = fixture.polygons["electrode_a"]
    cx, cy = int(np.mean([p[0] for p in a])), int(np.mean([p[1] for p in a]))
    hole = box(cx - 15, cy - 15, cx + 15, cy + 15)
    cfg = config(fixture, {"length_px": [15, 35]}, count=5, edge_margin_px=3)
    cfg["regions"].append(exclude("hole", hole))
    result = run(source, cfg)
    _assert_mask_contract(result, source)
    assert result.metadata["generated_count"] == 5

    allowed = margin_area(polygon_mask(a, source) & ~polygon_mask(hole, source), 3.0)
    changed = result.binary_mask == 255
    assert changed.any() and not (changed & ~allowed).any()
    for inst in result.metadata["instances"]:
        assert inst["params"]["min_edge_distance_px"] > 3


def test_scratch_with_centre_inside_but_ends_outside_is_rejected():
    fixture, source = part(angle_deg=0)
    cfg = GenerationConfigV11.model_validate(config(fixture, edge_margin_px=0))
    ctx = prepare_v11_context(source, cfg)
    allowed = ctx.area.allowed.mask
    row = int(np.mean(np.nonzero(allowed)[0]))
    xs = np.nonzero(allowed[row])[0]
    span = xs.max() - xs.min() + 1
    centre = ((xs.min() + xs.max() + 1) / 2.0, row + 0.5)
    canvas = CompositeCanvas(source.rgb, allowed, allow_overlap=False)
    generator = AdaptiveScratchGenerator(source.rgb, ctx.analysis, 0.0, ctx.area.distance_to_edge)

    def params(length: float, width: float) -> AdaptiveScratchParams:
        return AdaptiveScratchParams.model_validate(
            {"length_px": [length, length], "width_px": [width, width], "curvature": 0, "orientation": {"mode": "absolute", "angle_deg": 0, "jitter_deg": 0}, "shading": {"mode": "local"}}
        )

    # Endpoints themselves leave the electrode -> rejected before rasterising.
    proposal = generator.render(np.random.default_rng(0), params(span + 40, 2), centre, canvas.context)
    assert isinstance(proposal, Rejected) and proposal.reason == "outside_roi"
    # Endpoints inside, but the anti-aliased round caps of an 8px-wide line cross the edge -> compositor rejects.
    proposal = generator.render(np.random.default_rng(0), params(span - 3, 8), centre, canvas.context)
    assert not isinstance(proposal, Rejected)
    assert canvas.try_apply(proposal, 1, 1) == "outside_roi"
    assert np.array_equal(canvas.image, source.rgb)  # rejected as a whole, nothing clipped in


def test_impossible_direction_fails_explicitly_instead_of_clipping():
    fixture, source = part(angle_deg=0)
    # Electrode A is ~100px along the axis; 120-140px scratches parallel to it can never fit.
    with pytest.raises(DefectForgeError) as info:
        run(source, config(fixture, {"length_px": [120, 140]}, count=1))
    assert info.value.code is ErrorCode.DEFECT_PLACEMENT_FAILED
    assert info.value.details["rejections"]["outside_roi"] == 100
    assert "허용 영역" in info.value.message


# ---------------------------------------------------------------- scratch direction


@pytest.mark.parametrize(
    ("orientation", "expected_offset"),
    [
        ({"mode": "parallel", "jitter_deg": 0}, 0.0),
        ({"mode": "parallel", "jitter_deg": 8}, 0.0),
        ({"mode": "perpendicular", "jitter_deg": 0}, 90.0),
        ({"mode": "perpendicular", "jitter_deg": 8}, 90.0),
        ({"mode": "absolute", "angle_deg": 37, "jitter_deg": 0}, None),
        ({"mode": "absolute", "angle_deg": 37, "jitter_deg": 8}, None),
    ],
)
def test_orientation_modes_and_jitter_bounds(orientation, expected_offset):
    fixture, source = part(angle_deg=20)
    result = run(source, config(fixture, {**STRAIGHT, "orientation": orientation}, count=3))
    line = result.metadata["reference_line"]["angle_deg"]
    base = 37.0 if expected_offset is None else (line + expected_offset) % 180
    for inst in result.metadata["instances"]:
        assert inst["params"]["base_angle_deg"] == pytest.approx(base, abs=1e-3)
        angle = inst["params"]["angle_deg"]
        assert angle_diff(angle, base) <= orientation["jitter_deg"] + 1e-3
        measured = principal_angle(result.instance_map == inst["id"])  # what was actually drawn
        assert angle_diff(measured, angle) <= 2.5


def test_random_mode_draws_from_the_angle_range_and_ignores_the_line():
    fixture, source = part(angle_deg=0)
    cfg = config(fixture, {**STRAIGHT, "length_px": [20, 30], "angle_deg": [60, 80], "orientation": {"mode": "random"}}, count=4)
    result = run(source, cfg)
    for inst in result.metadata["instances"]:
        assert 60 <= inst["params"]["angle_deg"] <= 80
        assert inst["params"]["base_angle_deg"] is None and inst["params"]["angle_offset_deg"] is None
    cfg["reference_line"] = None  # not needed for random
    assert _sha(run(source, cfg).image) == _sha(result.image)


@pytest.mark.parametrize("part_angle", [0, 30, 90, 135, 172])
@pytest.mark.parametrize("mode", ["parallel", "perpendicular"])
def test_direction_follows_the_reference_line_under_rotation(part_angle, mode):
    fixture, source = part(angle_deg=part_angle)
    result = run(source, config(fixture, {**STRAIGHT, "orientation": {"mode": mode, "jitter_deg": 0}}, count=2))
    expected = part_angle if mode == "parallel" else (part_angle + 90) % 180
    for inst in result.metadata["instances"]:
        # The line endpoints are rounded to pixels, so allow a small tolerance against the analytic angle.
        assert angle_diff(principal_angle(result.instance_map == inst["id"]), expected) <= 3.0


def test_swapping_line_endpoints_is_bit_identical():
    fixture, source = part(angle_deg=33)
    cfg = config(fixture, count=3)
    swapped = config(fixture, count=3, reference_line={"start": fixture.axis[1], "end": fixture.axis[0]})
    a, b = run(source, cfg), run(source, swapped)
    assert _sha(a.image, a.class_mask, a.binary_mask) == _sha(b.image, b.class_mask, b.binary_mask)


# ---------------------------------------------------------------- reproducibility


def test_region_order_and_names_do_not_change_the_result():
    fixture, source = part(angle_deg=10)
    regions = [include("a", fixture.polygons["electrode_a"]), include("b", fixture.polygons["electrode_b"]), exclude("x", box(200, 200, 230, 230))]
    reordered = [dict(r, name=f"다른 이름 {i}") for i, r in enumerate(reversed(regions))]
    a, b = run(source, config(fixture, count=3, regions=regions)), run(source, config(fixture, count=3, regions=reordered))
    assert _sha(a.image, a.class_mask, a.binary_mask) == _sha(b.image, b.class_mask, b.binary_mask)
    assert a.metadata["area"]["allowed_mask_sha256"] == b.metadata["area"]["allowed_mask_sha256"]


def test_same_seed_reproduces_and_other_seed_differs():
    fixture, source = part(angle_deg=8)
    cfg = config(fixture, count=3)
    a, b = run(source, cfg), run(source, cfg)
    c = run(source, cfg, seed=43)
    assert _sha(a.image, a.class_mask, a.binary_mask) == _sha(b.image, b.class_mask, b.binary_mask)
    assert a.metadata == b.metadata
    assert _sha(a.image) != _sha(c.image)


# ---------------------------------------------------------------- surface matching


@pytest.mark.parametrize("polarity", ["dark", "bright"])
def test_shading_scales_with_local_brightness(polarity):
    fixture, source = part(angle_deg=0, electrode_levels=(205.0, 150.0))
    params = {"contrast": [0.4, 0.4], "polarity": polarity, "shading": {"min_texture_ratio": 0}}
    deltas = {}
    for name in ("electrode_a", "electrode_b"):
        result = run(source, config(fixture, params, count=3, regions=[include(name, fixture.polygons[name])]))
        _assert_mask_contract(result, source)
        for inst in result.metadata["instances"]:
            shading = inst["params"]["shading"]
            headroom = shading["local_luma_mean"] if polarity == "dark" else 255.0 - shading["local_luma_mean"]
            assert shading["delta_luma_mean"] == pytest.approx(0.4 * headroom, abs=0.05)
            assert shading["fallback_fraction"] == 0.0
        deltas[name] = np.mean([i["params"]["shading"]["delta_luma_mean"] for i in result.metadata["instances"]])
    # Dark scratches darken the brighter electrode more; bright ones brighten the darker electrode more.
    assert (deltas["electrode_a"] > deltas["electrode_b"]) == (polarity == "dark")


def _flat_part(colour: tuple[int, int, int], noise_sigma: float = 0.0):
    image = np.full((200, 300, 3), 40.0)
    image[50:150, 60:240] = colour
    if noise_sigma:
        image[50:150, 60:240] += np.random.default_rng(7).normal(0, noise_sigma, (100, 180, 1))
    source = decode_image(encode_png(np.clip(image, 0, 255).astype(np.uint8)), 32, 2048)
    return source, {"version": "1.1", "seed": 3, "regions": [include("e", box(60, 50, 239, 149))], "reference_line": {"start": [60, 100], "end": [239, 100]}}


def _scratch(count: int, **params) -> list[dict]:
    shading = {"mode": "local", **params.pop("shading", {})}
    return [{"type": "scratch", "count": count, "params": {"orientation": {"mode": "parallel"}, "shading": shading, **params}}]


def test_dark_scratch_keeps_the_local_colour_ratio():
    source, cfg = _flat_part((200, 150, 100))
    cfg["defects"] = _scratch(2, length_px=[20, 60], contrast=[0.5, 0.5], polarity="dark", shading={"min_texture_ratio": 0})
    result = run(source, cfg)
    drop = source.rgb.astype(float) - result.image.astype(float)
    strong = drop[..., 0] >= 40  # ignore anti-aliased edge pixels where rounding dominates
    assert strong.any()
    assert np.allclose(drop[strong][:, 1] / drop[strong][:, 0], 150 / 200, atol=0.04)
    assert np.allclose(drop[strong][:, 2] / drop[strong][:, 0], 100 / 200, atol=0.04)
    assert result.metadata["instances"][0]["params"]["shading"]["flat_fraction"] == 1.0


@pytest.mark.parametrize(
    ("colour", "polarity", "works"),
    [((255, 255, 255), "bright", False), ((255, 255, 255), "dark", True), ((0, 0, 0), "dark", False), ((0, 0, 0), "bright", True), ((128, 128, 128), "dark", True)],
)
def test_saturated_and_flat_surfaces_behave_numerically(colour, polarity, works):
    source, cfg = _flat_part(colour)
    cfg["defects"] = _scratch(1, length_px=[20, 60], polarity=polarity)
    if not works:
        with pytest.raises(DefectForgeError) as info:
            run(source, cfg)
        assert info.value.details["rejections"]["no_visible_change"] > 0
        assert "극성" in info.value.message
        return
    result = run(source, cfg)
    _assert_mask_contract(result, source)
    shading = result.metadata["instances"][0]["params"]["shading"]
    assert all(np.isfinite(v) for k, v in shading.items() if isinstance(v, float))
    assert result.metadata["surface_analysis"]["global_stats_include_saturated"] == (colour != (128, 128, 128))


def test_texture_floor_raises_faint_scratches_above_the_texture():
    source, cfg = _flat_part((150, 150, 150), noise_sigma=8.0)  # 0.05·150 = 7.5 levels < 3σ ≈ 24
    cfg["defects"] = _scratch(2, length_px=[20, 60], contrast=[0.05, 0.05], shading={"min_texture_ratio": 3.0})
    result = run(source, cfg)
    for inst in result.metadata["instances"]:
        shading = inst["params"]["shading"]
        assert shading["texture_floor_fraction"] > 0.9
        # ΔL = max(c·H, min(r·σ, H)) >= r·σ pixel-wise, so the means obey it too.
        assert shading["delta_luma_mean"] >= 3.0 * shading["local_luma_std"] - 0.01
        assert shading["delta_luma_mean"] > 0.05 * shading["headroom_luma"]


def test_fixed_shading_skips_analysis_and_keeps_the_mask_contract():
    fixture, source = part(angle_deg=0)
    result = run(source, config(fixture, {"shading": {"mode": "fixed"}}, count=2))
    _assert_mask_contract(result, source)
    assert result.metadata["surface_analysis"] is None
    assert result.metadata["algorithm_versions"]["surface_analysis"] is None
    assert all(i["params"]["shading"] == {"mode": "fixed"} for i in result.metadata["instances"])


def test_analysis_runs_once_on_the_source_and_is_shared_by_samples():
    fixture, source = part(angle_deg=5)
    cfg = GenerationConfigV11.model_validate(config(fixture, count=4, allow_overlap=True))
    sampler = make_sampler(source, cfg)
    first, second = sampler.generate(1), sampler.generate(2)
    assert first.metadata["surface_analysis"] is second.metadata["surface_analysis"]  # prepared once
    ctx = prepare_v11_context(source, cfg)
    direct = analyze_surface(source.rgb, ctx.area.stats_domain, cfg.scratch.params.shading.window_sigma_px)
    assert first.metadata["surface_analysis"] == direct.summary


def test_metadata_records_what_is_needed_to_reproduce():
    fixture, source = part(angle_deg=12)
    meta = run(source, config(fixture, count=2)).metadata
    assert meta["version"] == "1.1" and meta["source_sha256"] == source.sha256
    assert set(meta["algorithm_versions"]) == {"region_geometry", "surface_analysis", "adaptive_scratch"}
    area = meta["area"]
    assert [r["id"] for r in area["regions"]] == ["electrode_a"]
    assert all(len(r["mask_sha256"]) == 64 for r in area["regions"])
    assert len(area["allowed_mask_sha256"]) == 64 and area["rasterization"] and area["edge_margin_px"] == 2
    assert meta["reference_line"]["angle_deg"] == pytest.approx(12, abs=0.5)
    for inst in meta["instances"]:
        p = inst["params"]
        assert p["orientation_mode"] == "parallel"
        assert {"angle_deg", "base_angle_deg", "angle_offset_deg", "contrast", "polarity", "shading"} <= set(p)
        assert {"local_mean_rgb", "local_luma_mean", "delta_luma_mean", "fallback_fraction"} <= set(p["shading"])
