# 주소 기반 거리뷰 비교 — 독립 로컬 웹앱

기존 `pipeline.py`, Next.js 앱, npm 스크립트, 8765 보고서 서버를 변경하지 않는 별도 확장이다. 사용자가 제공한 참조 주소를 이용하며, 사진의 실제 주소·거주지를 추론하거나 확정하지 않는다. GPT를 호출하지 않는다.

## 실행

기존 `.venv-pipeline`과 다운로드된 DINOv2·DISK·LightGlue 모델을 사용한다. 추가 Python 패키지는 없다. PowerShell에서 프로젝트 루트 기준:

```powershell
$env:GOOGLE_MAPS_API_KEY = '본인의 Google Maps API 키'
.\.venv-pipeline\Scripts\python.exe -X utf8 prototype/streetview_web/server.py
```

키를 실제로 입력한 명령은 터미널 history에 남을 수 있다. 기존 비공개 `.env.local`에 `GOOGLE_MAPS_API_KEY`를 직접 설정하는 방법도 지원한다. 앱이 그 파일을 작성하거나 변경하지는 않는다. 키를 브라우저 코드·공개 파일·Git에 넣지 않는다. 선택적으로 `GOOGLE_MAPS_SIGNING_SECRET`을 서버에 설정하면 URL 서명을 사용한다. Google Cloud에서 Street View Static API 활성화·결제 설정·키 제한을 준비해야 한다.

`http://127.0.0.1:8766`을 연다. 필요하면 `--port 8767`로 변경한다. localhost가 아닌 `127.0.0.1` 주소를 사용한다. 종료는 `Ctrl+C`다. 8765 서버와 동시에 실행할 수 있다.

## 사용과 처리 흐름

1. 정지 JPEG/PNG/WebP 사진 1~5장 선택(장당 10MB, 4,000만 픽셀 이하).
2. 주소 검색 또는 특정 거리뷰 지정을 선택한다. 원본 EXIF/GPS는 주소 입력에 사용하지 않는다.
3. 주소의 Google 전송·이미지 요청 비용 안내 확인 후 비교 시작.
4. 로컬 입력 검증·모델 준비 후 Google metadata에서 파노라마 확인. 주소 검색은 기본적으로 실내를 포함하며 야외만으로 제한할 수도 있다.
5. **동일한 pano ID**로 heading 0/90/180/270, fov 90, pitch 0, 640×640 이미지 네 장 요청.
6. 각 업로드 사진과 네 방향의 DINOv2 유사도를 계산하고 **네 방향 모두** DISK·LightGlue·Homography 검증.
7. 업로드 사진별로 유사도순 결과와 통과점 최대 60개 표시.

기존 CLI의 `--query`에 해당하는 사진을 여러 번 처리하고 네 방향 이미지를 공통 `--gallery`로 사용하는 것과 같은 역할이다. 명령 문자열이나 사용자 경로를 shell로 실행하지 않고 기존 `prepare`, `Models.local`, `Models.match`, `geometry`를 직접 재사용한다. DINOv2 추론은 기존 CLS·L2 방식이며 디스크 벡터 캐시를 사용하지 않는다. 기본 기하 임계값도 기존과 같다. 결과가 동일 장소·사용자의 거주지·위험도 확정을 뜻하지 않는다.

## 특정 실내 거리뷰 사용

주소만으로는 원하는 실내·층·촬영 지점을 고를 수 없다. **특정 거리뷰 지정 · 실내 권장**을 선택한 뒤 Google Maps 거리뷰 전체 링크 또는 파노라마 ID를 입력한다. `google.com`, `google.co.kr`의 전체 링크와 직접 ID를 지원하며 단축 URL은 직접 따라가지 않는다.

전달받은 중앙대 310관 내부 파노라마는 **전달한 중앙대 310관 실내 거리뷰 선택** 버튼으로 ID `CIHM0ogKEICAgIDq3c3y1gE`를 채울 수 있다. 이 버튼은 해당 ID만 입력하며 API에서 실제 제공되는지는 별도 확인한다. 특정 파노라마 요청에는 야외 필터를 사용하지 않으며, API에서 사용할 수 없거나 다른 ID가 반환되면 중단한다. 주소 검색으로 자동 대체하지 않는다.

