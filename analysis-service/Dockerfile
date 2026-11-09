# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/data/models/huggingface HF_HUB_DISABLE_XET=1 \
    PADDLE_HOME=/data/models/paddle PADDLE_PDX_CACHE_HOME=/data/models/paddle
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY analysis-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY analysis-service/app.py analysis-service/test_app.py ./
RUN python -m unittest discover -p 'test_*.py' && python -c "import paddle, torch, transformers; assert not torch.cuda.is_available()" && useradd --create-home --uid 10001 worker && mkdir -p /data && chown worker:worker /data
USER worker
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health',timeout=4)"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--no-access-log"]
