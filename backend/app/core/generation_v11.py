"""Config 1.1 pipeline: 1.0 defects (+ texture/patch) inside include/exclude areas, scratch direction and surface matching.

prepare (once per request):  regions -> allowed area (core/regions.py) -> reference line -> scratch base angle
                             -> local surface analysis of the *source* when scratch shading is "local"
generate (per seed):         rng(seed) -> place_instances (shared with 1.0, max 100 attempts)
                             -> CompositeCanvas restricted to the allowed area -> masks + metadata
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config import APP_VERSION
from app.core.compositor import CompositeCanvas
from app.core.generation import HINTS_KO, GenerationResult, PlacementJob, common_metadata, place_instances
from app.core.image_io import SourceImage
from app.core.regions import REGION_GEOMETRY_VERSION, AreaGeometry, prepare_area
from app.core.surface import ANALYSIS_VERSION, SurfaceAnalysis, analyze_surface
from app.defects import GENERATORS, V11_CLASS_MAP
from app.defects.adaptive_scratch import ADAPTIVE_SCRATCH_VERSION, AdaptiveScratchGenerator
from app.defects.base import DefectGenerator
from app.defects.patch import PatchGenerator
from app.defects.texture import TextureGenerator
from app.defects.base import r4
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import REFERENCE_LINE_MIN_LENGTH_PX, V11_CONFIG_VERSION, GenerationConfigV11, OrientationSpec

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
    analysis: SurfaceAnalysis | None
    base_angle_deg: float | None
    metadata: dict[str, Any]  # area / reference_line / surface_analysis / algorithm_versions


def prepare_v11_context(source: SourceImage, config: GenerationConfigV11) -> V11Context:
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
        shading = scratch.params.shading
        if shading.mode == "local":
            analysis = analyze_surface(source.rgb, area.stats_domain, shading.window_sigma_px)

    metadata = {
        "area": area.metadata,
        "reference_line": line_meta,
        "surface_analysis": analysis.summary if analysis is not None else None,
        "algorithm_versions": {
            "region_geometry": REGION_GEOMETRY_VERSION,
            "surface_analysis": ANALYSIS_VERSION if analysis is not None else None,
            "adaptive_scratch": ADAPTIVE_SCRATCH_VERSION if scratch is not None else None,
        },
    }
    return V11Context(area=area, analysis=analysis, base_angle_deg=base_angle, metadata=metadata)


def _generator(defect_type: str, source: SourceImage, ctx: V11Context) -> DefectGenerator:
    if defect_type == "scratch":
        return AdaptiveScratchGenerator(source.rgb, ctx.analysis, ctx.base_angle_deg, ctx.area.distance_to_edge)
    if defect_type == "texture":
        return TextureGenerator(source.rgb)
    if defect_type == "patch":
        return PatchGenerator(source.rgb)
    return GENERATORS[defect_type]


def generate_v11_sample(source: SourceImage, config: GenerationConfigV11, seed: int, ctx: V11Context) -> GenerationResult:
    """Deterministic for (source pixels, config, seed); ``ctx`` must come from prepare_v11_context."""
    rng = np.random.default_rng(seed)
    allowed = ctx.area.allowed
    canvas = CompositeCanvas(source.rgb, allowed.mask, config.allow_overlap)
    jobs: list[PlacementJob] = [(spec.type, _generator(spec.type, source, ctx), spec.params, spec.count) for spec in config.defects]
    instances = place_instances(rng, allowed, canvas, jobs, HINTS_V11)
    final = canvas.finalize()
    metadata = common_metadata(V11_CONFIG_VERSION, APP_VERSION, source, seed, None, config, instances, final, V11_CLASS_MAP)
    metadata.update(ctx.metadata)
    return GenerationResult(final.image, final.class_mask, final.binary_mask, final.instance_map, metadata)
