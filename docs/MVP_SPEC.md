# DefectForge — AI 코딩 에이전트용 제품·기술 명세서

- 문서 버전: 1.0
- 작성 기준: 2026-11-11
- 상태: MVP 구현 기준 (의도적으로 범위 고정)
- 대상: 다른 AI 코딩 에이전트(Codex, Claude Code, Cursor 등)
- 언어: 화면 및 사용자 문구는 한국어, 코드/파일/필드명은 영어

> 핵심 미션: 사용자가 정상 제품·표면 이미지를 업로드하고 원하는 영역과 불량 조건을 지정하면, 합성 불량 이미지와 픽셀 단위 Ground Truth 마스크를 생성하고 일괄 데이터셋으로 내려받을 수 있는 실제 작동하는 웹앱을 개발한다.

---

## 0. 에이전트 실행 지침 (최우선)

1. 이 문서의 **MVP 필수 범위**를 실제 동작하는 코드로 구현하라. 목업/더미 추론/하드코딩된 출력으로 핵심 흐름을 대체하지 말 것.
2. 기술 스택과 API 계약을 우선 따르고, 세부 구현의 애매한 부분만 합리적으로 결정하여 `DECISIONS.md`에 기록하라.
3. UI는 어두운 배경을 기본으로 한 깔끔한 검사 워크벤치 스타일로 만들고, 모든 버튼과 입력이 실제로 동작하도록 하라.
4. 이미지의 원본 픽셀 좌표·출력 크기·마스크 정합성을 절대 깨뜨리지 말 것. 특히 확대/축소된 브라우저 좌표와 원본 이미지 좌표를 구분하라.
5. 첫 버전에서는 생성형 AI 모델, DB, 로그인, 결제, 장시간 실행 작업 큐, 모델 학습 기능을 만들지 말 것.
6. 각 단계에서 테스트를 실행하고 오류가 있으면 수정하라. 구현 완료 시 실행 방법, 구현 기능, 검증 결과, 알려진 한계를 `README.md`에 정리하라.
7. 필요한 코드 파일은 직접 생성하라. 세부 라이브러리 API가 버전에 따라 다르면 공식 문서와 설치 버전을 기준으로 동작을 검증하라.

## 1. 문제와 제품 목표

### 해결할 문제
- 산업용 비전 검사에서 드문 NG 샘플을 수집하기 어렵다.
- 임의로 합성한 결함 이미지에 대해 사람이 별도 Segmentation 마스크를 그리면 반복 작업이 많다.
- 결함 크기/명암/위치/개수를 바꿔 다양한 조건을 재현하기 어렵다.

### 목표 사용자
- Computer Vision 엔지니어, 산업용 비전 검사 연구원, 데이터셋 제작자.
- 우선 대상 이미지는 필름·금속·플라스틱 등 평면 표면이다. MLCC 전극 등 복잡한 도메인은 후속 확장 대상이다.

### 제품 성공 조건
- 정상 이미지 1장을 올리고 3가지 불량 유형 중 하나 이상을 선택해 합성 결과를 미리 볼 수 있다.
- 동일한 Seed와 설정은 동일한 이미지·마스크를 만든다.
- 이미지와 마스크의 해상도 및 좌표가 1픽셀 단위로 일치한다.
- 최대 20장까지 변형 데이터를 일괄 생성해 ZIP으로 다운로드할 수 있다.
- 별도 GPU, 사용자 가입, DB 없이 로컬에서 프론트/백엔드를 실행할 수 있다.

## 2. MVP 범위: 반드시 구현

1. 이미지 업로드: PNG/JPEG/WebP, 드래그 앤 드롭과 파일 선택, 이미지 미리보기.
2. ROI 편집: 전체 이미지 선택이 기본값. 마우스로 다각형 ROI를 생성/편집/삭제 가능. 원본 좌표로 서버에 전달.
3. 결함 유형: `scratch`, `pinhole`, `contamination` 3종. 유형별 활성화, 개수, 파라미터 설정.
4. 공통 설정: 난수 `seed`, 겹침 허용 여부(기본 false), 출력 장수(1~20).
5. 합성 미리보기: 원본/합성 이미지 비교, 마스크 오버레이 표시, 원본 크기 확인.
6. 합성 데이터: 컬러 출력 PNG, 8비트 클래스 마스크, 8비트 바이너리 마스크, 재현 가능한 메타데이터.
7. ZIP 내보내기: N장 합성 이미지/마스크/개별 JSON + manifest.json + README.txt.
8. 예외 처리: 불량 ROI, 너무 큰 이미지, 잘못된 파일, 불가능한 결함 배치, 비정상 파라미터에 대한 친절한 오류 안내.
9. 자동 테스트: Python 단위·API 통합 테스트와 주요 UI 흐름 E2E 테스트.

