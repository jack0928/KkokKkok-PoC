# 꼭꼭 · Location Cue Lab

중앙대학교 캡스톤 프로젝트 **꼭꼭**의 Location Cue Detection 사전 기술 검증용 PoC입니다. 현재는 Experiment 1 **Feature Discovery**만 구현합니다.

VLM 결과는 Ground Truth가 아니라 사람이 검토할 **Feature 후보**입니다. 실제 촬영 위치·주소·지역·좌표를 추론하지 않습니다. 화면에서 읽을 수 있는 간판 글자는 관찰 단서로 기술할 수 있지만, 이를 실제 촬영 위치로 해석하지 않습니다.

## 실행

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
6. 원본 또는 실제 AI 입력 이미지를 보면서 후보의 적절성·사람의 위험도·이유를 독립적으로 기록합니다. 적절·부적절·판단 보류에 따라 다른 기본 이유를 제안하며 직접 수정, 놓친 Feature 추가와 메모를 지원합니다. 적절성을 바꿔도 기존 이유를 자동으로 덮어쓰지 않으므로 내용을 확인하세요. 변경은 약 1초 후 자동 저장됩니다.
7. **검토 완료**를 직접 눌러 완료를 확정합니다. 자동 저장은 완료 판정이 아닙니다. 각 후보의 적절성·이유·위험도를 작성하되, 부적절·판단 보류 항목은 이유를 남기면 위험도를 미검토로 둘 수 있습니다. 요소 분류와 관찰 내용은 완료 시 필수입니다. 수정하면 다시 검토 중으로 바뀝니다. **다음 미완료 이미지**로 이동해 계속 검토할 수 있습니다.
8. 기존 DB 결과는 그대로 보존합니다. 원본 없는 기존 기록은 검토 페이지에서 같은 원본을 한 번 연결하면 보관됩니다. 다른 hash의 파일은 거부됩니다. 기존 localStorage 기록은 결과 페이지에서 DB로 옮길 수 있으며 브라우저 원본은 유지됩니다.
9. JSON Export는 결과·검토·완료 시각을 보존하며 이미지는 포함하지 않습니다. 삭제는 원본·분석본·미리보기와 DB 기록을 함께 제거합니다. 분석 중인 기록은 완료 후 삭제할 수 있습니다.

`npm run dev`와 `npm start`는 Next.js 서버와 로컬 작업 프로세스를 함께 시작합니다. 동일 DB에는 한 작업 프로세스만 실행합니다. 큐는 SQLite에 보존되므로 재시작 시 대기 작업은 이어서 진행됩니다. 분석 도중 중단된 작업은 실패로 표시하고 직접 재시도를 요구합니다(이미 비용이 발생했을 수 있음). 상태 갱신은 2~3초 간격입니다.

현재 작업 프로세스는 로컬 개발용으로 TypeScript를 메모리에서 변환합니다. `npm ci`로 개발 의존성까지 설치해야 합니다. 배포용 작업 큐·인증·객체 저장소는 이번 범위에 포함하지 않습니다.

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
