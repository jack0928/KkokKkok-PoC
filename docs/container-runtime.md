# 컨테이너 실행 환경

기존 API와 worker를 한 이미지에서 실행합니다. 현재는 작업 SQLite와 사진을 `/data`의 전용 영속 volume에 저장하며, 같은 volume의 worker는 한 개만 실행합니다. 컨테이너 간 단일 worker는 Linux `flock`으로 제한하고 강제 종료 후 재생성 시 남은 PID 잠금 파일을 안전하게 제거합니다. 실행 중이던 분석은 기존 정책대로 실패 처리하며 비용이 발생했을 수 있어 자동 재요청하지 않습니다.

```sh
docker build -t kkokkkok-analysis:local .
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env.local \
  -v kkokkkok-analysis-data:/data kkokkkok-analysis:local
```

기존 `.env.local`이 있으면 실제 AI 요청 비용이 발생할 수 있습니다. 무료 기동 확인은 OpenAI 키 없이 `/api/health`만 조회하세요. health는 프로세스 생존 확인이며 모델·키·추론 품질 검증을 의미하지 않습니다. 키·실제 사진·결과·로컬 DB는 이미지 빌드에 포함하지 않습니다.

`ANALYSIS_BIND_HOST`는 컨테이너에서 `0.0.0.0`, 일반 로컬 실행에서는 `127.0.0.1`입니다. 내부 서버 간 호출은 `ANALYSIS_API_HOSTS=analysis:3000`처럼 허용할 HTTP Host를 명시하고 기존 X-Analysis-Api-Key 인증을 함께 사용합니다. Origin이 있는 내부 호스트 요청은 차단하며 실험용 웹 화면·기록 API는 계속 localhost에서만 접근합니다. 공개 경로는 Spring API로 제한하고 이 분석 포트는 내부 네트워크에서만 연결해야 합니다.

## OCR·객체 탐지 서버

PaddlePaddle 3.3.1의 Linux ARM wheel이 없어 분석 보조 이미지는 Linux amd64를 대상으로 합니다. 기존 Mac 설치 환경은 변경하지 않습니다.

```sh
docker build --platform linux/amd64 -f analysis-service/Dockerfile -t kkokkkok-vision:cpu .
docker run --rm --platform linux/amd64 --env-file .env.local \
  -v kkokkkok-vision-models:/data kkokkkok-vision:cpu
```

CPU PyTorch를 사용하며 모델 캐시는 `/data/models`에 보관합니다. 실제 모델 실행 시 공개 모델 다운로드가 필요합니다. 현재 GPU 실행 이미지는 포함하지 않으며 CUDA·드라이버 조합과 GPU 성능은 실제 서버 선정 후 검증합니다. ARM Mac에서 amd64 에뮬레이션으로 측정한 시간은 실제 EC2의 성능 지표로 사용할 수 없습니다.