### 이번 버전에 포함하지 말 것
- Diffusion/Stable Diffusion/ControlNet 생성.
- PatchCore 학습, ONNX 모델 추론, 이상 점수 표시.
- 회원가입, 데이터베이스, 소셜 기능, 랭킹.
- CVAT/YOLO/COCO 포맷 내보내기.
- 영상/라인스캔 스트리밍, 16비트 원본, 초고해상도 타일링.

## 3. 사용자 시나리오

### 기본 흐름
1. 사용자가 브라우저에서 PNG/JPEG/WebP 정상 이미지를 업로드한다.
2. 화면의 원본 이미지 위에서 다각형 ROI를 지정한다. 미지정 시 전체 이미지를 사용한다.
3. 불량 유형을 고르고 `count`, 크기, 명암 대비, 각도 등을 설정한다.
4. `생성 미리보기`를 누르면 백엔드가 설정에 따른 합성 이미지와 정답 마스크를 반환한다.
5. 사용자는 `원본 / 합성 / 마스크 오버레이` 보기 모드를 전환한다.
6. 사용자는 Seed·개수·설정을 수정해 다시 생성한다.
7. `데이터셋 다운로드`에서 N장(1~20)을 선택해 ZIP을 받는다.

### UI 레이아웃 (데스크톱 우선, 모바일에서는 세로 스택)
- 상단 헤더: 로고/제품명 DefectForge, 제품 설명, GitHub 자리표시 텍스트(실제 링크는 프로젝트 URL 확보 전까지 만들지 않음).
- 좌측 패널(280~360px): 업로드, ROI 도구, 불량 유형 체크 및 각 파라미터, Seed, 생성 버튼.
- 중앙 작업 영역: 큰 이미지 캔버스, 확대·축소/팬, ROI 다각형 편집, 원본/합성/마스크 보기 탭.
- 우측 패널(260~320px): 출력 이미지 크기, 실제 생성 결함 개수, 마스크 클래스 범례, Seed, 생성 결과, ZIP 옵션.
- 하단: 이미지 생성 상태와 오류 메시지, 데이터셋 내보내기 버튼.
- 초기에 예시 이미지는 사용자 제공 파일 또는 라이선스가 확인된 자산만 제공하고 무단 복제하지 않는다.

### 주요 컴포넌트
`ImageUploader`, `RoiEditor`, `DefectTypeSelector`, `ScratchControls`, `PinholeControls`, `ContaminationControls`, `PreviewCanvas`, `MaskLegend`, `GenerationSummary`, `ExportPanel`, `Toast`.

### UX 제약
- PNG와 마스크는 원본 픽셀 크기로 생성한다. 브라우저 렌더링의 확대/축소는 결과 배열을 수정하지 않는다.
- 미리보기 요청 중 생성 버튼 비활성화, 오류 시 사용자가 설정을 잃지 않도록 유지.
- 유효한 이미지가 없으면 생성/내보내기 비활성화.
- 마스크 오버레이 불투명도 슬라이더 제공(시각화에만 영향을 줌).
- 파라미터 변경 후 이전 미리보기를 현재 결과처럼 보이지 않도록 `설정 변경됨` 표시.

## 4. 기술 스택

### Frontend
- React + TypeScript + Vite
- Tailwind CSS
- React Konva/Konva: 이미지 스테이지, ROI 폴리곤, 줌/팬
- Zustand: 이미지·설정·생성 상태
- TanStack Query 또는 단순 fetch API 래퍼: 서버 상태(둘 중 하나 선택)
- Zod: 사용자 설정의 프론트 검증
- Vitest + React Testing Library: 단위 테스트
- Playwright: 핵심 사용자 시나리오 테스트

