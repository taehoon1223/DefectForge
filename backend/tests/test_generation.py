"""Engine behaviour: T02, T03, T05, T06, T10, placement failures, randomised invariants."""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from app.core.generation import MAX_PLACEMENT_ATTEMPTS, generate_sample
from app.core.image_io import encode_png
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import LIMITS, GenerationConfig
from tests.helpers import RECT_ROI, full_config, make_source, textured_rgb


def _sha(data: bytes | np.ndarray) -> str:
    return hashlib.sha256(data if isinstance(data, bytes) else data.tobytes()).hexdigest()


def _cfg(**overrides) -> GenerationConfig:
    return GenerationConfig.model_validate(full_config(**overrides))


@pytest.mark.parametrize("defect_type", ["scratch", "pinhole", "contamination"])
def test_each_type_generates_visible_defects(defect_type):  # T02
    source = make_source(textured_rgb())
    cfg = _cfg(defects=[{"type": defect_type, "count": 3}])
    result = generate_sample(source, cfg, 11)
    assert result.metadata["generated_count"] == result.metadata["requested_count"] == 3
    assert result.metadata["class_pixel_counts"][defect_type] > 0
    assert {i["type"] for i in result.metadata["instances"]} == {defect_type}
    assert result.binary_mask.any()


def test_no_roi_uses_full_image():  # T03
    source = make_source(textured_rgb())
    result = generate_sample(source, _cfg(roi=None, defects=[{"type": "pinhole", "count": 30}]), 5)
    assert result.metadata["roi"] is None
    assert result.metadata["roi_pixel_count"] == source.width * source.height
    # With 30 instances on the full image, some must land outside the RECT_ROI area.
    centers = np.array([i["center_xy"] for i in result.metadata["instances"]])
    outside_rect = (centers[:, 0] < 40) | (centers[:, 0] > 460) | (centers[:, 1] < 40) | (centers[:, 1] > 400)
    assert outside_rect.any()


def test_same_seed_is_bit_identical():  # T05
    rgb = textured_rgb()
    cfg = _cfg(roi=RECT_ROI)
    runs = []
    for _ in range(3):
        result = generate_sample(make_source(rgb), cfg, 42)  # fresh decode each run
        runs.append(
            (
                _sha(encode_png(result.image)),
                _sha(encode_png(result.class_mask)),
                _sha(encode_png(result.binary_mask)),
                _sha(result.image),
                result.metadata,
            )
        )
    assert runs[0] == runs[1] == runs[2]


def test_different_seeds_differ():  # T06
    source = make_source(textured_rgb())
    cfg = _cfg()
    a = generate_sample(source, cfg, 42)
    b = generate_sample(source, cfg, 43)
    assert _sha(a.image) != _sha(b.image)
    assert [i["center_xy"] for i in a.metadata["instances"]] != [i["center_xy"] for i in b.metadata["instances"]]


def test_many_instances_of_same_type_all_generated():  # T10
    source = make_source(textured_rgb())
    cfg = _cfg(
        defects=[
            {"type": "scratch", "count": 20, "params": {"length_px": [20, 60]}},
            {"type": "pinhole", "count": 30},
            {"type": "contamination", "count": 30, "params": {"radius_px": [4, 10]}},
        ]
    )
    result = generate_sample(source, cfg, 9)
    assert result.metadata["requested_count"] == result.metadata["generated_count"] == 80
    assert len(result.metadata["instances"]) == 80
    assert [i["id"] for i in result.metadata["instances"]] == list(range(1, 81))


def test_impossible_placement_raises_instead_of_reducing_count():  # T10
    source = make_source(textured_rgb())
    small_roi = [[100, 100], [130, 100], [130, 130], [100, 130]]
    cfg = _cfg(roi=small_roi, defects=[{"type": "scratch", "count": 2, "params": {"length_px": [200, 300]}}])
    with pytest.raises(DefectForgeError) as info:
        generate_sample(source, cfg, 1)
    err = info.value
    assert err.code is ErrorCode.DEFECT_PLACEMENT_FAILED and err.status_code == 422
    assert err.details["attempts"] == MAX_PLACEMENT_ATTEMPTS
    assert sum(err.details["rejections"].values()) == MAX_PLACEMENT_ATTEMPTS
    assert err.details["rejections"]["outside_roi"] > 0


def test_too_many_non_overlapping_instances_fail_with_overlap_reason():
    source = make_source(textured_rgb(64, 64))
    cfg = _cfg(defects=[{"type": "contamination", "count": 30, "params": {"radius_px": [12, 16]}}])
    with pytest.raises(DefectForgeError) as info:
        generate_sample(source, cfg, 1)
    assert info.value.details["rejections"]["overlap"] > 0
    assert "겹침" in info.value.message


