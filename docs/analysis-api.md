# Spring 분석 서버 연결 (임시 계약)

이 API는 기존 Feature Discovery 작업 큐를 Spring 백엔드에서 호출하기 위한 로컬 연결 계층입니다. 기존 PoC 웹 흐름과 사람 검토 결과는 바꾸지 않습니다. 파이프라인 스키마가 확정되면 이 매핑만 교체합니다.

## 로컬 설정

`.env.local`에 서버에서만 사용하는 값을 설정합니다.

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=...
ANALYSIS_API_KEY=같은_키를_Spring의_NODE_ANALYSIS_API_KEY에도_설정
```

Next.js 분석 서버는 로컬 전용으로 실행하고, Spring은 `NODE_ANALYSIS_BASE_URL=http://127.0.0.1:3000`, `NODE_ANALYSIS_API_KEY`로 연결합니다. 이 임시 route는 PoC의 loopback 제한도 확인하므로 외부 네트워크에서 직접 호출할 수 없습니다. 배포용 인증 설계가 아닙니다.

## 요청 접수

`POST /api/inspections` — `multipart/form-data`

필수 헤더:

- `X-Analysis-Api-Key`: 서버 간 키
- `Idempotency-Key`: UUID
- `X-Analysis-Consent: true`: 호출한 앱/서버가 사진 보관 및 외부 AI 분석 전송에 대한 사용자 동의를 확인했음을 나타냅니다.

필드:

- `photo`: JPEG, PNG 또는 WebP, 최대 10MB
- `address` 등 다른 현재 Spring 필드는 호환을 위해 받아도 분석 입력으로 사용하지 않습니다. 이 파이프라인은 사진의 보이는 픽셀만 보고 실제 위치를 추론하지 않습니다.

동의가 없으면 사진을 큐에 넣지 않고 400을 반환합니다. 로컬 통합 테스트에서는 사용자가 알고 동의한 경우에만 Spring 설정 `NODE_ANALYSIS_EXTERNAL_IMAGE_CONSENT=true`로 전송을 허용합니다. 이 서버 설정은 최종 사용자 동의 UX를 대체하지 않으며, 배포 전에는 앱 동의 흐름을 별도로 연결해야 합니다.

응답은 `202`와 임시 `inspectionId`, `status`, `riskFactors`를 반환합니다. 동일 요청 키와 동일 이미지는 같은 작업을 반환하며, 동일 키에 다른 사진을 보내면 `409`입니다.

## 상태 / 결과 조회

`GET /api/inspections/{inspectionId}` — 동일한 `X-Analysis-Api-Key` 필요

상태는 `queued`, `processing`, `completed`, `failed` 중 하나입니다. `riskFactors`에는 GPT가 제안한 관찰 후보, 설명, 모델의 임시 판단 근거만 포함합니다. 사람 검토 결과는 별도 데이터라 노출하지 않습니다. `riskSummary.score`는 `null`이며 최종 위험 점수나 확률을 의미하지 않습니다. 현재 후보에는 bbox가 생성되지 않으므로 `bbox: null`입니다. 분석 근거의 원문 응답, 사진 경로, 토큰 응답 원문은 반환하지 않습니다.

## 개인정보와 운영 범위

- 사진 원본과 분석본은 기존 비공개 `private-data` 경로에 저장하고 SQLite를 사용합니다.
- 서버는 이미지, API 키, 모델 응답 원문을 로그에 기록하지 않습니다.
- API 키는 Spring과 분석 서버 사이에서만 사용하며 Android로 전달하지 않습니다.
- 이 route/저장소는 개발용 로컬 연결입니다. 사용자 계정 권한, 여러 서버 배포, 장기 저장 정책, 운영 인증은 별도 설계가 필요합니다.