### Backend
- Python 3.11 또는 3.12 (한 버전을 정해 lock/pin)
- FastAPI + Uvicorn + Pydantic v2 + python-multipart
- NumPy, OpenCV, Pillow
- pytest + httpx
- 기본 CPU 동작. 필요 시 `opencv-python-headless` 선택.

### 저장·배포
- MVP는 DB 없이 동작. 업로드 원본과 합성 데이터는 영구 저장하지 않는다.
- 미리보기는 메모리에서 처리하고 base64 PNG 반환.
- ZIP은 임시 파일 또는 spooled file로 생성하고 응답 전송 후 즉시 삭제한다.
- 환경변수로 API URL/CORS origin/최대 파일 크기/최대 배치 크기를 설정.
- 로컬: 프론트 Vite 서버와 FastAPI 서버. Docker Compose는 있으면 좋은 선택 사항.

## 5. 이미지·라벨 데이터 규약 (절대 준수)

### 입력 제약
- 입력 형식: `.png`, `.jpg`, `.jpeg`, `.webp`.
- 최대 업로드 바이트: 10 MiB.
- 가로·세로: 각각 32~2048 px (둘 중 하나라도 범위 밖이면 422로 거절).
- Pillow에서 EXIF 회전을 적용해 표준 방향으로 정규화. 그 후 ROI 픽셀 좌표 기준을 확정한다.
- RGB 8-bit 3채널로 정규화. 그레이스케일은 RGB 3채널로 변환하고 알파 입력은 흰색 배경에 합성한다.
- 서버 디코드 후 유효 이미지 확인, 파일 확장자만 신뢰하지 않기.

### 출력 규약
- `image`: RGB 8-bit PNG, 원본과 동일한 `width × height`.
- `class_mask`: 단일 채널 8-bit PNG. **0=background, 1=scratch, 2=pinhole, 3=contamination** (회색조 저장, 팔레트 컬러로 저장 금지).
- `binary_mask`: 단일 채널 8-bit PNG. **0=unchanged, 255=changed**.
- `metadata`: 설정 버전, 입력 이미지 해시(SHA-256), Seed, 실제 생성된 인스턴스/파라미터, 이미지 크기, 클래스 매핑, 선택 ROI.
- 오버레이는 UI에서 class_mask 위에 색상 팔레트를 적용해 표현; 마스크 원본 PNG 자체를 컬러화하지 않는다.
- 기본 오버레이 색상은 scratch=빨강, pinhole=노랑, contamination=청록으로 하되 사용자에게 클래스별 범례를 보여준다.
- 결함별/클래스별 영역이 겹치면 최종적으로 **나중에 적용한 결함 클래스가 해당 픽셀 라벨을 갖는다**. 겹침 기본 비허용.
- 최종 `binary_mask`는 **합성 이미지와 디코딩/정규화된 원본 간 실제 RGB 값이 다른 픽셀**을 기준으로 산출한다.
- 최종 `class_mask`는 `binary_mask==0`인 위치에서 반드시 0이어야 한다.
- ROI 밖 이미지 픽셀은 원본과 완전히 동일해야 한다.

### 정답 마스크 의미
- 이 프로젝트에서 마스크는 **합성에 의해 실제로 바뀐 픽셀의 위치**를 나타낸다.
- 이것이 현장 실물 결함의 물리적으로 검증된 Annotation을 뜻하지는 않는다. README에서 합성 데이터의 도메인 차이와 검증 필요성을 명시한다.

## 6. 결함별 생성 알고리즘 (MVP)

