# 사진 검색·부분 대응 프로토타입

멘토링에서 파이프라인의 실제 동작을 보여주기 위한 별도 로컬 실험이다. 기존 Experiment 1 앱과 DB는 변경하지 않는다. Experiment 2의 Annotation·Matching 평가 기능도 구현하지 않는다.

## 지금 동작하는 부분

```text
새 사진 + 과거 사진 폴더
 → 메타데이터 제거·방향/크기 정규화
 → DINOv2-small 이미지 벡터 추출
 → 코사인 유사도 상위 K장 검색
 → DISK 특징 추출 + LightGlue 대응점 연결
 → Homography RANSAC 검증
 → 검색 순서·대응점·판정 보류를 로컬 HTML로 표시
```

무작위 모델이나 모의 응답이 아니라 공개 사전학습 가중치를 실행한다. GPT API 호출, 단서 추출, 반복·추가 단서 자동 결합, 위치 식별 유용성 평가는 아직 연결하지 않았다. 따라서 전체 누적 분석 기능이 완성된 것은 아니다.

독립 실행을 위해 전처리는 Pillow로 구현했다. 기존 Sharp 전처리와 보안·크기 원칙은 같지만 JPEG 바이트와 hash가 같다고 가정하지 않으며 기존 DB의 이미지나 캐시를 자동으로 연결하지 않는다.

## 설치

Python 3.13, Node.js 및 Git이 필요하다. 프로젝트 루트에서 실행한다.

```sh
python3 -m venv .venv-pipeline
.venv-pipeline/bin/python -m pip install -r prototype/requirements.txt
```

프로젝트 전용 가상 환경을 사용하며 기존 Node 패키지는 바꾸지 않는다. 가상 환경과 모델 파일에는 별도의 디스크 공간이 필요하다. 첫 실행은 공개 모델 다운로드를 위해 인터넷 연결이 필요하다. 이미지 자체는 외부 서버에 보내지 않는다. 다운로드 요청에는 모델 제공자의 일반적인 네트워크 접속 정보가 전달된다.

LightGlue 코드는 commit으로 고정했다. Embedding은 기본적으로 `facebook/dinov2-small`의 `main`을 최초 사용하며 실제 commit hash를 보고서에 저장한다. 재현 실행 시 `--revision <보고서의 embeddingRevision>`으로 고정할 수 있다. 부분 매칭 가중치의 SHA-256과 라이브러리 버전도 결과 JSON에 남긴다. 각 모델의 라이선스는 원본 저장소·모델 카드에서 확인한다.

## 가장 빠른 시연

```sh
npm run pipeline:demo
```

시연용 합성 도형을 만들고 실제 모델로 처리한다. 개인 사진이나 기존 PoC DB를 읽지 않는다. 포함된 자료는 다음과 같다.

- 같은 도형의 시점 변환과 패널 추가: 대응 확인용.
- 같은 배치지만 무늬가 다른 도형: 공통 디자인에 의한 오대응 관찰용.
- 관련 없는 원형 도형: 대응 근거 부족 사례용.
- 새 사진의 복사본: 동일 이미지 제외 동작 확인용.

이 입력의 생성 관계는 보고서에 따로 표시되며 모델의 검색·판정에는 사용하지 않는다. 합성 도형의 결과는 실제 장소·SNS 사진에서의 정확도를 입증하지 않는다.

생성된 파일을 브라우저로 연다.

```sh
open private-data/pipeline/latest-report.html
```

가중치를 한 번 받은 뒤에는 네트워크 없는 시연이 가능하다.

```sh
npm run pipeline:demo -- --offline
```

HTML에는 이미지가 포함되어 있으므로 HTML을 여는 데 Next.js 서버나 Python 서버는 필요 없다. 입력을 바꿔 다시 분석하려면 명령어를 재실행하고 브라우저를 새로고침한다. 업로드 UI는 없다.

## 본인 사진으로 실행

사용 권한이 있는 정지 JPEG/PNG/WebP만 사용한다. 장당 10 MB, 4,000만 픽셀 이하이며 과거 사진 폴더의 최상위 파일을 최대 100장 읽는다. 지원 확장자인데 손상·형식 오류가 있으면 실패로 표시하고 중단한다. 하위 폴더는 읽지 않는다.

일부 휴대폰 JPEG는 보조 이미지 때문에 Pillow에서 MPO로 인식된다. 이 경우 JPEG 컨테이너의 첫 번째 이미지만 사용하고 보조 이미지·메타데이터는 분석본에서 제거한다. 원본 파일은 수정하지 않는다. 처리한 이미지 수는 JSON의 `primaryJpegOnlyCount`에 기록한다. 이 호환 처리는 독립 프로토타입에만 적용하며 기존 Feature Discovery 업로드의 지원 범위는 변경하지 않는다.

```sh
npm run pipeline:run -- \
  --query /절대/경로/새사진.jpg \
  --gallery /절대/경로/과거사진폴더 \
  --k 5 \
  --offline
```

