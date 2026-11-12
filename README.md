# DefectForge

정상 표면 이미지에 **합성 결함(scratch · pinhole · contamination)** 을 넣고, 합성 이미지와 **픽셀 단위로 정확히 정합되는 Segmentation 마스크**를 함께 만들어 데이터셋 ZIP으로 내려받는 로컬 웹 워크벤치입니다. GPU·DB·로그인 없이 동작합니다.

![작업 화면: 다각형 ROI 안에 합성된 결함과 마스크 오버레이](docs/images/workspace_overlay.png)

| 클래스 마스크 보기 |
| --- |
| ![클래스 마스크 보기](docs/images/class_mask_view.png) |

## 주요 기능

- **이미지 업로드**: PNG / JPEG / WebP, 드래그 앤 드롭 또는 파일 선택, 최대 10 MiB, 각 변 32–2048 px. 서버는 확장자가 아니라 실제 디코딩으로 판별하고 EXIF 회전 적용, RGB 8-bit로 정규화(알파는 흰 배경에 합성).
- **ROI 편집**: 기본은 전체 이미지. 다각형 그리기, 꼭짓점 드래그, 변 중앙 클릭으로 점 삽입, 우클릭으로 점 삭제, ROI 삭제. 확대·축소(휠, 포인터 기준)·팬과 무관하게 **원본 픽셀 좌표**로 저장되고, 좌표 목록이 패널에 표시됩니다. 자기 교차·면적 0 등은 즉시 안내.
- **결함 3종**: 유형별 활성화, 개수, 크기·대비·각도·극성 등 파라미터. 공통으로 Seed, 겹침 허용 여부.
- **미리보기**: 원본 / 합성 / 마스크 오버레이 / 클래스 마스크 보기, 오버레이 불투명도(시각화 전용), 원본·출력 크기, 실제 생성 개수, 클래스별 픽셀 수, 인스턴스 bbox, 처리 시간. 설정을 바꾸면 `설정 변경됨`으로 이전 결과임을 표시.
- **재현성**: 같은 이미지 + 같은 설정 + 같은 Seed → 이미지·마스크 PNG 바이트까지 동일.
- **데이터셋 ZIP**: 1–20장, i번째 샘플 seed = `seed + i`. 이미지 / 클래스 마스크 / 바이너리 마스크 / 샘플별 JSON + `manifest.json` + `README.txt`.
- **한국어 오류 안내**: 잘못된 파일, 크기 초과, 잘못된 ROI·파라미터(필드별), 배치 불가능(원인별 횟수와 해결 힌트)을 설정을 잃지 않고 안내.

## 요구 사항

| 구성 | 버전 |
| --- | --- |
| Python | **3.11** (3.11.9에서 검증) |
| Node.js | **22.12 이상** (24.22.2 LTS에서 검증. Vitest 5 요구사항) |
| OS | Windows 11에서 검증. macOS/Linux는 아래 명령의 가상환경 경로만 다름 |

GPU는 필요 없습니다.

## 빠른 시작

터미널 두 개에서 백엔드와 프론트엔드를 각각 실행합니다.

### 1) 백엔드 (FastAPI, http://127.0.0.1:8000)

```bash
cd backend
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# Windows (Git Bash):    source .venv/Scripts/activate
# macOS / Linux:         source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- API 문서(OpenAPI/Swagger): http://127.0.0.1:8000/docs
- 설정을 바꾸려면 `backend/.env.example`을 `backend/.env`로 복사해 수정(선택).

### 2) 프론트엔드 (Vite, http://127.0.0.1:5173)

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 **http://127.0.0.1:5173** 을 엽니다. 백엔드 주소가 다르면 `frontend/.env.example`을 `frontend/.env`로 복사해 `VITE_API_BASE_URL`을 바꿉니다.

### 3) 사용 순서

1. 왼쪽 패널에서 이미지를 올리거나 **예시 이미지**를 누릅니다.
2. (선택) **다각형 그리기**(`P`)로 ROI를 그립니다. 클릭으로 점 추가 → 첫 점 클릭 / 더블클릭 / `Enter`로 닫기, `Backspace` 마지막 점 삭제, `Esc` 취소, `Space`+드래그로 이동. 그리지 않으면 전체 이미지를 사용합니다.
3. 결함 유형과 파라미터, Seed를 정하고 **생성 미리보기**를 누릅니다.
4. 상단 탭으로 보기 모드를 바꾸고, 오른쪽에서 결과(생성 개수, 크기, 클래스별 픽셀)와 범례를 확인합니다.
5. 오른쪽 **데이터셋 내보내기**에서 장수(1–20)를 정하고 하단 **데이터셋 다운로드**를 누릅니다.

## 테스트와 검증 결과

```bash
# 백엔드: 단위 + API 통합
cd backend
pytest -q