### 공통 엔진 흐름
```
validate_image_and_config
  -> normalize_image_and_exif
  -> polygon_to_roi_mask
  -> rng = np.random.default_rng(seed)
  -> sample_valid_defect_locations
  -> each_defect.generate_effect(image, rng, params, roi_mask)
  -> apply_effect_with_alpha_and_roi
  -> update_class_map_using_actual_changed_pixels
  -> final_binary_mask = any(output_rgb != input_rgb, axis=2)
  -> class_mask[final_binary_mask == 0] = 0
  -> encode_png_and_metadata
```
- 로직은 서버 렌더링 좌표가 아니라 원본 이미지 픽셀 좌표로 계산.
- 각 결함 유형을 `DefectGenerator` 프로토콜(또는 추상 클래스)로 분리.
- 각 generator는 렌더링 결과와 적용한 알파/클래스/인스턴스 정보를 반환.
- Seed가 동일할 때 플랫폼/라이브러리 고정 환경에서 재현 가능하도록 난수는 `numpy.random.Generator`만 사용.
- 배치의 i번째 샘플 Seed는 `base_seed + i`로 정의.
- 이미지 범위/ROI에 유효하게 놓을 수 없는 결함은 최대 100회 재시도. 끝내 불가능하면 `422 DEFECT_PLACEMENT_FAILED`를 내고 조용히 개수를 줄이지 말 것.
- 겹침 비허용 시 이미 생성된 영역의 마스크와 유효하게 분리되는지 검사.

### A. scratch
**목적:** 표면 스크래치/선형 손상 시뮬레이션.
- 파라미터: `count` 1~20, `length_px=[min,max]` 8~512, `width_px=[min,max]` 1~20, `angle_deg=[min,max]` 0~180, `contrast=[min,max]` 0.05~1.0, `polarity` (`dark|bright|random`), `curvature` 0~1.
- 알고리즘: 방향과 길이에 따라 포인트 시퀀스 생성 -> curvature를 반영한 polyline -> cv2.polylines/line + anti-alias mask -> 길이 방향 텍스처 변화 및 alpha 조절 -> 원본과 블렌딩.
- 디폴트: 직선 또는 약한 곡률, 1~3px 폭, 중간 대비.
- 마스크: 실제 RGB 값 변경 픽셀, 마스크가 이미지 외부로 잘리지 않도록 위치 검증.

### B. pinhole
**목적:** 작은 구멍 형태의 광학적 패턴(밝거나 어두운 미세 점) 시뮬레이션.
- 파라미터: `count` 1~30, `radius_px=[min,max]` 1~30, `irregularity` 0~1, `contrast=[min,max]` 0.05~1.0, `polarity` (`dark|bright|random`), `rim_strength` 0~1.
- 알고리즘: 타원/불규칙 폐곡선 -> 중심부 명암 변화 -> 선택적 얕은 주변 링(림) -> ROI 마스킹 후 블렌딩.
- 주의: 실제 필름 관통 구멍의 물리 광학을 모사한다고 주장하지 말고 'pinhole-like appearance'로 표현.

### C. contamination
**목적:** 먼지/이물/국소 얼룩 형태 시뮬레이션.
- 파라미터: `count` 1~30, `radius_px=[min,max]` 2~80, `irregularity` 0~1, `opacity=[min,max]` 0.1~1.0, `blur_sigma` 0~8, `polarity` (`dark|bright|random`).
- 알고리즘: 불규칙 blob 생성 -> 모양에 저주파 노이즈/농도 변화 -> 선택적 feathering -> ROI 마스킹 -> 알파 블렌딩.
- 주의: `blur_sigma`가 ROI 바깥에 영향을 주지 않도록 최종 alpha를 ROI와 교차.

### 품질 원칙
- 원본 밖으로 벗어난 요소/잘린 결함을 디폴트로 허용하지 말 것.
- 강한 파라미터에서 결과가 단색 도형처럼 보이지 않도록 텍스처/경계 가변성을 포함.
- 복잡한 GAN/Diffusion 없이도 충분한 다양성을 낼 수 있게 Seed와 범위 조절 지원.
- 결과가 시각적으로 부자연스러운 경우 이는 모델이 아닌 합성 알고리즘 한계이므로 README에 분명히 설명.

## 7. 설정 및 API 계약

### 기본 규칙
- 모든 API prefix는 `/api/v1`.
- 업로드 이미지+설정 전송: `multipart/form-data`로 `file`(파일), `config`(JSON 문자열의 form field)를 보낸다.
- Pydantic v2로 유형별 파라미터/범위/ROI를 검증.
- API 오류 공통 포맷: `{"error":{"code":"...","message":"...","details":{}}}`.
- OpenAPI 문서 `/docs`를 활성화하고 응답 모델 정의.

