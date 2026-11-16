"""Real-defect samples (config 1.1): YOLO labels, measurements, rule fitting, the "real" type, YOLO export and the API."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import zipfile

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.config import Settings
from app.core.exporter import write_dataset_zip
from app.core.image_io import encode_png
from app.core.pipeline import make_sampler
from app.core.samples import DefectSampleSet, load_defect_samples, suggest_params
from app.core.yolo import parse_labels, rasterize
from app.error_codes import DefectForgeError, ErrorCode
from app.main import create_app
from app.schemas.generation import ContaminationParams, GenerationConfig, GenerationConfigV11, PinholeParams, ScratchParams
from tests.helpers import make_source, textured_rgb, to_bytes
from tests.v11_helpers import box, exclude, include, margin_area, polygon_mask, principal_angle

W, H = 200, 160
SCRATCH = {"center": (80.0, 70.0), "length": 80.0, "width": 3.0, "angle": 30.0, "factor": 0.5}
SPOT = {"center": (160.0, 120.0), "radius": 5.0, "contrast": 0.6}


def scratch_polygon() -> np.ndarray:
    (cx, cy), t = SCRATCH["center"], math.radians(SCRATCH["angle"])
    d, n = np.array([math.cos(t), math.sin(t)]), np.array([-math.sin(t), math.cos(t)])
    half_l, half_w = SCRATCH["length"] / 2, SCRATCH["width"] / 2
    return np.array([[cx, cy] + s * half_l * d + q * half_w * n for s, q in [(-1, -1), (1, -1), (1, 1), (-1, 1)]])


def spot_polygon() -> np.ndarray:
    a = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    return np.stack([SPOT["center"][0] + SPOT["radius"] * np.cos(a), SPOT["center"][1] + SPOT["radius"] * np.sin(a)], axis=1)


def line(class_id: int, pixel_points: np.ndarray, width: int = W, height: int = H) -> str:
    return f"{class_id} " + " ".join(f"{x / width:.6f} {y / height:.6f}" for x, y in pixel_points)


def pixels_of(pixel_points: np.ndarray, width: int = W, height: int = H) -> np.ndarray:
    """Full-image bool mask of a polygon, by the same YOLO convention the engine uses."""
    x, y, region = rasterize(pixel_points / [width, height], width, height)
    out = np.zeros((height, width), bool)
    out[y : y + region.shape[0], x : x + region.shape[1]] = region
    return out


def drawn_sample(with_spot: bool = True) -> tuple[np.ndarray, bytes]:
    """Synthetic labelled sample: a dark scratch (class 0, contrast 0.5) and, optionally, a bright spot (class 1, 0.6)."""
    img = textured_rgb(H, W, seed=3).astype(np.float32)
    img[pixels_of(scratch_polygon())] *= SCRATCH["factor"]
    lines = [line(0, scratch_polygon())]
    if with_spot:
        spot = pixels_of(spot_polygon())
        img[spot] += SPOT["contrast"] * (255.0 - img[spot])
        lines.append(line(1, spot_polygon()))
    return np.clip(np.rint(img), 0, 255).astype(np.uint8), ("\n".join(lines) + "\n").encode()


def load(*pairs: tuple[np.ndarray, bytes], names: tuple[bytes, str] | None = None) -> DefectSampleSet:
    return load_defect_samples([(encode_png(img), label) for img, label in pairs], names, 2048)


def sample_set(with_spot: bool = True, names: tuple[bytes, str] | None = (b"line_mark\ndot\n", "classes.txt")) -> DefectSampleSet:
    return load(drawn_sample(with_spot), names=names)


def real_cfg(count: int = 4, **params) -> dict:
    return {"version": "1.1", "seed": 7, "defects": [{"type": "real", "count": count, "params": params}]}


def target():
    return make_source(textured_rgb(seed=11))


def run_real(cfg: dict, samples: DefectSampleSet | None, seed: int | None = None):
    parsed = GenerationConfigV11.model_validate(cfg)
    return make_sampler(target(), parsed, samples).generate(parsed.seed if seed is None else seed)


def _error(fn) -> DefectForgeError:
    with pytest.raises(DefectForgeError) as exc:
        fn()
    assert exc.value.code == ErrorCode.INVALID_DEFECT_SAMPLE
    return exc.value


# ---------------------------------------------------------------- labels and measurements


def test_measurements_match_the_drawn_defects():
    scratch, spot = sample_set().samples[0].measurements  # label order
    assert (scratch["class_id"], scratch["label_line"], spot["class_id"], spot["label_line"]) == (0, 1, 1, 2)
    assert scratch["polarity"] == "dark" and spot["polarity"] == "bright"
    assert scratch["length_px"] == pytest.approx(SCRATCH["length"], abs=3)
    assert scratch["width_px"] == pytest.approx(SCRATCH["width"], abs=1.2)  # polygon boundary pixels are included
    assert scratch["angle_deg"] == pytest.approx(SCRATCH["angle"], abs=1.5)
    assert scratch["contrast"] == pytest.approx(1 - SCRATCH["factor"], abs=0.06)
    assert spot["radius_px"] == pytest.approx(SPOT["radius"], abs=0.8)
    assert spot["contrast"] == pytest.approx(SPOT["contrast"], abs=0.06)
    assert scratch["area_px"] == int(pixels_of(scratch_polygon()).sum())


def test_line_like_defects_fit_scratches_and_the_rest_fit_spots():
    suggestions = suggest_params(sample_set().samples[0].measurements)
    scratch, pinhole, contamination = suggestions["scratch"], suggestions["pinhole"], suggestions["contamination"]
    ScratchParams(**scratch)
    PinholeParams(**pinhole)
    ContaminationParams(**contamination)
    assert scratch["polarity"] == "dark" and pinhole["polarity"] == contamination["polarity"] == "bright"
    assert scratch["length_px"][0] == pytest.approx(0.9 * 80, abs=3)
    assert scratch["contrast"][0] == pytest.approx(0.9 * 0.5, abs=0.06)
    assert pinhole["radius_px"][1] == pytest.approx(1.1 * 5, abs=1)

    img = textured_rgb(H, W, seed=3).astype(np.float32)
    img[pixels_of(spot_polygon())] *= 0.3
    only_spots = suggest_params(load((np.rint(img).astype(np.uint8), line(0, spot_polygon()).encode())).samples[0].measurements)
    assert only_spots["scratch"]["polarity"] == "dark"  # no line-like defect: scratches fall back to the spots
    assert only_spots["scratch"]["length_px"][1] == pytest.approx(1.1 * 11, abs=1.2)


def test_comments_blank_lines_and_crlf_are_accepted():
    img, label = drawn_sample()
    padded = b"# defects\r\n\r\n" + label.replace(b"\n", b"\r\n") + b"\r\n"
    assert [m["label_line"] for m in load((img, padded)).samples[0].measurements] == [3, 4]


@pytest.mark.parametrize(
    ("label", "needle"),
    [
        pytest.param(b"0 0.5 0.5 0.2 0.1\n", "박스 형식", id="box"),
        pytest.param(b"0 0.1 0.1 0.2 0.2 0.3\n", "x y 쌍", id="odd"),
        pytest.param(b"0 0.1 0.1 0.2 0.2\n0 0.1 0.1 0.2 0.2 0.3 0.1\n", "1번째 줄", id="two points"),
        pytest.param(b"0 0.1 0.1 0.2 0.2 1.5 0.3\n", "0~1", id="not normalised"),
        pytest.param(b"a 0.1 0.1 0.2 0.2 0.3 0.1\n", "정수", id="class text"),
        pytest.param(b"300 0.1 0.1 0.2 0.2 0.3 0.1\n", "범위", id="class range"),
        pytest.param(b"# only a comment\n\n", "결함이 없습니다", id="empty"),
        pytest.param(b"\xff\xfe0 0.1", "UTF-8", id="not utf-8"),
        pytest.param(b"0 0 0 1 0 1 1 0 1\n", "절반", id="covers everything"),
    ],
)
def test_bad_labels_fail_with_a_clear_message(label, needle):
    img, _ = drawn_sample()
    exc = _error(lambda: load_defect_samples([(encode_png(img), b"0 0.1 0.1 0.2 0.1 0.2 0.2\n"), (encode_png(img), label)], None, 2048))
    assert needle in exc.message and exc.message.startswith("결함 샘플 2:")


def test_bad_sample_image_names_the_sample():
    with pytest.raises(DefectForgeError) as exc:
        load_defect_samples([(b"junk", drawn_sample()[1])], None, 2048)
    assert exc.value.code == ErrorCode.INVALID_IMAGE and exc.value.message.startswith("결함 샘플 1 이미지:")


@pytest.mark.parametrize(
    ("content", "filename"),
    [
        pytest.param(b"line_mark\ndot\n\n", "classes.txt", id="classes.txt"),
        pytest.param(b"path: ../data\nnames: ['line_mark', \"dot\"]  # two\nnc: 2\n", "data.yaml", id="flow list"),
        pytest.param(b"nc: 2\nnames:\n  - line_mark\n  - dot\ntrain: images\n", "data.yaml", id="block list"),
        pytest.param(b"names:\n  0: line_mark\n  1: 'dot'\n", "dataset.yml", id="indexed"),
        pytest.param(b"names: {0: line_mark, 1: dot}\n", "data.yaml", id="flow map"),
    ],
)
def test_class_names_from_classes_txt_or_data_yaml(content, filename):
    loaded = load(drawn_sample(), names=(content, filename))
    assert loaded.class_names == ("line_mark", "dot")
    assert loaded.class_names_sha256 == hashlib.sha256(content).hexdigest()


def test_class_name_problems():
    assert load(drawn_sample()).class_names == ("class_0", "class_1")  # no names file
    assert "중복" in _error(lambda: load(drawn_sample(), names=(b"a\na\n", "classes.txt"))).message
    assert "이름은 1개" in _error(lambda: load(drawn_sample(), names=(b"line_mark\n", "classes.txt"))).message
    assert "names" in _error(lambda: load(drawn_sample(), names=(b"nc: 2\n", "data.yaml"))).message
    assert "0부터" in _error(lambda: load(drawn_sample(), names=(b"names:\n  1: a\n  2: b\n", "data.yaml"))).message


# ---------------------------------------------------------------- the "real" type


def _assert_contract(result, source_rgb: np.ndarray, class_ids: set[int]) -> np.ndarray:
    changed = (result.image != source_rgb).any(axis=2)
    assert np.array_equal(result.binary_mask, changed.astype(np.uint8) * 255)
    assert np.array_equal(result.class_mask > 0, changed)
    assert set(np.unique(result.class_mask).tolist()) <= {0, *class_ids}
    return changed


def test_real_defects_keep_their_label_class_and_stay_inside_the_allowed_area():
    source = target()
    hole = box(180, 150, 300, 260)
    cfg = real_cfg(8, scale=[0.7, 1.4]) | {"regions": [include("a", box(20, 20, 480, 420)), exclude("hole", hole)], "edge_margin_px": 2}
    result = make_sampler(source, GenerationConfigV11.model_validate(cfg), sample_set()).generate(7)
    changed = _assert_contract(result, source.rgb, {6, 7})
    allowed = margin_area(polygon_mask(box(20, 20, 480, 420), source) & ~polygon_mask(hole, source), 2.0)
    assert changed.any() and not (changed & ~allowed).any()
    meta = result.metadata
    assert meta["class_map"]["6"] == "real:line_mark" and meta["class_map"]["7"] == "real:dot"
    for inst in meta["instances"]:
        p = inst["params"]
        assert inst["class_id"] == 6 + p["label_class"] and p["class_name"] == ["line_mark", "dot"][p["label_class"]]
        assert int((result.class_mask == inst["class_id"]).sum()) > 0
    assert {i["class_id"] for i in meta["instances"]} == {6, 7}
    assert meta["class_pixel_counts"]["real:dot"] == int((result.class_mask == 7).sum())
    assert meta["real_samples"]["class_names"] == ["line_mark", "dot"] and meta["algorithm_versions"]["real_defect"] == "1.1"


def test_keep_rotation_at_scale_one_copies_the_sample_change_exactly():
    result = run_real(real_cfg(1, rotation="keep", scale=[1, 1], intensity=[1, 1]), sample_set(with_spot=False, names=None))
    changed = _assert_contract(result, target().rgb, {6})
    assert principal_angle(changed) == pytest.approx(SCRATCH["angle"], abs=1.5)
    assert int(changed.sum()) <= int(pixels_of(scratch_polygon()).sum())
    delta = result.image.astype(np.int16) - target().rgb
    assert delta[changed].max() <= 0 and delta[changed].mean() < -30
    assert result.metadata["instances"][0]["params"] | {"scale": 1, "intensity": 1} == {
        "sample_index": 0, "defect_index": 0, "label_class": 0, "class_name": "class_0",
        "scale": 1, "intensity": 1, "rotation": "keep", "angle_deg": 0.0, "mirrored": False,
    }


def test_intensity_scales_the_transferred_change():
    src = target().rgb.astype(np.int16)
    samples = sample_set(with_spot=False)
    one = run_real(real_cfg(1, rotation="keep", intensity=[1, 1]), samples)
    half = run_real(real_cfg(1, rotation="keep", intensity=[0.5, 0.5]), samples)
    region = one.binary_mask == 255
    ratio = np.abs(half.image.astype(np.int16) - src)[region].mean() / np.abs(one.image.astype(np.int16) - src)[region].mean()
    assert ratio == pytest.approx(0.5, abs=0.06)


def test_same_seed_reproduces_and_free_rotation_varies_the_angle():
    samples = sample_set()
    a, b, c = run_real(real_cfg(6), samples), run_real(real_cfg(6), samples), run_real(real_cfg(6), samples, seed=8)
    assert np.array_equal(a.image, b.image) and np.array_equal(a.class_mask, b.class_mask)
    assert not np.array_equal(a.image, c.image)
    assert len({inst["params"]["angle_deg"] for inst in a.metadata["instances"]}) == 6


def test_real_needs_samples_and_config_10_refuses_it():
    assert "YOLO 라벨" in _error(lambda: run_real(real_cfg(), None)).message
    with pytest.raises(ValidationError):
        GenerationConfig.model_validate({"version": "1.0", "defects": [{"type": "real"}]})


def test_unused_samples_change_nothing():
    cfg = GenerationConfigV11.model_validate({"version": "1.1", "seed": 4, "defects": [{"type": "pinhole", "count": 3}]})
    source = make_source(textured_rgb())
    with_samples = make_sampler(source, cfg, sample_set()).generate(4)
    without = make_sampler(source, cfg).generate(4)
    assert np.array_equal(with_samples.image, without.image)
    assert with_samples.metadata["real_samples"] is None and "6" not in with_samples.metadata["class_map"]


# ---------------------------------------------------------------- YOLO export


def _filled(mask: np.ndarray) -> np.ndarray:
    """``mask`` with enclosed holes filled (flood fill of the outside; independent of the writer)."""
    outside = np.pad((~mask).astype(np.uint8), 1, constant_values=1)
    cv2.floodFill(outside, None, (0, 0), 2)  # 4-connected: background touching only diagonally stays a hole
    return mask | (outside[1:-1, 1:-1] == 1)


def _read_back(text: str, width: int, height: int) -> dict[int, np.ndarray]:
    painted: dict[int, np.ndarray] = {}
    for poly in parse_labels(text.encode(), lambda m: AssertionError(m)):
        x, y, region = rasterize(poly.points, width, height)
        canvas = painted.setdefault(poly.class_id, np.zeros((height, width), bool))
        canvas[y : y + region.shape[0], x : x + region.shape[1]] |= region
    return painted


def test_yolo_labels_read_back_to_the_mask_pixels_with_source_class_numbers():
    cfg = GenerationConfigV11.model_validate(
        {"version": "1.1", "seed": 3, "defects": [{"type": "scratch", "count": 2}, {"type": "pinhole", "count": 3}, {"type": "real", "count": 4}]}
    )
    buf = io.BytesIO()
    manifest = write_dataset_zip(target(), cfg, 3, buf, defect_samples=sample_set())
    yolo_of = {int(k): v for k, v in manifest["yolo"]["class_id_to_yolo"].items()}
    assert yolo_of == {6: 0, 7: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6}  # label classes keep 0, 1; rule types follow
    with zipfile.ZipFile(buf) as zf:
        data_yaml = zf.read("data.yaml").decode()
        assert 'names:\n  0: "line_mark"\n  1: "dot"\n  2: "scratch"' in data_yaml
        for entry in manifest["files"]:
            class_mask = np.array(Image.open(io.BytesIO(zf.read(entry["class_mask"]))))
            painted = _read_back(zf.read(entry["label"]).decode(), *class_mask.shape[::-1])
            present = {int(c) for c in np.unique(class_mask)} - {0}
            assert {yolo_of[c] for c in present} == set(painted)
            for cid in present:
                actual = class_mask == cid
                assert np.array_equal(painted[yolo_of[cid]], _filled(actual)), cid


def test_yolo_labels_without_real_defects_number_the_rule_types_from_zero():
    cfg = GenerationConfigV11.model_validate({"version": "1.1", "seed": 3, "defects": [{"type": "contamination", "count": 2}]})
    buf = io.BytesIO()
    manifest = write_dataset_zip(target(), cfg, 1, buf)
    assert manifest["yolo"]["names"] == {0: "scratch", 1: "pinhole", 2: "contamination", 3: "texture", 4: "patch"}
    with zipfile.ZipFile(buf) as zf:
        assert {ln.split()[0] for ln in zf.read("labels/image_0001.txt").decode().splitlines()} == {"2"}
        assert "[YOLO 라벨" in zf.read("README.txt").decode()


# ---------------------------------------------------------------- API


def _sample_files(*pairs: tuple[bytes, bytes], names: tuple[str, bytes] | None = None) -> list[tuple[str, tuple[str, bytes, str]]]:
    files = []
    for i, (image, label) in enumerate(pairs):
        files.append(("defect_images", (f"defect{i}.png", image, "image/png")))
        files.append(("defect_labels", (f"defect{i}.txt", label, "text/plain")))
    if names is not None:
        files.append(("class_names", (names[0], names[1], "text/plain")))
    return files


def _pair() -> tuple[bytes, bytes]:
    img, label = drawn_sample()
    return encode_png(img), label


def test_analyze_endpoint_returns_classes_measurements_and_suggestions(client):
    response = client.post("/api/v1/defect-samples/analyze", files=_sample_files(_pair(), _pair(), names=("classes.txt", b"line_mark\ndot\n")))
    assert response.status_code == 200, response.text
    body = response.json()
    assert [s["defect_count"] for s in body["samples"]] == [2, 2]
    assert body["samples"][0]["label_sha256"] == hashlib.sha256(_pair()[1]).hexdigest()
    assert body["classes"] == [{"id": 0, "name": "line_mark", "defect_count": 2}, {"id": 1, "name": "dot", "defect_count": 2}]
    assert len(body["defects"]) == 4 and body["defects"][2]["sample_index"] == 1
    assert body["fitted_from"] == {"scratch": 2, "pinhole": 2, "contamination": 2}


def test_analyze_endpoint_rejects_bad_input(client):
    image, label = _pair()
    unpaired = client.post("/api/v1/defect-samples/analyze", files=[("defect_images", ("a.png", image, "image/png"))])
    assert unpaired.status_code == 400 and unpaired.json()["error"]["code"] == "MISSING_FIELD"
    mismatched = client.post("/api/v1/defect-samples/analyze", files=_sample_files((image, label)) + [("defect_images", ("b.png", image, "image/png"))])
    assert mismatched.status_code == 422 and "라벨 파일(1개)" in mismatched.json()["error"]["message"]
    too_many = client.post("/api/v1/defect-samples/analyze", files=_sample_files(*[(image, label)] * 9))
    assert too_many.status_code == 422 and "최대 8개" in too_many.json()["error"]["message"]
    box_label = client.post("/api/v1/defect-samples/analyze", files=_sample_files((image, b"0 0.5 0.5 0.1 0.1\n")))
    assert box_label.status_code == 422 and box_label.json()["error"]["message"].startswith("결함 샘플 1: 라벨 1번째 줄이 박스")


def test_sample_files_have_a_combined_size_budget(tmp_path):
    image, label = _pair()
    small = TestClient(create_app(Settings(export_tmp_dir=str(tmp_path), max_defect_sample_bytes=len(image) + len(label) + 10)))
    assert small.post("/api/v1/defect-samples/analyze", files=_sample_files((image, label))).status_code == 200
    over = small.post("/api/v1/defect-samples/analyze", files=_sample_files((image, label), (image, label)))
    assert over.status_code == 413 and over.json()["error"]["code"] == "FILE_TOO_LARGE"


def _preview(client, cfg: dict, files: list):
    surface = [("file", ("surface.png", to_bytes(textured_rgb(seed=11)), "image/png"))]
    return client.post("/api/v1/preview", files=surface + files, data={"config": json.dumps(cfg)})


def test_preview_with_real_samples(client):
    response = _preview(client, real_cfg(6), _sample_files(_pair(), names=("data.yaml", b"names: [line_mark, dot]\n")))
    assert response.status_code == 200, response.text
    meta = response.json()["metadata"]
    assert meta["generated_count"] == 6 and meta["class_map"]["7"] == "real:dot"
    assert meta["real_samples"]["samples"][0]["label_sha256"] == hashlib.sha256(_pair()[1]).hexdigest()
    class_mask = np.array(Image.open(io.BytesIO(base64.b64decode(response.json()["class_mask_png_base64"]))))
    assert set(np.unique(class_mask).tolist()) == {0, 6, 7}


def test_preview_real_without_samples_fails_and_samples_are_ignored_otherwise(client):
    missing = _preview(client, real_cfg(), [])
    assert missing.status_code == 422 and missing.json()["error"]["code"] == "INVALID_DEFECT_SAMPLE"
    junk = _sample_files((b"junk", b"junk"))  # never decoded: no "real" defect requested
    plain = _preview(client, {"version": "1.1", "defects": [{"type": "pinhole"}]}, junk)
    assert plain.status_code == 200 and plain.json()["metadata"]["real_samples"] is None


def test_export_records_the_samples_and_writes_yolo_labels(client):
    surface = [("file", ("surface.png", to_bytes(textured_rgb(seed=11)), "image/png"))]
    response = client.post(
        "/api/v1/export",
        files=surface + _sample_files(_pair(), names=("classes.txt", b"line_mark\ndot\n")),
        data={"config": json.dumps(real_cfg(2)), "sample_count": "2"},
    )
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        readme = zf.read("README.txt").decode("utf-8")
        labels = zf.read("labels/image_0002.txt").decode()
        assert "data.yaml" in zf.namelist()
    assert manifest["real_samples"]["samples"][0]["image_sha256"] == hashlib.sha256(_pair()[0]).hexdigest()
    assert manifest["files"][1]["label"] == "labels/image_0002.txt"
    assert "6 = real:line_mark" in readme and "0 = line_mark, 1 = dot" in readme and "평가(test) 데이터" in readme
    assert {ln.split()[0] for ln in labels.splitlines()} <= {"0", "1"}