Google Maps 웹에서 볼 수 있는 사용자 기여 사진도 Static API에서 제공되지 않을 수 있다. 이 경우 API 제공 불가 안내를 표시하며, 비공식 이미지 추출은 하지 않는다. 링크를 붙여넣는 것은 주소·좌표를 추론하는 기능이 아니다.

## 데이터와 비용

- 업로드 사진은 이 PC에서 처리하며 Google·OpenAI로 전송하지 않는다. 입력 주소 또는 파노라마 ID는 Google로 전송된다.
- metadata 1회와 이미지 최대 4회 요청. 중간 실패 시에도 이미 성공한 이미지 요청은 비용이 발생할 수 있다. 자동 재시도 없음. 청구액은 계정 요금·할당량에 따른다.
- 사용자가 해당 자동 분석 용도의 별도 허가를 확보했다고 확인한 전제로 만든 기능이다. 일반 API 키 발급만으로 저장·파생 사용까지 허용되는 것은 아니다. 실제 계약 조건과 Google 출처 표시 조건을 따른다.
- Google 이미지·Embedding·비교 결과는 영구 파일로 저장하지 않는다. 전처리에 필요한 원본 임시 파일만 `private-data/streetview-web/runtime/` 아래 생성 후 정상·예외 종료 시 제거한다. 프로세스 강제 종료 시 임시 파일이 남을 가능성은 있다.
- 완료 결과는 서버 메모리에 최근 최대 5회만 유지한다. 서버 종료 시 사라진다. 페이지 새로고침으로 결과를 자동 복원하지 않는다.
- 기존 `latest-report.html`, `runs`, 회차 목록·코멘트·DB는 수정하지 않는다. 공개 배포나 팀 인증을 제공하지 않는다.
- 주소에 가장 가까운 파노라마가 원하는 촬영 위치와 다를 수 있다. 네 방향은 같은 촬영 지점의 방향 변화다. 촬영 시점·시야·가림·공통 디자인 차이로 오연결·놓침이 생길 수 있다.

## 검증

```powershell
.\.venv-pipeline\Scripts\python.exe -X utf8 -m unittest discover -s prototype/streetview_web -p 'test_*.py'
```

이 테스트는 Google 응답을 모의 처리하며 실제 Google API·과금 검증이 아니다. 모델 캐시가 없으면 기존 합성 데모로 먼저 준비한다. 실제 API 검증은 본인 키와 주소로 별도 수행해야 한다.

실제 로컬 모델과 합성 참조 이미지의 연결 확인(Google 호출 없음):

```powershell
$env:RUN_STREETVIEW_MODEL_TEST = '1'
.\.venv-pipeline\Scripts\python.exe -X utf8 -m unittest discover -s prototype/streetview_web -p 'test_engine.py'
Remove-Item Env:RUN_STREETVIEW_MODEL_TEST
```

키가 없는 상태로 8766 서버를 실행한 뒤, 별도 터미널에서 다음 UI 검증을 실행할 수 있다. Node.js와 Chrome이 필요하며 Google API 응답을 브라우저 안에서 모의 처리한다.

```powershell
node prototype/streetview_web/test_browser.cjs
```

최초 작성 시 기존 프로토타입 테스트 25개와 실제 오프라인 모델 합성 비교를 통과했다. 실내 지정 확장 후 기본 테스트 15개 통과(실제 모델 테스트 1개는 기본 실행에서 제외), 브라우저 주소/실내 파노라마 전환·중앙대 ID 선택·네 방향 결과·모바일 표시 검증 통과. 루트 lint·typecheck·build 통과. 현재 서버 설정에서 Google API 키가 확인되지 않아 전달받은 실내 파노라마의 실제 API 제공 여부·결제·실제 거리뷰 비교 품질은 검증하지 못했다. Google 관련 자동 테스트는 모의 응답이다.
