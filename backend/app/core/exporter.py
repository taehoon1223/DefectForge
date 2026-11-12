"""Dataset ZIP builder (pure; the API layer owns the temp-file lifecycle)."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from typing import IO, Any

from app.core.image_io import SourceImage, encode_png
from app.core.pipeline import make_sampler
from app.schemas.generation import AnyGenerationConfig

SEED_RULE = "seed_i = base_seed + i  (i = 0 .. sample_count-1, 파일 번호 = i + 1)"

_README_TEMPLATE = """DefectForge 합성 결함 데이터셋
================================

생성 일시(UTC): {created_at}
샘플 수: {count}
원본 이미지 SHA-256: {sha256}
이미지 크기: {width} x {height} px
기준 seed(base_seed): {seed}

[폴더 구조]
images/image_NNNN.png         합성 이미지 (RGB 8-bit PNG, 원본과 동일한 크기)
masks/mask_NNNN.png           클래스 마스크 (단일 채널 8-bit 회색조 PNG, 픽셀값 = 클래스 ID)
binary_masks/binary_NNNN.png  바이너리 마스크 (단일 채널 8-bit PNG, 0 = 변경 없음, 255 = 변경됨)
metadata/image_NNNN.json      샘플별 메타데이터 (seed, 실제 샘플링된 파라미터, bbox 등)
manifest.json                 전체 파일 목록, 클래스 정의, seed 규약, 합성 설정

[파일 매칭]
같은 번호 NNNN(0001부터 시작)을 가진 파일끼리 1:1로 대응합니다.
  images/image_0001.png <-> masks/mask_0001.png <-> binary_masks/binary_0001.png <-> metadata/image_0001.json

[클래스 값 (masks/)]
{class_lines}
클래스 마스크는 팔레트가 아닌 회색조 값 자체가 클래스 ID입니다.
일반 이미지 뷰어에서 거의 검게 보이는 것이 정상입니다.

[Seed 규약]
{seed_rule}
같은 원본 이미지 + 같은 설정 + 같은 seed -> 항상 같은 이미지와 마스크가 생성됩니다.

[마스크 의미와 한계]
- 마스크는 '합성에 의해 실제 RGB 값이 바뀐 픽셀'을 뜻합니다.
  binary_mask == any(image != 원본, 채널축) * 255 이며, binary_mask가 0인 곳의 class_mask는 항상 0입니다.
- 1~2 레벨 차이처럼 눈에 잘 띄지 않는 변화도 변경 픽셀로 포함됩니다.
- 겹침이 허용된 경우, 나중에 적용된 결함의 클래스가 해당 픽셀의 라벨이 됩니다.
- 실제 현장 결함을 물리적으로 검증한 어노테이션이 아닙니다. 합성 결함은 실제 결함의 형태·분포·광학 특성과
  다를 수 있으므로, 이 데이터로 학습한 모델은 반드시 실제 검사 데이터로 별도 검증해야 합니다.
- pinhole은 핀홀과 유사한 외관(pinhole-like appearance)을 흉내 낸 것으로, 관통 구멍의 물리 광학을 시뮬레이션하지 않습니다.
"""

_V11_README = """
[생성 영역 (config 1.1)]
생성 영역: {scope} · 제외 영역 {excluded}개 · 경계 여유 {margin}px · 허용 픽셀 {allowed}
- 결함은 '허용 영역 = 생성 영역(없으면 이미지 전체) − 제외 영역'에서 경계 여유를 뺀 곳에만 생깁니다.
  이 영역 밖의 픽셀은 원본과 완전히 같습니다.
- 영역 다각형과 마스크 해시(allowed_mask_sha256 등), 기준선, 표면 분석 요약은
  manifest.json과 metadata/*.json의 area / reference_line / surface_analysis 필드에 기록됩니다.
- 스크래치 '표면 밝기에 맞추기'는 원본 이미지의 국소 평균·표준편차를 이용한 외관 규칙이며,
  실제 조명·3D 형상을 복원한 것이 아닙니다.
"""


def sample_paths(index: int) -> dict[str, str]:
    stem = f"{index:04d}"
    return {
        "image": f"images/image_{stem}.png",
        "class_mask": f"masks/mask_{stem}.png",
        "binary_mask": f"binary_masks/binary_{stem}.png",
        "metadata": f"metadata/image_{stem}.json",
    }


def _json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


def write_dataset_zip(
    source: SourceImage,
    config: AnyGenerationConfig,
    sample_count: int,
    out: IO[bytes],
    created_at: datetime | None = None,
) -> dict[str, Any]:
    """Generate ``sample_count`` samples (seed = config.seed + i) into ``out``. Returns the manifest.

    Validation and preparation (ROI, areas, surface analysis) run once and are shared by all
    samples. Samples are generated, encoded and written one at a time so memory stays bounded.
    """
    created = (created_at or datetime.now(timezone.utc)).replace(microsecond=0)
    created_iso = created.isoformat().replace("+00:00", "Z")
    sampler = make_sampler(source, config)
    files: list[dict[str, Any]] = []

    with zipfile.ZipFile(out, "w") as zf:
        for i in range(sample_count):
            seed = config.seed + i
            paths = sample_paths(i + 1)
            result = sampler.generate(seed)
            # PNG is already deflate-compressed; store it as-is.
            zf.writestr(paths["image"], encode_png(result.image), compress_type=zipfile.ZIP_STORED)
            zf.writestr(paths["class_mask"], encode_png(result.class_mask), compress_type=zipfile.ZIP_STORED)
            zf.writestr(paths["binary_mask"], encode_png(result.binary_mask), compress_type=zipfile.ZIP_STORED)
            zf.writestr(paths["metadata"], _json_bytes(result.metadata), compress_type=zipfile.ZIP_DEFLATED)
            files.append({"index": i + 1, "seed": seed, **paths, "generated_count": result.metadata["generated_count"]})
            del result

        manifest = {
            "dataset": "DefectForge synthetic defect dataset",
            "format_version": "1.0",
            "generator": {"name": "DefectForge", "engine_version": sampler.engine_version},
            "created_at": created_iso,
            "sample_count": sample_count,
            "class_map": dict(sampler.class_map),
            "mask_encoding": {
                "class_mask": "single-channel 8-bit grayscale PNG; pixel value = class id",
                "binary_mask": "single-channel 8-bit PNG; 0 = unchanged, 255 = changed",
                "bbox_format": "xyxy_inclusive",
            },
            "seed_rule": SEED_RULE,
            "base_seed": config.seed,
            "source": {"sha256": source.sha256, "width": source.width, "height": source.height, "format": source.format},
            "config": config.model_dump(mode="json"),
            "files": files,
            **sampler.manifest_extra,
        }
        zf.writestr("manifest.json", _json_bytes(manifest), compress_type=zipfile.ZIP_DEFLATED)
        readme = _README_TEMPLATE.format(
            class_lines="\n".join(f"  {cid} = {name}" for cid, name in sampler.class_map.items()),
            created_at=created_iso,
            count=sample_count,
            sha256=source.sha256,
            width=source.width,
            height=source.height,
            seed=config.seed,
            seed_rule=SEED_RULE,
        )
        if "area" in sampler.manifest_extra:
            area = sampler.manifest_extra["area"]
            includes = sum(r["kind"] == "include" for r in area["regions"])
            readme += _V11_README.format(
                scope="이미지 전체" if area["full_image"] else f"{includes}개",
                excluded=sum(r["kind"] == "exclude" for r in area["regions"]),
                margin=area["edge_margin_px"],
                allowed=area["allowed_pixel_count"],
            )
        zf.writestr("README.txt", readme.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
    return manifest
