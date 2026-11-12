"""Mask contract (spec section 5): T04, T07, T08, T09 and label precedence."""

from __future__ import annotations

import io

import cv2
import numpy as np
import pytest
from PIL import Image

from app.core.compositor import CompositeCanvas
from app.core.generation import generate_sample
from app.core.image_io import encode_png
from app.core.roi import build_roi_mask
from app.defects.base import EffectLayer, RenderedDefect
from app.schemas.generation import GenerationConfig
from tests.helpers import RECT_ROI, full_config, make_source, textured_rgb


def _generate(rgb, **overrides):
    source = make_source(rgb)
    cfg = GenerationConfig.model_validate(full_config(**overrides))
    return source, generate_sample(source, cfg, cfg.seed)


def _png_roundtrip(array: np.ndarray) -> Image.Image:
    img = Image.open(io.BytesIO(encode_png(array)))
    img.load()
    return img


@pytest.mark.parametrize("seed", [0, 1, 42, 1234])
def test_mask_contract_on_encoded_pngs(seed):  # T07, T08, T09
    source, result = _generate(textured_rgb(), seed=seed)
    image_png = _png_roundtrip(result.image)
    class_png = _png_roundtrip(result.class_mask)
    binary_png = _png_roundtrip(result.binary_mask)

    # T07: identical width x height, correct PNG modes (masks are grayscale, never palette)
    assert image_png.mode == "RGB" and class_png.mode == "L" and binary_png.mode == "L"
    assert image_png.size == class_png.size == binary_png.size == (source.width, source.height)

    out = np.asarray(image_png)
    cls = np.asarray(class_png)
    binary = np.asarray(binary_png)
    # T08
    assert np.array_equal(binary, (out != source.rgb).any(axis=2).astype(np.uint8) * 255)
    # T09
    assert (cls[binary == 0] == 0).all()
    assert set(np.unique(cls).tolist()) <= {0, 1, 2, 3}
    # stronger: every changed pixel carries a defect class
    assert (cls[binary == 255] > 0).all()
    assert set(np.unique(binary).tolist()) <= {0, 255}


def test_outside_roi_is_bit_identical():  # T04
    triangle = [[60, 50], [470, 120], [150, 420]]
    source, result = _generate(textured_rgb(), roi=triangle, seed=7)
    roi = build_roi_mask(triangle, source.width, source.height).mask
    assert np.array_equal(result.image[~roi], source.rgb[~roi])
    assert (result.binary_mask[~roi] == 0).all() and (result.class_mask[~roi] == 0).all()
    assert result.binary_mask[roi].any()


def test_heavy_blur_never_leaks_outside_roi():
    cfg = full_config(
        roi=RECT_ROI,
        defects=[{"type": "contamination", "count": 6, "params": {"radius_px": [20, 40], "opacity": [0.8, 1.0], "blur_sigma": 8, "irregularity": 1}}],
    )
    source, result = _generate(textured_rgb(), **cfg)
    roi = build_roi_mask(RECT_ROI, source.width, source.height).mask
    assert np.array_equal(result.image[~roi], source.rgb[~roi])


def test_instances_do_not_touch_when_overlap_disallowed():
    cfg = full_config(defects=[{"type": "pinhole", "count": 30, "params": {"radius_px": [3, 8]}}, {"type": "contamination", "count": 10}])
    _, result = _generate(textured_rgb(), **cfg)
    ids = [i for i in np.unique(result.instance_map) if i]
    assert len(ids) == 40
    for inst in ids:
        grown = cv2.dilate((result.instance_map == inst).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        others = result.instance_map[grown]
        assert set(np.unique(others).tolist()) <= {0, int(inst)}


def test_bbox_is_minimal_bbox_of_changed_pixels():
    _, result = _generate(textured_rgb(), seed=3)
    for inst in result.metadata["instances"]:
        ys, xs = np.nonzero(result.instance_map == inst["id"])
        assert inst["bbox_xyxy"] == [xs.min(), ys.min(), xs.max(), ys.max()]
        assert inst["changed_pixel_count"] == xs.size


def test_later_defect_class_wins_on_overlap():
    rgb = np.full((40, 40, 3), 128, np.uint8)
    roi = build_roi_mask(None, 40, 40)
    canvas = CompositeCanvas(rgb, roi.mask, allow_overlap=True)
    first = np.zeros((10, 10), np.float32)
    first[2:8, 2:8] = 0.5
    second = np.zeros((10, 10), np.float32)
    second[5:10, 5:10] = 0.5
    canvas.try_apply(RenderedDefect(10, 10, [EffectLayer(first, np.zeros(3, np.float32))], {}, (0, 0)), class_id=1, instance_id=1)
    canvas.try_apply(RenderedDefect(10, 10, [EffectLayer(second, np.full(3, 255, np.float32))], {}, (0, 0)), class_id=3, instance_id=2)
    final = canvas.finalize()
    assert final.class_mask[12, 12] == 1  # only first
    assert final.class_mask[16, 16] == 3  # overlap -> later wins
    assert final.class_mask[18, 18] == 3  # only second


def test_change_reverted_to_original_is_unlabelled():
    rgb = np.full((40, 40, 3), 100, np.uint8)
    canvas = CompositeCanvas(rgb, build_roi_mask(None, 40, 40).mask, allow_overlap=True)
    alpha = np.full((5, 5), 1.0, np.float32)
    canvas.try_apply(RenderedDefect(5, 5, [EffectLayer(alpha, np.full(3, 200, np.float32))], {}, (0, 0)), 1, 1)
    canvas.try_apply(RenderedDefect(5, 5, [EffectLayer(alpha, np.full(3, 100, np.float32))], {}, (0, 0)), 2, 2)
    final = canvas.finalize()
    assert not final.binary_mask.any() and not final.class_mask.any()


def test_source_pixels_are_never_mutated():
    source = make_source(textured_rgb())
    before = source.rgb.copy()
    generate_sample(source, GenerationConfig.model_validate(full_config()), 5)
    assert np.array_equal(source.rgb, before)
    assert not source.rgb.flags.writeable
