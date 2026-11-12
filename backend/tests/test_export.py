"""Dataset ZIP: T11 and temp-file cleanup."""

from __future__ import annotations

import base64
import io
import json
import os
import re
import zipfile

import numpy as np
import pytest
from PIL import Image

from tests.helpers import RECT_ROI, full_config, post_export, post_preview, textured_rgb, to_bytes


def _png(zf: zipfile.ZipFile, name: str) -> Image.Image:
    img = Image.open(io.BytesIO(zf.read(name)))
    img.load()
    return img


@pytest.mark.parametrize("n", [1, 10, 20])
def test_zip_structure_and_manifest(client, surface, surface_png, settings, n):  # T11
    cfg = full_config(seed=100, roi=RECT_ROI)
    resp = post_export(client, surface_png, cfg, n)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    assert 'filename="defectforge_dataset.zip"' in resp.headers["content-disposition"]

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    groups = {prefix: sorted(x for x in names if x.startswith(prefix)) for prefix in ("images/", "masks/", "binary_masks/", "metadata/")}
    assert all(len(files) == n for files in groups.values())
    assert names == {"README.txt", "manifest.json", *[f for files in groups.values() for f in files]}

    # 1:1 matching by number, no gaps
    numbers = {prefix: [re.search(r"_(\d{4})\.", f).group(1) for f in files] for prefix, files in groups.items()}
    expected = [f"{i:04d}" for i in range(1, n + 1)]
    assert all(nums == expected for nums in numbers.values())

    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["sample_count"] == n
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", manifest["created_at"])
    assert manifest["class_map"] == {"0": "background", "1": "scratch", "2": "pinhole", "3": "contamination"}
    assert manifest["base_seed"] == 100 and "base_seed + i" in manifest["seed_rule"]
    assert len(manifest["source"]["sha256"]) == 64
    assert manifest["config"]["seed"] == 100 and manifest["config"]["roi"] == RECT_ROI
    assert [f["seed"] for f in manifest["files"]] == [100 + i for i in range(n)]
    for entry in manifest["files"]:
        for key in ("image", "class_mask", "binary_mask", "metadata"):
            assert entry[key] in names

    readme = zf.read("README.txt").decode("utf-8")
    assert "0 = background" in readme and "3 = contamination" in readme and "검증" in readme

    for entry in manifest["files"][:3]:  # pixel-level contract on a few samples
        image = np.asarray(_png(zf, entry["image"]))
        cls_img, bin_img = _png(zf, entry["class_mask"]), _png(zf, entry["binary_mask"])
        assert cls_img.mode == bin_img.mode == "L"
        binary = np.asarray(bin_img)
        assert np.array_equal(binary, (image != surface).any(axis=2).astype(np.uint8) * 255)
        assert (np.asarray(cls_img)[binary == 0] == 0).all()
        meta = json.loads(zf.read(entry["metadata"]))
        assert meta["seed"] == entry["seed"] and meta["generated_count"] == meta["requested_count"]

    assert os.listdir(settings.export_tmp_dir) == []  # temp ZIP removed after the response


def test_export_sample_matches_preview_with_same_seed(client, surface_png):
    cfg = full_config(seed=500)
    zf = zipfile.ZipFile(io.BytesIO(post_export(client, surface_png, cfg, 2).content))
    second = post_preview(client, surface_png, full_config(seed=501)).json()
    assert zf.read("images/image_0002.png") == base64.b64decode(second["image_png_base64"])
    assert zf.read("masks/mask_0002.png") == base64.b64decode(second["class_mask_png_base64"])


@pytest.mark.parametrize("count", [0, 21, -1, "abc"])
def test_invalid_sample_count(client, surface_png, count):
    resp = post_export(client, surface_png, full_config(), count)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_SAMPLE_COUNT"


def test_temp_file_removed_after_failure(client, settings):
    # Sample 1 fits, but the ROI is too small for the requested scratches -> 422 mid-export.
    cfg = full_config(roi=[[100, 100], [140, 100], [140, 140]], defects=[{"type": "scratch", "count": 1, "params": {"length_px": [300, 400]}}])
    resp = post_export(client, to_bytes(textured_rgb()), cfg, 5)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "DEFECT_PLACEMENT_FAILED"
    assert os.listdir(settings.export_tmp_dir) == []
