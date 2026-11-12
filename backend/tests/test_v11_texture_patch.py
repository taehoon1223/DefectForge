"""Config 1.1 texture (DRAEM-style) and patch (NSA-style) defects: mask contract, area, determinism, errors."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import numpy as np
import pytest

from app.core.image_io import decode_image, encode_png
from app.error_codes import DefectForgeError, ErrorCode
from tests.helpers import full_config, make_source, post_export, post_preview, textured_rgb
from tests.v11_helpers import box, exclude, include, margin_area, polygon_mask, run


def _sha(*arrays: np.ndarray) -> str:
    return hashlib.sha256(b"".join(encode_png(a) for a in arrays)).hexdigest()


def _cfg(*defects: dict, **overrides) -> dict:
    return {"version": "1.1", "seed": 5, "defects": list(defects), **overrides}


def _assert_mask_contract(result, source, class_id: int):
    changed = (result.image != source.rgb).any(axis=2)
    assert np.array_equal(result.binary_mask, changed.astype(np.uint8) * 255)
    assert np.array_equal(result.class_mask > 0, result.binary_mask == 255)
    assert set(np.unique(result.class_mask).tolist()) <= {0, class_id}
    assert changed.any()


@pytest.mark.parametrize(
    ("defect", "class_id"),
    [
        ({"type": "texture", "count": 4, "params": {"source": "self"}}, 4),
        ({"type": "texture", "count": 4, "params": {"source": "noise", "roughness": 1.0}}, 4),
        ({"type": "patch", "count": 4, "params": {"blend": "source"}}, 5),
        ({"type": "patch", "count": 4, "params": {"blend": "mixed"}}, 5),
    ],
)
def test_new_types_keep_the_mask_contract_and_stay_inside_the_allowed_area(defect, class_id):
    source = make_source(textured_rgb())
    hole = box(180, 150, 300, 260)
    cfg = _cfg(defect, regions=[include("a", box(20, 20, 480, 420)), exclude("hole", hole)], edge_margin_px=2)
    result = run(source, cfg)
    _assert_mask_contract(result, source, class_id)
    assert result.metadata["generated_count"] == 4
    allowed = margin_area(polygon_mask(box(20, 20, 480, 420), source) & ~polygon_mask(hole, source), 2.0)
    assert not ((result.binary_mask == 255) & ~allowed).any()
    assert result.metadata["class_map"]["4"] == "texture" and result.metadata["class_map"]["5"] == "patch"
    assert result.metadata["class_pixel_counts"][defect["type"]] == int((result.class_mask == class_id).sum())


def test_same_seed_reproduces_and_other_seed_differs():
    source = make_source(textured_rgb())
    cfg = _cfg({"type": "texture", "count": 3}, {"type": "patch", "count": 3})
    a, b, c = run(source, cfg), run(source, cfg), run(source, cfg, seed=6)
    assert _sha(a.image, a.class_mask, a.binary_mask) == _sha(b.image, b.class_mask, b.binary_mask)
    assert a.metadata == b.metadata
    assert _sha(a.image) != _sha(c.image)


def test_patch_only_touches_its_ellipse_and_comes_from_elsewhere():
    source = make_source(textured_rgb())
    result = run(source, _cfg({"type": "patch", "count": 1, "params": {"size_px": [40, 40]}}))
    inst = result.metadata["instances"][0]
    p = inst["params"]
    assert p["rotation_deg"] in (90, 270)
    cx, cy = inst["center_xy"]
    sx, sy, m = p["source_xy"][0], p["source_xy"][1], p["source_size_px"]
    assert np.hypot(sx + m / 2 - cx, sy + m / 2 - cy) >= p["size_px"]  # the copied content is not the spot itself
    # Every changed pixel lies inside the sampled ellipse (seamlessClone never leaks outside the region).
    ys, xs = np.nonzero(result.binary_mask)
    theta = np.radians(p["angle_deg"])
    u = (xs + 0.5 - cx) * np.cos(theta) + (ys + 0.5 - cy) * np.sin(theta)
    v = -(xs + 0.5 - cx) * np.sin(theta) + (ys + 0.5 - cy) * np.cos(theta)
    ax, ay = p["size_px"] / 2, p["size_px"] / 2 * p["aspect"]
    assert ((u / ax) ** 2 + (v / ay) ** 2 <= 1.0 + 1e-6).all()


def test_texture_records_what_it_sampled():
    source = make_source(textured_rgb())
    meta = run(source, _cfg({"type": "texture", "count": 2})).metadata
    for inst in meta["instances"]:
        p = inst["params"]
        assert {"radius_px", "opacity", "roughness", "noise_cells", "source", "source_xy", "rotation_deg", "contrast"} <= set(p)
        assert inst["class_id"] == 4


def test_patch_on_a_flat_surface_changes_nothing_and_fails_explicitly():
    source = decode_image(encode_png(np.full((200, 200, 3), 128, np.uint8)), 32, 2048)
    with pytest.raises(DefectForgeError) as info:
        run(source, _cfg({"type": "patch", "count": 1}))
    assert info.value.code is ErrorCode.DEFECT_PLACEMENT_FAILED
    assert info.value.details["rejections"]["no_visible_change"] > 0
    # A noise texture still shows on the same flat surface.
    result = run(source, _cfg({"type": "texture", "count": 1, "params": {"source": "noise"}}))
    assert result.metadata["generated_count"] == 1


def test_all_five_types_together_and_later_classes_win():
    source = make_source(textured_rgb())
    cfg = {**full_config(allow_overlap=True), "version": "1.1", "defects": full_config()["defects"] + [{"type": "texture", "count": 2}, {"type": "patch", "count": 2}]}
    cfg.pop("roi")
    result = run(source, cfg)
    assert result.metadata["generated_count"] == 11
    assert set(np.unique(result.class_mask).tolist()) <= {0, 1, 2, 3, 4, 5}
    assert np.array_equal(result.class_mask > 0, result.binary_mask == 255)


def test_config_10_does_not_accept_the_new_types(client, surface_png):
    cfg = full_config()
    cfg["defects"] = [{"type": "texture", "count": 1}]
    resp = post_preview(client, surface_png, cfg)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "INVALID_CONFIG"


def test_export_readme_and_manifest_list_the_new_classes_only_for_v11(client, surface_png):
    v11 = zipfile.ZipFile(io.BytesIO(post_export(client, surface_png, _cfg({"type": "texture", "count": 1}), 1).content))
    assert json.loads(v11.read("manifest.json"))["class_map"]["5"] == "patch"
    assert "4 = texture" in v11.read("README.txt").decode("utf-8")
    v10 = zipfile.ZipFile(io.BytesIO(post_export(client, surface_png, full_config(), 1).content))
    assert set(json.loads(v10.read("manifest.json"))["class_map"]) == {"0", "1", "2", "3"}
    assert "4 = texture" not in v10.read("README.txt").decode("utf-8")
