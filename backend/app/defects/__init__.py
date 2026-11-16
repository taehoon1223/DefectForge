"""Registry of defect generators. Class IDs are part of the mask contract (0 = background).

``GENERATORS``/``CLASS_MAP`` are the config 1.0 set and must not change (1.0 output is frozen).
Config 1.1 adds generators that are built per request (they read the source image or the uploaded
defect samples): scratch -> AdaptiveScratchGenerator, texture -> TextureGenerator,
patch -> PatchGenerator, real -> RealDefectGenerator.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.defects.base import DefectGenerator
from app.defects.contamination import ContaminationGenerator
from app.defects.patch import PatchGenerator
from app.defects.pinhole import PinholeGenerator
from app.defects.real import REAL_CLASS_OFFSET
from app.defects.scratch import ScratchGenerator
from app.defects.texture import TextureGenerator

GENERATORS: dict[str, DefectGenerator] = {
    g.type_name: g for g in (ScratchGenerator(), PinholeGenerator(), ContaminationGenerator())
}

CLASS_MAP: dict[str, str] = {"0": "background", **{str(g.class_id): name for name, g in GENERATORS.items()}}
V11_CLASS_MAP: dict[str, str] = {**CLASS_MAP, str(TextureGenerator.class_id): "texture", str(PatchGenerator.class_id): "patch"}


def v11_class_map(real_class_names: Sequence[str] = ()) -> dict[str, str]:
    """The 1.1 classes plus one "real:<name>" class per label class k, at id REAL_CLASS_OFFSET + k."""
    return {**V11_CLASS_MAP, **{str(REAL_CLASS_OFFSET + k): f"real:{name}" for k, name in enumerate(real_class_names)}}


__all__ = ["CLASS_MAP", "GENERATORS", "REAL_CLASS_OFFSET", "V11_CLASS_MAP", "DefectGenerator", "v11_class_map"]
