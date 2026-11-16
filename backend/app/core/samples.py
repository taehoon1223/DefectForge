"""Real-defect samples: uploaded (defect image, YOLO polygon label) pairs -> exemplars + measurements.

Label rule (core/yolo.py): one defect per line, ``class x1 y1 x2 y2 ...`` normalised to 0–1; its
pixels are the polygon filled the Ultralytics way. Class names come from an optional classes.txt /
data.yaml, otherwise "class_<k>". At most MAX_DEFECTS_PER_SAMPLE defects (the largest) per sample.

Exemplar (residual transfer):
    background = cv2.inpaint(image, all defect pixels grown by 2px, Telea)   the surface without defects
    delta      = image - background inside the defect, 0 elsewhere           what the defect did to it
The "real" generator adds a transformed ``delta`` to another surface, so the defect keeps its own
shape and shading while the new surface keeps its own colour and texture.

Measurements, per defect, from its pixels and the luma of image (s) and background (b):
    angle  = principal axis of the pixel cloud (image moments), [0, 180)
    length = extent along that axis; width = area / length; radius = sqrt(area / pi)
    polarity = dark if median(s - b) < 0 else bright
    contrast = 90th percentile of |s - b| / room toward black (b) or white (255 - b)   ~ scratch/pinhole
    opacity  = the same toward the contamination colour (luma ~50 dark, ~240 bright)    ~ contamination
They are fitted into the rule-based parameters by ``suggest_params``: line-like defects (length >= 3 ×
width) to scratches, the others to pinholes/contamination, as [0.9 · min, 1.1 · max] clipped to the limits.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.core.image_io import SourceImage, decode_image
from app.core.yolo import LabelPolygon, parse_class_names, parse_labels, rasterize
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import LIMITS

SAMPLE_ANALYSIS_VERSION = "1.1"
SAMPLE_MIN_DIM = 8  # a defect crop may be much smaller than a whole surface image
MAX_DEFECTS_PER_SAMPLE = 32
MAX_LABEL_COVERAGE = 0.5  # labels covering more than this leave too little surface to estimate the background
LINE_ELONGATION = 3.0  # length / width at or above this = line-like (fitted to scratches)

_PAD = 2  # zero border around each exemplar so bilinear warping fades out cleanly
_GROW = 2  # defect pixels grown by this before inpainting, so blurred edges are not taken as surface
_INPAINT_RADIUS = 3
_LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
_CONTAMINATION_LUMA = {"dark": 50.0, "bright": 240.0}


@dataclass(frozen=True)
class Exemplar:
    sample_index: int
    defect_index: int
    class_id: int  # YOLO class number from the label
    delta: np.ndarray  # (h, w, 3) float32: image - background inside the defect, 0 elsewhere
    mask: np.ndarray  # (h, w) float32: 1 inside the defect, 0 elsewhere


@dataclass(frozen=True)
class DefectSample:
    index: int
    image: SourceImage
    label_sha256: str
    exemplars: tuple[Exemplar, ...]
    measurements: tuple[dict[str, Any], ...]

    @property
    def info(self) -> dict[str, Any]:
        classes = [e.class_id for e in self.exemplars]
        return {
            "index": self.index,
            "width": self.image.width,
            "height": self.image.height,
            "image_sha256": self.image.sha256,
            "label_sha256": self.label_sha256,
            "defect_count": len(self.exemplars),
            "class_counts": {str(k): classes.count(k) for k in sorted(set(classes))},
        }


@dataclass(frozen=True)
class DefectSampleSet:
    samples: tuple[DefectSample, ...]
    class_names: tuple[str, ...]  # YOLO class k -> name
    class_names_sha256: str | None  # None = names were generated ("class_<k>")

    @property
    def exemplars(self) -> tuple[Exemplar, ...]:
        return tuple(e for s in self.samples for e in s.exemplars)

    @property
    def metadata(self) -> dict[str, Any]:
        return {"samples": [s.info for s in self.samples], "class_names": list(self.class_names), "class_names_sha256": self.class_names_sha256}


def _r4(value: float) -> float:
    return round(float(value), 4)


def sample_error(number: int, message: str, **details: Any) -> DefectForgeError:
    return DefectForgeError(ErrorCode.INVALID_DEFECT_SAMPLE, f"결함 샘플 {number}: {message}", {"sample": number, **details})


def names_error(message: str) -> DefectForgeError:
    return DefectForgeError(ErrorCode.INVALID_DEFECT_SAMPLE, f"클래스 이름 파일: {message}")


def load_defect_samples(
    pairs: Sequence[tuple[bytes, bytes]], class_names: tuple[bytes, str] | None, max_dim: int
) -> DefectSampleSet:
    """``pairs`` = (image bytes, label txt bytes); ``class_names`` = (bytes, filename) of classes.txt / data.yaml."""
    samples = tuple(load_defect_sample(i, image, label, max_dim) for i, (image, label) in enumerate(pairs))
    used = sorted({e.class_id for s in samples for e in s.exemplars})
    if class_names is None:
        return DefectSampleSet(samples, tuple(f"class_{k}" for k in range(used[-1] + 1 if used else 0)), None)
    data, filename = class_names
    names = parse_class_names(data, filename, names_error)
    missing = [k for k in used if k >= len(names)]
    if missing:
        raise names_error(f"라벨에 클래스 {missing[0]}이(가) 있지만 이름은 {len(names)}개(0~{len(names) - 1})뿐입니다.")
    return DefectSampleSet(samples, tuple(names), hashlib.sha256(data).hexdigest())


def load_defect_sample(index: int, image_bytes: bytes, label_bytes: bytes, max_dim: int) -> DefectSample:
    number = index + 1
    try:
        image = decode_image(image_bytes, SAMPLE_MIN_DIM, max_dim)
    except DefectForgeError as exc:
        raise DefectForgeError(exc.code, f"결함 샘플 {number} 이미지: {exc.message}", {"sample": number, **exc.details}) from exc
    polygons = parse_labels(label_bytes, lambda message: sample_error(number, message))
    return extract_sample(index, image, polygons, hashlib.sha256(label_bytes).hexdigest())


def extract_sample(index: int, image: SourceImage, polygons: Sequence[LabelPolygon], label_sha256: str) -> DefectSample:
    number = index + 1
    width, height = image.width, image.height
    regions = [(p.class_id, *rasterize(p.points, width, height)) for p in polygons]
    union = np.zeros((height, width), dtype=np.uint8)
    for _, x, y, pixels in regions:
        union[y : y + pixels.shape[0], x : x + pixels.shape[1]] |= pixels.astype(np.uint8)
    coverage = float(union.mean())
    if coverage > MAX_LABEL_COVERAGE:
        raise sample_error(number, f"라벨이 이미지의 {coverage:.0%}를 덮습니다. 결함 주변의 표면이 보이도록 절반 이하만 라벨해야 합니다.", coverage=_r4(coverage))
    # The largest defects (stable, so ties keep label order), numbered in label order.
    keep = sorted(sorted(range(len(regions)), key=lambda i: -int(regions[i][3].sum()))[:MAX_DEFECTS_PER_SAMPLE])

    holes = cv2.dilate(union, np.ones((3, 3), np.uint8), iterations=_GROW)
    background = cv2.inpaint(np.ascontiguousarray(image.rgb), holes, _INPAINT_RADIUS, cv2.INPAINT_TELEA).astype(np.float32)
    rgb = image.rgb.astype(np.float32)
    delta_full = rgb - background
    luma, base = rgb @ _LUMA, background @ _LUMA

    exemplars: list[Exemplar] = []
    measurements: list[dict[str, Any]] = []
    for k, i in enumerate(keep):
        class_id, x, y, region = regions[i]
        win = (slice(y, y + region.shape[0]), slice(x, x + region.shape[1]))
        delta = np.pad(delta_full[win] * region[..., None], ((_PAD, _PAD), (_PAD, _PAD), (0, 0)))
        exemplars.append(Exemplar(index, k, class_id, delta, np.pad(region.astype(np.float32), _PAD)))
        measurement = _measure(index, k, region, x, y, luma[win][region], base[win][region])
        measurements.append({**measurement, "class_id": class_id, "label_line": polygons[i].line})
    return DefectSample(index, image, label_sha256, tuple(exemplars), tuple(measurements))


def _measure(sample_index: int, defect_index: int, region: np.ndarray, x: int, y: int, luma: np.ndarray, base: np.ndarray) -> dict[str, Any]:
    ys, xs = np.nonzero(region)
    area = int(xs.size)
    dx, dy = xs - xs.mean(), ys - ys.mean()
    theta = 0.5 * math.atan2(2.0 * float((dx * dy).mean()), float((dx * dx).mean() - (dy * dy).mean()))
    along = dx * math.cos(theta) + dy * math.sin(theta)
    length = float(along.max() - along.min()) + 1.0

    change = luma - base
    polarity = "dark" if float(np.median(change)) < 0 else "bright"
    amount = -change if polarity == "dark" else change
    room = np.maximum(base if polarity == "dark" else 255.0 - base, 1.0)
    target = _CONTAMINATION_LUMA[polarity]
    room_c = np.maximum(base - target if polarity == "dark" else target - base, 1.0)
    return {
        "sample_index": sample_index,
        "defect_index": defect_index,
        "bbox_xyxy": [x + int(xs.min()), y + int(ys.min()), x + int(xs.max()), y + int(ys.max())],
        "area_px": area,
        "length_px": _r4(length),
        "width_px": _r4(area / length),
        "angle_deg": _r4(math.degrees(theta) % 180.0),
        "radius_px": _r4(math.sqrt(area / math.pi)),
        "polarity": polarity,
        "contrast": _r4(np.percentile(np.clip(amount / room, 0.0, 1.0), 90)),
        "opacity": _r4(np.percentile(np.clip(amount / room_c, 0.0, 1.0), 90)),
    }


def _span(values: list[float], defect: str, name: str, digits: int) -> list[float]:
    """[0.9 · min, 1.1 · max] of the measured values, rounded and clipped to the parameter's limits."""
    lo_lim, hi_lim = LIMITS[defect][name]
    clip = lambda v: float(min(max(round(v, digits), lo_lim), hi_lim))  # noqa: E731
    return [clip(0.9 * min(values)), clip(1.1 * max(values))]