### GET `/api/v1/health`
응답: `{"status":"ok","version":"1.0.0"}`.

### POST `/api/v1/preview`
입력: `file`, `config`.
- 출력: `image_png_base64`, `class_mask_png_base64`, `binary_mask_png_base64`, `metadata`.
- 응답 JSON base64 값에는 data URI 접두어를 붙이지 않는다. 프론트에서 `data:image/png;base64,`를 붙여 표시한다.
- ZIP/파일 업로드는 이 엔드포인트에서 만들지 않는다.

### POST `/api/v1/export`
입력: `file`, `config`, `sample_count`(form integer, 1~20).
- 출력: `application/zip` (다운로드 파일명 `defectforge_dataset.zip`).
- 샘플 Seed는 `config.seed + i` (i=0,...,N-1).
- 서버는 ZIP 파일을 응답 후 제거한다.

### config JSON 예시
```json
{
  "version": "1.0",
  "seed": 42,
  "roi": [[40, 40], [460, 40], [460, 400], [40, 400]],
  "allow_overlap": false,
  "defects": [
    {
      "type": "scratch",
      "count": 2,
      "params": {
        "length_px": [45, 110],
        "width_px": [1, 3],
        "angle_deg": [0, 180],
        "contrast": [0.2, 0.65],
        "polarity": "dark",
        "curvature": 0.2
      }
    },
    {
      "type": "pinhole",
      "count": 3,
      "params": {
        "radius_px": [2, 6],
        "irregularity": 0.35,
        "contrast": [0.3, 0.9],
        "polarity": "bright",
        "rim_strength": 0.2
      }
    }
  ]
}
```
- `roi=null`이면 전체 이미지.
- 좌표는 디코딩 후 원본 픽셀 공간의 `[x, y]` 정수이며, 0<=x<width, 0<=y<height.
- ROI는 최소 3개의 점과 양의 면적을 가진 단순 다각형이어야 함. 이미지 범위/자기 교차/면적을 검증.
- `defects`에는 최소 1개, 각 유형은 최대 1회 등장하도록 검증(동일 유형의 count 사용).
- 초기값과 min/max는 프론트와 백엔드에서 일치해야 함. 백엔드가 최종 검증 권한을 가짐.

### response.metadata 구조 예시
```json
{
  "version": "1.0",
  "seed": 42,
  "source_sha256": "<64-hex-sha256>",
  "width": 512,
  "height": 448,
  "class_map": {"0": "background", "1": "scratch", "2": "pinhole", "3": "contamination"},
  "roi": [[40, 40], [460, 40], [460, 400], [40, 400]],
  "requested_count": 5,
  "generated_count": 5,
  "instances": [
    {"id": 1, "class_id": 1, "type": "scratch", "bbox_xyxy": [120, 80, 220, 95], "params": {"length_px": 102, "width_px": 2}}
  ]
}
```
- 실제 값은 예시이며, `instances`에는 모든 인스턴스의 실제 샘플링 파라미터와 최소 bounding box를 남긴다.
- 메타데이터만 보고 결함의 실제 위치, Seed, 파라미터를 추적할 수 있도록 하라.

### HTTP 상태 코드
- 200 정상(health/preview/export).
- 400 의미상 잘못된 요청.
- 413 업로드 사이즈 초과.
- 422 파일 디코딩 오류, 지원하지 않는 이미지 형식·크기, ROI/파라미터 오류, 배치 불가능, 결함 배치 실패. 코드별 상세 메시지.
- 500 서버 내부 오류(파일 내용/서버 경로 노출 금지).

## 8. 데이터셋 ZIP 구조

```
defectforge_dataset.zip
├── README.txt
├── manifest.json
├── images/
│   ├── image_0001.png
│   ├── image_0002.png
│   └── ...
├── masks/
│   ├── mask_0001.png
│   ├── mask_0002.png
│   └── ...
├── binary_masks/
│   ├── binary_0001.png
│   ├── binary_0002.png
│   └── ...
└── metadata/
    ├── image_0001.json
    ├── image_0002.json
    └── ...
```
- `manifest.json`에는 생성 일시(UTC ISO 8601), 이미지 개수, 클래스 정의, seed 규약, 각 파일 상대 경로, 소스 SHA-256, 합성 config를 기록.
- `README.txt`에는 마스크 클래스값/파일 매칭 방법/합성 데이터 한계를 설명.
- 이미지/마스크/JSON 파일은 basename이 1:1 매칭되고 누락이 없어야 한다.

