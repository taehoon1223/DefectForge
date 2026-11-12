from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.helpers import textured_rgb, to_bytes


@pytest.fixture
def surface() -> np.ndarray:
    return textured_rgb()


@pytest.fixture
def surface_png(surface: np.ndarray) -> bytes:
    return to_bytes(surface)


@pytest.fixture
def settings(tmp_path) -> Settings:
    # Spool limit of 1 byte forces every export ZIP onto disk inside tmp_path, so cleanup is observable.
    return Settings(export_tmp_dir=str(tmp_path), export_spool_max_bytes=1)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
