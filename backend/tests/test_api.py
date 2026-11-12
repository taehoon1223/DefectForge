"""HTTP contract: T01, T02, T05, T07, T08, T12 and error format."""

from __future__ import annotations

import base64
import io
import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import routes
from app.config import Settings
from app.main import create_app
from tests.helpers import RECT_ROI, full_config, post_preview, textured_rgb, to_bytes


def _assert_error(resp, status: int, code: str) -> dict:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == code
    assert body["error"]["message"]
    return body["error"]


def _b64_image(value: str) -> np.ndarray:
    assert not value.startswith("data:")
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(value))))


def test_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200 and resp.json() == {"status": "ok", "version": "1.2.0"}


def test_openapi_docs_enabled(client):
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert {"/api/v1/health", "/api/v1/preview", "/api/v1/export"} <= set(schema["paths"])


@pytest.mark.parametrize(("fmt", "name", "kwargs"), [("PNG", "a.png", {}), ("JPEG", "a.jpg", {"quality": 92}), ("WEBP", "a.webp", {"quality": 90})])
def test_preview_accepts_png_jpeg_webp(client, fmt, name, kwargs):  # T01, T02, T07, T08
    rgb = textured_rgb()
    resp = post_preview(client, to_bytes(rgb, fmt, **kwargs), full_config(roi=RECT_ROI), filename=name)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    image = _b64_image(body["image_png_base64"])
    cls = _b64_image(body["class_mask_png_base64"])
    binary = _b64_image(body["binary_mask_png_base64"])
    assert image.shape == (448, 512, 3) and cls.shape == binary.shape == (448, 512)
    meta = body["metadata"]
    assert meta["generated_count"] == meta["requested_count"] == 7
    assert (meta["width"], meta["height"]) == (512, 448)
    # Mask contract holds against the server-normalised source (for lossless PNG that is the upload itself).
    if fmt == "PNG":
        assert np.array_equal(binary, (image != rgb).any(axis=2).astype(np.uint8) * 255)
    assert (cls[binary == 0] == 0).all()
    assert body["processing_ms"] >= 0


def test_preview_is_deterministic_over_http(client, surface_png):  # T05
    a = post_preview(client, surface_png, full_config()).json()
    b = post_preview(client, surface_png, full_config()).json()
    for key in ("image_png_base64", "class_mask_png_base64", "binary_mask_png_base64", "metadata"):
        assert a[key] == b[key]


@pytest.mark.parametrize(
    ("payload", "name"),
    [(b"plain text, not an image", "fake.png"), (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "broken.png")],
)
def test_preview_rejects_bad_files(client, payload, name):  # T01
    _assert_error(post_preview(client, payload, full_config(), filename=name), 422, "INVALID_IMAGE")


def test_preview_rejects_gif(client):  # T01 (wrong format even with a .png name)
    gif = to_bytes(textured_rgb(64, 64), "GIF")
    _assert_error(post_preview(client, gif, full_config(), filename="looks_like.png"), 422, "UNSUPPORTED_IMAGE_FORMAT")


def test_upload_over_10_mib_rejected(client):  # T12
    just_over = b"\x00" * (10 * 1024 * 1024 + 1)  # passes the header guard, caught while streaming
    _assert_error(post_preview(client, just_over, full_config()), 413, "FILE_TOO_LARGE")
    way_over = b"\x00" * (12 * 1024 * 1024)  # caught by the Content-Length guard
    _assert_error(post_preview(client, way_over, full_config()), 413, "FILE_TOO_LARGE")


def test_image_over_2048_rejected(client):  # T12
    big = to_bytes(np.zeros((40, 2049, 3), np.uint8))
    err = _assert_error(post_preview(client, big, full_config()), 422, "IMAGE_DIMENSIONS_OUT_OF_RANGE")
    assert err["details"]["width"] == 2049


@pytest.mark.parametrize(
    "roi",
    [[], [[10, 10], [20, 20]], [[10, 10], [100, 100], [100, 10], [10, 100]], [[0, 0], [600, 0], [0, 100]]],
)
def test_invalid_roi_rejected(client, surface_png, roi):  # T12 (empty ROI and friends)
    _assert_error(post_preview(client, surface_png, full_config(roi=roi)), 422, "INVALID_ROI")