## 9. 프론트엔드 상태 설계

```ts
type DefectType = 'scratch' | 'pinhole' | 'contamination';
type ViewMode = 'original' | 'generated' | 'overlay' | 'classMask';

type WorkspaceState = {
  sourceFile: File | null;
  sourceImageSize: { width: number; height: number } | null;
  roi: Array<[number, number]> | null;
  defectConfig: GenerationConfig;
  currentResult: PreviewResponse | null;
  currentResultConfigHash: string | null;
  viewMode: ViewMode;
  overlayOpacity: number;
  isGenerating: boolean;
  isExporting: boolean;
  error: string | null;
};
```
- Stage zoom/pan은 뷰에만 적용. 좌표 변환은 캔버스 변환행렬의 역행렬을 사용해 원본 이미지 좌표로 취득.
- 유효 좌표 범위를 벗어난 점은 클램핑하거나 작성을 차단하며, ROI self-intersection은 유효하지 않다고 알려준다.
- 원본을 새 이미지로 교체하면 이전 ROI/미리보기/관련 오류를 초기화한다.
- API 요청에 `AbortController` 적용, 사용자가 이미지 교체 시 오래된 요청 결과로 현재 상태를 덮어쓰지 않도록 한다.

## 10. Backend 모듈/리포지토리 구조

```
defectforge/
├── README.md
├── DECISIONS.md
├── .gitignore
├── .env.example
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ImageUploader.tsx
│   │   │   ├── RoiEditor.tsx
│   │   │   ├── PreviewCanvas.tsx
│   │   │   ├── DefectControls.tsx
│   │   │   └── ExportPanel.tsx
│   │   ├── api/client.ts
│   │   ├── store/useWorkspaceStore.ts
│   │   ├── types/generation.ts
│   │   └── styles/index.css
│   └── tests/
│       └── workspace.spec.ts
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── api/routes.py
│   │   ├── schemas/generation.py
│   │   ├── core/image_io.py
│   │   ├── core/roi.py
│   │   ├── core/compositor.py
│   │   ├── core/generation.py
│   │   ├── core/exporter.py
│   │   └── defects/
│   │       ├── base.py
│   │       ├── scratch.py
│   │       ├── pinhole.py
│   │       └── contamination.py
│   └── tests/
│       ├── test_generation.py
│       ├── test_masks.py
│       ├── test_roi.py
│       ├── test_api.py
│       └── test_export.py
└── docs/
    └── MVP_SPEC.md
```
- 재사용 가능한 생성 로직은 HTTP/FastAPI에 종속되지 않는 순수 Python 함수로 만든다.
- 에러 코드는 `error_codes.py` 등 한곳에 모은다.
- Python/CV 라이브러리 버전은 `requirements.txt`와 README에 명시.
- 저장소 구조는 합리적으로 변경 가능하지만 AI/합성 엔진과 API/프론트 분리는 유지.

## 11. 단계별 개발 작업 및 완료 기준

### Phase 1. 프로젝트 설정 + UI 뼈대
- Vite React TS + Tailwind, FastAPI 앱, CORS, 기본 health API.
- 이미지 업로드와 캔버스 표시, 3패널 레이아웃.
- 완료 기준: 로컬에서 프론트/백엔드 실행, 파일 업로드/원본 미리보기 가능.

### Phase 2. ROI 및 폼
- ROI 생성/편집/삭제, 이미지 크기·좌표 변환.
- 3종 결함 유형별 파라미터 폼, Seed, Zod 검증.
- 완료 기준: zoom/pan 이후 지정한 ROI가 원본 좌표와 일치.

### Phase 3. 합성 엔진
- Pydantic request schemas, ROI mask, generator 3종, compositor, seed 재현성.
- preview API, 실제 class/binary masks, 결과 상세 정보.
- 완료 기준: 같은 이미지+Seed+설정에서 RGB/마스크의 SHA-256이 완전히 동일하고 출력 크기가 원본과 같음.

