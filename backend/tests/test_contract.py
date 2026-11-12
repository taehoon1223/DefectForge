"""Cross-component contract: frontend limits/defaults mirror the backend; example configs work."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import MIN_IMAGE_DIM, Settings
from app.core.generation import generate_sample
from app.core.image_io import decode_image
from app.schemas.generation import DEFAULTS, LIMITS, ROI_MAX_POINTS, SEED_MAX, GenerationConfig

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_LIMITS = ROOT / "frontend" / "src" / "types" / "limits.json"
SAMPLE_IMAGE = ROOT / "frontend" / "public" / "samples" / "brushed_metal_512x448.png"
EXAMPLES = sorted((ROOT / "examples" / "configs").glob("*.json"))


def _frontend() -> dict:
    return json.loads(FRONTEND_LIMITS.read_text(encoding="utf-8"))


def test_defect_limits_and_defaults_match_frontend():
    data = _frontend()
    assert set(data["defects"]) == set(LIMITS)
    for kind, spec in data["defects"].items():
        assert {k: tuple(v) for k, v in spec["limits"].items()} == {k: tuple(v) for k, v in LIMITS[kind].items()}, kind
        assert spec["defaults"] == DEFAULTS[kind], kind


def test_global_limits_match_frontend():
    data = _frontend()
    settings = Settings()
    assert data["seed"] == {"min": 0, "max": SEED_MAX, "default": GenerationConfig.model_fields["seed"].default}
    assert data["roiMaxPoints"] == ROI_MAX_POINTS
    assert data["image"]["minDim"] == MIN_IMAGE_DIM
    assert data["image"]["maxDim"] == settings.max_image_dim
    assert data["image"]["maxUploadBytes"] == settings.max_upload_bytes
    assert data["exportCount"]["max"] == settings.max_export_count and data["exportCount"]["min"] == 1


def test_three_example_configs_exist():
    assert [p.name for p in EXAMPLES] == ["contamination.json", "pinhole.json", "scratch.json"]


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_example_configs_generate_on_bundled_sample(path):
    source = decode_image(SAMPLE_IMAGE.read_bytes(), 32, 2048)
    config = GenerationConfig.model_validate_json(path.read_text(encoding="utf-8"))
    result = generate_sample(source, config, config.seed)
    meta = result.metadata
    assert meta["generated_count"] == meta["requested_count"] > 0
    assert {i["type"] for i in meta["instances"]} == {path.stem}
