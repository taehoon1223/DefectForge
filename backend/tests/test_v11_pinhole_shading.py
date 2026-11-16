"""Pinhole surface matching (config 1.1, shading "local") on synthetic surfaces."""

from __future__ import annotations

import json

import numpy as np
import pytest
from pydantic import ValidationError

from app.core.image_io import decode_image, encode_png
from app.error_codes import DefectForgeError
from app.schemas.generation import GenerationConfig
from tests.helpers import make_source, textured_rgb, to_bytes
from tests.v11_helpers import box, exclude, include, margin_area, polygon_mask, run


def flat(level: float, noise_sigma: float = 0.0, size: tuple[int, int] = (200, 240)):
    image = np.full((*size, 3), float(level))
    if noise_sigma:
        image += np.random.default_rng(7).normal(0, noise_sigma, (*size, 1))
    return decode_image(encode_png(np.clip(np.rint(image), 0, 255).astype(np.uint8)), 32, 2048)


def pinholes(count: int = 3, mode: str = "local", seed: int = 5, **params) -> dict:
    shading = {"mode": mode, **params.pop("shading", {})}
    return {"version": "1.1", "seed": seed, "defects": [{"type": "pinhole", "count": count, "params": {"shading": shading, **params}}]}


def _luma(rgb: np.ndarray) -> np.ndarray:
    return rgb.astype(np.float64) @ np.array([0.299, 0.587, 0.114])


def _assert_mask_contract(result, source) -> np.ndarray:
    changed = (result.image != source.rgb).any(axis=2)
    assert np.array_equal(result.binary_mask, changed.astype(np.uint8) * 255)
    assert np.array_equal(result.class_mask > 0, changed)
    assert set(np.unique(result.class_mask).tolist()) <= {0, 2}
    return changed


@pytest.mark.parametrize("polarity", ["dark", "bright"])
def test_local_pinhole_changes_luma_by_contrast_times_local_headroom(polarity):
    deltas = {}
    for level in (200, 90):
        source = flat(level)
        cfg = pinholes(3, polarity=polarity, contrast=[0.4, 0.4], rim_strength=0, radius_px=[5, 8], shading={"min_texture_ratio": 0})
        result = run(source, cfg)
        _assert_mask_contract(result, source)
        headroom = level if polarity == "dark" else 255 - level
        for inst in result.metadata["instances"]:
            shading = inst["params"]["shading"]
            assert shading["mode"] == "local" and shading["headroom_luma"] == pytest.approx(headroom, abs=0.5)
            assert shading["delta_luma_mean"] == pytest.approx(0.4 * headroom, abs=0.05)
        change = np.abs(_luma(result.image) - _luma(source.rgb))
        assert change.max() == pytest.approx(0.4 * headroom, rel=0.12)  # centre: alpha ≈ 1
        deltas[level] = change.max()
    # Dark spots darken the brighter surface more; bright spots brighten the darker one more.
    assert (deltas[200] > deltas[90]) == (polarity == "dark")


def test_local_pinholes_keep_the_shapes_and_places_of_fixed_ones():
    source = make_source(textured_rgb(seed=4))
    fixed = run(source, pinholes(4, mode="fixed"))
    local = run(source, pinholes(4, mode="local"))
    key = lambda inst: (inst["center_xy"], inst["params"]["radius_px"], inst["params"]["semi_axes_px"])  # noqa: E731
    assert [key(i) for i in fixed.metadata["instances"]] == [key(i) for i in local.metadata["instances"]]
    assert all(i["params"]["shading"] == {"mode": "fixed"} for i in fixed.metadata["instances"])
    assert not np.array_equal(fixed.image, local.image)


def test_local_pinhole_keeps_the_surface_texture_inside_the_spot():
    """Offset (local) vs blend toward black (fixed): the texture under the spot stays correlated with the source."""
    source = make_source(textured_rgb(seed=9))
    corr = {}
    for mode in ("fixed", "local"):
        result = run(source, pinholes(4, mode=mode, polarity="dark", contrast=[0.6, 0.6], rim_strength=0, radius_px=[10, 12], shading={"min_texture_ratio": 0}))
        values = []
        for inst in result.metadata["instances"]:
            cx, cy = inst["center_xy"]
            yy, xx = np.mgrid[0 : source.height, 0 : source.width]
            core = (xx - cx) ** 2 + (yy - cy) ** 2 <= (0.5 * inst["params"]["radius_px"]) ** 2
            values.append(np.corrcoef(_luma(result.image)[core], _luma(source.rgb)[core])[0, 1])
        corr[mode] = float(np.mean(values))
    assert corr["local"] > corr["fixed"] + 0.1, corr


