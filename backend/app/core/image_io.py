"""Upload reading, decoding/normalisation and PNG encoding.

Normalised source = EXIF-transposed, RGB 8-bit, 3 channels, alpha composited on white.
All ROI coordinates and outputs live in this normalised pixel space.
"""

from __future__ import annotations

import base64
import hashlib
import io
import warnings
from dataclasses import dataclass
from typing import BinaryIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.error_codes import DefectForgeError, ErrorCode

ALLOWED_FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}
_HIGH_BIT_DEPTH_MODES = {"I", "I;16", "I;16B", "I;16L", "I;16N", "F"}
_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class SourceImage:
    rgb: np.ndarray  # (H, W, 3) uint8, read-only
    sha256: str
    format: str

    @property
    def width(self) -> int:
        return int(self.rgb.shape[1])

    @property
    def height(self) -> int:
        return int(self.rgb.shape[0])


def read_upload_limited(stream: BinaryIO, max_bytes: int) -> bytes:
    """Read an upload without ever holding more than ``max_bytes + 1 chunk`` in memory."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise DefectForgeError(
                ErrorCode.FILE_TOO_LARGE,
                f"파일이 너무 큽니다. 최대 {max_bytes / (1024 * 1024):g} MiB까지 업로드할 수 있습니다.",
                {"max_bytes": max_bytes},
            )
        chunks.append(chunk)
    if total == 0:
        raise DefectForgeError(ErrorCode.INVALID_IMAGE, "빈 파일입니다. 이미지 파일을 선택하세요.")
    return b"".join(chunks)


def _check_dims(width: int, height: int, min_dim: int, max_dim: int) -> None:
    if not (min_dim <= width <= max_dim and min_dim <= height <= max_dim):
        raise DefectForgeError(
            ErrorCode.IMAGE_DIMENSIONS_OUT_OF_RANGE,
            f"이미지 크기 {width}×{height}px는 지원 범위를 벗어났습니다. 가로·세로 모두 {min_dim}~{max_dim}px이어야 합니다.",
            {"width": width, "height": height, "min_dim": min_dim, "max_dim": max_dim},
        )


def _to_rgb(img: Image.Image) -> np.ndarray:
    if img.mode in _HIGH_BIT_DEPTH_MODES:
        raise DefectForgeError(
            ErrorCode.UNSUPPORTED_IMAGE_FORMAT,
            "16비트/부동소수점 이미지는 MVP에서 지원하지 않습니다. 8비트 이미지로 변환 후 업로드하세요.",
            {"mode": img.mode},
        )
    has_alpha = img.mode in ("RGBA", "LA", "PA", "RGBa", "La") or "transparency" in img.info
    if has_alpha:
        rgba = img.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(white, rgba).convert("RGB")
    else:
        rgb = img.convert("RGB")
    arr = np.array(rgb, dtype=np.uint8, copy=True)
    arr.setflags(write=False)
    return arr


def decode_image(data: bytes, min_dim: int, max_dim: int) -> SourceImage:
    """Decode by content (never by extension), validate, EXIF-transpose and normalise to RGB8."""
    sha256 = hashlib.sha256(data).hexdigest()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as img:
                fmt = img.format or ""
                if fmt not in ALLOWED_FORMATS:
                    raise DefectForgeError(
                        ErrorCode.UNSUPPORTED_IMAGE_FORMAT,
                        f"지원하지 않는 이미지 형식입니다({fmt or '알 수 없음'}). PNG, JPEG, WebP만 업로드할 수 있습니다.",
                        {"format": fmt or None},
                    )
                # Header-only size check before decoding pixels (decompression-bomb guard).
                # EXIF rotation only swaps axes, and the range is symmetric, so this is exact.
                _check_dims(img.width, img.height, min_dim, max_dim)
                img.load()
                oriented = ImageOps.exif_transpose(img)
                rgb = _to_rgb(oriented)
    except DefectForgeError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise DefectForgeError(
            ErrorCode.IMAGE_DIMENSIONS_OUT_OF_RANGE,
            "이미지 픽셀 수가 너무 많습니다(압축 폭탄 의심).",
        ) from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError) as exc:
        raise DefectForgeError(
            ErrorCode.INVALID_IMAGE,
            "이미지를 디코딩할 수 없습니다. 파일이 손상되었거나 이미지가 아닙니다.",
        ) from exc
    _check_dims(rgb.shape[1], rgb.shape[0], min_dim, max_dim)
    return SourceImage(rgb=rgb, sha256=sha256, format=ALLOWED_FORMATS[fmt])


def encode_png(array: np.ndarray) -> bytes:
    """RGB (H,W,3) -> 8-bit RGB PNG, (H,W) -> 8-bit grayscale PNG (never palette)."""
    if array.dtype != np.uint8:
        raise TypeError("encode_png expects uint8")
    if array.ndim == 3:
        array = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".png", array, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return buf.tobytes()


def b64(data: bytes) -> str:
    """Plain base64 (no data-URI prefix, per API contract)."""
    return base64.b64encode(data).decode("ascii")
