"""Config 1.1 pipeline: 1.0 defects (+ texture/patch/real) inside include/exclude areas, scratch direction and surface matching.

prepare (once per request):  regions -> allowed area (core/regions.py) -> reference line -> scratch base angle
                             -> local surface analysis of the *source* when scratch or pinhole shading is "local"
                                (one per window size: both types share it when their σ is the same)
                             -> exemplars of the uploaded defect samples when "real" is requested
generate (per seed):         rng(seed) -> place_instances (shared with 1.0, max 100 attempts)
                             -> CompositeCanvas restricted to the allowed area -> masks + metadata
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config import APP_VERSION
from app.core.compositor import CompositeCanvas
from app.core.generation import HINTS_KO, GenerationResult, PlacementJob, common_metadata, place_instances
from app.core.image_io import SourceImage
from app.core.regions import REGION_GEOMETRY_VERSION, AreaGeometry, prepare_area
from app.core.samples import SAMPLE_ANALYSIS_VERSION, DefectSampleSet
from app.core.surface import ANALYSIS_VERSION, SurfaceAnalysis, analyze_surface
from app.core.yolo import YoloClasses
from app.defects import GENERATORS, REAL_CLASS_OFFSET, v11_class_map
from app.defects.adaptive_pinhole import ADAPTIVE_PINHOLE_VERSION, AdaptivePinholeGenerator
from app.defects.adaptive_scratch import ADAPTIVE_SCRATCH_VERSION, AdaptiveScratchGenerator
from app.defects.base import DefectGenerator
from app.defects.patch import PatchGenerator
from app.defects.real import REAL_DEFECT_VERSION, RealDefectGenerator
from app.defects.texture import TextureGenerator
from app.defects.base import r4
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import REFERENCE_LINE_MIN_LENGTH_PX, V11_CONFIG_VERSION, GenerationConfigV11, OrientationSpec, ShadingSpec

HINTS_V11 = {
    **HINTS_KO,
    "outside_roi": "결함이 허용 영역(생성 영역 − 제외 영역, 경계 여유 적용)에 완전히 들어가지 않습니다. "
    "생성 영역을 넓히거나 크기·경계 여유를 줄이세요. 스크래치 방향을 고정했다면 영역 모양과 맞는지(예: 좁은 영역에 수직 방향) 확인하세요.",
    "no_visible_change": "현재 극성/대비로는 픽셀 값이 바뀌지 않습니다(예: 흰색·포화된 표면에 밝은 결함). 극성이나 대비를 바꾸세요.",
}


def line_angle_deg(start: tuple[int, int], end: tuple[int, int]) -> float:
    """Direction of the line start->end in image coordinates (x right, y down), in [0, 180).

    The vector is sign-normalised first, so swapping the endpoints gives exactly the same value.
    """
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dy < 0 or (dy == 0 and dx < 0):
        dx, dy = -dx, -dy
    angle = math.degrees(math.atan2(dy, dx))
    return 0.0 if angle >= 180.0 else angle


def resolve_base_angle(orientation: OrientationSpec, line_angle: float | None) -> float | None:
    """None for "random" (angle drawn from params.angle_deg like 1.0)."""
    if orientation.mode == "random":
        return None
    if orientation.mode == "absolute":
        return orientation.angle_deg % 180.0
    assert line_angle is not None
    return line_angle if orientation.mode == "parallel" else (line_angle + 90.0) % 180.0


def _line_error(message: str, **details: object) -> DefectForgeError:
    return DefectForgeError(ErrorCode.INVALID_REFERENCE_LINE, message, dict(details))


@dataclass(frozen=True)
class V11Context:
    area: AreaGeometry
    analysis: SurfaceAnalysis | None  # scratch shading "local"
    pinhole_analysis: SurfaceAnalysis | None  # pinhole shading "local"
    base_angle_deg: float | None
    samples: DefectSampleSet | None  # only when the config asks for "real" defects
    class_map: dict[str, str]
    yolo: YoloClasses
    metadata: dict[str, Any]  # area / reference_line / surface_analysis / real_samples / algorithm_versions


def yolo_classes(class_map: dict[str, str], real_class_names: Sequence[str]) -> YoloClasses:
    """Label classes keep their own YOLO numbers 0..K-1 (so the output merges with the source dataset);
    the rule-based types follow as K.. in class-id order."""
    k = len(real_class_names)
    by_class_id = {REAL_CLASS_OFFSET + i: i for i in range(k)}
    names = list(real_class_names)
    for cid in sorted(int(c) for c in class_map if 0 < int(c) < REAL_CLASS_OFFSET):
        by_class_id[cid] = k + cid - 1
        names.append(class_map[str(cid)])
    return YoloClasses(by_class_id, names)


def prepare_v11_context(source: SourceImage, config: GenerationConfigV11, samples: DefectSampleSet | None = None) -> V11Context:
    """``samples`` are only used (and required) when the config asks for "real" defects."""
    width, height = source.width, source.height
    area = prepare_area(config.regions, config.edge_margin_px, width, height)

    line_meta: dict[str, Any] | None = None
    line_angle: float | None = None
    if config.reference_line is not None:
        start, end = config.reference_line.start, config.reference_line.end
        if any(not (0 <= x < width and 0 <= y < height) for x, y in (start, end)):
            raise _line_error(f"기준선의 점이 이미지 범위(0~{width - 1}, 0~{height - 1})를 벗어났습니다.", start=list(start), end=list(end))
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        if length < REFERENCE_LINE_MIN_LENGTH_PX:
            raise _line_error(f"기준선이 너무 짧습니다({length:.1f}px). 두 점을 {REFERENCE_LINE_MIN_LENGTH_PX}px 이상 떨어뜨려 지정하세요.", length_px=length)
        line_angle = line_angle_deg(start, end)
        line_meta = {"start": list(start), "end": list(end), "angle_deg": r4(line_angle), "length_px": r4(length)}

    analyses: dict[float, SurfaceAnalysis] = {}

    def analysis_for(shading: ShadingSpec) -> SurfaceAnalysis | None:
        if shading.mode != "local":
            return None
        sigma = shading.window_sigma_px
        if sigma not in analyses:
            analyses[sigma] = analyze_surface(source.rgb, area.stats_domain, sigma)
        return analyses[sigma]

    scratch = config.scratch
    base_angle: float | None = None
    analysis: SurfaceAnalysis | None = None
    if scratch is not None:
        orientation = scratch.params.orientation
        if orientation.mode in ("parallel", "perpendicular") and line_angle is None:
            raise _line_error(
                "스크래치 방향 '기준선에 평행/수직'에는 기준선이 필요합니다. 이미지에서 기준선의 두 점을 지정하거나 다른 방향을 고르세요.",
                orientation_mode=orientation.mode,
            )
        base_angle = resolve_base_angle(orientation, line_angle)
        analysis = analysis_for(scratch.params.shading)
    pinhole = config.pinhole
    pinhole_analysis = analysis_for(pinhole.params.shading) if pinhole is not None else None

    real = config.uses_real_samples
    if real and (samples is None or not samples.samples):
        raise DefectForgeError(
            ErrorCode.INVALID_DEFECT_SAMPLE,
            "‘실제 결함’에는 결함 샘플(결함 이미지 + YOLO 라벨 txt)이 하나 이상 필요합니다. 샘플을 추가하거나 ‘실제 결함’을 끄세요.",
        )
    used = samples if real else None
    real_names = used.class_names if used is not None else ()
    class_map = v11_class_map(real_names)

    metadata = {
        "area": area.metadata,
        "reference_line": line_meta,
        "surface_analysis": analysis.summary if analysis is not None else None,
        "pinhole_surface_analysis": pinhole_analysis.summary if pinhole_analysis is not None else None,
        "real_samples": used.metadata if used is not None else None,
        "algorithm_versions": {
            "region_geometry": REGION_GEOMETRY_VERSION,
            "surface_analysis": ANALYSIS_VERSION if analyses else None,
            "adaptive_scratch": ADAPTIVE_SCRATCH_VERSION if scratch is not None else None,
            "adaptive_pinhole": ADAPTIVE_PINHOLE_VERSION if pinhole is not None else None,
            "defect_samples": SAMPLE_ANALYSIS_VERSION if real else None,
            "real_defect": REAL_DEFECT_VERSION if real else None,
        },
    }
    return V11Context(
        area=area,
        analysis=analysis,
        pinhole_analysis=pinhole_analysis,
        base_angle_deg=base_angle,
        samples=used,
        class_map=class_map,
        yolo=yolo_classes(class_map, real_names),
        metadata=metadata,
    )


def _generator(defect_type: str, source: SourceImage, ctx: V11Context) -> DefectGenerator:
    if defect_type == "scratch":
        return AdaptiveScratchGenerator(source.rgb, ctx.analysis, ctx.base_angle_deg, ctx.area.distance_to_edge)
    if defect_type == "pinhole":
        return AdaptivePinholeGenerator(source.rgb, ctx.pinhole_analysis)
    if defect_type == "texture":
        return TextureGenerator(source.rgb)
    if defect_type == "patch":
        return PatchGenerator(source.rgb)
    if defect_type == "real":
        assert ctx.samples is not None  # prepare_v11_context requires samples for "real"
        return RealDefectGenerator(ctx.samples.exemplars, ctx.samples.class_names)
    return GENERATORS[defect_type]


def generate_v11_sample(source: SourceImage, config: GenerationConfigV11, seed: int, ctx: V11Context) -> GenerationResult:
    """Deterministic for (source pixels, config, seed); ``ctx`` must come from prepare_v11_context."""
    rng = np.random.default_rng(seed)
    allowed = ctx.area.allowed
    canvas = CompositeCanvas(source.rgb, allowed.mask, config.allow_overlap)
    jobs: list[PlacementJob] = [(spec.type, _generator(spec.type, source, ctx), spec.params, spec.count) for spec in config.defects]
    instances = place_instances(rng, allowed, canvas, jobs, HINTS_V11)
    final = canvas.finalize()
    metadata = common_metadata(V11_CONFIG_VERSION, APP_VERSION, source, seed, None, config, instances, final, ctx.class_map)
    metadata.update(ctx.metadata)
    return GenerationResult(final.image, final.class_mask, final.binary_mask, final.instance_map, metadata)
