"""Registry of defect generators. Class IDs are part of the mask contract (0 = background).

``GENERATORS``/``CLASS_MAP`` are the config 1.0 set and must not change (1.0 output is frozen).
Config 1.1 adds image-dependent generators that are built per request (they read the source image):
scratch -> AdaptiveScratchGenerator, texture -> TextureGenerator, patch -> PatchGenerator.
"""

from __future__ import annotations

from app.defects.base import DefectGenerator
from app.defects.contamination import ContaminationGenerator
from app.defects.patch import PatchGenerator
from app.defects.pinhole import PinholeGenerator
from app.defects.scratch import ScratchGenerator
from app.defects.texture import TextureGenerator

GENERATORS: dict[str, DefectGenerator] = {
    g.type_name: g for g in (ScratchGenerator(), PinholeGenerator(), ContaminationGenerator())
}

CLASS_MAP: dict[str, str] = {"0": "background", **{str(g.class_id): name for name, g in GENERATORS.items()}}
V11_CLASS_MAP: dict[str, str] = {**CLASS_MAP, str(TextureGenerator.class_id): "texture", str(PatchGenerator.class_id): "patch"}

__all__ = ["CLASS_MAP", "GENERATORS", "V11_CLASS_MAP", "DefectGenerator"]
