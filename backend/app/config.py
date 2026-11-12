"""Runtime settings loaded from environment variables (and an optional backend/.env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_VERSION = "1.2.0"
CONFIG_VERSION = "1.0"
# Engine version recorded for config 1.0 output. The basic engine is unchanged since 1.0, so its
# metadata (and therefore its reproducibility hashes) stays exactly as in release 1.0.0.
BASIC_ENGINE_VERSION = "1.0.0"

# Fixed by the data contract (spec section 5); only the upper bound is configurable.
MIN_IMAGE_DIM = 32

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _load_env_file(path: Path) -> None:
    """Minimal KEY=VALUE loader. Real environment variables always win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int_env(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_dim: int = 2048
    max_export_count: int = 20
    max_concurrent_jobs: int = 2
    job_wait_seconds: float = 15.0
    export_tmp_dir: str | None = None
    export_spool_max_bytes: int = 32 * 1024 * 1024  # ZIPs larger than this spill to an auto-deleted temp file

    @property
    def min_image_dim(self) -> int:
        return MIN_IMAGE_DIM


def load_settings() -> Settings:
    _load_env_file(_ENV_FILE)
    origins = os.environ.get("CORS_ORIGINS", "")
    defaults = Settings()
    return Settings(
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()) or defaults.cors_origins,
        max_upload_bytes=_int_env("MAX_UPLOAD_MIB", 10) * 1024 * 1024,
        max_image_dim=_int_env("MAX_IMAGE_DIM", defaults.max_image_dim),
        max_export_count=_int_env("MAX_EXPORT_COUNT", defaults.max_export_count),
        max_concurrent_jobs=_int_env("MAX_CONCURRENT_JOBS", defaults.max_concurrent_jobs),
        job_wait_seconds=float(_int_env("JOB_WAIT_SECONDS", int(defaults.job_wait_seconds))),
        export_tmp_dir=os.environ.get("EXPORT_TMP_DIR") or None,
    )
