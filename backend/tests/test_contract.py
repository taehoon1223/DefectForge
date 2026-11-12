"""Cross-component contract: frontend limits/defaults mirror the backend; example configs work."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.api.routes import parse_config
from app.config import MIN_IMAGE_DIM, Settings
from app.core.image_io import decode_image
from app.core.pipeline import make_sampler
from app.schemas.generation import (
    AREA_DEFAULTS,
    AREA_LIMITS,
    DEFAULTS,
    LIMITS,
    REFERENCE_LINE_MIN_LENGTH_PX,
    REGION_MAX_COUNT,
    ROI_MAX_POINTS,
    SCRATCH_OPTION_DEFAULTS,
    SCRATCH_OPTION_LIMITS,
    SEED_MAX,
    GenerationConfig,
)

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_LIMITS = ROOT / "frontend" / "src" / "types" / "limits.json"
SAMPLES = ROOT / "frontend" / "public" / "samples"
EXAMPLES = sorted((ROOT / "examples" / "configs").glob("*.json"))
# config 1.0 examples run on the brushed-metal sample, the 1.1 example on the synthetic part sample
EXAMPLE_IMAGES = {
    "scratch": "brushed_metal_512x448.png",
    "pinhole": "brushed_metal_512x448.png",
    "contamination": "brushed_metal_512x448.png",
    "regions_scratch": "part_synthetic_640x400.png",
}


def _frontend() -> dict:
    return json.loads(FRONTEND_LIMITS.read_text(encoding="utf-8"))


def test_defect_limits_and_defaults_match_frontend():
    data = _frontend()
    assert set(data["defects"]) == set(LIMITS)
    for kind, spec in data["defects"].items():
        assert {k: tuple(v) for k, v in spec["limits"].items()} == {k: tuple(v) for k, v in LIMITS[kind].items()}, kind
        assert spec["defaults"] == DEFAULTS[kind], kind


def test_v11_limits_and_defaults_match_frontend():
    data = _frontend()
    area, options = data["area"], data["scratchOptions"]
    assert {k: tuple(v) for k, v in area["limits"].items()} == {k: tuple(v) for k, v in AREA_LIMITS.items()}
    assert area["defaults"] == AREA_DEFAULTS
    assert area["regionMaxCount"] == REGION_MAX_COUNT
    assert area["referenceLineMinLengthPx"] == REFERENCE_LINE_MIN_LENGTH_PX
    assert {k: tuple(v) for k, v in options["limits"].items()} == {k: tuple(v) for k, v in SCRATCH_OPTION_LIMITS.items()}
    assert options["defaults"] == SCRATCH_OPTION_DEFAULTS


def test_global_limits_match_frontend():
    data = _frontend()
    settings = Settings()
    assert data["seed"] == {"min": 0, "max": SEED_MAX, "default": GenerationConfig.model_fields["seed"].default}
    assert data["roiMaxPoints"] == ROI_MAX_POINTS
    assert data["image"]["minDim"] == MIN_IMAGE_DIM
    assert data["image"]["maxDim"] == settings.max_image_dim
    assert data["image"]["maxUploadBytes"] == settings.max_upload_bytes
    assert data["exportCount"]["max"] == settings.max_export_count and data["exportCount"]["min"] == 1


def test_example_configs_exist():
    assert sorted(p.stem for p in EXAMPLES) == sorted(EXAMPLE_IMAGES)


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_example_configs_generate_on_bundled_samples(path):
    source = decode_image((SAMPLES / EXAMPLE_IMAGES[path.stem]).read_bytes(), 32, 2048)
    config = parse_config(path.read_text(encoding="utf-8"))
    result = make_sampler(source, config).generate(config.seed)
    meta = result.metadata
    assert meta["generated_count"] == meta["requested_count"] > 0
    expected_type = "scratch" if path.stem == "regions_scratch" else path.stem
    assert {i["type"] for i in meta["instances"]} == {expected_type}
