"""Local OCR and open-vocabulary object detection sidecar for the PoC API."""
from __future__ import annotations

import asyncio
import hmac
import io
import os
import threading
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000
DETECTOR_ID = os.getenv("GROUNDING_DINO_MODEL", "IDEA-Research/grounding-dino-tiny")
DETECTOR_REVISION = os.getenv("GROUNDING_DINO_REVISION", "a2bb814dd30d776dcf7e30523b00659f4f141c71")
OCR_MODEL = "PaddleOCR 3.7.0 / PP-OCRv5_server_det + korean_PP-OCRv5_mobile_rec"
DETECTION_THRESHOLD = float(os.getenv("GROUNDING_DINO_THRESHOLD", "0.25"))
PROMPT_LABELS = [
    "store sign", "street sign", "building facade", "landmark", "bus",
    "vehicle", "license plate", "menu board", "logo", "billboard",
    "window", "shopfront",
]

Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(title="KkokKkok local vision stages", docs_url=None, redoc_url=None)
_ocr_lock = threading.Lock()
_detector_lock = threading.Lock()


@lru_cache(maxsize=1)
def _ocr_engine():
    from paddleocr import PaddleOCR

    return PaddleOCR(
        lang="korean",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


@lru_cache(maxsize=1)
def _detector():
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    processor = AutoProcessor.from_pretrained(DETECTOR_ID, revision=DETECTOR_REVISION)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(
        DETECTOR_ID, revision=DETECTOR_REVISION, use_safetensors=True,
    ).to(device)
    model.eval()
    return processor, model, device


def _open_image(data: bytes) -> Image.Image:
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "이미지 크기는 10MB 이하여야 합니다.")
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in {"JPEG", "PNG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
            raise HTTPException(415, "정지 JPEG, PNG, WebP만 지원합니다.")
        if image.width * image.height > MAX_PIXELS:
            raise HTTPException(413, "이미지는 4,000만 픽셀 이하여야 합니다.")
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.load()
        return image
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "이미지를 읽을 수 없습니다.") from None


def _rect(points: object, width: int, height: int) -> list[float] | None:
    try:
        xs = [float(point[0]) for point in points]  # type: ignore[index]
        ys = [float(point[1]) for point in points]  # type: ignore[index]
        left = max(0.0, min(xs) / width)
        top = max(0.0, min(ys) / height)
        right = min(1.0, max(xs) / width)
        bottom = min(1.0, max(ys) / height)
        if left >= right or top >= bottom:
            return None
        return [round(left, 6), round(top, 6), round(right, 6), round(bottom, 6)]
    except (TypeError, ValueError, IndexError):
        return None


def _ocr(image: Image.Image) -> list[dict]:
    import numpy as np

    with _ocr_lock:
        results = _ocr_engine().predict(input=np.asarray(image))
    lines: list[dict] = []
    for result in results or []:
        payload = getattr(result, "json", result)
        if callable(payload):
            payload = payload()
        payload = payload.get("res", payload) if isinstance(payload, dict) else {}
        texts = payload.get("rec_texts") or []
        scores = payload.get("rec_scores") or []
        boxes = payload.get("rec_polys") or payload.get("dt_polys") or []
        for index, text in enumerate(texts):
            text = str(text).strip()
            if not text:
                continue
            box = _rect(boxes[index], image.width, image.height) if index < len(boxes) else None
            if box is None:
                continue
            score = float(scores[index]) if index < len(scores) else None
            lines.append({"text": text[:300], "confidence": round(score, 4) if score is not None else None, "bbox": box})
            if len(lines) >= 100:
                return lines
    return lines


def _detect(image: Image.Image) -> list[dict]:
    import torch

    processor, model, device = _detector()
    inputs = processor(images=image, text=" . ".join(PROMPT_LABELS), return_tensors="pt").to(device)
    with _detector_lock, torch.inference_mode():
        outputs = model(**inputs)
    result = processor.post_process_grounded_object_detection(
        outputs, inputs.input_ids, threshold=DETECTION_THRESHOLD,
        target_sizes=[(image.height, image.width)],
    )[0]
    items: list[dict] = []
    for label, score, box in zip(result.get("text_labels", result.get("labels", [])), result["scores"], result["boxes"]):
        coords = [float(value) for value in box.tolist()]
        normalized = _rect(
            [[coords[0], coords[1]], [coords[2], coords[1]], [coords[2], coords[3]], [coords[0], coords[3]]],
            image.width, image.height,
        )
        if normalized is not None:
            items.append({"label": str(label)[:120], "confidence": round(float(score), 4), "bbox": normalized})
        if len(items) >= 60:
            break
    return items


def _authorized(value: str | None) -> bool:
    expected = os.getenv("ANALYSIS_VISION_STAGE_KEY", "").strip()
    return bool(expected and value and hmac.compare_digest(expected.encode(), value.encode()))


@app.get("/health")
async def health():
    return {"status": "ready", "ocr": OCR_MODEL, "objectDetection": f"{DETECTOR_ID}@{DETECTOR_REVISION}"}


@app.post("/v1/stages")
async def run_stages(request: Request):
    if not _authorized(request.headers.get("x-analysis-stage-key")):
        raise HTTPException(401, "인증에 실패했습니다.")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "JPEG, PNG, WebP 이미지가 필요합니다.")
    size = 0
    chunks = []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(413, "이미지 크기는 10MB 이하여야 합니다.")
        chunks.append(chunk)
    image = _open_image(b"".join(chunks))

    async def run_stage(name: str, function):
        try:
            result = await run_in_threadpool(function, image)
            return {"status": "completed", "items": result}
        except Exception:
            return {"status": "failed", "items": [], "error": f"{name} 단계 실행에 실패했습니다."}

    ocr, detection = await asyncio.gather(
        run_stage("OCR", _ocr), run_stage("객체 탐지", _detect),
    )
    return {
        "pipelineVersion": "local-vision-stages-v1",
        "image": {"width": image.width, "height": image.height, "coordinateSpace": "analysis-normalized-tlbr"},
        "ocr": {"model": OCR_MODEL, **ocr},
        "objectDetection": {"model": f"{DETECTOR_ID}@{DETECTOR_REVISION}", "threshold": DETECTION_THRESHOLD, **detection},
    }
