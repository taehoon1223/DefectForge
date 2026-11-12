"""HTTP contract for config 1.1: preview, export (preview == first ZIP sample), errors."""

from __future__ import annotations

import base64
import io
import json
import os
import zipfile

import pytest

from app.core.image_io import encode_png
from tests.helpers import full_config, post_export, post_preview
from tests.v11_helpers import as_v11, box, config, exclude, part


@pytest.fixture
def part_png():
    fixture, _ = part(angle_deg=12)
    return fixture, encode_png(fixture.rgb)


def _error(resp, status: int, code: str) -> dict:
    assert resp.status_code == status, resp.text
    err = resp.json()["error"]
    assert err["code"] == code and err["message"]
    return err


def test_preview_v11_returns_area_metadata(client, part_png):
    fixture, png = part_png
    resp = post_preview(client, png, config(fixture, count=2))
    assert resp.status_code == 200, resp.text
    meta = resp.json()["metadata"]
    assert meta["version"] == "1.1" and meta["engine_version"] == "1.1.0"
    assert meta["generated_count"] == meta["requested_count"] == 2
    assert meta["area"]["regions"][0]["id"] == "electrode_a"
    assert meta["reference_line"]["angle_deg"] == pytest.approx(12, abs=0.5)
    assert meta["surface_analysis"] is not None
    assert meta["config"]["regions"][0]["name"] == "전극 A"
    assert "roi" not in meta


def test_preview_v11_without_regions_matches_v10(client, surface_png):
    v10 = post_preview(client, surface_png, full_config()).json()
    v11 = post_preview(client, surface_png, as_v11(full_config())).json()
    for key in ("image_png_base64", "class_mask_png_base64", "binary_mask_png_base64"):
        assert v11[key] == v10[key]
    assert v11["metadata"]["area"]["full_image"] is True


def test_export_v11_first_sample_matches_preview_and_keeps_area_info(client, part_png, settings):
    fixture, png = part_png
    cfg = config(fixture, count=2, seed=77)
    preview = post_preview(client, png, cfg).json()
    resp = post_export(client, png, cfg, 3)
    assert resp.status_code == 200, resp.text
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert zf.read("images/image_0001.png") == base64.b64decode(preview["image_png_base64"])
    assert zf.read("masks/mask_0001.png") == base64.b64decode(preview["class_mask_png_base64"])
    assert zf.read("binary_masks/binary_0001.png") == base64.b64decode(preview["binary_mask_png_base64"])
    assert json.loads(zf.read("metadata/image_0001.json")) == preview["metadata"]
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["generator"]["engine_version"] == "1.1.0"
    for key in ("area", "reference_line", "surface_analysis", "algorithm_versions"):
        assert manifest[key] == preview["metadata"][key]
    assert [f["seed"] for f in manifest["files"]] == [77, 78, 79]
    readme = zf.read("README.txt").decode("utf-8")
    assert "생성 영역 (config 1.1)" in readme and "생성 영역: 1개" in readme
    assert os.listdir(settings.export_tmp_dir) == []


def test_v10_export_manifest_is_unchanged_in_shape(client, surface_png):
    zf = zipfile.ZipFile(io.BytesIO(post_export(client, surface_png, full_config(), 1).content))
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["generator"]["engine_version"] == "1.0.0"
    assert "area" not in manifest
    assert "생성 영역" not in zf.read("README.txt").decode("utf-8")


@pytest.mark.parametrize(
    ("mutate", "status", "code"),
    [
        (lambda c: c["regions"][0].update(polygon=[[1, 1], [2, 2]]), 422, "INVALID_REGION"),
        (lambda c: c["regions"].append(exclude("all", box(0, 0, 639, 559))), 422, "EMPTY_ALLOWED_AREA"),
        (lambda c: c.update(reference_line=None), 422, "INVALID_REFERENCE_LINE"),
        (lambda c: c.update(reference_line={"start": [10, 10], "end": [11, 11]}), 422, "INVALID_REFERENCE_LINE"),
        (lambda c: c.update(reference_line={"start": [10, 10], "end": [900, 10]}), 422, "INVALID_REFERENCE_LINE"),
        (lambda c: c["defects"][0]["params"].update(orientation={"mode": "parallel", "jitter_deg": 90}), 422, "INVALID_CONFIG"),
        (lambda c: c["defects"][0]["params"].update(orientation={"mode": "sideways"}), 422, "INVALID_CONFIG"),
        (lambda c: c.update(edge_margin_px=-1), 422, "INVALID_CONFIG"),
        (lambda c: c["regions"][0].update(kind="electrode"), 422, "INVALID_CONFIG"),
        (lambda c: c["regions"][0].update(id="has space"), 422, "INVALID_CONFIG"),
        (lambda c: c.update(roi=[[1, 1], [9, 1], [9, 9]]), 422, "INVALID_CONFIG"),  # 1.1 uses regions, not roi
        (lambda c: c.update(defects=[]), 422, "INVALID_CONFIG"),
        (lambda c: c["defects"].append(dict(c["defects"][0])), 422, "INVALID_CONFIG"),
        (lambda c: c["defects"][0]["params"].update(length_px=[120, 140]), 422, "DEFECT_PLACEMENT_FAILED"),
    ],
)
def test_v11_errors(client, part_png, mutate, status, code):
    fixture, png = part_png
    cfg = config(fixture, count=1)
    mutate(cfg)
    _error(post_preview(client, png, cfg), status, code)


@pytest.mark.parametrize("mode", ["absolute", "random"])
def test_modes_without_a_line_do_not_need_one(client, part_png, mode):
    fixture, png = part_png
    cfg = config(fixture, {"length_px": [20, 40], "orientation": {"mode": mode, "angle_deg": 45, "jitter_deg": 0}}, count=1, reference_line=None)
    resp = post_preview(client, png, cfg)
    assert resp.status_code == 200, resp.text
    assert resp.json()["metadata"]["reference_line"] is None
