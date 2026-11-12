"""One entry point for both config versions: validate/prepare once, then generate per seed.

Preview calls the sampler with ``config.seed``; export calls it with ``config.seed + i`` and reuses
everything prepared (ROI mask, areas, surface analysis) across all samples.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.config import APP_VERSION, BASIC_ENGINE_VERSION
from app.core.generation import GenerationResult, generate_sample
from app.core.image_io import SourceImage
from app.core.generation_v11 import generate_v11_sample, prepare_v11_context
from app.core.roi import build_roi_mask
from app.defects import CLASS_MAP, V11_CLASS_MAP
from app.schemas.generation import AnyGenerationConfig, GenerationConfigV11


@dataclass(frozen=True)
class Sampler:
    generate: Callable[[int], GenerationResult]
    engine_version: str
    class_map: dict[str, str]
    manifest_extra: dict[str, Any] = field(default_factory=dict)


def make_sampler(source: SourceImage, config: AnyGenerationConfig) -> Sampler:
    if isinstance(config, GenerationConfigV11):
        ctx = prepare_v11_context(source, config)
        return Sampler(
            generate=lambda seed: generate_v11_sample(source, config, seed, ctx),
            engine_version=APP_VERSION,
            class_map=V11_CLASS_MAP,
            manifest_extra=ctx.metadata,
        )
    roi = build_roi_mask(config.roi, source.width, source.height)
    return Sampler(generate=lambda seed: generate_sample(source, config, seed, roi), engine_version=BASIC_ENGINE_VERSION, class_map=CLASS_MAP)