# 프론트엔드: 타입체크, 린트, 단위 테스트, 빌드
cd ../frontend
npm run typecheck
npm run lint
npm run test
npm run build

# 브라우저 E2E (실제 FastAPI + Vite 서버를 자동으로 띄움. 이미 실행 중이면 재사용)
npx playwright install chromium   # 최초 1회
npx playwright test
```

**2026-11-11 실행 결과** (Windows 11, Python 3.11.9, Node 24.22.2)

| 스위트 | 결과 |
| --- | --- |
| `pytest -q` (백엔드 단위·API 통합·계약) | **126 passed** |
| `npm run test` (Vitest + React Testing Library) | **47 passed** (6 files) |
| `npx playwright test` (Chromium, 데스크톱 6 + 모바일 2) | **8 passed** |
| `npm run typecheck` / `npm run lint` / `npm run build` | 오류·린트 경고 0, 빌드 성공 |

E2E는 목업 없이 실제 백엔드에 요청합니다. Playwright가 `backend/.venv`의 Python으로 uvicorn을 띄우므로 먼저 백엔드 가상환경을 만들어 두세요(다른 Python을 쓰려면 `DEFECTFORGE_PYTHON` 환경변수로 경로 지정).

### 설계서 수용 기준(T01–T15) 대응

| 기준 | 검증 위치 |
| --- | --- |
| T01 PNG/JPEG/WebP 정상, 잘못된 형식·손상 파일 거절 | `test_image_io.py`, `test_api.py`(텍스트·잘린 PNG·`.png` 이름의 GIF), E2E(가짜 이미지 업로드) |
| T02 세 유형 미리보기 | `test_generation.py::test_each_type_generates_visible_defects`, E2E |
| T03 ROI 없으면 전체 이미지 | `test_roi.py`, `test_generation.py::test_no_roi_uses_full_image` |
| T04 ROI 밖 RGB 100% 동일 | `test_masks.py`(삼각형 ROI, blur σ=8에서도) |
| T05 같은 Seed → SHA-256 동일 | `test_generation.py`(3회 반복, 배열·PNG 바이트·메타데이터), `test_api.py` |
| T06 다른 Seed → 위치/형태 다름 | `test_generation.py::test_different_seeds_differ` |
| T07 이미지·마스크 크기 일치 | `test_masks.py`(PNG 디코드 후 비교), E2E(ZIP PNG 헤더) |
| T08 `binary == any(diff)*255` | `test_masks.py`, `test_api.py`, `test_export.py`, 무작위 설정 25종 |
| T09 `binary==0`이면 `class==0`, 범위 0..3 | 위와 동일 (+ `class>0 ⇔ binary==255`까지 검증) |
| T10 요청 개수 = 생성 개수 또는 명시적 422 | `test_generation.py`(80개 생성, 배치 불가 시 422) |
| T11 ZIP N=1/10/20 | `test_export.py`(구조·1:1 매칭·manifest·seed 규약·임시 파일 삭제), E2E(N=10 다운로드) |
| T12 10 MiB 초과, 2048 px 초과, 빈 ROI, 잘못된 파라미터 거절 | `test_api.py`, `test_image_io.py`, `test_roi.py`, Vitest, E2E |
| T13 오버레이 불투명도가 결과 파일 불변 | Vitest(스토어·컴포넌트), E2E(불투명도 변경 후 ZIP 바이트 = 미리보기 바이트) |
| T14 확대/축소 후 ROI 좌표 오차 ≤ 1 px | Vitest(Konva `Transform` 역행렬 대조, 무작위 2000회), E2E(확대·팬·휠 후 실제 클릭 / 꼭짓점 드래그 / 모바일 탭) |
| T15 Python·프론트 단위·E2E 통과 | 위 표 |

## 성능 (1024×1024 단일 미리보기, CPU)

```bash
cd backend
python scripts/benchmark_preview.py --runs 20
```

2026-11-11 측정 (AMD Ryzen 계열 데스크톱 CPU, Windows 11, Python 3.11.9, NumPy 2.4.6, OpenCV 4.14.0), 기본 설정(스크래치 2 + 핀홀 3 + 오염 2), Seed 20개:

| 구간 | 중앙값 | p90 |
| --- | --- | --- |
| 합성 엔진만 | **29.5 ms** | 36.1 ms |
| 미리보기 전체 (엔진 + PNG 3장 인코딩 + base64) | **250.5 ms** | 274.7 ms |

시간 대부분은 텍스처가 많은 RGB 이미지의 PNG 인코딩입니다. 512×448 예시 이미지의 서버 처리 시간은 보통 60–130 ms입니다.

## API

모든 경로는 `/api/v1` 아래에 있고, 오류는 항상 `{"error": {"code", "message", "details"}}` 형식입니다.

| 메서드·경로 | 입력 | 출력 |
| --- | --- | --- |
| `GET /api/v1/health` | – | `{"status":"ok","version":"1.0.0"}` |
| `POST /api/v1/preview` | multipart: `file`, `config`(JSON 문자열) | `image_png_base64`, `class_mask_png_base64`, `binary_mask_png_base64`(data URI 접두어 없음), `metadata`, `processing_ms` |
| `POST /api/v1/export` | multipart: `file`, `config`, `sample_count`(1–20) | `application/zip` (`defectforge_dataset.zip`) |

```bash
# 저장소 루트에서
curl -s http://127.0.0.1:8000/api/v1/health

