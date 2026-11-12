"""Registry of defect generators. Class IDs are part of the mask contract (0 = background)."""

from __future__ import annotations

from app.defects.base import DefectGenerator
from app.defects.contamination import ContaminationGenerator
from app.defects.pinhole import PinholeGenerator
from app.defects.scratch import ScratchGenerator

GENERATORS: dict[str, DefectGenerator] = {
    g.type_name: g for g in (ScratchGenerator(), PinholeGenerator(), ContaminationGenerator())
}

CLASS_MAP: dict[str, str] = {"0": "background", **{str(g.class_id): name for name, g in GENERATORS.items()}}

__all__ = ["CLASS_MAP", "GENERATORS", "DefectGenerator"]
