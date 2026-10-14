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

1. 권한이 있는 JPEG/PNG/WebP 정지 이미지를 선택합니다(10 MB 이하, 4,000만 픽셀 이하).
2. 방향을 정규화하고 최대 변 2048 px, JPEG quality 95로 준비한 Preview를 확인합니다. 메타데이터는 제거하고 투명 배경은 흰색으로 변환합니다. Preview와 VLM 입력은 같은 이미지입니다.
3. 외부 전송에 동의하고 **VLM으로 후보 탐색**을 누릅니다. 준비 단계는 OpenAI를 호출하지 않으며 분석 버튼을 눌렀을 때만 호출/비용이 발생합니다.
4. 후보마다 Feature type, Observed cue, 영역, 적절성, 사람의 Risk Level과 이유를 검토합니다. 분류는 고정 Taxonomy가 아니며 새 type을 직접 입력할 수 있습니다.
5. VLM이 놓친 Feature를 직접 추가하고 실험 메모를 남깁니다.
6. 이미지 선택만으로는 저장하지 않습니다. 후보 탐색 실행 후 분석·검토 변경은 입력이 멈춘 뒤 약 1초 후 **로컬 DB에 자동 저장**됩니다. 저장 상태를 확인하세요. 실패하면 **저장 재시도** 또는 **JSON Export**로 보존합니다. 미검토 기록도 저장/Export할 수 있습니다.
7. 저장된 기록을 다시 열어 수정합니다. Preview가 필요하면 같은 원본을 다시 연결합니다. 이미지 hash가 다른 파일은 연결되지 않습니다. 기록은 개별 삭제할 수 있습니다.
8. 상단 **테스트 결과**(/results)에서 이미지와 요약이 있는 카드를 눌러 모델 원본, Human Review, 메모와 token usage를 확인합니다. 개별/전체 JSON Export를 제공합니다.
9. 이전 localStorage 기록이 있으면 Feature Discovery의 **로컬 DB로 옮기기**를 이용하세요. 옮기기는 전체 성공 또는 전체 취소로 처리하며, 충돌 시 DB 기록을 덮어쓰지 않습니다. 브라우저 원본은 그대로 남습니다.

### Risk Level

**“해당 Feature가 외부 정보와 결합되었을 때 실제 촬영 위치를 좁히거나 특정하는 데 얼마나 유용한가”**

- `low`: 일반적이고 널리 공유되는 단서로 위치를 좁히는 데 제한적
- `medium`: 특징적/맥락적 단서로 다른 정보와 조합하면 유용
- `high`: 구체적인 식별자나 매우 독특한 단서로 위치 특정에 매우 유용

시각적으로 눈에 띄는 정도, detection confidence 또는 실제 노출 확률이 아닙니다. 이는 잠정적인 실험 기준이며 사람의 이유를 함께 남깁니다.

`analysis.modelOutput.candidates[].modelRisk`와 `humanReviews[].humanRisk`를 분리합니다. Human Review의 초기 위험도는 `null`(미검토)입니다. 모델 이유와 사람 이유, 관찰 내용도 분리하며 VLM 원본을 덮어쓰지 않습니다. 한 기록은 한 분석 실행만 포함합니다. 재분석은 **새 실험**으로 진행하세요.

## 보존 및 개인정보

- SQLite에는 구조화된 결과와 최대 480px JPEG quality 65 미리보기만 저장합니다. 원본/분석본, 원본 파일명, GPS는 저장하지 않습니다. 미리보기에도 민감한 내용이 보일 수 있습니다. 새 localStorage 저장은 하지 않습니다.
- DB 기본 경로는 `private-data/feature-discovery.sqlite`입니다. 첫 기록 조회 시 자동 생성합니다. `SQLITE_PATH` 서버 환경변수로 경로를 변경할 수 있습니다. 브라우저 데이터를 삭제해도 DB 기록은 남습니다. DB 저장 실패·다른 탭의 변경 충돌은 화면에 표시하며 자동 재시도하지 않습니다. 편집을 다시 하거나 저장 재시도를 눌러 재시도할 수 있습니다. 손상된 기존 저장 기록은 덮어쓰지 않습니다.
- DB 파일을 백업하려면 서버를 종료한 후 복사하세요. 결과 공유는 JSON Export를 사용합니다(미리보기 이미지는 JSON에 포함하지 않음). 로컬 DB는 다른 사람에게 접속 권한이나 공동 검토 기능을 제공하지 않습니다.
- JSON에는 모델 원본 JSON 텍스트·구조화된 후보, Human Review, 이미지 식별자/hash, 모델/프롬프트 버전/시간/token usage가 포함됩니다. 이미지 재검토용 파일은 연구자가 비공개로 따로 관리해야 합니다.
- 원본/분석 이미지는 요청 및 브라우저 메모리에서만 처리합니다. 결과 확인용 작은 미리보기만 DB에 보존합니다. 새 실험/다른 기록을 열면 브라우저의 분석 Preview 참조를 해제합니다.
- OpenAI 요청은 `store: false`를 사용하지만 OpenAI 측의 모든 보존을 없애는 것은 아닙니다. 기본 abuse monitoring 로그 등 별도 정책이 적용됩니다. [공식 데이터 보존 문서](https://developers.openai.com/api/docs/guides/your-data)를 확인하세요.
- **관찰된 간판 글자·주소 등 결과 텍스트도 민감정보일 수 있습니다.** Export JSON과 테스트 이미지는 공개 Repository에 넣지 마세요.
- SQLite 파일(`*.sqlite`, `*.db`)과 부속 파일은 Git에서 제외합니다. 결과 파일은 `experiment-exports/` 또는 `private-data/`, 테스트 이미지는 `test-images/`에 보관하세요. 이 디렉터리와 앱이 생성하는 `feature-discovery-*.json`, 사진 확장자, `proposal.docx`, `.env*`(예시 제외)는 Git에서 제외합니다. 그 밖의 개인정보 파일도 commit 전 확인해야 합니다.
- 이 앱은 localhost에서 사용하는 연구용 도구입니다. 인증/공개 운영용 rate limiting은 없으므로 그대로 공개 배포하지 않습니다.

## 파일 구조

```text
src/app/                         Home, Layout, CSS
src/app/feature-discovery/       Experiment 1 페이지
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
npm start
```

직접 확인할 시나리오:

- 정상 이미지 업로드/Preview, 지원하지 않는 파일·손상된 이미지·10 MB 초과 파일 거부
- 환경변수 미설정/API 인증/한도 오류가 탐지 0건과 구분되는지
- 실제 VLM 호출과 후보 표시, 모델 원본과 사람 위험도 차이 보존
- 사람의 추가 Feature, 부적절/판단 보류, 미검토 상태 저장
- 자동 저장 → 새로고침/서버 재시작 → 결과 페이지의 카드 상세 → 같은 원본 다시 연결
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