curl -s -X POST http://127.0.0.1:8000/api/v1/preview \
  -F "file=@frontend/public/samples/brushed_metal_512x448.png" \
  -F "config=<examples/configs/scratch.json"

curl -s -X POST http://127.0.0.1:8000/api/v1/export \
  -F "file=@frontend/public/samples/brushed_metal_512x448.png" \
  -F "config=<examples/configs/pinhole.json" \
  -F "sample_count=5" -o defectforge_dataset.zip
```

| HTTP | 코드 | 상황 |
| --- | --- | --- |
| 400 | `MISSING_FIELD`, `INVALID_JSON`, `BAD_REQUEST` | 필수 필드 누락, config JSON 문법 오류, 본문 해석 불가 |
| 413 | `FILE_TOO_LARGE` | 업로드 10 MiB 초과 |
| 422 | `INVALID_IMAGE`, `UNSUPPORTED_IMAGE_FORMAT`, `IMAGE_DIMENSIONS_OUT_OF_RANGE` | 디코딩 불가, PNG/JPEG/WebP 아님(16비트 포함), 크기 범위 밖 |
| 422 | `INVALID_CONFIG`, `INVALID_ROI`, `INVALID_SAMPLE_COUNT` | 파라미터·ROI·장수 오류 (`details.errors`에 필드별 한국어 메시지) |
| 422 | `DEFECT_PLACEMENT_FAILED` | 100회 시도해도 배치 불가 (`details.rejections`에 원인별 횟수) |
| 429 | `SERVER_BUSY` | 동시 생성 작업 상한 초과 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 (경로·트레이스 비노출) |

### config 형식

```json
{
  "version": "1.0",
  "seed": 42,
  "roi": [[40, 40], [460, 40], [460, 400], [40, 400]],
  "allow_overlap": false,
  "defects": [
    { "type": "scratch", "count": 2,
      "params": { "length_px": [45, 110], "width_px": [1, 3], "angle_deg": [0, 180],
                  "contrast": [0.2, 0.65], "polarity": "dark", "curvature": 0.2 } }
  ]
}
```

- `roi`: `null`이면 전체 이미지. 원본 픽셀 공간의 정수 `[x, y]`, 3–256점, 자기 교차 없는 단순 다각형. 경계 픽셀 포함.
- `defects`: 1–3개, 유형별 최대 1회(개수는 `count`). 배열 순서대로 적용되며 겹치면 나중 유형이 라벨을 가집니다.
- `[min, max]` 범위 값은 인스턴스마다 균등 샘플링. `polarity`는 `dark | bright | random`(random은 인스턴스마다 결정).
- 예시: [`examples/configs/`](examples/configs) (`scratch.json`, `pinhole.json`, `contamination.json` — 예시 이미지에서 생성되는지 테스트로 확인)

| 유형 | 파라미터 (범위 · 기본값) |
| --- | --- |
| `scratch` | `count` 1–20 · 2, `length_px` 8–512 · [40,120], `width_px` 1–20 · [1,3], `angle_deg` 0–180 · [0,180], `contrast` 0.05–1 · [0.25,0.6], `curvature` 0–1 · 0.15, `polarity` · dark |
| `pinhole` | `count` 1–30 · 3, `radius_px` 1–30 · [2,6], `irregularity` 0–1 · 0.3, `contrast` 0.05–1 · [0.35,0.85], `rim_strength` 0–1 · 0.2, `polarity` · bright |
| `contamination` | `count` 1–30 · 2, `radius_px` 2–80 · [8,24], `irregularity` 0–1 · 0.5, `opacity` 0.1–1 · [0.3,0.7], `blur_sigma` 0–8 · 1.5, `polarity` · dark |

기본 `seed`는 42(범위 0 ~ 2³²−1). 한계값·기본값의 단일 출처는 백엔드 `app/schemas/generation.py`이며, 프론트의 `frontend/src/types/limits.json`이 같은지 `tests/test_contract.py`가 검사합니다.

## 출력 데이터 형식

```
defectforge_dataset.zip
├── README.txt                    # 클래스 값, 파일 매칭, 합성 데이터 한계
├── manifest.json                 # 생성 일시(UTC), 개수, 클래스 정의, seed 규약, 원본 SHA-256, config, 파일 목록
├── images/image_0001.png         # RGB 8-bit, 원본과 같은 W×H
├── masks/mask_0001.png           # 단일 채널 8-bit 회색조, 픽셀값 = 클래스 ID
├── binary_masks/binary_0001.png  # 단일 채널 8-bit, 0 = 변경 없음, 255 = 변경됨
└── metadata/image_0001.json      # 샘플별 메타데이터
```

- 같은 번호(0001부터)끼리 1:1 대응합니다. i번째 샘플(0부터)의 seed = `base_seed + i`.
- **클래스 값**: `0 = background`, `1 = scratch`, `2 = pinhole`, `3 = contamination`. 팔레트 PNG가 아니라 회색조 값 자체가 클래스 ID라 일반 뷰어에서는 거의 검게 보입니다.
- **마스크 의미**: 합성으로 **실제 RGB 값이 바뀐 픽셀**. `binary_mask == any(image != 원본) * 255`가 항상 성립하고, `binary_mask == 0`인 곳의 `class_mask`는 0, 그 외는 1–3입니다. ROI 밖 픽셀은 원본과 완전히 같습니다.
- **metadata 주요 필드**: `seed`, `source_sha256`(업로드 원본 바이트), `width`, `height`, `class_map`, `roi`, `roi_pixel_count`, `requested_count`, `generated_count`, `changed_pixel_count`, `class_pixel_counts`, `config`, 그리고 `instances[]` — 인스턴스별 `type`, `class_id`, `bbox_xyxy`(포함 픽셀 인덱스), `center_xy`, `changed_pixel_count`, `attempts`, 실제 샘플링된 `params`(길이·폭·각도·대비·극성·반지름·색 등).

## 환경 변수

| 위치 | 변수 | 기본값 |
| --- | --- | --- |
| backend | `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |
| backend | `MAX_UPLOAD_MIB` | `10` |
| backend | `MAX_IMAGE_DIM` | `2048` |
| backend | `MAX_EXPORT_COUNT` | `20` |
| backend | `MAX_CONCURRENT_JOBS` / `JOB_WAIT_SECONDS` | `2` / `15` |
| backend | `EXPORT_TMP_DIR` | OS 임시 폴더 (32 MiB 넘는 ZIP만 디스크 사용, 자동 삭제) |
| frontend | `VITE_API_BASE_URL` | `http://127.0.0.1:8000` |

