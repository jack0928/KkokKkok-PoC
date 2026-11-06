"""Local inference. Image bytes on stdin, a single JSON result on stdout."""
import hashlib
import io
import json
import os
import sys
import time
from datetime import datetime, timezone


def main():
    started = time.monotonic()
    prompt = sys.argv[1]
    if not 3 <= len(prompt) <= 400:
        raise ValueError("Invalid prompt")
    box_threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
    text_threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
    if not (0.1 <= box_threshold <= 0.9 and 0.1 <= text_threshold <= 0.9):
        raise ValueError("Invalid thresholds")
    data = sys.stdin.buffer.read(12 * 1024 * 1024)
    # Libraries may print progress; reserve stdout exclusively for the protocol.
    with __import__("contextlib").redirect_stdout(sys.stderr):
        import torch
        import transformers
        from PIL import Image
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        model_id = "IDEA-Research/grounding-dino-tiny"
        device = "cuda" if torch.cuda.is_available() else "cpu"
        revision = "a2bb814dd30d776dcf7e30523b00659f4f141c71"
        processor = AutoProcessor.from_pretrained(model_id, revision=revision)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id, revision=revision, use_safetensors=True)
        model.config.disable_custom_kernels = True
        model.to(device).eval()
        image = Image.open(io.BytesIO(data)).convert("RGB")
        inputs = processor(images=image, text=prompt, return_tensors="pt").to(device)
        with torch.inference_mode():
            predictions = model(**inputs)
        result = processor.post_process_grounded_object_detection(
            predictions, inputs.input_ids, threshold=box_threshold, text_threshold=text_threshold,
            target_sizes=[image.size[::-1]],
        )[0]
        labels = result.get("text_labels", result.get("labels"))
        detections = []
        for box, score, label in zip(result["boxes"], result["scores"], labels):
            x1, y1, x2, y2 = box.tolist()
            bbox = [max(0, min(1, n / s)) for n, s in zip((x1, y1, x2, y2), image.size * 2)]
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1] or not str(label).strip():
                continue
            detections.append({"id":f"dino-{len(detections)}", "label":str(label), "score":float(score), "bbox":bbox})
        # Conservative same-label NMS; retain suppressed raw proposals for audit.
        kept, duplicates = [], []
        def iou(a, b):
            intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
            union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection
            return intersection / union if union else 0
        for detection in sorted(detections, key=lambda d: d["score"], reverse=True):
            duplicate = any(d["label"].strip().lower() == detection["label"].strip().lower() and iou(d["bbox"], detection["bbox"]) >= 0.85 for d in kept)
            (duplicates if duplicate else kept).append(detection)
        detections = kept
        output = {"engine":"Grounding DINO", "schemaVersion":1, "model":model_id,
                  "revision":model.config._commit_hash or "unknown", "transformersVersion":transformers.__version__,
                  "device":device, "prompt":prompt, "boxThreshold":box_threshold, "textThreshold":text_threshold,
                  "coordinateSpace":"analysis-normalized", "analysisSha256":hashlib.sha256(data).hexdigest(),
                  "analyzedAt":datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                  "elapsedMs":round((time.monotonic()-started)*1000), "detections":detections, "duplicateDetections":duplicates}
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Input image, prompt and model output must not appear in server logs.
        sys.stderr.write("Grounding DINO inference failed; check runtime/model cache.\n")
        sys.exit(1)
