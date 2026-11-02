# Spring 연동 통합 검사 API v1

기존 실험 API 및 저장 결과는 유지한다. 이 API는 내부 파이프라인을 앱용 JSON으로 변환하는 어댑터다. 모델 교체 시에도 요청/응답 계약은 유지한다.

## 실행

`.env.local`에 NODE_ANALYSIS_API_KEY를 설정한다. Spring의 NODE_ANALYSIS_API_KEY와 같은 값이어야 한다. 키는 앱에 보내지 않는다.

```text
NODE_ANALYSIS_API_KEY=<서버 간 공유 비밀키>
INSPECTION_PUBLIC_BASE_URL=http://127.0.0.1:3000
```

Spring은 NODE_ANALYSIS_BASE_URL=http://127.0.0.1:3000으로 설정한다. Node는 `npm.cmd run dev -- --webpack`으로 실행한다. 이 명령은 분석 워커도 시작하므로 새 접수는 실제 모델 실행 및 OpenAI 비용을 발생시킬 수 있다. `next dev`만 실행하면 HTTP 접수/조회는 가능하지만 작업은 queued 상태로 남는다.

INSPECTION_PUBLIC_BASE_URL은 앱에서 접근 가능한 Node의 기본 주소다. 미설정 시 image.url은 null이다. localhost는 동일 컴퓨터 개발용이며 실제 휴대폰에서 접근할 수 있는 주소가 아니다. 외부 배포·HTTPS·방화벽·사용자 인증은 이 작업에 포함되지 않는다. 기존 실험용 경로까지 포함한 앱 전체를 그대로 공개하지 않는다.

## POST /api/inspections

- 헤더: X-Analysis-Api-Key, Idempotency-Key(UUID)
- Content-Type: multipart/form-data
- photo: JPEG/PNG/WebP 정지 이미지, 최대 10MB, 최대 4천만 픽셀
- address: 선택, 최대 500자
- placeId: 선택 UUID. address와 동시 입력 불가. 존재·소유권 검증은 아직 없음
- locationRole: capture(기본)/sensitive
- compareHistory: true/false, 기본 false

주소 및 장소 ID는 사용자 입력 문맥으로만 보관하며 GPT에 전달하거나 지오코딩하지 않는다. compareHistory=true도 비교 기능이 구현된 것은 아니며 unavailable을 반환한다. 원본 GPS는 존재 여부만 응답하고 실제 좌표를 이 계약에 노출하지 않는다.

202 응답, Location: /api/inspections/{inspectionId}. GET과 같은 결과 구조다. 내부 전처리 후 작업을 큐에 넣으며 모델 완료를 기다리지 않는다.

동일 키+같은 사진/장소/옵션은 같은 ID를 반환한다. 동일 키+다른 입력은 409다. 이미 실패한 모델 분석은 POST를 반복해도 자동 재실행하지 않는다. 관리 화면의 기존 명시적 재시도를 사용한다. 사진 준비 중 프로세스 중단은 5분 후 동일 요청으로 재접수 가능하다. 파일 쓰기 도중 강제 종료로 고아 파일이 남은 경우 운영자 복구가 필요할 수 있다. 삭제한 검사에 사용한 키는 재사용할 수 없다.

## GET /api/inspections/{id}

X-Analysis-Api-Key가 필요하다. 통합 API에서 생성한 기록만 조회할 수 있다.

```json
{
  "schemaVersion": 1,
  "inspectionId": "11111111-1111-4111-8111-111111111111",
  "status": "completed",
  "image": {"url": "https://example.invalid/api/inspections/11111111-1111-4111-8111-111111111111/image?expires=...&signature=...", "width": 1536, "height": 2048, "coordinateSpace": "analysis-normalized"},
  "progress": {},
  "riskSummary": {"score": null, "level": "pending", "reason": "검증된 누적 위험 점수 산정은 아직 지원하지 않습니다."},
  "riskFactors": [{"id":"fusion-0","type":"sign_text","title":"예시 간판","description":"모델 판단 근거","text":"합성 상호","bbox":[0.1,0.2,0.4,0.3],"sources":["ocr","gpt"],"reviewStatus":"unreviewed","modelRisk":"low","humanRisk":null,"relatedToId":null,"assessmentSource":"model_candidate"}],
  "repeatedExposure": {"status":"unavailable","message":"게시 이력 비교는 아직 지원하지 않습니다.","matchedImageIds":[],"samePlaceConfirmed":false},
  "locationContext": {"provided":true,"role":"capture","status":"not_evaluated"},
  "metadata": {"gpsStatus":"missing"},
  "error": null
}
```

