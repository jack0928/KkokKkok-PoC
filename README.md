# 꼭꼭 · Location Cue Lab

중앙대학교 캡스톤 프로젝트 **꼭꼭**의 Location Cue Detection 사전 기술 검증용 PoC입니다. 현재는 Experiment 1 **Feature Discovery**만 구현합니다.

VLM 결과는 Ground Truth가 아니라 사람이 검토할 **Feature 후보**입니다. 실제 촬영 위치·주소·지역·좌표를 추론하지 않습니다. 화면에서 읽을 수 있는 간판 글자는 관찰 단서로 기술할 수 있지만, 이를 실제 촬영 위치로 해석하지 않습니다.

## 실행

누적 분석의 후속 방법론을 시연하는 **별도 사진 검색·부분 대응 프로토타입**은 [prototype/README.md](prototype/README.md)를 참고하세요. DINOv2 검색과 DISK + LightGlue 대응 시각화를 로컬에서 실행합니다. 기존 Experiment 1 앱과 DB는 변경하지 않으며 GPT 단서 결합·전체 누적 위험 평가는 아직 연결하지 않았습니다.

Node.js 22.13 이상을 사용합니다(가능하면 LTS). Next.js + TypeScript + React와 서버 Route Handler로 구성하며 별도 Backend 서버 없이 로컬 SQLite DB를 사용합니다(Node 내장 SQLite 모듈).

```sh
npm ci
cp .env.example .env.local
# .env.local을 편집해 실제 API Key와 모델을 설정하세요.
npm run dev
```

http://127.0.0.1:3000 에서 Home, http://127.0.0.1:3000/feature-discovery 에서 실험을 엽니다.

```dotenv
OPENAI_API_KEY=your-server-side-key
OPENAI_MODEL=gpt-5.4-mini
```

`OPENAI_MODEL`은 필수입니다. 코드에는 기본 모델이 없습니다. 예시 모델은 구현 시점 공식 문서에서 이미지 입력/Responses API/Structured Outputs 지원을 확인한 `gpt-5.4-mini`입니다. 실제 계정의 접근 가능 여부는 호출로 확인해야 합니다. 환경변수 변경 후 서버를 재시작하세요. API Key는 서버만 읽으며 `NEXT_PUBLIC_`를 사용하지 않습니다.

## Feature Discovery 사용

