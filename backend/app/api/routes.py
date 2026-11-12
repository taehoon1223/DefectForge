"""HTTP layer: /api/v1/health, /api/v1/preview, /api/v1/export."""

from __future__ import annotations

import json
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import IO, Annotated, Any

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from app.api.errors import config_validation_error
from app.config import APP_VERSION, Settings
from app.core.exporter import write_dataset_zip
from app.core.generation import generate_sample
from app.core.image_io import SourceImage, b64, decode_image, encode_png, read_upload_limited
from app.error_codes import DefectForgeError, ErrorCode
from app.schemas.generation import ErrorResponse, GenerationConfig, HealthResponse, PreviewResponse

router = APIRouter(prefix="/api/v1")

EXPORT_FILENAME = "defectforge_dataset.zip"
_STREAM_CHUNK = 1024 * 1024

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "필수 입력 누락 / config JSON 문법 오류"},
    413: {"model": ErrorResponse, "description": "업로드 크기 초과"},
    422: {"model": ErrorResponse, "description": "이미지·ROI·파라미터 오류, 결함 배치 실패"},
    429: {"model": ErrorResponse, "description": "동시 생성 작업 한도 초과"},
    500: {"model": ErrorResponse, "description": "서버 내부 오류"},
}

FileField = Annotated[UploadFile, File(description="정상 이미지 (PNG/JPEG/WebP, 최대 10 MiB, 각 변 32~2048px)")]
ConfigField = Annotated[str, Form(description="GenerationConfig JSON 문자열")]


class JobLimiter:
    """Caps concurrent CPU-heavy jobs (DoS guard)."""

    def __init__(self, slots: int, wait_seconds: float) -> None:
        self._semaphore = threading.BoundedSemaphore(max(1, slots))
        self._wait = wait_seconds

    @contextmanager
    def slot(self) -> Iterator[None]:
        if not self._semaphore.acquire(timeout=self._wait):
            raise DefectForgeError(ErrorCode.SERVER_BUSY, "서버가 다른 생성 작업을 처리 중입니다. 잠시 후 다시 시도하세요.")
        try:
            yield
        finally:
            self._semaphore.release()


def parse_config(raw: str) -> GenerationConfig:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DefectForgeError(
            ErrorCode.INVALID_JSON, "config가 올바른 JSON 문자열이 아닙니다.", {"line": exc.lineno, "column": exc.colno}
        ) from exc
    if not isinstance(data, dict):
        raise DefectForgeError(ErrorCode.INVALID_CONFIG, "config는 JSON 객체여야 합니다.")
    try:
        return GenerationConfig.model_validate(data)
    except ValidationError as exc:
        raise config_validation_error(exc) from exc


def _load_inputs(file: UploadFile, config: str, settings: Settings) -> tuple[SourceImage, GenerationConfig]:
    data = read_upload_limited(file.file, settings.max_upload_bytes)
    cfg = parse_config(config)
    source = decode_image(data, settings.min_image_dim, settings.max_image_dim)
    return source, cfg


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=APP_VERSION)


@router.post("/preview", response_model=PreviewResponse, responses=ERROR_RESPONSES)
def preview(request: Request, file: FileField, config: ConfigField) -> PreviewResponse:
    """합성 이미지 1장과 정답 마스크를 base64 PNG(data URI 접두어 없음)로 반환한다."""
    settings: Settings = request.app.state.settings
    source, cfg = _load_inputs(file, config, settings)
    with request.app.state.jobs.slot():
        started = time.perf_counter()
        result = generate_sample(source, cfg, cfg.seed)
        response = PreviewResponse(
            image_png_base64=b64(encode_png(result.image)),
            class_mask_png_base64=b64(encode_png(result.class_mask)),
            binary_mask_png_base64=b64(encode_png(result.binary_mask)),
            metadata=result.metadata,
            processing_ms=round((time.perf_counter() - started) * 1000.0, 1),
        )
    return response


def _stream_and_close(spool: IO[bytes]) -> Iterator[bytes]:
    try:
        spool.seek(0)
        while chunk := spool.read(_STREAM_CHUNK):
            yield chunk
    finally:
        spool.close()


@router.post(
    "/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/zip": {}}, "description": EXPORT_FILENAME}, **ERROR_RESPONSES},
)
def export(
    request: Request,
    file: FileField,
    config: ConfigField,
    sample_count: Annotated[int, Form(description="생성할 샘플 수 (1~20). i번째 seed = config.seed + i")],
) -> StreamingResponse:
    """N장 합성 데이터셋 ZIP을 생성해 내려준다. 임시 파일은 전송 후(또는 오류 시) 즉시 삭제된다."""
    settings: Settings = request.app.state.settings
    if not 1 <= sample_count <= settings.max_export_count:
        raise DefectForgeError(
            ErrorCode.INVALID_SAMPLE_COUNT,
            f"생성 장수는 1~{settings.max_export_count} 사이여야 합니다 (입력: {sample_count}).",
            {"min": 1, "max": settings.max_export_count},
        )
    source, cfg = _load_inputs(file, config, settings)

    # In memory up to the threshold, then an anonymous temp file that the OS deletes on close.
    spool = tempfile.SpooledTemporaryFile(max_size=settings.export_spool_max_bytes, dir=settings.export_tmp_dir)
    try:
        with request.app.state.jobs.slot():
            write_dataset_zip(source, cfg, sample_count, spool)
        size = spool.tell()
    except BaseException:
        spool.close()
        raise
    return StreamingResponse(
        _stream_and_close(spool),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{EXPORT_FILENAME}"', "Content-Length": str(size)},
        background=BackgroundTask(spool.close),  # idempotent safety net
    )
