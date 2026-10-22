# 사진 검색·부분 대응 프로토타입

멘토링에서 파이프라인의 실제 동작을 보여주기 위한 별도 로컬 실험이다. 기존 Experiment 1 앱과 DB는 변경하지 않는다. Experiment 2의 Annotation·Matching 평가 기능도 구현하지 않는다.

## 지금 동작하는 부분

```text
새 사진 + 과거 사진 폴더
 → 메타데이터 제거·방향/크기 정규화
 → DINOv2-small 이미지 벡터 추출
 → 코사인 유사도 상위 K장 검색
 → DISK 특징 추출 + LightGlue 대응점 연결
 → Homography RANSAC 검증
 → 검색 순서·대응점·판정 보류를 로컬 HTML로 표시
```

무작위 모델이나 모의 응답이 아니라 공개 사전학습 가중치를 실행한다. GPT API 호출, 단서 추출, 반복·추가 단서 자동 결합, 위치 식별 유용성 평가는 아직 연결하지 않았다. 따라서 전체 누적 분석 기능이 완성된 것은 아니다.

독립 실행을 위해 전처리는 Pillow로 구현했다. 기존 Sharp 전처리와 보안·크기 원칙은 같지만 JPEG 바이트와 hash가 같다고 가정하지 않으며 기존 DB의 이미지나 캐시를 자동으로 연결하지 않는다.

## 설치

Python 3.13, Node.js 및 Git이 필요하다. 프로젝트 루트에서 실행한다.

Node CLI와 테스트 의존성은 `npm ci`로 설치한다. GPT를 호출하려면 `.env.example`을 참고해
각자 `.env.local`에 `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정한다. 키와 환경 파일은 공유하거나 커밋하지 않는다.

```sh
python3 -m venv .venv-pipeline
.venv-pipeline/bin/python -m pip install -r prototype/requirements.txt
```

프로젝트 전용 가상 환경을 사용하며 기존 Node 패키지는 바꾸지 않는다. 가상 환경과 모델 파일에는 별도의 디스크 공간이 필요하다. 첫 실행은 공개 모델 다운로드를 위해 인터넷 연결이 필요하다. 이미지 자체는 외부 서버에 보내지 않는다. 다운로드 요청에는 모델 제공자의 일반적인 네트워크 접속 정보가 전달된다.

LightGlue 코드는 commit으로 고정했다. Embedding은 기본적으로 `facebook/dinov2-small`의 `main`을 최초 사용하며 실제 commit hash를 보고서에 저장한다. 재현 실행 시 `--revision <보고서의 embeddingRevision>`으로 고정할 수 있다. 부분 매칭 가중치의 SHA-256과 라이브러리 버전도 결과 JSON에 남긴다. 각 모델의 라이선스는 원본 저장소·모델 카드에서 확인한다.

## 가장 빠른 시연

```sh
npm run pipeline:demo
```

시연용 합성 도형을 만들고 실제 모델로 처리한다. 개인 사진이나 기존 PoC DB를 읽지 않는다. 포함된 자료는 다음과 같다.

- 같은 도형의 시점 변환과 패널 추가: 대응 확인용.
- 같은 배치지만 무늬가 다른 도형: 공통 디자인에 의한 오대응 관찰용.
- 관련 없는 원형 도형: 대응 근거 부족 사례용.
- 새 사진의 복사본: 동일 이미지 제외 동작 확인용.

이 입력의 생성 관계는 보고서에 따로 표시되며 모델의 검색·판정에는 사용하지 않는다. 합성 도형의 결과는 실제 장소·SNS 사진에서의 정확도를 입증하지 않는다.

생성된 파일을 브라우저로 연다.

```sh
open private-data/pipeline/latest-report.html
```

가중치를 한 번 받은 뒤에는 네트워크 없는 시연이 가능하다.

```sh
npm run pipeline:demo -- --offline
```

HTML에는 이미지가 포함되어 있으므로 HTML을 여는 데 Next.js 서버나 Python 서버는 필요 없다. 입력을 바꿔 다시 분석하려면 명령어를 재실행하고 브라우저를 새로고침한다. 업로드 UI는 없다.

## 회차별 결과 페이지

`npm run pipeline:reports`로 `private-data/pipeline/index.html`과 `review-회차ID.html`을 생성한다.
목록에서 회차를 선택하면 독립 페이지로 이동한다. 기존 `group-N-evaluation.html`이 있으면 그 결과를 사용한다.
이동은 저장된 보고서를 여는 동작이며 모델·GPT API를 호출하지 않는다.
저장한 이름과 코멘트는 유지된다. 대응점 필터·확대 등 임시 화면 상태는 페이지를 다시 열면 초기화된다.

## 본인 사진으로 실행

사용 권한이 있는 정지 JPEG/PNG/WebP만 사용한다. 장당 10 MB, 4,000만 픽셀 이하이며 과거 사진 폴더의 최상위 파일을 최대 100장 읽는다. 지원 확장자인데 손상·형식 오류가 있으면 실패로 표시하고 중단한다. 하위 폴더는 읽지 않는다.

일부 휴대폰 JPEG는 보조 이미지 때문에 Pillow에서 MPO로 인식된다. 이 경우 JPEG 컨테이너의 첫 번째 이미지만 사용하고 보조 이미지·메타데이터는 분석본에서 제거한다. 원본 파일은 수정하지 않는다. 처리한 이미지 수는 JSON의 `primaryJpegOnlyCount`에 기록한다. 이 호환 처리는 독립 프로토타입에만 적용하며 기존 Feature Discovery 업로드의 지원 범위는 변경하지 않는다.

```sh
npm run pipeline:run -- \
  --query /절대/경로/새사진.jpg \
  --gallery /절대/경로/과거사진폴더 \
  --k 5 \
  --offline