def fit_basis(measurements: Sequence[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Which defects each rule-based type is fitted to: line-like ones (length >= 3 × width) for scratches,
    the others for pinholes/contamination; a type falls back to every defect when its group is empty."""
    lines = [m for m in measurements if m["length_px"] >= LINE_ELONGATION * m["width_px"]]
    blobs = [m for m in measurements if m["length_px"] < LINE_ELONGATION * m["width_px"]]
    every = list(measurements)
    return {"scratch": lines or every, "pinhole": blobs or every, "contamination": blobs or every}


def _polarity(measurements: Sequence[dict[str, Any]]) -> str:
    dark = sum(m["polarity"] == "dark" for m in measurements) / len(measurements)
    return "dark" if dark >= 0.8 else "bright" if dark <= 0.2 else "random"


def suggest_params(measurements: Sequence[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Rule-based parameters that can be measured from labelled defects; everything else is left alone."""
    basis = fit_basis(measurements)

    def get(kind: str, key: str) -> list[float]:
        return [float(m[key]) for m in basis[kind]]

    return {
        "scratch": {
            "length_px": _span(get("scratch", "length_px"), "scratch", "length_px", 1),
            "width_px": _span(get("scratch", "width_px"), "scratch", "width_px", 1),
            "contrast": _span(get("scratch", "contrast"), "scratch", "contrast", 2),
            "polarity": _polarity(basis["scratch"]),
        },
        "pinhole": {
            "radius_px": _span(get("pinhole", "radius_px"), "pinhole", "radius_px", 1),
            "contrast": _span(get("pinhole", "contrast"), "pinhole", "contrast", 2),
            "polarity": _polarity(basis["pinhole"]),
        },
        "contamination": {
            "radius_px": _span(get("contamination", "radius_px"), "contamination", "radius_px", 1),
            "opacity": _span(get("contamination", "opacity"), "contamination", "opacity", 2),
            "polarity": _polarity(basis["contamination"]),
        },
    }


def analyze_samples(sample_set: DefectSampleSet) -> dict[str, Any]:
    measurements = [m for s in sample_set.samples for m in s.measurements]
    counts = [m["class_id"] for m in measurements]
    return {
        "samples": [s.info for s in sample_set.samples],
        "classes": [{"id": k, "name": name, "defect_count": counts.count(k)} for k, name in enumerate(sample_set.class_names)],
        "defects": measurements,
        "suggestions": suggest_params(measurements),
        "fitted_from": {kind: len(group) for kind, group in fit_basis(measurements).items()},
    }
