# 꼭꼭 PoC 개발 원칙

- 이 프로젝트는 Product MVP가 아닌 Location Cue Detection 실험용 PoC다. 범위를 임의로 확대하지 않는다.
- 현재 구현 범위는 Experiment 1 Feature Discovery만이다. Taxonomy 편집/버전 관리 UI, Experiment 2는 구현하지 않는다.
- VLM 결과는 Ground Truth가 아닌 Feature 후보다. VLM 원본과 Human Review를 분리하고 원본을 덮어쓰지 않는다.
- Risk Level은 **외부 정보와 결합했을 때 실제 촬영 위치를 좁히거나 특정하는 데 해당 Feature가 얼마나 유용한가**를 뜻한다. 시각적 현저성이나 detection confidence가 아니다.
- `modelRisk`와 `humanRisk`, 모델 이유와 사람 이유를 따로 저장한다. 미검토 사람 위험도는 null이다.
- 실제 촬영 위치/주소/지역/좌표 추론, SNS 연동, Profile, 편집, Clustering을 추가하지 않는다.
- 향후 Experiment 2는 별도 데이터로 Human Annotation → 확정 → VLM Detection 순서를 지키고 매칭은 사람이 수행한다. Human Annotation을 모델에 보내지 않는다.
- API Key는 server-side 환경변수로만 사용한다. 모델명은 `OPENAI_MODEL`로 설정하며 코드에 fallback을 고정하지 않는다.
- Secret, 제안서, 실제 사진, 실험 결과, private-data를 commit하지 않는다. 이미지/입력/모델 응답을 서버 로그에 출력하지 않는다.
- 원본/분석 이미지를 서버 디스크나 localStorage에 보존하지 않는다. 사용자 요청에 따라 결과 확인용 최대 480px JPEG 미리보기만 로컬 SQLite에 보존한다. 브라우저 메모리의 분석 Preview와 DB 미리보기·결과 기록을 구분한다.
- 변경 후 `npm run lint`, `npm run typecheck`, `npm run build` 및 해당 기능의 기본 동작을 검증한다. 실제 API와 모의 응답 검증은 구분해서 보고한다.
- 사용자 명시 요청 없이 commit 또는 push하지 않는다. Git history/remote를 임의로 변경하지 않는다.

## Git Convention

Codex가 향후 commit을 요청받으면 반드시 Conventional Commits 기반 `<type>: <description>` 형식을 사용한다. 메시지는 영어이며 한 commit은 가능한 한 하나의 논리적인 변경을 담는다.

허용 type: `feat` (새 기능), `fix` (버그), `refactor` (동작 변경 없는 코드 개선), `docs` (문서), `style` (UI/CSS), `test` (테스트), `chore` (설정/패키지).

예: `feat: add feature discovery page`, `fix: handle invalid image uploads`.

commitlint, Husky, GitHub Actions, Issue Template, Branch Protection은 현재 범위에서 제외한다.