```

최초 다운로드 전이면 `--offline`을 빼고 실행한다. K는 1~20이며 유효한 과거 사진이 K보다 적으면 존재하는 사진만 비교한다. 원본 hash 또는 전처리 결과 hash가 같은 사진은 새 사진 자신 및 과거 사진 간 중복에서 제외한다. 다른 크기·압축으로 재인코딩된 유사 중복을 모두 제거하는 기능은 아니다.

기본 실행 장치는 CPU이다. Apple Silicon에서도 우선 CPU를 사용하며 MPS 가속은 검증하지 않았다. NVIDIA CUDA 환경이 준비되어 있다면 `--device cuda`를 지정할 수 있으나 해당 경로는 이 PC에서 검증하지 않았다. `--device auto`는 CUDA가 있으면 CUDA, 없으면 CPU를 선택한다.

## 화면 읽는 방법

- 검색 유사도: 전체 이미지 벡터의 코사인 유사도. 같은 장소일 확률이 아니다.
- 대응점: DISK + LightGlue가 연결한 작은 특징의 수.
- 검증 통과: 하나의 투영 변환으로 설명할 수 있는 대응점의 수.
- 분포 면적: 통과 대응점들의 볼록 껍질 면적 비율. 실제 배경 일치 면적이 아니다.
- 초록 점·선: 기하 검증을 통과한 대응점.
- 주황 점·선: 기하 검증에서 탈락한 대응점. 실제로 틀린 대응이라는 의미는 아니다.

상단 ①~④ 단계에 마우스를 올리거나 키보드로 초점을 맞추면 쉬운 설명이 표시된다. 터치에서는 누르면 열리고, 다시 누르거나 바깥을 누르면 닫힌다. Escape로도 닫을 수 있다.

대응점 검토 기능:

- 기본적으로 통과점 중 최대 5개만 표시하며 10개·30개·전체로 바꿀 수 있다. 제한 개수 내에서 점을 고르게 추려 표시하고, 선택한 점은 항상 포함한다.
- 통과점·탈락점을 각각 켜고 끄며 연결선도 숨길 수 있다. 필터가 전체 통계나 판정 결과를 바꾸지는 않는다.
- 점을 누르거나 대응점 메뉴·이전/다음 버튼으로 선택하면 두 사진의 해당 부분을 나란히 확대한다. 이전/다음은 표시한 표본 안에서만 이동하며, 메뉴에서는 필터에 맞는 모든 점을 직접 선택할 수 있다. 점 번호는 원래 매칭 배열 기준으로 필터를 바꿔도 유지한다.
- 확대 패널의 십자선 중심이 대응점이며 확대 범위를 조절할 수 있다. 이미지 경계 밖은 빈 배경으로 표시한다.
- **영역 선택**을 켜고 한쪽 사진에서 사각형을 드래그하면 그 영역 안에 끝점이 있는 대응점만 검토한다. **영역 초기화**로 해제한다. 광고판·기둥 등을 자동 분류하는 기능은 아니다.
- 조건에 맞는 점이 없으면 점 선택과 이동을 비활성화하고 확대 패널을 비운다.

새 실행의 JSON schemaVersion은 2이며 전체 대응점(`allQueryPoints`, `allCandidatePoints`)과 기하 검증 마스크(`inlierMask`)를 저장한다. 기존 통과점 전용 필드도 유지한다. 이전 실행을 다시 렌더링할 경우 통과점은 볼 수 있지만 저장되지 않은 탈락점은 복구하거나 추측하지 않는다. 이 경우 탈락점 표시를 비활성화하고 안내한다.

HTML에 JavaScript와 CSS를 함께 포함해 오프라인으로 조작한다. 외부 스크립트나 이미지를 요청하지 않으며, CSP는 생성 시 해시를 계산한 스크립트만 허용한다. JavaScript를 사용할 수 없으면 기존 정적 미리보기(통과점 최대 60개)를 표시한다.

실패 원인 탐색에서는 같은 방향의 대표 사진 쌍부터 통과점·탈락점을 각각 5개씩 검토하고, 같은 오류 유형이 반복되면 추가 점검을 멈춘다. 모든 점에 정답을 붙이는 작업이 아니다. 표본 검토로 전체 정확도를 주장하지 않는다.

`시각적 대응 근거 있음`은 다음 잠정 조건을 모두 통과했다는 뜻이다.

- 검증 통과점 12개 이상
- 대응점 중 통과 비율 35% 이상
- 양쪽 이미지에서 대응점 분포 면적 각각 2% 이상

조건은 `--min-inliers`, `--min-ratio`, `--min-coverage`로 바꿀 수 있다. 모델 confidence를 위험도로 바꾸지 않으며 임계값은 아직 평가 데이터로 보정하지 않았다. 후보는 원래 검색 순서로 표시하고 통과한 후보를 위로 재정렬하지 않는다.

같은 물건·포스터·반복 무늬도 대응할 수 있다. 반대로 겹치는 배경이 없거나 비평면 장면·큰 시점 변화에서는 관련 사진을 놓칠 수 있다. 근거 부족은 다른 장소라는 판정이 아니다. 이 화면으로 실제 장소 일치·노출 확률·위험 증가를 확정하지 않는다.

검색용 DINOv2는 기본 processor의 짧은 변 256px resize와 중앙 224×224 crop을 사용한다. 따라서 가장자리 단서가 검색에서 누락될 수 있다. 부분 매칭은 중앙 crop이 아닌 전체 분석본을 최대 변 960px로 줄여 사용한다. 배경 전용 검색이나 여러 crop의 결합은 구현하지 않았다.

## 보관 및 재실행

```text
private-data/pipeline/
  models/                  공개 모델 캐시
  cache/                   분석본 hash + 모델·설정별 Embedding 캐시
  demo-inputs/             합성 입력
  runs/<실행ID>/
    report.html            이미지가 포함된 비교 보고서
    report.json            hash·설정·점 좌표·시간·수치 (원본 경로/파일명 없음)
  latest-report.html       가장 최근 성공한 보고서 사본
  group-N-report.json      묶음별 대응점·마스크·통계 보관본
  group-N-report.html      묶음별 개별 보고서
  group-N-evaluation.html  사용자 구분을 추론 후 덧붙인 개별 보고서 (있는 경우)
  index.html               회차 목록 (개별 review-회차ID.html로 이동)
