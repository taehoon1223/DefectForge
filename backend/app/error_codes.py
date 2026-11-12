"""Single place for API error codes, their HTTP status and the domain exception.

The engine raises :class:`DefectForgeError`; only the API layer turns it into an HTTP response.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class ErrorCode(str, Enum):
    BAD_REQUEST = "BAD_REQUEST"
    MISSING_FIELD = "MISSING_FIELD"
    INVALID_JSON = "INVALID_JSON"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    INVALID_IMAGE = "INVALID_IMAGE"
    UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT"
    IMAGE_DIMENSIONS_OUT_OF_RANGE = "IMAGE_DIMENSIONS_OUT_OF_RANGE"
    INVALID_CONFIG = "INVALID_CONFIG"
    INVALID_ROI = "INVALID_ROI"
    INVALID_SAMPLE_COUNT = "INVALID_SAMPLE_COUNT"
    DEFECT_PLACEMENT_FAILED = "DEFECT_PLACEMENT_FAILED"
    SERVER_BUSY = "SERVER_BUSY"
    INTERNAL_ERROR = "INTERNAL_ERROR"


HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.BAD_REQUEST: 400,
    ErrorCode.MISSING_FIELD: 400,
    ErrorCode.INVALID_JSON: 400,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.METHOD_NOT_ALLOWED: 405,
    ErrorCode.FILE_TOO_LARGE: 413,
    ErrorCode.INVALID_IMAGE: 422,
    ErrorCode.UNSUPPORTED_IMAGE_FORMAT: 422,
    ErrorCode.IMAGE_DIMENSIONS_OUT_OF_RANGE: 422,
    ErrorCode.INVALID_CONFIG: 422,
    ErrorCode.INVALID_ROI: 422,
    ErrorCode.INVALID_SAMPLE_COUNT: 422,
    ErrorCode.DEFECT_PLACEMENT_FAILED: 422,
    ErrorCode.SERVER_BUSY: 429,
    ErrorCode.INTERNAL_ERROR: 500,
}


class DefectForgeError(Exception):
    """Expected, user-facing failure. ``message`` is Korean and safe to show to users."""

    def __init__(self, code: ErrorCode, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    @property
    def status_code(self) -> int:
        return HTTP_STATUS[self.code]

    def to_body(self) -> dict[str, Any]:
        return {"error": {"code": self.code.value, "message": self.message, "details": self.details}}