1. **이미지 분석**(/feature-discovery)에서 권한이 있는 JPEG/PNG/WebP 정지 이미지를 최대 20장 선택합니다(장당 10 MB, 4,000만 픽셀 이하). 선택·미리보기만으로는 저장하거나 호출하지 않습니다.
2. 원본 보관과 외부 전송·API 비용 발생에 동의한 뒤 **선택 이미지 분석 시작**을 누릅니다. 이미지별로 비공개 파일 저장소와 SQLite 큐에 등록됩니다. 업로드가 끝날 때까지는 페이지를 열어두세요.
3. 로컬 작업 프로세스가 한 장씩 순차 분석합니다. AI 입력은 메타데이터를 제거하고 방향 정규화·최대 변 2048px JPEG quality 95로 전처리합니다. 원본은 모델에 보내지 않습니다.
4. 업로드가 끝나면 브라우저를 닫아도 분석은 계속됩니다. 로컬 서버/작업 프로세스는 실행 상태여야 합니다. 실패한 작업은 자동 재시도하지 않으며, 상태를 확인하고 **분석 재시도**를 누르면 비용이 다시 발생할 수 있습니다.
5. **결과·검토 목록**(/results)에서 분석 대기·분석 중·실패·검토 전·검토 중·검토 완료별로 필터링합니다. 이미지 카드의 **사람 검토 시작/검토 계속**으로 별도 검토 페이지(/review/기록ID)에 진입합니다.
6. 원본 또는 실제 AI 입력 이미지를 보면서 후보의 적절성·사람의 위험도·이유를 독립적으로 기록합니다. 적절·부적절·판단 보류에 따라 다른 기본 이유를 제안하며 직접 수정, 놓친 Feature 추가와 메모를 지원합니다. 적절성을 바꾸면 기존 이유를 유지하면서 재확인을 요구합니다. 새 이유 선택·직접 수정 또는 **기존 이유 확인 · 유지**로 확인하며, 확인 전에는 검토 완료할 수 없습니다. 변경은 약 1초 후 자동 저장됩니다.
7. **검토 완료**를 직접 눌러 완료를 확정합니다. 자동 저장은 완료 판정이 아닙니다. 각 후보의 적절성·이유·위험도를 작성하되, 부적절·판단 보류 항목은 이유를 남기면 위험도를 미검토로 둘 수 있습니다. 요소 분류와 관찰 내용은 완료 시 필수입니다. 수정하면 다시 검토 중으로 바뀝니다. **완료하고 다음**은 저장·완료·다음 미완료 기록 이동을 한 번에 처리합니다. 다음 기록이 없으면 결과 목록으로 이동합니다. **완료만 저장** 또는 **다음 미완료 이미지**도 이용할 수 있습니다.
8. 기존 DB 결과는 그대로 보존합니다. 원본 없는 기존 기록은 검토 페이지에서 같은 원본을 한 번 연결하면 보관됩니다. 다른 hash의 파일은 거부됩니다. 기존 localStorage 기록은 결과 페이지에서 DB로 옮길 수 있으며 브라우저 원본은 유지됩니다.
9. JSON Export는 결과·검토·완료 시각을 보존하며 이미지는 포함하지 않습니다. 삭제는 원본·분석본·미리보기와 DB 기록을 함께 제거합니다. 분석 중인 기록은 완료 후 삭제할 수 있습니다.

`npm run dev`와 `npm start`는 Next.js 서버와 로컬 작업 프로세스를 함께 시작합니다. 동일 DB에는 한 작업 프로세스만 실행합니다. 큐는 SQLite에 보존되므로 재시작 시 대기 작업은 이어서 진행됩니다. 분석 도중 중단된 작업은 실패로 표시하고 직접 재시도를 요구합니다(이미 비용이 발생했을 수 있음). 상태 갱신은 2~3초 간격입니다.

현재 작업 프로세스는 로컬 개발용으로 TypeScript를 메모리에서 변환합니다. `npm ci`로 개발 의존성까지 설치해야 합니다. 배포용 작업 큐·인증·객체 저장소는 이번 범위에 포함하지 않습니다.

### 원본 EXIF GPS · Street View

분석 업로드 시 원본 EXIF에 기록된 위도·경도를 함께 추출해 분석 진행 상황에 표시합니다. 새로고침 후나 기존 기록에서는 **GPS 확인**으로 보관된 원본을 다시 읽습니다. 사람 검토 화면에서도 조회할 수 있습니다. 좌표 입력란을 선택하면 `위도,경도` 전체가 선택되어 복사할 수 있습니다.