### Phase 4. 미리보기 + Export
- 전/후 비교, 마스크 오버레이·범례·불투명도, 진행 상태/오류 UI.
- batch ZIP endpoint, ZIP 다운로드/검증.
- 완료 기준: 웹 UI에서 N=10을 생성·다운로드하고 모든 결과 파일이 1:1 대응.

### Phase 5. 자동 테스트 + 문서
- unit/integration/E2E 테스트, 위협/입력 검증, README.
- 완료 기준: 모든 필수 테스트 통과, 새 환경에서 README만 따라 로컬 실행 가능.

## 12. 반드시 통과해야 할 테스트 (Acceptance Criteria)

### 기능 테스트
- T01: PNG/JPEG/WebP 업로드 정상, 잘못된 MIME/손상 파일 거절.
- T02: 이미지 세 변환 유형에 대해 미리보기 정상 출력.
- T03: ROI 없이 생성하면 전체 이미지 사용.
- T04: ROI를 지정하면 ROI 외부 RGB 값이 100% 원본과 일치.
- T05: 동일 입력+Seed에서 원본/마스크 결과 SHA-256이 반복 실행 동일.
- T06: 다른 Seed에서 적어도 하나의 결함 위치/형태가 달라짐(유효한 랜덤 설정 기준).
- T07: 이미지와 클래스/바이너리 마스크의 가로·세로가 모두 일치.
- T08: `binary_mask == (generated_rgb != original_rgb).any(axis=2) * 255` 충족.
- T09: `class_mask==0` everywhere `binary_mask==0`; 클래스 ID 범위 0..3.
- T10: 동일 유형 다중 결함 요청에서 `generated_count==requested_count` 또는 명시적 422 실패.
- T11: ZIP N=1, N=10, N=20에서 이미지/마스크/메타데이터 N개와 올바른 manifest.
- T12: 10 MiB 초과, 2048px 초과, 빈 ROI, 잘못된 파라미터를 거절.
- T13: 마스크 오버레이 불투명도는 원본 결과 파일을 변경하지 않음.
- T14: 브라우저에서 확대/축소 후 ROI 좌표 변환 오차 <=1px.
- T15: Python 테스트, 프론트 단위 테스트, 브라우저 E2E 통과.

### 품질/성능 목표 (목표치, 절대적 보장 아님)
- 1024×1024 단일 미리보기의 CPU 처리 시간을 개발 환경에서 측정해 README에 기록.
- 일괄 생성은 프로세스 메모리가 무제한 증가하지 않도록 파일/배열 생명주기 관리.
- 오류는 한국어로 이해할 수 있는 메시지를 보여주고 서버 내부 경로를 노출하지 않음.
- 모바일은 주요 기능을 사용할 수 있어야 하지만 데스크톱 편집 UX를 우선.

## 13. 보안·운영·라이선스

- 이미지 파일은 확장자만 보지 말고 실제 디코딩으로 확인, 픽셀 수/파일 크기 제한, Pillow decompression bomb 경고 대응.
- 입력 파일명으로 서버 경로 구성 금지. 임시 파일은 임의 생성명/정해진 임시 디렉터리 사용.
- 임의 외부 URL을 서버가 가져오는 기능 금지(SSRF 방지).
- 개발 CORS는 명시적 로컬 origin만 허용, 배포 시 환경 변수로 제한.
- 요청 크기 제한, 생성 개수 상한, 배치 요청 동시성 제한을 두어 DoS 위험을 줄임.
- 업로드 이미지와 결과는 로그/DB에 영구 저장하지 않음. 임시 ZIP 응답 완료 후 삭제, 오류 시에도 정리.
- 사용자/회사 소유 이미지를 자동으로 외부 API에 전송하지 않음.
- 라이브러리 및 예시 이미지의 상업적 사용 가능 여부는 포함 전에 확인.
- 합성 데이터는 실제 결함 분포와 다를 수 있으므로 모델 학습 효과를 별도 실험 데이터로 검증해야 함.

## 14. V2 / V3 확장 로드맵 (이번 구현 금지)

