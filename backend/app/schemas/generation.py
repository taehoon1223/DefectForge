"""Request/response schemas (Pydantic v2).

``LIMITS`` and ``DEFAULTS`` are the backend's source of truth. The frontend keeps a mirror in
``frontend/src/types/limits.json``; ``tests/test_contract.py`` fails if the two drift apart.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.config import CONFIG_VERSION

Polarity = Literal["dark", "bright", "random"]
DefectType = Literal["scratch", "pinhole", "contamination"]

# (min, max) inclusive bounds for every user-tunable value.
LIMITS: dict[str, dict[str, tuple[float, float]]] = {
    "scratch": {
        "count": (1, 20),
        "length_px": (8, 512),
        "width_px": (1, 20),
        "angle_deg": (0, 180),
        "contrast": (0.05, 1.0),
        "curvature": (0, 1),
    },
    "pinhole": {
        "count": (1, 30),
        "radius_px": (1, 30),
        "irregularity": (0, 1),
        "contrast": (0.05, 1.0),
        "rim_strength": (0, 1),
    },
    "contamination": {
        "count": (1, 30),
        "radius_px": (2, 80),
        "irregularity": (0, 1),
        "opacity": (0.1, 1.0),
        "blur_sigma": (0, 8),
    },
}

DEFAULTS: dict[str, dict[str, Any]] = {
    "scratch": {
        "count": 2,
        "length_px": [40, 120],
        "width_px": [1, 3],
        "angle_deg": [0, 180],
        "contrast": [0.25, 0.6],
        "polarity": "dark",
        "curvature": 0.15,
    },
    "pinhole": {
        "count": 3,
        "radius_px": [2, 6],
        "irregularity": 0.3,
        "contrast": [0.35, 0.85],
        "polarity": "bright",
        "rim_strength": 0.2,
    },
    "contamination": {
        "count": 2,
        "radius_px": [8, 24],
        "irregularity": 0.5,
        "opacity": [0.3, 0.7],
        "blur_sigma": 1.5,
        "polarity": "dark",
    },
}

SEED_MAX = 2**32 - 1
ROI_MAX_POINTS = 256


def _range(defect: str, name: str) -> Any:
    lo, hi = LIMITS[defect][name]

    def check(value: tuple[float, float]) -> tuple[float, float]:
        a, b = value
        if not (lo <= a <= hi and lo <= b <= hi):
            raise ValueError(f"{lo:g}~{hi:g} 범위여야 합니다 (입력: [{a:g}, {b:g}])")
        if a > b:
            raise ValueError(f"최솟값이 최댓값보다 클 수 없습니다 (입력: [{a:g}, {b:g}])")
        return value

    return Annotated[tuple[float, float], AfterValidator(check)]


def _scalar(defect: str, name: str) -> Any:
    lo, hi = LIMITS[defect][name]
    return Annotated[float, Field(ge=lo, le=hi)]


def _count(defect: str) -> Any:
    lo, hi = LIMITS[defect]["count"]
    return Annotated[int, Field(ge=int(lo), le=int(hi))]


def _default(defect: str, name: str) -> Any:
    value = DEFAULTS[defect][name]
    return tuple(float(v) for v in value) if isinstance(value, list) else value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ScratchParams(_Strict):
    length_px: _range("scratch", "length_px") = _default("scratch", "length_px")
    width_px: _range("scratch", "width_px") = _default("scratch", "width_px")
    angle_deg: _range("scratch", "angle_deg") = _default("scratch", "angle_deg")
    contrast: _range("scratch", "contrast") = _default("scratch", "contrast")
    polarity: Polarity = _default("scratch", "polarity")
    curvature: _scalar("scratch", "curvature") = _default("scratch", "curvature")


class PinholeParams(_Strict):
    radius_px: _range("pinhole", "radius_px") = _default("pinhole", "radius_px")
    irregularity: _scalar("pinhole", "irregularity") = _default("pinhole", "irregularity")
    contrast: _range("pinhole", "contrast") = _default("pinhole", "contrast")
    polarity: Polarity = _default("pinhole", "polarity")
    rim_strength: _scalar("pinhole", "rim_strength") = _default("pinhole", "rim_strength")


class ContaminationParams(_Strict):
    radius_px: _range("contamination", "radius_px") = _default("contamination", "radius_px")
    irregularity: _scalar("contamination", "irregularity") = _default("contamination", "irregularity")
    opacity: _range("contamination", "opacity") = _default("contamination", "opacity")
    blur_sigma: _scalar("contamination", "blur_sigma") = _default("contamination", "blur_sigma")
    polarity: Polarity = _default("contamination", "polarity")


class ScratchDefect(_Strict):
    type: Literal["scratch"]
    count: _count("scratch") = DEFAULTS["scratch"]["count"]
    params: ScratchParams = Field(default_factory=ScratchParams)


class PinholeDefect(_Strict):
    type: Literal["pinhole"]
    count: _count("pinhole") = DEFAULTS["pinhole"]["count"]
    params: PinholeParams = Field(default_factory=PinholeParams)


class ContaminationDefect(_Strict):
    type: Literal["contamination"]
    count: _count("contamination") = DEFAULTS["contamination"]["count"]
    params: ContaminationParams = Field(default_factory=ContaminationParams)


DefectSpec = Annotated[Union[ScratchDefect, PinholeDefect, ContaminationDefect], Field(discriminator="type")]


class GenerationConfig(_Strict):
    version: Literal["1.0"] = CONFIG_VERSION
    seed: Annotated[int, Field(ge=0, le=SEED_MAX)] = 42
    # Geometry (in-bounds, area, self-intersection) is validated against the decoded image in core/roi.py.
    roi: Annotated[list[tuple[int, int]], Field(max_length=ROI_MAX_POINTS)] | None = None
    allow_overlap: bool = False
    defects: Annotated[list[DefectSpec], Field(min_length=1, max_length=3)]

    @field_validator("defects")
    @classmethod
    def _unique_types(cls, defects: list[Any]) -> list[Any]:
        types = [d.type for d in defects]
        duplicated = sorted({t for t in types if types.count(t) > 1})
        if duplicated:
            raise ValueError(f"결함 유형은 한 번씩만 지정할 수 있습니다 (중복: {', '.join(duplicated)}). 개수는 count로 조절하세요")
        return defects

    @property
    def requested_count(self) -> int:
        return sum(d.count for d in self.defects)


# ---------------------------------------------------------------- responses


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class InstanceInfo(BaseModel):
    id: int
    class_id: int
    type: DefectType
    bbox_xyxy: list[int] = Field(description="[x_min, y_min, x_max, y_max], 포함(inclusive) 픽셀 인덱스")
    center_xy: list[float]
    changed_pixel_count: int
    attempts: int
    params: dict[str, Any]


class GenerationMetadata(BaseModel):
    version: str
    engine_version: str
    seed: int
    source_sha256: str
    width: int
    height: int
    class_map: dict[str, str]
    bbox_format: str
    roi: list[list[int]] | None
    roi_pixel_count: int
    allow_overlap: bool
    requested_count: int
    generated_count: int
    changed_pixel_count: int
    class_pixel_counts: dict[str, int]
    instances: list[InstanceInfo]
    config: dict[str, Any]


class PreviewResponse(BaseModel):
    image_png_base64: str
    class_mask_png_base64: str
    binary_mask_png_base64: str
    metadata: GenerationMetadata
    processing_ms: float = Field(description="서버 처리 시간(ms). 재현성 대상이 아님")


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorDetail
