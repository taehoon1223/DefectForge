"""Config version 1.0 must stay bit-identical after the v1.1 extension (areas + scratch options).

Golden values were computed with the v1.0 engine *before* any v1.1 code existed (commit 7387978).
If one of these fails, the basic mode's random-number order or composition maths changed.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.core.generation import generate_sample
from app.core.image_io import decode_image, encode_png
from app.schemas.generation import GenerationConfig
from tests.helpers import RECT_ROI, full_config, make_source, post_preview, textured_rgb, to_bytes

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "frontend" / "public" / "samples" / "brushed_metal_512x448.png"

# name -> (sha256 of image+class+binary PNG bytes, sha256 of metadata JSON)
GOLDEN = {
    "full_rect_roi_seed42": ("215526c973244347726dba52dcb6e2ca545f4abd218ff0f8e400a9c46e00f2d5", "4608c6b536130bff6f8a74094bb0c6bfe1307e4ecd74c2e048f09834f12753a8"),
    "full_overlap_seed1234": ("3abb29a5225ef81c9c1d60cf838d0e6b7b4072c9c1b99db225a63aeadf53b853", "92a99b025dfebe46eece68c4c3d4fea592cc3fbb844b5ea839dc24b41ac33e79"),
    "example_contamination": ("08736d18e0fc4bf9e66344b8f71aef10f9b7606f8eb197ced45db670fd414c71", "e7d91a2551314f8d8fdde2c284ef0e149f9683f25c88dafb313a092aa5127cab"),
    "example_pinhole": ("7eee921845f049541ca33dc7d521721be7eb98edf33b1c4ac65f934df5821596", "f185e19ffaf8957a925918bb67087a896e323194e71d6a16810e2a947a1bfd42"),
    "example_scratch": ("987682ef74e92d45574157d3acc6bd39b281eda5b3ceb7a371db44db5bcbb144", "fc68fbb1821ecf7424d966ccc02499b025987de9c7c38178c2b818569ce1018b"),
}
GOLDEN_PREVIEW_RESPONSE = "843f5aa68714d79e51a058b9c8af5984a188979080a399786d08dccd1bd6e14d"


def _digest(source, cfg_dict, seed):
    result = generate_sample(source, GenerationConfig.model_validate(cfg_dict), seed)
    pixels = hashlib.sha256(encode_png(result.image) + encode_png(result.class_mask) + encode_png(result.binary_mask)).hexdigest()
    meta = hashlib.sha256(json.dumps(result.metadata, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return pixels, meta


def _cases():
    textured = make_source(textured_rgb())
    yield "full_rect_roi_seed42", textured, full_config(roi=RECT_ROI), 42
    yield "full_overlap_seed1234", textured, full_config(allow_overlap=True), 1234
    sample = decode_image(SAMPLE.read_bytes(), 32, 2048)
    for path in sorted((ROOT / "examples" / "configs").glob("*.json")):
        if path.stem in ("contamination", "pinhole", "scratch"):
            cfg = json.loads(path.read_text(encoding="utf-8"))
            yield f"example_{path.stem}", sample, cfg, cfg["seed"]


@pytest.mark.parametrize("case", list(_cases()), ids=lambda c: c[0])
def test_v1_engine_output_is_unchanged(case):
    name, source, cfg, seed = case
    assert _digest(source, cfg, seed) == GOLDEN[name]


def test_v1_preview_response_is_unchanged(client):
    resp = post_preview(client, to_bytes(textured_rgb()), full_config(roi=RECT_ROI))
    body = resp.json()
    body.pop("processing_ms")
    assert hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest() == GOLDEN_PREVIEW_RESPONSE
