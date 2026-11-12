"""Local surface statistics: no background mixing, flat/saturated/narrow fallbacks, finite values."""

from __future__ import annotations

import cv2
import numpy as np

from app.core.surface import LUMA_STD_FLOOR, analyze_surface, luma


def _finite(analysis) -> bool:
    return bool(np.isfinite(analysis.mean_rgb).all() and np.isfinite(analysis.luma_std).all())


def test_statistics_near_the_edge_do_not_mix_in_the_background():
    rng = np.random.default_rng(0)
    image = np.full((200, 300, 3), 30.0)  # dark background
    image[50:150, 100:200] = 200.0  # bright electrode
    image += rng.normal(0, 3, image.shape)
    image = np.clip(image, 0, 255).astype(np.uint8)
    domain = np.zeros((200, 300), bool)
    domain[50:150, 100:200] = True

    analysis = analyze_surface(image, domain, window_sigma_px=6)
    mean, std, fallback, _ = analysis.window(0, 0, (200, 300))
    edge = (100, 100)  # first electrode column: half the window lies on the background
    assert abs(luma(mean[edge]) - 200.0) < 2.0
    assert std[edge] < 6.0  # only electrode noise (σ≈3), no 170-level step
    assert not fallback[edge]
    # A plain blur over the image would be dragged toward the background.
    naive = cv2.GaussianBlur(image.astype(np.float32), (0, 0), 6)
    assert luma(naive[edge]) < 150.0
    assert analysis.summary["fallback_pixel_fraction"] == 0.0


def test_flat_surface_uses_the_std_floor():
    image = np.full((120, 120, 3), 128, np.uint8)
    domain = np.zeros((120, 120), bool)
    domain[20:100, 20:100] = True
    analysis = analyze_surface(image, domain, window_sigma_px=6)
    assert _finite(analysis)
    assert np.allclose(analysis.luma_std, LUMA_STD_FLOOR)
    assert analysis.summary["flat_pixel_fraction"] == 1.0
    mean, _, _, _ = analysis.window(0, 0, (120, 120))
    assert np.allclose(mean[domain], 128.0)


def test_saturated_surface_falls_back_to_all_domain_pixels():
    image = np.full((120, 120, 3), 255, np.uint8)
    domain = np.zeros((120, 120), bool)
    domain[20:100, 20:100] = True
    analysis = analyze_surface(image, domain, window_sigma_px=6)
    assert _finite(analysis)
    assert analysis.summary["valid_pixel_count"] == 0
    assert analysis.summary["global_stats_include_saturated"] is True
    assert analysis.summary["saturated_pixel_fraction"] == 1.0
    assert analysis.summary["fallback_pixel_fraction"] == 1.0
    assert np.allclose(analysis.global_mean_rgb, 255.0)


def test_narrow_domain_records_fallback_to_global_statistics():
    rng = np.random.default_rng(1)
    image = np.clip(np.full((120, 200, 3), 140.0) + rng.normal(0, 5, (120, 200, 3)), 0, 255).astype(np.uint8)
    domain = np.zeros((120, 200), bool)
    domain[60:62, 20:180] = True  # 2px strip: window support ≈ 2/(σ√2π) < MIN_SUPPORT
    analysis = analyze_surface(image, domain, window_sigma_px=8)
    assert analysis.summary["fallback_pixel_fraction"] > 0.9
    mean, _, fallback, _ = analysis.window(0, 0, (120, 200))
    assert fallback[60, 100]
    assert np.allclose(mean[60, 100], analysis.global_mean_rgb)


def test_patches_outside_the_analysed_crop_get_global_values():
    image = np.full((100, 100, 3), 90, np.uint8)
    domain = np.zeros((100, 100), bool)
    domain[40:60, 40:60] = True
    analysis = analyze_surface(image, domain, window_sigma_px=2)
    mean, std, fallback, _ = analysis.window(-30, -30, (20, 20))
    assert fallback.all() and np.allclose(mean, analysis.global_mean_rgb) and np.allclose(std, analysis.global_luma_std)


def test_analysis_arrays_are_read_only():
    image = np.full((60, 60, 3), 90, np.uint8)
    domain = np.ones((60, 60), bool)
    analysis = analyze_surface(image, domain, window_sigma_px=3)
    for array in (analysis.mean_rgb, analysis.luma_std, analysis.fallback, analysis.flat):
        assert not array.flags.writeable