def test_bright_defect_on_white_image_fails_explicitly():
    source = make_source(np.full((128, 128, 3), 255, np.uint8))
    cfg = _cfg(defects=[{"type": "pinhole", "count": 1, "params": {"polarity": "bright", "rim_strength": 0}}])
    with pytest.raises(DefectForgeError) as info:
        generate_sample(source, cfg, 1)
    rejections = info.value.details["rejections"]
    # Attempts near the border are rejected as out_of_image first; every other attempt is "no change".
    assert rejections["no_visible_change"] + rejections["out_of_image"] == MAX_PLACEMENT_ATTEMPTS
    assert rejections["no_visible_change"] > rejections["out_of_image"]
    assert "극성" in info.value.message
    # The dark polarity works on the same image.
    ok = generate_sample(source, _cfg(defects=[{"type": "pinhole", "count": 1, "params": {"polarity": "dark"}}]), 1)
    assert ok.metadata["generated_count"] == 1


def test_overlap_allowed_places_dense_defects():
    source = make_source(textured_rgb(64, 64))
    cfg = _cfg(allow_overlap=True, defects=[{"type": "contamination", "count": 30, "params": {"radius_px": [12, 16]}}])
    result = generate_sample(source, cfg, 1)
    assert result.metadata["generated_count"] == 30


def test_metadata_is_traceable():
    source = make_source(textured_rgb())
    cfg = _cfg(roi=RECT_ROI)
    meta = generate_sample(source, cfg, 77).metadata
    assert meta["seed"] == 77 and meta["source_sha256"] == source.sha256
    assert (meta["width"], meta["height"]) == (source.width, source.height)
    assert meta["class_map"] == {"0": "background", "1": "scratch", "2": "pinhole", "3": "contamination"}
    assert meta["roi"] == RECT_ROI
    assert meta["config"]["defects"][0]["type"] == "scratch"
    class_ids = {"scratch": 1, "pinhole": 2, "contamination": 3}
    for inst in meta["instances"]:
        assert inst["class_id"] == class_ids[inst["type"]]
        x0, y0, x1, y1 = inst["bbox_xyxy"]
        assert 0 <= x0 <= x1 < source.width and 0 <= y0 <= y1 < source.height
        assert inst["params"]["polarity"] in ("dark", "bright")
        assert 1 <= inst["attempts"] <= MAX_PLACEMENT_ATTEMPTS


def _random_config(rng: np.random.Generator) -> dict:
    def rng_range(lo, hi, span_max):
        a = rng.uniform(lo, hi)
        b = min(hi, a + rng.uniform(0, span_max))
        return [round(a, 3), round(b, 3)]

    defects = []
    for kind in rng.permutation(["scratch", "pinhole", "contamination"])[: rng.integers(1, 4)]:
        lim = LIMITS[kind]
        if kind == "scratch":
            params = {"length_px": rng_range(8, 120, 60), "width_px": rng_range(1, 8, 4), "angle_deg": rng_range(0, 180, 180),
                      "contrast": rng_range(0.05, 1.0, 0.5), "polarity": str(rng.choice(["dark", "bright", "random"])), "curvature": round(rng.uniform(0, 1), 3)}
        elif kind == "pinhole":
            params = {"radius_px": rng_range(1, 12, 6), "irregularity": round(rng.uniform(0, 1), 3), "contrast": rng_range(0.05, 1.0, 0.5),
                      "polarity": str(rng.choice(["dark", "bright", "random"])), "rim_strength": round(rng.uniform(0, 1), 3)}
        else:
            params = {"radius_px": rng_range(2, 25, 10), "irregularity": round(rng.uniform(0, 1), 3), "opacity": rng_range(0.1, 1.0, 0.5),
                      "blur_sigma": round(rng.uniform(0, 8), 3), "polarity": str(rng.choice(["dark", "bright", "random"]))}
        defects.append({"type": str(kind), "count": int(rng.integers(1, min(6, lim["count"][1]) + 1)), "params": params})
    return full_config(seed=int(rng.integers(0, 2**32)), allow_overlap=bool(rng.random() < 0.3), defects=defects)


@pytest.mark.parametrize("case", range(25))
def test_randomised_configs_keep_invariants(case):
    rng = np.random.default_rng(1000 + case)
    source = make_source(textured_rgb(seed=case))
    cfg = GenerationConfig.model_validate(_random_config(rng))
    try:
        result = generate_sample(source, cfg, cfg.seed)
    except DefectForgeError as err:  # allowed outcome, but it must be the explicit placement failure
        assert err.code is ErrorCode.DEFECT_PLACEMENT_FAILED
        return
    assert result.metadata["generated_count"] == cfg.requested_count
    assert np.array_equal(result.binary_mask, (result.image != source.rgb).any(axis=2).astype(np.uint8) * 255)
    assert (result.class_mask[result.binary_mask == 0] == 0).all()