## 프로젝트 구조

```
backend/
  app/main.py                FastAPI 앱 팩토리, CORS, 요청 크기 가드, 500 처리
  app/config.py              환경 변수 설정
  app/error_codes.py         오류 코드·HTTP 상태 단일 정의
  app/api/routes.py          /health, /preview, /export, 동시성 제한
  app/api/errors.py          공통 오류 포맷, 검증 오류 한국어 번역
  app/schemas/generation.py  Pydantic 스키마, LIMITS/DEFAULTS
  app/core/image_io.py       업로드 읽기·디코딩·정규화·PNG 인코딩
  app/core/roi.py            ROI 검증·래스터화
  app/core/compositor.py     효과 적용과 마스크 규약 보장
  app/core/generation.py     생성 파이프라인 (FastAPI 비의존)
  app/core/exporter.py       데이터셋 ZIP
  app/defects/               DefectGenerator 기반 클래스와 3종 생성기, 래스터 헬퍼
  app/inference/base.py      V2용 InferenceAdapter 인터페이스(구현 없음)
  scripts/                   예시 이미지 생성, 성능 측정
  tests/                     pytest 126개
frontend/
  src/App.tsx                3패널 레이아웃(모바일 세로 스택)
  src/components/            ImageUploader, RoiEditor, PreviewCanvas, DefectControls(유형 선택·유형별 컨트롤),
                             MaskLegend, GenerationSummary, ExportPanel, StatusBar, Toast, Header
  src/store/                 Zustand 작업 상태
  src/api/client.ts          fetch 래퍼(AbortController)
  src/lib/                   좌표 변환, ROI 동작, 마스크 색상, 이미지 파일 검사
  src/types/                 타입, Zod 스키마, limits.json
  tests/workspace.spec.ts    Playwright E2E
examples/configs/            예시 config 3종
docs/MVP_SPEC.md             원본 설계서
DECISIONS.md                 설계서에 없던 구현 판단과 이유
```

