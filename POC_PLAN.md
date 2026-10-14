# Location Cue Detection PoC 계획

## 현재 범위

Experiment 1 Feature Discovery만 구현한다. 이미지 → Preview → VLM 후보 → Human Review → 직접 추가 → SQLite 자동 저장 → 결과 조회 → JSON Export를 제공한다. Taxonomy는 Export 결과를 사람이 별도로 검토해 확정하며 편집/버전 관리 UI를 만들지 않는다.

데스크톱 브라우저에서 사용한다. 모바일 UI 최적화는 현재 범위에 포함하지 않는다.

VLM 결과는 Ground Truth가 아니다. 촬영 위치를 입력/추론하지 않으며, 확정되지 않은 모델 위험도를 사실이나 노출 확률로 표현하지 않는다.

## 실험 질문

- 어떤 시각적 요소를 Location Cue Feature로 정의할 수 있는가?
- 후보의 분류와 위치 식별 유용성에 대해 사람과 VLM의 판단이 어떻게 다른가?
- VLM이 놓치거나 불필요하게 제안하는 후보는 무엇인가?

## 위험도 정의

“해당 Feature가 외부 정보와 결합되었을 때 실제 촬영 위치를 좁히거나 특정하는 데 얼마나 유용한가”

low/medium/high는 이 유용성을 기준으로 작성한다. 현저성이나 confidence가 아니다. 사람이 위험도/적절성/이유를 독립적으로 기록한다. 이 단계에서는 전반적인 위험 점수나 실제 위치 추론 성공률을 산출하지 않는다.

## 데이터 모델

- `DiscoveryRecord`: schemaVersion, experiment discriminator, recordId, 생성/수정 시각, riskDefinition, image, analysis, humanReviews, notes.
- `image`: 앱이 발급한 imageId, originalSha256/analysisSha256, 분석 크기/MIME/전처리 설정. 원본 이름이나 위치 메타데이터 없음.
- `analysis`: requestedModel/responseModel, responseId, 분석 시각, promptVersion, 입력 hash, usage, modelOutput, rawOutputText. 한 기록에 한 번만 설정.
- `modelOutput.candidates`: featureType, observedCue, regionDescription, modelRisk, modelReason. 분류는 자유 문자열이다.
- `humanReviews`: cueId, modelCandidateIndex 또는 null, source, 사람이 수정 가능한 type/관찰/영역, appropriateness, humanRisk 또는 null, humanReason.
- 사람 직접 추가 항목은 `source: human`, `modelCandidateIndex: null`. 모델 위험도는 생성하지 않는다.
- JSON Export는 experiment를 명시한 envelope에 현재 기록 또는 저장 기록 배열을 담는다. 원본 이미지는 포함하지 않는다.

모델 원본 후보의 index와 Human Review를 연결한다. 부적절한 모델 후보도 삭제하지 않고 검토 상태로 보존한다. 사람의 직접 추가만 삭제 가능하다. UI가 사람의 위험도를 모델 위험도로 자동 채우지 않는다. 브라우저 재조회 시 스키마/참조 무결성을 확인한다.

## 이미지·API·보존

이미지 준비 API는 서버 메모리에서 검증/전처리하고 동일한 분석본을 Preview와 모델에 사용한다. 최대 10 MB, 4,000만 픽셀의 정지 JPEG/PNG/WebP를 지원한다. EXIF 제거 후 최대 변 2048 px JPEG quality 95로 처리한다. EXIF 자체 탐지는 이번 실험에서 제외한다.

간단한 SHA-256으로 다시 연결한 원본과 분석본을 확인한다. 유사 이미지/재인코딩 이미지 탐지는 하지 않으며 Experiment 2의 중복 데이터 방지는 후속 계획에서 다룬다. 모델명은 서버 환경변수만 사용한다.

OpenAI에는 이미지와 탐색 프롬프트만 보낸다. 사람의 Review/메모를 보내지 않는다. 웹 검색/지도/외부 도구는 제공하지 않는다. `store: false`, SDK timeout 90초, 자동 재시도 없음. 실패와 후보 0건을 구분한다. 서버에 이미지·모델 출력·Secret 로그를 남기지 않는다. 결과 확인용 최대 480px JPEG quality 65 미리보기만 SQLite에 보존한다. 원본/분석본은 디스크에 저장하지 않는다.