최초 다운로드 전이면 `--offline`을 빼고 실행한다. K는 1~20이며 유효한 과거 사진이 K보다 적으면 존재하는 사진만 비교한다. 원본 hash 또는 전처리 결과 hash가 같은 사진은 새 사진 자신 및 과거 사진 간 중복에서 제외한다. 다른 크기·압축으로 재인코딩된 유사 중복을 모두 제거하는 기능은 아니다.

기본 실행 장치는 CPU이다. Apple Silicon에서도 우선 CPU를 사용하며 MPS 가속은 검증하지 않았다. NVIDIA CUDA 환경이 준비되어 있다면 `--device cuda`를 지정할 수 있으나 해당 경로는 이 PC에서 검증하지 않았다. `--device auto`는 CUDA가 있으면 CUDA, 없으면 CPU를 선택한다.

## 화면 읽는 방법

- 검색 유사도: 전체 이미지 벡터의 코사인 유사도. 같은 장소일 확률이 아니다.
- 대응점: DISK + LightGlue가 연결한 작은 특징의 수.
- 검증 통과: 하나의 투영 변환으로 설명할 수 있는 대응점의 수.
- 분포 면적: 통과 대응점들의 볼록 껍질 면적 비율. 실제 배경 일치 면적이 아니다.
- 초록 선: 검증을 통과한 대응점 중 최대 60개만 표시.

`시각적 대응 근거 있음`은 다음 잠정 조건을 모두 통과했다는 뜻이다.

- 검증 통과점 12개 이상
- 대응점 중 통과 비율 35% 이상
- 양쪽 이미지에서 대응점 분포 면적 각각 2% 이상

조건은 `--min-inliers`, `--min-ratio`, `--min-coverage`로 바꿀 수 있다. 모델 confidence를 위험도로 바꾸지 않으며 임계값은 아직 평가 데이터로 보정하지 않았다. 후보는 원래 검색 순서로 표시하고 통과한 후보를 위로 재정렬하지 않는다.

같은 물건·포스터·반복 무늬도 대응할 수 있다. 반대로 겹치는 배경이 없거나 비평면 장면·큰 시점 변화에서는 관련 사진을 놓칠 수 있다. 근거 부족은 다른 장소라는 판정이 아니다. 이 화면으로 실제 장소 일치·노출 확률·위험 증가를 확정하지 않는다.

검색용 DINOv2는 기본 processor의 짧은 변 256px resize와 중앙 224×224 crop을 사용한다. 따라서 가장자리 단서가 검색에서 누락될 수 있다. 부분 매칭은 중앙 crop이 아닌 전체 분석본을 최대 변 960px로 줄여 사용한다. 배경 전용 검색이나 여러 crop의 결합은 구현하지 않았다.

## 보관 및 재실행

```text
private-data/pipeline/
  models/                  공개 모델 캐시
  cache/                   분석본 hash + 모델·설정별 Embedding 캐시
  demo-inputs/             합성 입력
  runs/<실행ID>/
    report.html            이미지가 포함된 비교 보고서
    report.json            hash·설정·점 좌표·시간·수치 (원본 경로/파일명 없음)
  latest-report.html       가장 최근 성공한 보고서 사본
```

원본은 이 프로토타입에서 복사·보관하지 않는다. 비교 보고서에는 전처리 이미지가 포함되고, 캐시에는 파생 벡터가 남는다. 실제 사진으로 만든 보고서·벡터·JSON도 민감한 실험 자료로 취급한다. 모두 Git과 공개 정적 경로에서 제외한다. 모델에 실제 이미지의 EXIF/GPS를 전달하거나 위치 추론에 사용하지 않는다. 입력·모델 응답·Secret을 로그로 출력하지 않는다.

같은 분석본과 같은 Embedding 모델·revision·설정은 벡터 캐시를 재사용한다. 매번 CLI를 실행할 때 모델을 불러오고 부분 매칭은 다시 계산한다. 화면에 모델 준비·특징 추출/검색·부분 매칭 시간을 구분한다. 실패 시 이전 성공 보고서는 그대로 남으므로 새 성공 메시지와 생성 시각을 확인한다.

## 검증

```sh
npm run pipeline:test
npm run pipeline:demo -- --offline
npm run lint
npm run typecheck
npm run build
npm run test:workflow
```

단위 테스트는 이미지 메타데이터·방향·투명도·크기·입력 오류와 기하 검증의 긍정/부정 사례를 확인하며 모델 다운로드와 GPT API 호출을 하지 않는다. 합성 데모는 실제 사전학습 모델의 실행 검증이다. 실제 사진의 검색·연결 성능 평가와 실제 GPT API 검증은 별도로 수행해야 한다.

## 참고

- [전체 방법론과 미확정 사항](../pipeline.md)
- [DINOv2 공식 모델 카드](https://huggingface.co/facebook/dinov2-small)
- [DINOv2 특징 추출 문서](https://huggingface.co/docs/transformers/model_doc/dinov2)
- [LightGlue 공식 코드](https://github.com/cvg/LightGlue)
- [OpenCV 특징 매칭·Homography 설명](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html)
