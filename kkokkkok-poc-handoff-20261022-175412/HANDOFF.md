# 꼭꼭 PoC 비공개 실험 자료 인계

대응 코드 commit: 1731791 (별도 Git 레포에서 받으세요.)
이 ZIP에는 실제 사진과 사진이 포함된 보고서가 있습니다. 접근 제한된 팀 채널로만 전달하세요.
ZIP 자체는 암호화되지 않았습니다. API 키, 환경 파일, 앱 DB, 제안서, 모델 캐시와 가상 환경은 포함하지 않았습니다.

1. 레포 루트에서 압축을 풀어 private-data/ 경로를 유지하세요. 기존 자료가 있다면 덮어쓰기 전에 백업하세요.
2. prototype/README.md에 따라 npm ci와 Python 가상 환경 설치를 진행하세요.
3. npm run pipeline:reports
4. npm run pipeline:reports:serve 실행 후 http://127.0.0.1:8765 에 접속하세요.

보고서 조회에는 모델 실행이나 GPT API 호출이 필요하지 않습니다.
재실행할 때는 diagnostic-config.json, region-config.json, region-experiments/*/manifest.json의
이전 PC 절대 경로를 현재 PC의 사진 경로에 맞추세요. 모델 가중치는 각자 다운로드해야 합니다.
GPT 실험을 다시 실행할 때만 각자의 .env.local에 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요.
원본 실험 결과와 GPT 의견, 사람 검토는 별도로 유지하고 덮어쓰지 마세요.

포함: 실제 테스트 사진, 회차 결과·검토, 초기 묶음 결과·평가, 이름·코멘트,
진단 설정, 영역 제안 준비 자료, 존재하는 합성 데모 입력.
index/review 페이지는 위 명령으로 재생성합니다.
