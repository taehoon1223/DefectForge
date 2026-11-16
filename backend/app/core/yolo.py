"""YOLO segmentation labels: reading defect-sample labels and writing the dataset's labels.

Line format: ``class x1 y1 x2 y2 ...`` with coordinates normalised to 0–1, one object per line.
Pixels of a polygon = cv2.fillPoly on (x · W, y · H) rounded to whole pixels, boundary included —
the Ultralytics convention. Written labels use the outer contour of each object's pixels
(cv2.findContours) as x / W, y / H with 6 decimals, so reading them back gives the same pixels
(holes are filled; a part that splits into pieces gives one line per piece).

Class names: classes.txt (one name per line) or the ``names`` of a data.yaml, in the three common
forms ``names: [a, b]``, ``- a`` lines and ``0: a`` lines. No YAML library is needed for that.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.error_codes import DefectForgeError

MAX_CLASSES = 250  # class-mask PNG id = REAL_CLASS_OFFSET + k must stay <= 255
MAX_NAME_LENGTH = 64
_COORD_TOLERANCE = 1e-3  # exporters sometimes write 1.0000001 or -0.0000002


@dataclass(frozen=True)
class LabelPolygon:
    class_id: int
    points: np.ndarray  # (n, 2) normalised 0–1
    line: int


ErrorFactory = Callable[[str], DefectForgeError]


def _text(data: bytes, error: ErrorFactory, what: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise error(f"{what}을 UTF-8 텍스트로 읽을 수 없습니다.") from exc


def parse_labels(data: bytes, error: ErrorFactory) -> list[LabelPolygon]:
    polygons: list[LabelPolygon] = []
    for number, raw in enumerate(_text(data, error, "라벨 파일").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        try:
            class_id, coords = int(tokens[0]), [float(t) for t in tokens[1:]]
        except ValueError:
            raise error(f"라벨 {number}번째 줄을 읽을 수 없습니다. 클래스는 정수, 좌표는 숫자여야 합니다.") from None
        if len(coords) == 4:
            raise error(f"라벨 {number}번째 줄이 박스 형식(class cx cy w h)입니다. 다각형 라벨(class x1 y1 x2 y2 …)만 지원합니다.")
        if len(coords) < 6 or len(coords) % 2:
            raise error(f"라벨 {number}번째 줄의 좌표는 x y 쌍으로 3점 이상이어야 합니다 (값 {len(coords)}개).")
        if not 0 <= class_id < MAX_CLASSES:
            raise error(f"라벨 {number}번째 줄의 클래스 {class_id}가 범위(0~{MAX_CLASSES - 1})를 벗어났습니다.")
        points = np.asarray(coords, dtype=np.float64).reshape(-1, 2)
        if not np.isfinite(points).all() or (points < -_COORD_TOLERANCE).any() or (points > 1 + _COORD_TOLERANCE).any():
            raise error(f"라벨 {number}번째 줄의 좌표가 0~1 범위를 벗어났습니다. 이미지 크기로 나눈 정규화 좌표여야 합니다.")
        polygons.append(LabelPolygon(class_id, np.clip(points, 0.0, 1.0), number))
    if not polygons:
        raise error("라벨 파일에 결함이 없습니다.")
    return polygons


def rasterize(points: np.ndarray, width: int, height: int) -> tuple[int, int, np.ndarray]:
    """(x0, y0, pixels) of a normalised polygon; ``pixels`` is the bool window starting at (x0, y0)."""
    pts = np.rint(points * np.array([width, height])).astype(np.int64)
    pts = np.minimum(pts, np.array([width - 1, height - 1]))
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    canvas = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)
    cv2.fillPoly(canvas, [(pts - [x0, y0]).astype(np.int32).reshape(-1, 1, 2)], 1)
    return int(x0), int(y0), canvas.astype(bool)


# ---------------------------------------------------------------- class names


def _unquote(value: str) -> str:
    value = re.sub(r"\s+#.*$", "", value).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return value.strip()


def _yaml_names(text: str, error: ErrorFactory) -> list[str]:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        match = re.match(r"^names\s*:\s*(.*)$", line)
        if not match:
            continue
        rest = re.sub(r"\s+#.*$", "", match.group(1)).strip()
        if rest.startswith(("[", "{")):
            flow = rest
            for more in lines[i + 1 :]:
                if flow.rstrip().endswith(("]", "}")):
                    break
                flow += " " + more.strip()
            body = flow.strip()[1:-1]
            items = [item for item in body.split(",") if item.strip()]
            if rest.startswith("["):
                return [_unquote(item) for item in items]
            pairs = [item.split(":", 1) for item in items]
            return _indexed({int(_unquote(k)): _unquote(v) for k, v in pairs}, error)
        if rest:
            break
        listed: list[str] = []
        indexed: dict[int, str] = {}
        for more in lines[i + 1 :]:
            stripped = more.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not more[0].isspace() and not stripped.startswith("- "):
                break
            if stripped.startswith("- "):
                listed.append(_unquote(stripped[2:]))
            elif m := re.match(r"^(\d+)\s*:\s*(.+)$", stripped):
                indexed[int(m.group(1))] = _unquote(m.group(2))
            else:
                raise error(f"data.yaml의 names 항목을 읽을 수 없습니다: {stripped[:40]}")
        if listed and indexed:
            break
        return listed or _indexed(indexed, error)
    raise error("data.yaml에서 names를 찾지 못했습니다. names: [이름, …] 또는 '0: 이름' 줄 형식이어야 합니다.")


def _indexed(names: dict[int, str], error: ErrorFactory) -> list[str]:
    if sorted(names) != list(range(len(names))):
        raise error("data.yaml의 names 번호가 0부터 빠짐없이 이어져야 합니다.")
    return [names[k] for k in range(len(names))]


def parse_class_names(data: bytes, filename: str, error: ErrorFactory) -> list[str]:
    text = _text(data, error, "클래스 이름 파일")
    if filename.lower().endswith((".yaml", ".yml")) or re.search(r"^names\s*:", text, re.MULTILINE):
        names = _yaml_names(text, error)
    else:
        names = [line.strip() for line in text.splitlines()]
        while names and not names[-1]:
            names.pop()
    if not names:
        raise error("클래스 이름 파일이 비어 있습니다.")
    if len(names) > MAX_CLASSES:
        raise error(f"클래스는 최대 {MAX_CLASSES}개까지 쓸 수 있습니다 (입력: {len(names)}개).")
    for k, name in enumerate(names):
        if not name or len(name) > MAX_NAME_LENGTH:
            raise error(f"클래스 {k}의 이름이 비어 있거나 {MAX_NAME_LENGTH}자를 넘습니다.")
    duplicated = sorted({n for n in names if names.count(n) > 1})
    if duplicated:
        raise error(f"클래스 이름이 중복됩니다: {', '.join(duplicated)}")
    return names


# ---------------------------------------------------------------- writing dataset labels


@dataclass(frozen=True)
class YoloClasses:
    """YOLO class number for every class-mask id, and the names list for data.yaml."""

    by_class_id: dict[int, int]
    names: list[str]

    def data_yaml(self) -> str:
        lines = [
            "# DefectForge 합성 데이터셋 — YOLO 세그멘테이션 라벨 (labels/image_NNNN.txt, 이미지는 images/)",
            "# 학습에 쓸 때 train/val 경로를 직접 지정하세요. 실제 결함 샘플로 쓴 원본 이미지는 평가(val/test)에 넣지 마세요.",
            "names:",
            *(f"  {k}: {json.dumps(name, ensure_ascii=False)}" for k, name in enumerate(self.names)),
        ]
        return "\n".join(lines) + "\n"

    def manifest(self) -> dict[str, Any]:
        return {
            "format": "segmentation polygons: class x1 y1 x2 y2 ... (normalised 0-1)",
            "labels_dir": "labels",
            "names": dict(enumerate(self.names)),
            "class_id_to_yolo": {str(cid): yolo for cid, yolo in sorted(self.by_class_id.items())},
        }


def object_lines(yolo_id: int, pixels: np.ndarray, x0: int, y0: int, width: int, height: int) -> list[str]:
    contours, _ = cv2.findContours(pixels.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lines = []
    for contour in contours:
        pts = contour.reshape(-1, 2)
        if len(pts) < 3:  # a 1-2 pixel piece: repeat points (fillPoly then fills exactly those pixels)
            pts = np.vstack([pts, pts[:1], pts[:1]])[:3]
        coords = " ".join(f"{(x0 + x) / width:.6f} {(y0 + y) / height:.6f}" for x, y in pts)
        lines.append(f"{yolo_id} {coords}")
    return lines


def label_text(instance_map: np.ndarray, instances: Sequence[dict[str, Any]], classes: YoloClasses) -> str:
    """YOLO lines for every instance's final pixels (later instances own overlapped pixels)."""
    height, width = instance_map.shape
    lines: list[str] = []
    for inst in instances:
        x0, y0, x1, y1 = inst["bbox_xyxy"]
        pixels = instance_map[y0 : y1 + 1, x0 : x1 + 1] == inst["id"]
        if pixels.any():
            lines.extend(object_lines(classes.by_class_id[inst["class_id"]], pixels, x0, y0, width, height))
    return "\n".join(lines) + ("\n" if lines else "")