이미지 선택만으로는 저장하지 않는다. 후보 탐색 실행 후 SQLite 자동 저장은 변경 후 약 1초 입력이 멈추면 수행한다. 실패 시 자동 반복하지 않고 저장 재시도/JSON Export를 제공한다. 미완료 기록도 보존할 수 있다. 저장 실패는 Export로 복구하도록 안내한다. JSON은 장기 보존본이며 브라우저 삭제는 다운로드된 파일을 삭제하지 않는다. 실제 이미지/결과는 비공개로 따로 관리한다.

## 구현 순서 및 완료 조건

1. Next.js/TypeScript 및 Git 보안·문서·PR Template 구성.
2. 기본 Layout/Home와 재사용 가능한 업로드/Preview 구성.
3. 서버 OpenAI Structured Outputs와 후보/Human Review 분리.
4. 직접 추가, SQLite 저장/재조회/삭제, JSON Export.
5. lint/type check/build, API 입력 거부, Key 미설정, 브라우저 리뷰·저장·Export 흐름 검증.
6. 사용자가 설정한 API Key와 실제 테스트 사진으로 VLM 검증. 모의 응답 테스트는 실제 검증으로 간주하지 않는다.
7. 실험 결과 검토 및 Taxonomy 별도 확정 후 Experiment 2 착수.

## 후속 Experiment 2

새로운 테스트 이미지를 사용한다. 고정 Taxonomy와 Human Annotation을 VLM 호출 전 확정한다. 사람의 Annotation은 모델 입력에 포함하지 않는다. Matched/Missed/VLM Only 연결은 사람이 직접 확인하고 평가 데이터를 Experiment 1과 분리한다. 현재는 준비 중 안내 페이지만 제공하며 테스트 API/Matching은 구현하지 않는다.

## 제외 및 협업

회원가입, SNS API, Personal Exposure Profile, Embedding/Clustering, Risk Score, Privacy Edit, Python/Spring 서버, Production DB, 자동 Matching, Taxonomy UI, JSON Import, 정밀 Bounding Box는 제외한다.

명시적 요청이 있을 때만 논리적 단위로 Conventional Commit을 생성한다. commit 설명과 PR 제목·본문은 한글 중심으로 작성하고, type 및 필요한 기술 용어·식별자·명령어는 영어로 유지한다. push는 별도 요청이 필요하다. Secret, 실제 사진, Export 결과, proposal.docx는 commit하지 않는다.

## 현재 검증 기록 (2026-10-07)

- lint, type check, production build 통과.
- production 서버에서 잘못된 이미지/JSON, 10 MB 초과 요청, 이미지 hash 불일치 거부와 API 환경변수 미설정 503 응답 확인.
- 합성 JPEG의 EXIF 제거 확인.
- headless Chrome 데스크톱에서 Preview/동의/오류 표시, 모의 VLM 후보 검토, modelRisk medium / humanRisk high 분리, 사람의 직접 추가, localStorage 저장/새로고침/재조회, JSON Export, 동일 이미지 재연결/다른 이미지 거부, 기록 삭제 확인. 런타임 오류 없음.
- 브라우저 검증에 사용한 Playwright/합성 이미지/스크린샷/Export 파일은 임시 디렉터리에만 두고 Repository에 포함하지 않음.
- 실제 OpenAI Key와 실제 테스트 사진이 없어 실제 VLM 응답 품질은 아직 검증하지 않음. 다음 검증은 사용자 환경변수 설정 후 수행해야 함.
- `npm audit --omit=dev`: 취약점 0건. 전체 감사에는 ESLint 간접 의존성인 braces 계열 high 5건이 남음. 조회 시 최신 braces도 영향 범위이며, 제안된 Next lint 설정 downgrade/강제 수정은 적용하지 않음.

## 로컬 결과 보존 변경

사용자 요청에 따라 SQLite 자동 저장과 결과 조회(/results)를 추가한다. DB는 `private-data/feature-discovery.sqlite`에 보관하고 Git에서 제외한다. 모델 원본/이미지 식별자는 저장 후 변경을 거부하며, 다른 탭의 오래된 저장·삭제 요청도 거부한다. 기존 브라우저 기록은 명시적으로 옮기며 원본을 남긴다. 결과 확인용 작은 미리보기는 DB에만 저장하고 JSON에는 포함하지 않는다. 서버 종료 후 DB 파일을 백업하거나 JSON을 Export한다.