## 확장

- **결함 유형 추가**: `app/defects/base.py`의 `DefectGenerator`를 상속해 `render()`에서 알파 레이어(효과)만 반환하고, 파라미터 스키마를 `app/schemas/generation.py`에 추가한 뒤 `app/defects/__init__.py`에 등록합니다. 이미지 범위·ROI·겹침·실제 변화 검사와 마스크 규약은 compositor가 공통으로 처리합니다.
- **모델 추론(V2)**: `app/inference/base.py`의 `InferenceAdapter` 프로토콜이 ONNX Runtime / PatchCore 어댑터 연결 지점입니다. MVP에서는 인터페이스만 있습니다.
- **Diffusion 인페인팅(V3)**: 생성기가 효과를 "제안"하고 compositor가 실제 변경 픽셀로 마스크를 만드는 구조라, 인페인팅 결과도 같은 규약으로 마스크를 얻을 수 있습니다.

## 알려진 한계

- **합성 데이터의 도메인 차이**: 마스크는 "합성으로 바뀐 픽셀"이며, 실제 현장 결함을 물리적으로 검증한 어노테이션이 아닙니다. 형태·분포·광학 특성이 실제 결함과 다를 수 있으므로, 이 데이터로 학습한 모델은 **반드시 실제 검사 데이터로 별도 검증**해야 합니다.
- **알고리즘 한계**: 결함은 절차적(알파 블렌딩) 모델입니다. `pinhole`은 핀홀과 비슷한 외관(pinhole-like appearance)을 흉내 낼 뿐 관통 구멍의 광학을 시뮬레이션하지 않습니다. 강한 파라미터에서 부자연스러워 보이는 것은 생성 모델이 아닌 합성 알고리즘의 한계입니다.
- 1–2 레벨처럼 눈에 띄지 않는 변화도 변경 픽셀로 마스크에 포함됩니다(규약상 의도).
- 밝기가 포화된 영역(예: 흰 배경 + `bright`)에서는 변화가 생기지 않아 422가 납니다. 극성이나 대비를 바꿔야 합니다.
- 16비트 이미지, 2048 px 초과 이미지, 영상/라인스캔, 타일링, COCO/YOLO/CVAT 내보내기는 지원하지 않습니다(설계서 범위 밖).
- 겹침을 허용하면 인스턴스 bbox는 적용 시점 기준이라 나중 결함이 덮은 픽셀도 포함될 수 있습니다.
- 모바일에서는 버튼으로 확대·축소합니다(핀치 줌 없음). ROI 편집 실행 취소(undo)는 없습니다.
- 프론트 번들이 약 680 kB(gzip 209 kB)로, 대부분 Konva입니다. 로컬 도구 특성상 코드 분할은 하지 않았습니다.
- 동일 Seed의 바이트 재현성은 `requirements.txt`의 버전이 같은 환경을 전제로 합니다. 라이브러리 버전이나 플랫폼이 바뀌면 래스터화 결과가 달라질 수 있습니다.

## 자산·라이선스

- 예시 이미지 `frontend/public/samples/brushed_metal_512x448.png`는 `backend/scripts/generate_sample_image.py`가 난수로 만든 합성 텍스처로, 외부 자산을 사용하지 않았습니다.
- 사용한 오픈소스(FastAPI, NumPy, OpenCV, Pillow, React, Konva 등)는 각 라이선스를 따릅니다. 상업적 사용 전에 각 라이선스를 확인하세요.
- 업로드한 이미지와 결과는 서버에 저장되지 않습니다(미리보기는 메모리 처리, ZIP은 전송 후 즉시 삭제). 외부 API로 전송하지 않습니다.