### V2: AI 모델이 놓치는 결함 찾기
- `InferenceAdapter` 인터페이스: `infer(image)-> {anomaly_map?, score?, mask?, latency_ms}`.
- ONNX Runtime 기반 segmentation/anomaly 모델 로더. 모델마다 입출력 shape/preprocess/postprocess는 어댑터로 캡슐화.
- 사용자 합성 GT mask와 예측 mask를 비교해 Pixel IoU/Dice, 생성 결함 검출 여부를 보여줄 수 있음.
- PatchCore는 정상 이미지의 특징 메모리뱅크 구성(별도 정상 이미지 집합/학습)이 필요하며, 사전학습 백본만으로 업로드 1장에 즉시 유효한 검사가 가능하다고 간주하면 안 됨.
- 이미지 단위 AUROC는 단일 샘플로 계산하지 않으며, 여러 정상/불량 평가 데이터가 필요.
- 합성 결함에 대한 점수는 진짜 현장 데이터 모델 성능을 대체하지 않음.

### V3: 현실감 강화 및 현장 도메인 특화
- Crack, coating stain, edge defect, 전극 결함 등 추가.
- 소재/조명 조건별 합성 프리셋, 고해상도 이미지 타일링, 16-bit 지원.
- Diffusers 기반 선택 영역 Inpainting. 합성 결과에 대해 GT 마스크 검증/후처리 필요.
- 대규모 GPU 작업을 위한 큐(Celery/RQ), 프로젝트 DB, 장기 저장, 사용자별 데이터셋.
- COCO/YOLO Seg/CVAT 변환, QA 대시보드, 진짜/합성 분포 차이 분석.

## 15. 실행/검증 예시 (저장소 README에 반영)

### Backend
```bash
cd backend
python -m venv .venv
# 환경별로 가상환경 활성화 후:
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### 검증
```bash
cd backend
pytest -q
cd ../frontend
npm run test
npx playwright test
```

- frontend `.env.example`: `VITE_API_BASE_URL=http://127.0.0.1:8000`
- backend `.env.example`: `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`, `MAX_UPLOAD_MIB=10`, `MAX_IMAGE_DIM=2048`, `MAX_EXPORT_COUNT=20`.
- 실제 구현에서 명령이 변경되면 README를 코드와 일치시켜 수정할 것.

## 16. 납품 결과물

1. 바로 로컬에서 실행 가능한 전체 소스코드(프론트/백엔드).
2. 한국어 UI와 실제 작동하는 이미지 업로드/ROI/결함 합성/마스크/ZIP 흐름.
3. 자동 테스트 코드와 통과 기록.
4. `README.md`: 설치, 실행, 스크린샷, 기능, API, 출력 데이터 포맷, 한계.
5. `DECISIONS.md`: 명세서에 없는 구현 판단 및 그 이유.
6. 예시 설정 JSON 3개: scratch, pinhole, contamination.
7. 확장 지점을 명확히 남긴 구조(DefectGenerator, 추후 InferenceAdapter).

---

## 17. 에이전트에게 줄 최종 명령

이 명세서를 완전히 읽고, 실제 작동하는 DefectForge MVP를 구현하라. 작업 계획을 만든 다음 Phase 1부터 Phase 5까지 차례대로 구현하되, 각 단계 완료 후 관련 테스트를 수행하고 오류를 수정하라. 먼저 백엔드 이미지 생성 엔진과 정확한 마스크 규약을 구현한 다음 프론트엔드와 연결하라. 화면만 구현하고 API가 더미인 상태로 완료했다고 보고하지 말 것. 마지막에 구현 파일 구조, 실행 방법, 테스트 결과, 남은 한계를 정리하라.

### 참고 공식 문서
- FastAPI 파일 업로드: https://fastapi.tiangolo.com/tutorial/request-files/
- FastAPI 파일+설정 폼: https://fastapi.tiangolo.com/tutorial/request-forms-and-files/
- React Konva: https://konvajs.org/docs/react/
- OpenCV 문서: https://docs.opencv.org/4.x/
- Anomalib PatchCore (V2): https://anomalib.readthedocs.io/en/latest/markdown/guides/reference/models/image/patchcore.html