**Google Street View 열기**는 [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started#street-view-action)로 주변 파노라마를 엽니다. 이 링크에는 API Key가 필요하지 않습니다. 클릭할 때만 좌표를 Google로 전달하며 이미지 업로드나 Street View API 자동 호출은 하지 않습니다. 해당 위치의 파노라마 제공 여부는 Google에 따라 달라집니다.

GPS가 없는 사진은 정보 없음으로 표시하고 추정으로 채우지 않습니다. 손상된 GPS·범위를 벗어난 좌표·WGS84 이외의 명시된 좌표계는 사용하지 않습니다. GPS는 파일에 기록된 값으로, 실제 촬영 위치를 검증한 결과가 아닙니다. JPEG·PNG·WebP의 EXIF만 지원하며 HEIC·XMP 위치 정보는 지원하지 않습니다.

GPS는 VLM 입력, Feature 후보, 사람 위험도, SQLite 결과 JSON 및 JSON Export에 추가하지 않습니다. 이미 보관 중인 원본에서 필요할 때 읽으며 로그나 별도 파일에 기록하지 않습니다. GPT에는 계속 메타데이터가 제거된 분석본만 전송합니다. 이 기능은 사용자가 요청한 원본 GPS 조회이며 픽셀로 촬영 위치를 추론하는 기능이 아닙니다.

### Risk Level

**“해당 Feature가 외부 정보와 결합되었을 때 실제 촬영 위치를 좁히거나 특정하는 데 얼마나 유용한가”**

- `low`: 일반적이고 널리 공유되는 단서로 위치를 좁히는 데 제한적
- `medium`: 특징적/맥락적 단서로 다른 정보와 조합하면 유용
- `high`: 구체적인 식별자나 매우 독특한 단서로 위치 특정에 매우 유용

시각적으로 눈에 띄는 정도, detection confidence 또는 실제 노출 확률이 아닙니다. 이는 잠정적인 실험 기준이며 사람의 이유를 함께 남깁니다.

`analysis.modelOutput.candidates[].modelRisk`와 `humanReviews[].humanRisk`를 분리합니다. Human Review의 초기 위험도는 `null`(미검토)입니다. 모델 이유와 사람 이유, 관찰 내용도 분리하며 VLM 원본을 덮어쓰지 않습니다. 한 기록은 한 분석 실행만 포함합니다. 재분석은 **새 실험**으로 진행하세요.

## 보존 및 개인정보

- SQLite에는 결과·검토·분석 작업 상태·비공개 이미지 경로와 작은 미리보기를 저장합니다. 원본 파일명이나 위치 정보 필드를 따로 기록하지 않습니다. 새 localStorage 저장은 하지 않습니다.
- 원본과 전처리 분석본은 기본 `private-data/images/`에 각각 `기록ID.original`, `기록ID.jpeg`로 보관합니다. `IMAGE_STORAGE_PATH`로 변경할 수 있으며 반드시 비공개 폴더를 사용하세요(`public/` 사용 금지). 원본에는 EXIF/GPS 등 민감한 메타데이터가 남아 있을 수 있습니다. 모델에는 메타데이터가 제거된 분석본만 보냅니다. 이미지 조회는 로컬 API를 통해 제공하며 외부 URL이나 공개 정적 파일로 노출하지 않습니다.
- DB 기본 경로는 `private-data/feature-discovery.sqlite`입니다. 첫 기록 조회 시 자동 생성합니다. `SQLITE_PATH` 서버 환경변수로 경로를 변경할 수 있습니다. 브라우저 데이터를 삭제해도 DB 기록은 남습니다. DB 저장 실패·다른 탭의 변경 충돌은 화면에 표시하며 자동 재시도하지 않습니다. 편집을 다시 하거나 저장 재시도를 눌러 재시도할 수 있습니다. 손상된 기존 저장 기록은 덮어쓰지 않습니다.
- DB와 원본을 함께 백업하려면 서버·작업 프로세스를 종료한 후 DB 파일과 이미지 폴더를 함께 복사하세요. 결과 공유는 JSON Export를 사용합니다(미리보기 이미지는 JSON에 포함하지 않음). 로컬 DB는 다른 사람에게 접속 권한이나 공동 검토 기능을 제공하지 않습니다.
- JSON에는 모델 원본 JSON 텍스트·구조화된 후보, Human Review, 이미지 식별자/hash, 모델/프롬프트 버전/시간/token usage가 포함됩니다. 원본과 분석본은 별도 비공개 파일 저장소에 보관되며 JSON에는 파일 경로나 이미지가 포함되지 않습니다.
- 원본 보존은 사용자의 명시 요청에 따라 추가한 로컬 기능입니다. 업로드 선택 미리보기 URL은 선택 취소/페이지 종료 시 해제합니다. 서버 로그에 이미지·모델 응답·Secret을 남기지 않습니다.
- OpenAI 요청은 `store: false`를 사용하지만 OpenAI 측의 모든 보존을 없애는 것은 아닙니다. 기본 abuse monitoring 로그 등 별도 정책이 적용됩니다. [공식 데이터 보존 문서](https://developers.openai.com/api/docs/guides/your-data)를 확인하세요.
- **관찰된 간판 글자·주소 등 결과 텍스트도 민감정보일 수 있습니다.** Export JSON과 테스트 이미지는 공개 Repository에 넣지 마세요.
- SQLite 파일(`*.sqlite`, `*.db`)과 부속 파일은 Git에서 제외합니다. 결과 파일은 `experiment-exports/` 또는 `private-data/`, 테스트 이미지는 `test-images/`에 보관하세요. 이 디렉터리와 앱이 생성하는 `feature-discovery-*.json`, 사진 확장자, `proposal.docx`, `.env*`(예시 제외)는 Git에서 제외합니다. 그 밖의 개인정보 파일도 commit 전 확인해야 합니다.
- 이 앱은 localhost에서 사용하는 연구용 도구입니다. 인증/공개 운영용 rate limiting은 없으므로 그대로 공개 배포하지 않습니다.

## 파일 구조

```text
src/app/                         Home, Layout, CSS
src/app/feature-discovery/       여러 이미지 분석 요청
src/app/review/[id]/             별도 사람 검토 페이지
src/app/api/analysis-jobs/       업로드·원본 연결·실패 재시도
src/app/api/discovery-images/    로컬 비공개 이미지 조회
src/lib/server/jobs.ts           이미지 보관·영속 큐·순차 분석
scripts/                        로컬 서버·작업 프로세스 실행
src/app/api/prepare-image/       이미지 검증·방향/크기 정리·메타데이터 제거
src/app/api/feature-discovery/   서버 전용 OpenAI 호출
src/components/                 실험 작업 공간, 업로드, Cue 검토
src/lib/discovery.ts             스키마와 모델/사람 기록 구조
src/lib/storage.ts               DB 요청·기존 브라우저 기록 옮기기·JSON Export
src/lib/server/records.ts         SQLite 저장·조회·삭제·모델 원본 보호
src/app/api/discovery-records/    로컬 기록 API
src/app/results/                 저장 결과·작은 이미지·검토 비교
src/lib/server/image.ts          메모리 이미지 처리·요청 크기 제한
.github/pull_request_template.md
AGENTS.md / POC_PLAN.md
```

## 검증

```sh
npm run lint
npm run typecheck
npm run build
npm run test:workflow
npm start
```

직접 확인할 시나리오:

- 정상 이미지 업로드/Preview, 지원하지 않는 파일·손상된 이미지·10 MB 초과 파일 거부
- 환경변수 미설정/API 인증/한도 오류가 탐지 0건과 구분되는지
- 실제 VLM 호출과 후보 표시, 모델 원본과 사람 위험도 차이 보존
- 사람의 추가 Feature, 부적절/판단 보류, 미검토 상태 저장
- 배치 등록 → 페이지 종료 → 결과 상태 확인 → 원본 조회 → 별도 검토·완료 → 다음 이미지
- 다른 이미지 연결 거부, 새 실험에서 독립 기록 생성
- JSON의 modelRisk/humanRisk·이유 분리 및 이미지/Secret 미포함
- 기록 삭제, 데스크톱 화면, 키보드 조작

## 제외 범위

Experiment 2, 자동 매칭, Taxonomy 편집/버전 관리 UI, JSON Import, EXIF 탐지 평가, 실제 위치 추론, 전체 Risk Score, 로그인/SNS/Profile/Embedding/Clustering/Privacy Edit/Inpainting, 별도 AI 서버/Production DB/공개 배포 인프라는 구현하지 않습니다. Experiment 2는 실험 1의 실제 이미지 검증과 별도 Taxonomy 확정 후, 다른 이미지로 Human Annotation → 확정 → VLM → 사람의 수동 비교 순서로 진행합니다.

## Git Convention

Conventional Commits의 간단한 `<type>: <description>` 형식을 사용합니다. 설명은 한글 중심으로 작성하고, type과 모델명·API·코드 식별자 등 필요한 기술 용어는 영어를 유지합니다. 한 commit에는 가능한 한 하나의 논리적인 변경을 담습니다.

PR 제목과 본문도 한글 중심으로 작성합니다. 기술 용어·파일 경로·명령어는 필요한 경우 영어로 표기하며, 변경 목적과 동작·검증 결과를 간결하게 설명합니다.

| type | 용도 |
| --- | --- |
| feat | 새로운 기능 |
| fix | 버그 수정 |
| refactor | 동작 변경 없는 코드 개선 |
| docs | 문서 수정 |
| style | UI/CSS 스타일 |
| test | 테스트 추가/수정 |
| chore | 설정/패키지 등 |

예: `feat: Feature Discovery 테스트 페이지 추가`, `fix: 잘못된 이미지 업로드 처리`.

Codex는 명시적으로 요청받은 경우에만 commit/push합니다. commitlint/Husky 등의 자동화는 사용하지 않습니다.

## OpenAI 공식 참고 문서

- [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [예시 모델 GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

TypeScript SDK의 `responses.parse` + `zodTextFormat`을 사용합니다. Structured Outputs는 데이터 형식을 제한하며 내용의 사실성을 보장하지 않습니다.

목록의 자동 갱신은 요약·상태만 조회하고 미리보기는 이미지 API에서 읽습니다. 모델 원본과 검토 상세는 카드나 검토 페이지를 열 때 해당 기록만 조회합니다. 자동 저장 중에도 입력을 계속할 수 있으며, 저장 응답보다 늦게 입력한 변경은 다음 저장에서 반영합니다. 삭제 파일은 DB 변경 전 임시 이동하고 실패 시 복구하며, 중단된 임시 이동과 정리 대기는 다음 DB 접근에서 복구/정리합니다.

검토 화면에서는 요소 분류·관찰·영역을 읽기 화면으로 보여주고 필요할 때만 **내용 수정**을 엽니다. 새로 추가한 빈 요소는 입력창이 바로 표시됩니다. 기본 이유 선택 후 문장은 읽기 화면으로 표시하고 **문장 수정**으로 편집합니다. 모델 원본·위험도·이유는 기본적으로 접어두며 필요 시 비교할 수 있습니다. 이는 AI 보조 탐색이며 독립적인 정답 생성은 아닙니다. 데스크톱에서는 검토 이미지가 스크롤 중에도 유지되고, 판단 기준은 펼쳐서 확인합니다.


## OCR 문자와 GPT 후보 연결 (로컬 확장)

기존 GPT 분석이 완료된 기록의 사람 검토 화면에서 **로컬 OCR 실행**을 누른다.
저장 대기 중에는 실행할 수 없으며 원본/분석본 파일이 필요하다. 실행 중 편집은 잠긴다.
GPT 재호출이나 개인 이미지의 외부 전송 없이 분석본을 로컬 PaddleOCR로 처리한다.
최초 실행은 공개 모델 다운로드가 필요하며 5분 시간 제한이 있다. 실패 시 기존 기록은 유지되고 직접 재시도할 수 있다.

Windows Python 3.11 별도 환경 (기존 매칭 가상환경과 분리):

```powershell
py -3.11 -m venv private-data/ocr-venv
.\private-data\ocr-venv\Scripts\python.exe -m pip install -r scripts/ocr/requirements.txt
```

다른 환경에서는 `OCR_PYTHON`에 Python 실행 파일의 절대 경로를 지정한다.
기본 캐시는 `private-data/ocr-models`이며 실행 환경/모델은 Git에 포함하지 않는다.
PaddleOCR 3.x `predict`의 `rec_texts`, `rec_scores`, `rec_polys`를 사용한다.
공식 API 참고: https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md

OCR 원문은 `record.ocr`, 사람의 연결 판단은 `record.ocrReviews`로 저장된다.
기존 schemaVersion 1 기록은 추가 필드 없이 그대로 읽는다. 이전 버전 앱으로 새 기록을 열지는 않는다.
OCR 원본은 저장 후 수정할 수 없으며 GPT 후보 연결은 원본 후보 index를 참조한다.
좌표는 방향 정규화된 **분석본**의 0~1 좌표이며 원본 픽셀 좌표가 아니다.
문자열 일치 제안은 공백/기호를 제거한 2글자 이상 문자열의 포함 여부에만 근거한다.
GPT가 글자를 읽지 못했거나 같은 글자가 여러 곳에 있으면 자동으로 확정하지 않는다.
영역을 확인한 사람이 GPT 후보 연결, 독립 보존, 제외 중 하나를 선택한다.
OCR 단독 후보/제외 원문도 보존된다. Fusion이 없는 기록은 모든 OCR 항목을 판단해야 검토 완료할 수 있다.
독립 문자 단서의 위험도/이유는 기존 Feature 직접 추가 기능으로 기록한다.
초기 OCR 연결 단계의 범위였다. 현재 추가된 GPT 검토·박스 수정은 아래 Fusion 절을 참조한다. 정밀 마스크와 Grounding DINO는 미구현이다.

```powershell
node --conditions=react-server tests/ocr-workflow.cjs
```

Windows에서 저장소 경로에 한글이 포함되면 Paddle 모델 파일 열기에 실패할 수 있다. 이 경우 .env.local의 OCR_CACHE_PATH를 영문 절대 경로로 설정한다. 이 폴더에는 공개 모델·다운로드 캐시만 저장하며 사진·검토 기록은 기존 private-data에 남는다. OCR 실행 자식 프로세스의 USERPROFILE/HF_HOME/MODELSCOPE_CACHE를 이 캐시로 한정해 전역 사용자 캐시에 쓰지 않는다. 환경변수 변경 후 서버를 재시작한다.

추가 API 테스트: node --conditions=react-server tests/ocr-api.cjs (모의 하위 프로세스)

### Windows 빌드 시 EPERM이 발생하는 경우

병렬 빌드에서 `.next` 폴더 생성 권한 오류가 발생하는 환경은 아래 선택적 빌드 모드를 사용할 수 있다. 기본 빌드 설정은 유지된다.

```powershell
$env:KKOK_SERIAL_BUILD = '1'
npm run build
Remove-Item Env:KKOK_SERIAL_BUILD
```

이 모드는 Webpack 빌드 작업 프로세스를 비활성화하고 정적 페이지 작업자를 1개로 제한한다. 별도 코드·모델 실행이나 GPT 호출은 없다.

### OCR → GPT → Fusion 단서 (2026-10-27)

사람 검토 화면에서 로컬 OCR을 실행한 뒤, 전송·비용 안내에 동의하고 **GPT로 검토하고 Fusion 단서 만들기**를 누른다. 기존 결과는 자동 재분석하지 않는다.

1. PaddleOCR가 분석본의 문자·인식 점수·다각형 좌표를 추출해 `record.ocr`에 보존한다.
2. `OPENAI_MODEL`에 설정된 GPT가 분석본, 저장된 OCR 문자/좌표, 기존 GPT 관찰을 함께 검토한다. 사람 메모·판단·수정 좌표는 보내지 않는다.
3. 같은 간판의 인접 문자열을 묶고 유용/제외/불확실로 판단한다. 모든 OCR ID가 정확히 한 번 포함되어야 저장된다. 기존 GPT가 놓친 OCR 단서도 가능하다.
4. 서버가 각 그룹의 OCR 좌표에서 경계 사각형을 계산한다. GPT는 bbox를 생성하지 않는다. 좌표는 분석본 기준 `[left, top, right, bottom]`, 범위 0~1이다.
5. 유용한 단서만 Fusion 카드에 표시하며 각 카드에 분석본과 해당 단서의 주황색 사각형을 표시한다. 제외·보류 원문도 접힌 목록에 남고 사람이 복원할 수 있다.
6. 사람은 단서 내용/분류/위험도/이유를 검토하고 사각형을 다시 그리거나 수치로 수정할 수 있다. 모델 원본은 `fusion`, 사람 값은 `fusionReviews`로 분리한다. JSON Export에 모두 포함된다.

Fusion이 만들어진 기록에서는 문자별 기존 OCR 연결 판단 대신 Fusion 검토 완료 여부를 검사한다. 기존 GPT 후보·사람 추가 단서의 검토는 유지한다. Fusion이 없는 이전 기록은 기존 완료 기준을 사용한다.

요청은 한 번에 OCR 120개까지 지원하며 초과 시 호출 전에 중단한다. OCR 0개는 유료 호출 없이 완료한다. 120초 제한, 자동 재시도 없음, 실행 상태/실패 기록과 중복 호출 차단을 적용했다. 중단된 실행은 180초 후 상태 확인 시 실패로 전환되고 사용자가 직접 재시도한다. 실패해도 OCR과 이전 기록은 유지된다. GPT 실패/타임아웃 시에도 API 비용이 발생했을 수 있다.

Fusion은 OCR 텍스트 기반 단서 검토다. Grounding DINO, SAM, 원본 이미지 픽셀 좌표 역변환은 추가하지 않았다. 기존 DINOv2 파이프라인은 변경하지 않았다.

검증: `node --conditions=react-server tests/fusion-workflow.cjs` (GPT 모의 응답, 비용 없음). 실제 GPT의 한국어 인식·단서 선별 품질은 대표 사진으로 별도 평가해야 한다.


### Grounding DINO 객체 Fusion 파일럿 (2026-10-28)

사람 검토 화면의 **Grounding DINO 객체 탐지**에서 간판/외관/출입구 등의 영어 프롬프트를 입력한다. 탐지 후 **GPT로 객체 검토하고 Fusion 단서 만들기**를 누르면 유용/제외/불확실로 분류한다. GPT 전송 동의는 별도이며 기존 OPENAI_MODEL을 사용한다. 최초 이미지 GPT 분석, OCR Fusion, 객체 Fusion은 각각 별도 호출이다.

- 모델: IDEA-Research/grounding-dino-tiny, revision a2bb814dd30d776dcf7e30523b00659f4f141c71. 기본 점수 임계값 0.3, text 임계값 0.25. CPU/CUDA 자동 선택.
- 저장: grounding(탐지 원본), groundingAttempt(실행 상태), objectFusion(GPT 검토 원본), objectFusionReviews(사람 수정), objectFusionAttempt(GPT 실행 상태). JSON Export에 모두 포함된다.
- bbox: 기존 분석본 기준 0~1 xyxy. GPT는 좌표를 생성하지 않고 서버가 탐지 ID의 원본 bbox를 합친다. 모든 탐지 ID가 정확히 한 번 검토되어야 저장한다. 탐지 최대 900개, GPT 검토 최대 120개이며 초과하면 API 호출 전에 중단한다.
- 기존 **VLM Feature 후보** 카드에도 분석본과 연결된 OCR(주황)/Grounding DINO(파랑) 상자를 표시한다. OCR 사람 연결 또는 각 GPT 검토의 원본 후보 index를 근거로 연결한다. 단순 문자열 추측으로 상자를 연결하지 않는다. 대응 좌표가 없는 후보는 이미지와 좌표 미연결 안내를 표시한다.
- OCR/객체 Fusion의 각 VLM 후보 카드, 전체 OCR 원문/객체 원본 카드에도 해당 항목의 사각형을 표시한다. 사람이 편집한 bbox는 원본과 별도 보존한다.
- 탐지 10분 제한, 다른 기록과의 탐지 동시 실행 차단. 서버 재시작 후 11분 이상 중단된 작업은 상태 조회 시 실패 처리한다. GPT 검토는 120초 제한/자동 재시도 없음. 실패해도 원본과 검토 기록은 유지된다.
- 객체 탐지를 시작한 기록은 객체 GPT 검토와 유용/복원 단서의 사람 검토를 마쳐야 완료할 수 있다. 탐지 0개는 GPT 호출을 생략한다.

새 환경 설치 (프로젝트 루트 PowerShell):

```powershell
py -3.11 -m venv private-data/grounding-venv
.\private-data\grounding-venv\Scripts\python.exe -m pip install --upgrade pip
.\private-data\grounding-venv\Scripts\python.exe -m pip install -r scripts/grounding/requirements.txt
npm.cmd run dev -- --webpack
```

현재 PC에서는 기존 .venv-pipeline의 torch 2.14.1+cpu / transformers 4.57.6을 재사용하도록 .env.local의 GROUNDING_PYTHON을 설정했다. 기존 패키지를 변경하지 않았다. 공개 모델 캐시는 GROUNDING_CACHE_PATH의 영문 절대 경로에 저장한다. 다른 PC는 위 독립 환경을 설치하거나 설치된 Python을 명시한다.

검사: tests/grounding-workflow.cjs (모의 GPT, 저장/실패/좌표 계보), tests/feature-regions.cjs (React 후보 카드 SVG 렌더링). 실제 사진의 탐지 정밀도/재현율은 별도의 독립 사람 정답 데이터로 평가해야 한다. 검토에서 수정한 박스를 모델 평가용 독립 정답으로 간주하지 않는다.

### 객체 crop 검토 v3

Grounding DINO는 입력한 객체 이름에 해당하는 영역을 찾습니다. 실내/실외 목록을 선택하거나 수정하고 객체 점수 기준(기본 0.3)과 레이블 단어 기준(기본 0.25)을 조절할 수 있습니다. 작은 기준값은 오탐도 늘릴 수 있습니다.

새 객체 GPT 검토는 ID가 표시된 개별 bbox crop(최대 512px)을 한 요청으로 보냅니다. 기존 GPT 설명과 전체 OCR 문자열은 전송하지 않습니다. 각 ID는 별도 결과로 반환하며 원래 VLM 후보 연결은 비워 둡니다. 문자 간판/메뉴판은 OCR 담당으로 제외합니다. 원본 bbox와 이전 v1/v2 응답은 보존합니다. 기존 완료 기록은 자동으로 재분석하지 않으며 새 기록에서 적용됩니다. crop 안에서의 오인식 가능성은 있어 사람 검토가 필요합니다. crop 수에 따라 이미지 입력 비용이 늘 수 있습니다.

검사: `node --conditions=react-server tests/object-crops.cjs` (실제 OpenAI 호출 없음).

### 업로드 병렬 분석

새 이미지 분석에서 GPT 개별 후보·PaddleOCR·Grounding DINO를 동시에 실행합니다. GPT+OCR 완료 시 OCR Fusion, GPT+DINO 완료 시 객체 crop 검토를 각각 자동 실행합니다. 업로드 동의는 분석본·OCR 및 객체 crop 전송과 이미지당 최대3회 GPT 호출을 포함합니다. 이미지 여러 장은 로컬 자원을 위해 한 장씩 처리합니다. 각 단계 상태와 결과는 SQLite에 저장되고 브라우저를 닫아도 worker가 계속 처리합니다. 실패는 자동 재시도하지 않으며 재시도는 결과가 없는 단계만 실행합니다. 개발 worker 코드를 바꾼 뒤에는 dev 서버를 재시작해야 합니다.

OCR 문구 중복, 같은 종류 객체의 IoU>=0.7 중복 후보, 방향이 충돌하지 않는 동일 종류 GPT/객체 관련 근거를 접어서 묶습니다. 좌표 없는 GPT 관찰은 동일 객체 확정이 아니라 관련 단서 제안입니다. 원본·각 사람 검토·JSON export는 보존되며 접힌 항목도 펼쳐 검토할 수 있습니다.

## Spring 통합 검사 API
POST /api/inspections 및 GET /api/inspections/{id}로 기존 분석 파이프라인을 호출할 수 있습니다. 요청·결과 계약과 접근 키 설정은 [통합 API 문서](docs/inspection-api.md)를 참고하세요. 최종 점수·게시 이력 비교는 아직 지원하지 않습니다.
