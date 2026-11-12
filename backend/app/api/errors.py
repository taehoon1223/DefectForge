"""Uniform error responses: {"error": {"code", "message", "details"}} with Korean messages."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.error_codes import DefectForgeError, ErrorCode


def error_response(code: ErrorCode, message: str, details: dict[str, Any] | None = None) -> JSONResponse:
    exc = DefectForgeError(code, message, details)
    return JSONResponse(status_code=exc.status_code, content=exc.to_body())


def field_path(loc: tuple[Any, ...] | list[Any]) -> str:
    path = ""
    for part in loc:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}" if path else str(part)
    return path or "(root)"


def translate_error(err: dict[str, Any]) -> str:
    kind = err.get("type", "")
    ctx = err.get("ctx") or {}
    msg = str(err.get("msg", ""))
    match kind:
        case "missing":
            return "필수 값이 없습니다"
        case "extra_forbidden":
            return "알 수 없는 필드입니다"
        case "greater_than_equal":
            return f"{ctx.get('ge')} 이상이어야 합니다"
        case "less_than_equal":
            return f"{ctx.get('le')} 이하여야 합니다"
        case "greater_than":
            return f"{ctx.get('gt')}보다 커야 합니다"
        case "less_than":
            return f"{ctx.get('lt')}보다 작아야 합니다"
        case "int_parsing" | "int_type" | "int_from_float":
            return "정수여야 합니다"
        case "float_parsing" | "float_type":
            return "숫자여야 합니다"
        case "finite_number":
            return "유한한 숫자여야 합니다"
        case "bool_parsing" | "bool_type":
            return "true 또는 false여야 합니다"
        case "literal_error":
            return f"허용되지 않는 값입니다 (허용: {ctx.get('expected')})"
        case "union_tag_invalid":
            return f"알 수 없는 결함 유형입니다 (허용: {ctx.get('expected_tags')})"
        case "union_tag_not_found":
            return "type 필드가 필요합니다"
        case "too_short":
            return f"항목 수가 너무 적습니다 (최소 {ctx.get('min_length')}개)"
        case "too_long":
            return f"항목 수가 너무 많습니다 (최대 {ctx.get('max_length')}개)"
        case "list_type" | "tuple_type":
            return "배열이어야 합니다"
        case "model_type" | "dict_type" | "model_attributes_type":
            return "객체여야 합니다"
        case "value_error" | "assertion_error":
            return msg.split(", ", 1)[1] if ", " in msg else msg
    return msg


def config_validation_error(exc: ValidationError) -> DefectForgeError:
    errors = [{"field": field_path(e["loc"]), "message": translate_error(e)} for e in exc.errors(include_url=False)]
    first = errors[0]
    extra = f" (외 {len(errors) - 1}건)" if len(errors) > 1 else ""
    return DefectForgeError(
        ErrorCode.INVALID_CONFIG,
        f"설정값이 올바르지 않습니다 — {first['field']}: {first['message']}{extra}",
        {"errors": errors},
    )


_HTTP_CODES = {404: (ErrorCode.NOT_FOUND, "요청한 경로를 찾을 수 없습니다."), 405: (ErrorCode.METHOD_NOT_ALLOWED, "허용되지 않는 HTTP 메서드입니다.")}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DefectForgeError)
    async def _domain(_: Request, exc: DefectForgeError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_body())

    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        fields = [field_path([p for p in e["loc"] if p not in ("body", "form")]) for e in errors]
        if any(e["type"] == "missing" for e in errors):
            missing = [f for f, e in zip(fields, errors) if e["type"] == "missing"]
            return error_response(ErrorCode.MISSING_FIELD, f"필수 입력이 누락되었습니다: {', '.join(missing)}", {"fields": missing})
        if "sample_count" in fields:
            return error_response(ErrorCode.INVALID_SAMPLE_COUNT, "sample_count는 정수여야 합니다.")
        return error_response(ErrorCode.BAD_REQUEST, f"요청 형식이 올바르지 않습니다: {', '.join(fields)}", {"fields": fields})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _HTTP_CODES.get(exc.status_code, (ErrorCode.BAD_REQUEST, "요청 본문을 해석할 수 없습니다."))
        return error_response(code, message)
