#!/bin/sh
set -eu

SERVICE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON="$SERVICE_ROOT/private-data/.venv-analysis/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "분석 가상환경을 먼저 만들고 analysis-service/requirements.txt를 설치하세요." >&2
  exit 1
fi
if [ -z "${ANALYSIS_VISION_STAGE_KEY:-}" ]; then
  echo "ANALYSIS_VISION_STAGE_KEY 환경 변수가 필요합니다." >&2
  exit 1
fi

mkdir -p "$SERVICE_ROOT/private-data/models/huggingface" "$SERVICE_ROOT/private-data/models/paddle"
export HF_HOME=${HF_HOME:-"$SERVICE_ROOT/private-data/models/huggingface"}
export HF_HUB_DISABLE_XET=${HF_HUB_DISABLE_XET:-1}
export PADDLE_HOME=${PADDLE_HOME:-"$SERVICE_ROOT/private-data/models/paddle"}
export PADDLE_PDX_CACHE_HOME=${PADDLE_PDX_CACHE_HOME:-"$SERVICE_ROOT/private-data/models/paddle"}
exec "$PYTHON" -m uvicorn app:app --app-dir "$SERVICE_ROOT/analysis-service" --host 127.0.0.1 --port 8091