@pytest.mark.parametrize(
    ("mutate", "field_fragment"),
    [
        (lambda c: c["defects"][0].update(count=0), "count"),
        (lambda c: c["defects"][0].update(count=21), "count"),
        (lambda c: c["defects"][0]["params"].update(length_px=[200, 100]), "length_px"),
        (lambda c: c["defects"][0]["params"].update(width_px=[1, 99]), "width_px"),
        (lambda c: c["defects"][1]["params"].update(polarity="purple"), "polarity"),
        (lambda c: c["defects"][2]["params"].update(blur_sigma=9), "blur_sigma"),
        (lambda c: c["defects"][0]["params"].update(unknown=1), "unknown"),
        (lambda c: c.update(seed=-1), "seed"),
        (lambda c: c.update(defects=[]), "defects"),
        (lambda c: c.update(defects=[{"type": "crack", "count": 1}]), "defects"),
        (lambda c: c.update(defects=[{"type": "pinhole"}, {"type": "pinhole"}]), "defects"),
        (lambda c: c.update(roi=[[1.5, 2], [3, 4], [5, 6]]), "roi"),
    ],
)
def test_invalid_params_rejected_with_field_details(client, surface_png, mutate, field_fragment):  # T12
    cfg = full_config()
    mutate(cfg)
    err = _assert_error(post_preview(client, surface_png, cfg), 422, "INVALID_CONFIG")
    assert any(field_fragment in e["field"] for e in err["details"]["errors"]), err


def test_nan_rejected(client, surface_png):
    raw = json.dumps(full_config()).replace('"curvature": 0.2', '"curvature": NaN')
    _assert_error(post_preview(client, surface_png, raw), 422, "INVALID_CONFIG")


def test_missing_fields_and_bad_json(client, surface_png):
    _assert_error(client.post("/api/v1/preview", data={"config": "{}"}), 400, "MISSING_FIELD")
    resp = client.post("/api/v1/preview", files={"file": ("a.png", surface_png, "image/png")})
    _assert_error(resp, 400, "MISSING_FIELD")
    _assert_error(post_preview(client, surface_png, "{not json"), 400, "INVALID_JSON")
    _assert_error(post_preview(client, surface_png, "[1, 2]"), 422, "INVALID_CONFIG")


def test_placement_failure_is_422(client, surface_png):
    cfg = full_config(roi=[[100, 100], [120, 100], [120, 120]], defects=[{"type": "scratch", "count": 1, "params": {"length_px": [300, 400]}}])
    err = _assert_error(post_preview(client, surface_png, cfg), 422, "DEFECT_PLACEMENT_FAILED")
    assert err["details"]["defect_type"] == "scratch"


def test_internal_errors_do_not_leak_details(client, surface_png, monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError(f"secret failure in {os.getcwd()}")

    monkeypatch.setattr(routes, "make_sampler", boom)
    err = _assert_error(post_preview(client, surface_png, full_config()), 500, "INTERNAL_ERROR")
    assert "secret" not in json.dumps(err) and os.getcwd() not in json.dumps(err)


def test_server_busy_returns_429(surface_png):
    app = create_app(Settings(max_concurrent_jobs=1, job_wait_seconds=0.01))
    app.state.jobs._semaphore.acquire()  # simulate a running job
    try:
        _assert_error(post_preview(TestClient(app), surface_png, full_config()), 429, "SERVER_BUSY")
    finally:
        app.state.jobs._semaphore.release()


def test_cors_allows_only_configured_origins(client):
    ok = client.options("/api/v1/preview", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/api/v1/preview", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
    # Error responses carry CORS headers too (so the browser can read the Korean message).
    err = client.post("/api/v1/preview", data={"config": "{}"}, headers={"Origin": "http://localhost:5173"})
    assert err.headers.get("access-control-allow-origin") == "http://localhost:5173"
