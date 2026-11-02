"""Read a normalized analysis JPEG from stdin; emit only bounded JSON on stdout."""
import contextlib
import io
import json
import sys
from importlib.metadata import version

def extract(content):
    # Paddle logs can contain recognition output: discard instead of forwarding.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        import numpy as np
        from PIL import Image
        from paddleocr import PaddleOCR
        image = Image.open(io.BytesIO(content)).convert("RGB")
        width, height = image.size
        model = PaddleOCR(lang="korean", ocr_version="PP-OCRv5", device="cpu",
            use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_textline_orientation=False)
        results = list(model.predict(np.array(image)[:, :, ::-1]))
        if len(results) != 1:
            raise ValueError("Expected one result")
        data = results[0].json["res"]
    texts, scores, polygons = data["rec_texts"], data["rec_scores"], data["rec_polys"]
    if not (len(texts) == len(scores) == len(polygons)) or len(texts) > 500:
        raise ValueError("Invalid result size")
    lines = []
    for index, (text, score, polygon) in enumerate(zip(texts, scores, polygons)):
        lines.append({"id": f"ocr-{index}", "text": text, "score": float(score),
            "polygon": [[max(0, min(1, float(x)/width)), max(0, min(1, float(y)/height))] for x,y in polygon]})
    return {"engine": "PaddleOCR", "version": version("paddleocr"),
        "coordinateSpace": "analysis-normalized", "lines": lines}

if __name__ == "__main__":
    try:
        content = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise ValueError("Too large")
        result = extract(content)
        sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False))
    except Exception:
        sys.stderr.write("OCR execution failed; check local runtime and model installation.\n")
        sys.exit(1)
