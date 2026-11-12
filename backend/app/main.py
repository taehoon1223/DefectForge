"""FastAPI application factory. Run: ``uvicorn app.main:app --host 127.0.0.1 --port 8000``."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.api.errors import error_response, register_exception_handlers
from app.api.routes import JobLimiter, router
from app.config import APP_VERSION, Settings, load_settings
from app.error_codes import ErrorCode

logger = logging.getLogger("defectforge")

# Room for multipart boundaries and the config field on top of the image itself.
_FORM_OVERHEAD_BYTES = 1024 * 1024


class GuardMiddleware(BaseHTTPMiddleware):
    """Rejects oversized bodies early and turns unexpected exceptions into a generic 500.

    Sits inside CORS so even these responses carry CORS headers; never leaks paths or tracebacks.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings: Settings = request.app.state.settings
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > settings.max_upload_bytes + _FORM_OVERHEAD_BYTES:
            return error_response(
                ErrorCode.FILE_TOO_LARGE,
                f"요청이 너무 큽니다. 이미지는 최대 {settings.max_upload_bytes / (1024 * 1024):g} MiB까지 업로드할 수 있습니다.",
                {"max_bytes": settings.max_upload_bytes},
            )
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return error_response(ErrorCode.INTERNAL_ERROR, "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도하세요.")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(
        title="DefectForge API",
        version=APP_VERSION,
        description="정상 표면 이미지에 합성 결함(scratch/pinhole/contamination)을 넣고 픽셀 정합 GT 마스크를 생성한다.",
        docs_url="/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.jobs = JobLimiter(settings.max_concurrent_jobs, settings.job_wait_seconds)
    register_exception_handlers(app)
    app.add_middleware(GuardMiddleware)
    app.add_middleware(  # added last = outermost
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    app.include_router(router)
    return app


app = create_app()