```

원본은 이 프로토타입에서 복사·보관하지 않는다. 비교 보고서에는 전처리 이미지가 포함되고, 캐시에는 파생 벡터가 남는다. 실제 사진으로 만든 보고서·벡터·JSON도 민감한 실험 자료로 취급한다. 모두 Git과 공개 정적 경로에서 제외한다. 모델에 실제 이미지의 EXIF/GPS를 전달하거나 위치 추론에 사용하지 않는다. 입력·모델 응답·Secret을 로그로 출력하지 않는다.

같은 분석본과 같은 Embedding 모델·revision·설정은 벡터 캐시를 재사용한다. 매번 CLI를 실행할 때 모델을 불러오고 부분 매칭은 다시 계산한다. 화면에 모델 준비·특징 추출/검색·부분 매칭 시간을 구분한다. 실패 시 이전 성공 보고서는 그대로 남으므로 새 성공 메시지와 생성 시각을 확인한다.

## 검증

```sh
npm run pipeline:test
npm run pipeline:demo -- --offline
# Google Chrome 설치 환경에서 실제 생성 보고서 UI 검증
npm run pipeline:test-viewer -- private-data/pipeline/latest-report.html
# 묶음별 보고서 3개가 있는 환경에서 목록·개별 페이지 이동 검증
npm run pipeline:test-viewer -- --hub private-data/pipeline/index.html
npm run lint
npm run typecheck
npm run build
npm run test:workflow
```

단위 테스트는 이미지 메타데이터·방향·투명도·크기·입력 오류와 기하 검증의 긍정/부정 사례를 확인하며 모델 다운로드와 GPT API 호출을 하지 않는다. 합성 데모는 실제 사전학습 모델의 실행 검증이다. 실제 사진의 검색·연결 성능 평가와 실제 GPT API 검증은 별도로 수행해야 한다.

브라우저 검증은 별도 프로필의 headless Chrome으로 보고서를 열어 필터·점 선택·확대·영역 선택·호버/키보드/모바일 설명과 외부 요청 없음을 확인한다. 실제 모델을 다시 호출하지 않는다. 기본 Chrome 경로는 macOS 설치 위치이며 `CHROME_BIN`으로 변경할 수 있다. 최신 전체 대응점이 포함되고 통과·탈락점이 모두 있는 보고서로 실행한다. 검증 스크린샷은 보고서와 같은 비공개 폴더에 생성한다.

## 참고

- [전체 방법론과 미확정 사항](../pipeline.md)
- [DINOv2 공식 모델 카드](https://huggingface.co/facebook/dinov2-small)
- [DINOv2 특징 추출 문서](https://huggingface.co/docs/transformers/model_doc/dinov2)
- [LightGlue 공식 코드](https://github.com/cvg/LightGlue)
- [OpenCV 특징 매칭·Homography 설명](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html)

## 테스트 회차 목록과 코멘트

`npm run pipeline:reports:serve`를 실행하고 http://127.0.0.1:8765 를 연다.
기존 1·2·3번 묶음과 `runs/`의 성공한 모든 실행을 선택할 수 있다.
새 실행은 시각과 고유 ID로 기본 회차 이름이 생성된다. 실행 성공 시 정적 `index.html`도 자동 갱신한다.
서버 화면에서는 목록을 새로고침하면 새 회차가 나타난다. 회차 이름과 코멘트를 입력하고 **저장**하면
비공개 `review-metadata.json`에 따로 보관되어 서버 재시작 후에도 유지된다.
원본 결과 JSON은 수정하지 않으며 메모를 모델에 전달하지 않는다.
`latest-report.html` 파일은 계속 마지막 결과 사본이고, 전체 이력은 회차 목록에서 확인한다.
정적 `index.html`을 직접 열면 조회만 가능하다. 저장에는 위 로컬 서버가 필요하다.
기본 서버는 127.0.0.1에만 바인딩한다. 발견한 보고서만 제공하고 모델 캐시와 입력 사진은 제공하지 않는다.

서버는 로컬 개발 전용이며 내부망 공유·로그인 기능은 제공하지 않는다. `--port`로 포트만 변경할 수 있다.

## 대응점 원인 분석 실험

주 파이프라인과 별도의 진단 명령이다. 검색 순위나 기존 판정 임계값을 바꾸지 않는다.
같은 DISK·LightGlue 설정으로 전체 사진과 지정 영역을 다시 매칭하고, 각 조건의 **동일한 대응점 목록**에
Homography와 Fundamental matrix를 적용한다. 최초 DISK 점·검출 점수, 연결 좌표, 변환 행렬,
오차·마스크와 임계값 민감도를 `report.json`에 보관한다. descriptor 전체는 저장하지 않는다.

비공개 `private-data/pipeline/diagnostic-config.json`을 작성한다. 다음은 경로 형식 예시이며 실제 사진·영역 설정은 Git에 넣지 않는다.

```json
{"pairs":[{"name":"대표 비교","query":"private-data/example-a.jpeg","candidate":"private-data/example-b.jpeg",
"queryRoi":[0.2,0.1,0.8,0.9],"candidateRoi":[0.1,0.1,0.9,0.9]}]}
```

좌표는 EXIF 회전·메타데이터 제거 후 분석본의 정규화된 `[왼쪽, 위, 오른쪽, 아래]`다.
ROI 두 개를 생략하면 전체 사진만 비교한다. 두 영역을 지정하면 잘라낸 이미지로 특징점 검출부터 다시 실행한다.
영역을 잘라내면 해상도와 특징점 예산도 함께 달라지므로 개선 원인을 대상 선택 하나로 단정하지 않는다.
사각형에는 가려진 다른 물체도 포함될 수 있다. 영역 내 점 수는 정확한 대상 물체의 점 수가 아니다.

```sh
npm run pipeline:diagnose -- run --config private-data/pipeline/diagnostic-config.json
# 위 명령이 생성한 회차 폴더 지정
npm run pipeline:review -- --run private-data/pipeline/runs/실행ID
npm run pipeline:diagnose -- render --run private-data/pipeline/runs/실행ID
npm run pipeline:reports
```

진단의 기본값은 이미 받은 모델만 사용하는 offline CPU 실행이다. 최초 다운로드가 필요하면 `--download`를 추가한다.
검출점 표시와 H/F 선택은 결과 뷰어에서 조작한다. H는 후보 이미지의 forward reprojection 거리 4px,
F는 두 방향 점-에피폴라선 거리의 최댓값 1px를 사용한다. 서로 다른 오차이므로 통과 수로 우열을 판단하지 않는다.
H 2/4/6px, F 0.5/1/2px 민감도도 보관한다. RNG 42, 최대 2,000회, confidence 0.995다.
F RANSAC은 최소 15쌍이 필요하다. 부족하거나 추정 실패 시 F는 추정 불가로 표시하고 선택을 막는다.
평면·반복 요소에 대한 F의 모호성도 남아 있으므로 같은 장소 판정이나 H/F 결과의 단순 OR 결합을 하지 않는다.

### GPT 보조 검토와 사람 검토

`pipeline:review`는 `.env.local`의 서버 환경변수 `OPENAI_API_KEY`, `OPENAI_MODEL`을 사용한다. 모델 fallback은 없다.
기본 OpenAI Responses API에 메타데이터 없는 전처리 이미지의 문맥·확대 패널을 전송한다. `store:false`,
호출당 최대 출력 4,500 tokens, timeout 90초, 자동 재시도 없음이다. 한 회차는 최대 10조건, 조건당 최대 4표본으로 제한한다.
샘플 선정은 H/F 양쪽 통과·각각만 통과·양쪽 탈락 범주에서 우선 하나씩 선택하고 부족하면 균등 간격으로 채운다.
이는 실패 원인 탐색 표본이며 무작위 정확도 평가 표본이 아니다. 한 변환을 추정하지 못하면 범주 간 비교를 해석하지 않는다.

GPT에는 흰색 중심 표시의 문맥·확대 패널과 불투명 sample ID만 보내고, 알고리즘 통과/탈락, 임계값,
사진 파일명, 사용자의 장소 구분, ROI 설명, 사람 검토·회차 코멘트는 보내지 않는다.
결과는 `같은 지점 / 같은 물체의 다른 지점 / 다른 물체 / 판단 불가`에 대응하는 네 enum과 이유·불확실성이다.
실제 촬영 위치·건물 이름·주소·좌표를 추론하지 않도록 요청한다. 반환 sample ID가 누락·중복·추가되면 실패 처리한다.
GPT 판단 자체는 정답이 아니며, 특히 같은 종류의 물체와 동일한 물리적 지점을 혼동할 수 있다.

- `report.json`: 실제 모델 실행의 원본. 검토로 덮어쓰지 않는다.
- `visuals.json`, `review-input.json`: 비공개 시각화·중립 검토 패널. 로컬 서버의 직접 제공 대상에서 제외한다.
- `model-review-calls/`: 호출별 원본 텍스트·모델·사용량·상태를 별도 파일로 보관한다. 재실행해도 과거 호출을 덮어쓰지 않는다.
- `model-review.json`: 호출 목록. 같은 입력·요청 모델·프롬프트로 성공한 검토는 재사용한다.
- `human-review.json`: 사람 판정·이유·시각. 미검토는 null이며 GPT에 전송하지 않는다.
- `diagnostic-summary.json`: 조건별 수치·GPT 판단 분포·사람 검토 수·API 사용량을 정리한 파생 요약이다.

로컬 회차 페이지 하단에서 표본을 펼쳐 GPT 의견과 별개로 사람 판단·이유를 저장한다.
실제 API 검증과 모의 응답·합성 기하 검증을 구분해 기록한다. 모델 판단 분포를 정확도로 부르지 않는다.

```sh
npm run pipeline:test
npm run pipeline:test-review
npm run pipeline:test-viewer -- --diagnostic private-data/pipeline/runs/실행ID/report.html
```

기하 검증 구현은 [OpenCV 문서](https://docs.opencv.org/4.12.0/d9/d0c/group__calib3d.html),
이미지 입력과 구조화 응답은 [OpenAI 이미지 입력](https://developers.openai.com/api/docs/guides/images-vision),
[구조화 응답](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)을 참고했다.

## GPT 비교 영역 제안 실험

기본 검색 파이프라인과 별도의 진단 명령이다. GPT에 두 분석본만 보내 공통 구조가 있을 법한
사각형을 최대 두 쌍 제안받거나 보류한다. 사람 지정 영역·파일명·검토 의견은 요청에서 제외한다.
제안은 정답이 아니며 실제 위치나 건물 이름을 추론하지 않는다.

위 진단 설정과 같은 `pairs` 형식으로 1~3쌍을 지정한다. 사람 참조 영역은 선택 사항이다.

```sh
npm run pipeline:regions -- prepare --config private-data/pipeline/region-config.json
# 출력된 준비 폴더 경로를 사용한다. 다음 명령은 실제 유료 API를 호출하고 분석본을 전송한다.
npm run pipeline:propose-regions -- --input private-data/pipeline/region-experiments/준비ID/proposal-input.json
npm run pipeline:regions -- run --experiment private-data/pipeline/region-experiments/준비ID
# 아래 보조 검토도 실제 API를 호출한다. 실행 결과 회차 경로를 사용한다.
npm run pipeline:review -- --run private-data/pipeline/runs/실행ID
npm run pipeline:reports
```

로컬 모델은 미리 다운로드되어 있어야 한다. 전체 사진, 사람 지정 영역(있는 경우), GPT 영역을 비교한다.
`fixed`는 원래 특징점·해상도를 유지하며 영역 밖 특징점을 제외하고 다시 매칭한다.
`crop`은 영역을 잘라 특징점을 새로 추출하므로 해상도와 특징점 예산도 달라진다.
이 실험은 H 4px만 적용하고 F는 실행하지 않는다. 선택과 보조 검토에 같은 모델을 쓸 수 있어
독립적인 정확도 평가가 아니며, 대응점 증가만으로 대상 선택이 개선됐다고 판단하지 않는다.

```sh
npm run pipeline:test
npm run pipeline:test-regions
npm run pipeline:test-review
npm run pipeline:test-viewer -- --regions private-data/pipeline/runs/실행ID/report.html
```

## 팀원에게 로컬 자료 전달

클론에는 코드와 문서만 포함된다. 기존 회차를 이어서 보려면 사용 권한을 확인한 자료를
접근 제한된 팀 저장소나 암호화 파일로 별도 전달하고 다음 경로를 유지한다.

- `private-data/test-image/`: 재실행할 원본 사진.
- `private-data/pipeline/runs/`: 회차별 결과·시각화·GPT 의견·사람 검토 원본.
- `private-data/pipeline/group-*`: 초기 묶음별 보고서와 평가 페이지(있는 경우).
- `private-data/pipeline/review-metadata.json`: 회차 이름과 코멘트.
- 비공개 진단 설정 JSON과 `private-data/pipeline/region-experiments/`: 재실행에 필요한 설정과 영역 제안 기록.

보고서 HTML에도 사진이 포함된다. 공개 링크나 Git 첨부로 전달하지 않는다.
설정과 `manifest.json`의 로컬 절대 경로는 받는 PC 경로에 맞춰 수정한다. 원본 결과·모델 의견은 덮어쓰지 않는다.
`models/`, `cache/`, 가상 환경, `node_modules/`는 전달하지 않아도 된다. 모델은 각자 내려받는다.
`.env*`, API 키, 기존 앱 DB와 제안서는 전달 묶음에서 제외한다.
받는 PC에서 `npm run pipeline:reports`로 목록을 다시 생성하고
`npm run pipeline:reports:serve`로 회차와 코멘트를 확인한다.
