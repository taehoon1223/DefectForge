from __future__ import annotations

import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image

from app.core.image_io import decode_image, read_upload_limited
from app.error_codes import DefectForgeError, ErrorCode
from tests.helpers import textured_rgb, to_bytes


def _decode(data: bytes):
    return decode_image(data, 32, 2048)


@pytest.mark.parametrize(("fmt", "kwargs"), [("PNG", {}), ("JPEG", {"quality": 95}), ("WEBP", {"lossless": True})])
def test_supported_formats_decode(fmt, kwargs):  # T01
    rgb = textured_rgb(64, 80)
    src = _decode(to_bytes(rgb, fmt, **kwargs))
    assert src.rgb.shape == (64, 80, 3) and src.rgb.dtype == np.uint8
    assert src.format == {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[fmt]
    if fmt != "JPEG":
        assert np.array_equal(src.rgb, rgb)
    assert len(src.sha256) == 64


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"this is not an image at all", ErrorCode.INVALID_IMAGE),
        (to_bytes(textured_rgb(64, 64))[:200], ErrorCode.INVALID_IMAGE),  # truncated PNG
        (to_bytes(textured_rgb(64, 64), "GIF"), ErrorCode.UNSUPPORTED_IMAGE_FORMAT),
        (to_bytes(textured_rgb(64, 64), "BMP"), ErrorCode.UNSUPPORTED_IMAGE_FORMAT),
    ],
)
def test_invalid_or_unsupported_files_rejected(data, code):  # T01
    with pytest.raises(DefectForgeError) as info:
        _decode(data)
    assert info.value.code is code
    assert info.value.status_code == 422


@pytest.mark.parametrize(("w", "h"), [(31, 64), (64, 31), (2049, 40), (40, 2049)])
def test_dimensions_out_of_range_rejected(w, h):  # T12
    with pytest.raises(DefectForgeError) as info:
        _decode(to_bytes(np.zeros((h, w, 3), np.uint8)))
    assert info.value.code is ErrorCode.IMAGE_DIMENSIONS_OUT_OF_RANGE


def test_dimension_bounds_inclusive():
    assert _decode(to_bytes(np.zeros((32, 2048, 3), np.uint8))).rgb.shape == (32, 2048, 3)


def _png_with_fake_header(width: int, height: int) -> bytes:
    """Valid small PNG whose IHDR claims a huge size (decompression-bomb shape)."""
    data = bytearray(to_bytes(np.zeros((40, 40, 3), np.uint8)))
    ihdr = struct.pack(">II", width, height) + bytes(data[24:29])
    data[16:29] = ihdr
    data[29:33] = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr) & 0xFFFFFFFF)
    return bytes(data)


def test_huge_header_rejected_before_decoding():
    with pytest.raises(DefectForgeError) as info:
        _decode(_png_with_fake_header(100_000, 100_000))
    assert info.value.code is ErrorCode.IMAGE_DIMENSIONS_OUT_OF_RANGE


def test_exif_orientation_is_applied():
    img = Image.fromarray(textured_rgb(40, 100))  # landscape 100x40
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    src = _decode(buf.getvalue())
    assert (src.width, src.height) == (40, 100)


def test_alpha_is_composited_on_white_and_grey_expanded():
    rgba = np.zeros((40, 40, 4), np.uint8)
    rgba[..., :3] = 10
    rgba[:20, :, 3] = 255  # top half opaque dark, bottom half fully transparent
    src = _decode(to_bytes(rgba))
    assert (src.rgb[:20] == 10).all() and (src.rgb[20:] == 255).all()

    grey = _decode(to_bytes(np.full((40, 40), 77, np.uint8)))
    assert grey.rgb.shape == (40, 40, 3) and (grey.rgb == 77).all()


def test_sixteen_bit_grey_rejected():
    buf = io.BytesIO()
    Image.fromarray(np.full((40, 40), 30000, np.uint16)).save(buf, format="PNG")
    with pytest.raises(DefectForgeError) as info:
        _decode(buf.getvalue())
    assert info.value.code is ErrorCode.UNSUPPORTED_IMAGE_FORMAT


def test_upload_size_limit():
    assert read_upload_limited(io.BytesIO(b"x" * 100), 100) == b"x" * 100
    with pytest.raises(DefectForgeError) as info:
        read_upload_limited(io.BytesIO(b"x" * 101), 100)
    assert info.value.code is ErrorCode.FILE_TOO_LARGE and info.value.status_code == 413
    with pytest.raises(DefectForgeError) as info:
        read_upload_limited(io.BytesIO(b""), 100)
    assert info.value.code is ErrorCode.INVALID_IMAGE