- status: queued/processing/completed/failed. 일부 단계라도 실패하면 failed이지만 완료된 부분 결과는 내려준다. completed는 분석 파이프라인 완료이며 누적 점수 계산 완료가 아니다.
- progress: 기존 gpt/ocr/grounding/fusion/objects 단계 상태. 모델 내부 필드이므로 필수 UI 의존은 피한다.
- riskFactors: 모델 유용 후보 또는 사용자 채택 단서. 사용자 제외 단서는 제외한다. modelRisk는 모델 평가이며 최종 점수나 확정 위험도가 아니다. humanRisk와 분리한다.
- bbox: 분석 이미지 기준 0~1의 [x1,y1,x2,y2]. 사용자 채택·수정 bbox가 있으면 반영한다. GPT 단독과 GPS는 null.
- relatedToId: 같은 사진의 관련 후보라는 기존 휴리스틱 표시다. 동일 대상 확정이나 누적 비교가 아니다.
- repeatedExposure.status: unavailable 또는 not_requested.
- image.url은 원본이 아닌 분석 이미지의 15분 만료 서명 URL이다. 링크를 가진 사람은 만료 전 이미지를 볼 수 있으므로 로그/공유를 피한다. 만료 후 결과를 다시 조회한다.

## GET /api/inspections/{id}/image

분석 JPEG 전용이다. 서버 접근 키 또는 만료 시각+HMAC 서명이 필요하다. 원본 이미지는 반환하지 않는다. 응답 Cache-Control: no-store.

## 오류

`{"error":{"code":"INVALID_REQUEST","message":"..."}}`

400 입력/이미지 오류, 401 키·서명 오류, 404 검사 없음, 409 요청 키 충돌, 413 용량 초과, 415 multipart 형식 오류, 503 키·이미지 URL 설정 없음/오류, 500 내부 오류.

## 저장·검증

SQLite inspection_requests 테이블은 요청 키, 내부 record_id, 입력 해시, 사용자 입력 문맥, GPS 존재 상태, 준비 작업 임대를 저장한다. 모델 원본과 사람 검토는 기존 discovery_records에 유지한다. 사용자별 접근 권한은 아직 없으며 공유 키 기반 단일 사용자 개발 연동이다.

`node --conditions=react-server tests/inspections-api.cjs`는 임시 DB와 모의 모델을 사용한다. 실제 OpenAI 비용을 발생시키지 않는다.

## 검증 기록 (2026-10-29)

- 통합 API 계약 테스트: 통과. 임시 SQLite, 합성 이미지, 모의 모델 사용. 인증·동시 요청 중복 방지·입력 변경 충돌·이미지 서명·결과 변환·부분 실패 확인.
- 기존 parallel-pipeline 및 local-workflow 테스트: 이전 구현 턴에서 통과. 기존 병렬 실행·저장·재시도 동작 보존 확인.
- 실제 로컬 Spring → Node HTTP: 이전 구현 턴에서 사진 접수 202, 조회 200, 동일 키 재요청 202, 다른 입력 409, 서명 이미지 200 확인. 워커는 비활성화했으므로 실제 모델 분석을 실행하지 않음.
- 최종 lint / typecheck / git diff --check: 통과. 별도 빌드 산출물 `.next-inspections`를 ESLint에서 제외하는 설정 누락 수정.
- 프로덕션 빌드: 미통과. 번들 컴파일·타입 검사는 통과했으나 정적 페이지 생성의 폴더 생성에서 Windows EPERM 발생. 원본 OneDrive 경로와 별도 Documents 작업 경로에서 재현됨. 코드 오류라고 단정하거나 배포 빌드 통과로 취급하지 않음.
- Next.js 도구가 현재 설치 버전에 보안 업데이트 알림을 출력함. 이번 작업에서 의존성 업그레이드는 수행하지 않음.