def test_texture_floor_lifts_faint_pinholes_above_the_texture():
    source = flat(150, noise_sigma=8.0)  # 0.05·150 = 7.5 levels < 3σ ≈ 24
    result = run(source, pinholes(2, contrast=[0.05, 0.05], rim_strength=0, shading={"min_texture_ratio": 3.0}))
    for inst in result.metadata["instances"]:
        shading = inst["params"]["shading"]
        assert shading["texture_floor_fraction"] > 0.9
        assert shading["delta_luma_mean"] >= 3.0 * shading["local_luma_std"] - 0.01


def test_local_rim_takes_the_opposite_polarity():
    source = flat(128)
    with_rim = run(source, pinholes(2, polarity="dark", contrast=[0.6, 0.6], rim_strength=1.0, radius_px=[6, 8]))
    lum, base = _luma(with_rim.image), _luma(source.rgb)
    assert (lum < base - 1).any() and (lum > base + 1).any()  # dark core, bright halo
    no_rim = run(source, pinholes(2, polarity="dark", contrast=[0.6, 0.6], rim_strength=0, radius_px=[6, 8]))
    assert not (_luma(no_rim.image) > base + 0.5).any()


@pytest.mark.parametrize(("level", "polarity", "works"), [(255, "bright", False), (255, "dark", True), (0, "dark", False), (0, "bright", True)])
def test_saturated_surfaces(level, polarity, works):
    """Without a rim (which takes the opposite polarity and still has headroom) nothing can change."""
    source = flat(level)
    cfg = pinholes(1, polarity=polarity, rim_strength=0)
    if not works:
        with pytest.raises(DefectForgeError) as info:
            run(source, cfg)
        assert info.value.details["rejections"]["no_visible_change"] > 0
        return
    _assert_mask_contract(run(source, cfg), source)


def test_local_pinholes_stay_inside_the_allowed_area():
    source = make_source(textured_rgb(seed=2))
    hole = box(200, 150, 320, 260)
    cfg = pinholes(10, radius_px=[3, 6]) | {"regions": [include("a", box(40, 40, 470, 400)), exclude("hole", hole)], "edge_margin_px": 3}
    result = run(source, cfg)
    changed = _assert_mask_contract(result, source)
    allowed = margin_area(polygon_mask(box(40, 40, 470, 400), source) & ~polygon_mask(hole, source), 3.0)
    assert changed.any() and not (changed & ~allowed).any()


def test_surface_analysis_is_shared_when_the_window_matches():
    source = make_source(textured_rgb(seed=1))
    scratch = {"type": "scratch", "count": 1, "params": {"shading": {"mode": "local"}}}
    same = run(source, pinholes(2) | {"defects": [scratch, *pinholes(2)["defects"]]}).metadata
    assert same["pinhole_surface_analysis"] is same["surface_analysis"]  # prepared once

    other = pinholes(2, shading={"window_sigma_px": 10})["defects"]
    differ = run(source, {"version": "1.1", "seed": 5, "defects": [scratch, *other]}).metadata
    assert differ["surface_analysis"]["window_sigma_px"] == 6 and differ["pinhole_surface_analysis"]["window_sigma_px"] == 10

    only_pinhole = run(source, pinholes(2)).metadata
    assert only_pinhole["surface_analysis"] is None and only_pinhole["pinhole_surface_analysis"]["window_sigma_px"] == 6
    assert only_pinhole["algorithm_versions"]["surface_analysis"] == "1.0" and only_pinhole["algorithm_versions"]["adaptive_pinhole"] == "1.0"

    fixed = run(source, pinholes(2, mode="fixed")).metadata
    assert fixed["pinhole_surface_analysis"] is None and fixed["algorithm_versions"]["surface_analysis"] is None


def test_config_10_refuses_pinhole_shading():
    with pytest.raises(ValidationError):
        GenerationConfig.model_validate({"version": "1.0", "defects": [{"type": "pinhole", "params": {"shading": {"mode": "local"}}}]})


def test_preview_api_returns_the_pinhole_analysis(client):
    files = [("file", ("surface.png", to_bytes(textured_rgb(seed=11)), "image/png"))]
    response = client.post("/api/v1/preview", files=files, data={"config": json.dumps(pinholes(3))})
    assert response.status_code == 200, response.text
    meta = response.json()["metadata"]
    assert meta["pinhole_surface_analysis"]["window_sigma_px"] == 6
    assert all(i["params"]["shading"]["mode"] == "local" for i in meta["instances"])
