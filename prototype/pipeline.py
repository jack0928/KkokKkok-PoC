"""Local retrieval + correspondence prototype; never infers a shooting location."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
from pathlib import Path
import sys
import time
import warnings

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "private-data" / "pipeline"
os.environ.setdefault("HF_HOME", str(PRIVATE / "models" / "huggingface"))
os.environ.setdefault("TORCH_HOME", str(PRIVATE / "models" / "torch"))
os.environ.setdefault("MPLCONFIGDIR", str(PRIVATE / "runtime"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

MODEL_ID = "facebook/dinov2-small"
PREPROCESS = "pillow-exif-transpose;max-edge=2048;white-alpha;jpeg=95;v1"
FORMATS = {"JPEG", "PNG", "WEBP"}
Image.MAX_IMAGE_PIXELS = 40_000_000


class PrototypeError(Exception):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def private_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Files contain private derived data; do not rely on the shell's umask.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as f:
        f.write(data)


def prepare(path: Path) -> dict:
    try:
        if not path.is_file() or path.stat().st_size > 10 * 1024 * 1024:
            raise PrototypeError("입력은 장당 10 MB 이하의 정지 JPEG/PNG/WebP여야 합니다.")
        raw = path.read_bytes()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                # Some phone JPEGs carry an auxiliary image (e.g. an HDR gain map)
                # and Pillow exposes them as MPO. Explicitly use only the primary
                # frame; never pass auxiliary frames or original metadata to models.
                primary_jpeg = source.format == "MPO" and raw.startswith(b"\xff\xd8")
                if not primary_jpeg and (source.format not in FORMATS or getattr(source, "n_frames", 1) != 1):
                    raise PrototypeError("정지 JPEG/PNG/WebP만 지원합니다.")
                source.seek(0)
                if source.width * source.height > 40_000_000:
                    raise PrototypeError("4,000만 픽셀 이하 이미지를 사용하세요.")
                source.load()
                rgba = ImageOps.exif_transpose(source).convert("RGBA")
                rgb = Image.new("RGB", rgba.size, "white")
                rgb.paste(rgba, mask=rgba.getchannel("A"))
                rgb.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                # Save without copying EXIF, ICC, comments, filenames or other metadata.
                stream = io.BytesIO()
                rgb.save(stream, format="JPEG", quality=95)
        analysis = stream.getvalue()
        with Image.open(io.BytesIO(analysis)) as image:
            clean = image.copy()
        return {"image": clean, "bytes": analysis, "primaryJpegOnly": primary_jpeg, "originalHash": digest(raw),
                "analysisHash": digest(analysis), "width": clean.width, "height": clean.height}
    except PrototypeError:
        raise
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise PrototypeError("이미지를 읽을 수 없습니다. 형식·손상·픽셀 제한을 확인하세요.") from None


def geometry(points0, points1, size0, size1, minimum=12, ratio=0.35, coverage=0.02):
    """Homography supports a shared planar pattern, not a same-place assertion."""
    count = len(points0)
    mask = np.zeros(count, dtype=bool)
    if count >= 4:
        cv2.setRNGSeed(42)
        try:
            transform, inliers = cv2.findHomography(
                np.float32(points0), np.float32(points1), cv2.RANSAC, 4.0,
                maxIters=2000, confidence=0.995)
            if transform is not None and np.isfinite(transform).all() and inliers is not None:
                mask = inliers.ravel().astype(bool)
        except cv2.error:
            pass
    inlier_count = int(mask.sum())

    def area(points, size):
        if len(points) < 3:
            return 0.0
        return float(cv2.contourArea(cv2.convexHull(np.float32(points)))) / (size[0] * size[1])

    area0, area1 = area(points0[mask], size0), area(points1[mask], size1)
    fraction = inlier_count / count if count else 0.0
    supported = inlier_count >= minimum and fraction >= ratio and min(area0, area1) >= coverage
    return {"matches": count, "inliers": inlier_count, "inlierRatio": fraction,
            "queryCoverage": area0, "candidateCoverage": area1,
            "status": "visual-correspondence" if supported else "insufficient-evidence"}, mask


class Models:
    def __init__(self, device, offline=False, revision="main"):
        import certifi
        import torch
        from transformers import AutoImageProcessor, AutoModel
        from lightglue import DISK, LightGlue
        # Python.org macOS installations may not have a default CA bundle.
        # Keep TLS verification enabled for torch.hub's urllib downloads.
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cuda" and not torch.cuda.is_available():
            raise PrototypeError("CUDA GPU를 사용할 수 없습니다. --device cpu로 실행하세요.")
        # CPU is the default on Apple Silicon: no unverified MPS fallback.
        self.device = device
        self.torch = torch
        self.processor = AutoImageProcessor.from_pretrained(
            MODEL_ID, revision=revision, local_files_only=offline, use_fast=False)
        self.encoder = AutoModel.from_pretrained(
            MODEL_ID, revision=revision, local_files_only=offline, use_safetensors=True).eval().to(device)
        self.revision = self.encoder.config._commit_hash
        if not self.revision:
            raise PrototypeError("Embedding 모델의 revision을 확인할 수 없습니다.")
        if offline:
            checkpoints = Path(torch.hub.get_dir()) / "checkpoints"
            required = ("depth-save.pth", "disk_lightglue_v0-1_arxiv.pth")
            if any(not (checkpoints / name).is_file() for name in required):
                raise PrototypeError("부분 매칭 가중치가 없습니다. 최초 한 번은 --offline 없이 실행하세요.")
        self.extractor = DISK(max_num_keypoints=1024).eval().to(device)
        self.matcher = LightGlue(features="disk", flash=False, depth_confidence=-1,
                               width_confidence=-1).eval().to(device)
        self.cache_identity = digest(json.dumps({"model": MODEL_ID, "revision": self.revision,
            "processor": self.processor.to_dict(), "preprocessing": PREPROCESS,
            "pooling": "last_hidden_state[:,0];L2", "torch": torch.__version__,
            "device": device}, sort_keys=True).encode())

    def embed(self, prepared):
        cache = PRIVATE / "cache" / self.cache_identity / (prepared["analysisHash"] + ".npy")
        if cache.exists():
            try:
                vector = np.load(cache, allow_pickle=False)
                if vector.shape == (self.encoder.config.hidden_size,) and np.isfinite(vector).all() and abs(np.linalg.norm(vector) - 1) < 1e-3:
                    return vector, True
            except (OSError, ValueError):
                pass
        inputs = self.processor(images=prepared["image"], return_tensors="pt").to(self.device)
        with self.torch.inference_mode():
            vector = self.encoder(**inputs).last_hidden_state[:, 0, :]
            vector = self.torch.nn.functional.normalize(vector, dim=-1)[0].cpu().numpy()
        stream = io.BytesIO()
        np.save(stream, vector, allow_pickle=False)
        private_write(cache, stream.getvalue())
        return vector, False

    def local(self, prepared):
        image = prepared["image"].copy()
        image.thumbnail((960, 960), Image.Resampling.LANCZOS)
        array = np.array(image, dtype=np.float32) / 255
        tensor = self.torch.from_numpy(array).permute(2, 0, 1).to(self.device)
        with self.torch.inference_mode():
            features = self.extractor.extract(tensor, resize=None)
        return image, features

    def match(self, features0, features1):
        if features0["keypoints"].shape[1] == 0 or features1["keypoints"].shape[1] == 0:
            return np.empty((0, 2), np.float32), np.empty((0, 2), np.float32)
        with self.torch.inference_mode():
            result = self.matcher({"image0": features0, "image1": features1})
        pairs = result["matches"][0].cpu().numpy()
        return (features0["keypoints"][0].cpu().numpy()[pairs[:, 0]],
                features1["keypoints"][0].cpu().numpy()[pairs[:, 1]])


def data_url(image):
    stream = io.BytesIO()
    image.save(stream, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def comparison(image0, image1, points0, points1, mask):
    # The point coordinates refer to the exact resized images used by DISK.
    canvas = Image.new("RGB", (image0.width + image1.width, max(image0.height, image1.height)), "#0c1321")
    canvas.paste(image0, (0, 0))
    canvas.paste(image1, (image0.width, 0))
    draw = ImageDraw.Draw(canvas)
    indices = np.flatnonzero(mask)
    if len(indices) > 60:
        indices = indices[np.linspace(0, len(indices) - 1, 60, dtype=int)]
    for i in indices:
        x, y = map(float, points0[i])
        u, v = map(float, points1[i])
        u += image0.width
        draw.line((x, y, u, v), fill="#59f2ad", width=2)
        for a, b in [(x, y), (u, v)]:
            draw.ellipse((a-3, b-3, a+3, b+3), fill="#59f2ad")
    return canvas


def report_html(result, query, visuals):
    cards = []
    for candidate, visual in zip(result["candidates"], visuals):
        ok = candidate["status"] == "visual-correspondence"
        status = "시각적 대응 근거 있음" if ok else "판단 보류 · 대응 근거 부족"
        fixture = ("<p class='muted'>합성 입력 구성: " + html.escape(candidate["fixtureDescription"]) + "</p>") if "fixtureDescription" in candidate else ""
        cards.append(f'''<article data-status="{candidate['status']}">
          <div class="head"><h2>후보 {candidate['rank']:02d}</h2><span class="badge {'ok' if ok else ''}">{status}</span></div>
          {fixture}
          <div class="metrics"><span>검색 유사도 <b>{candidate['similarity']:.3f}</b></span>
          <span>대응점 <b>{candidate['matches']}</b></span><span>검증 통과 <b>{candidate['inliers']}</b></span>
          <span>통과 비율 <b>{candidate['inlierRatio']:.1%}</b></span>
          <span>분포 면적 · 새 사진 / 과거 사진 <b>{candidate['queryCoverage']:.1%} / {candidate['candidateCoverage']:.1%}</b></span></div>
          <figure><img src="{data_url(visual)}" alt="왼쪽 새 사진과 오른쪽 과거 사진의 대응점 비교">
          <figcaption>왼쪽: 새 사진 · 오른쪽: 과거 사진 · 초록 선: 기하 검증 통과 대응점 (최대 60개)</figcaption></figure>
          <details><summary>후보 이미지 ID와 해석</summary><p>{html.escape(candidate['imageId'])}</p>
          <p>대응은 동일 장소·배경의 확정이나 위치 위험도 판정이 아닙니다. 동일한 물건·포스터도 대응할 수 있습니다.</p></details></article>''')
    synthetic = result["inputKind"] == "synthetic"
    mode = "합성 도형 · 실제 모델 실행" if synthetic else "사용자 제공 이미지 · 실제 모델 실행"
    info = result["runtime"]
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>꼭꼭 · 사진 연결 프로토타입</title><style>
    :root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;background:#0c1321;color:#e7edf6;font:16px/1.65 system-ui,sans-serif}}
    main{{max-width:1160px;margin:auto;padding:48px 24px}}h1{{font-size:clamp(26px,4vw,42px);line-height:1.3;margin:10px 0 18px}}h2{{margin:0;font-size:22px}}
    .eyebrow{{color:#8cbcff;letter-spacing:.1em;font-size:13px}}.muted,figcaption{{color:#a5b2c7}}.intro,article,.stage{{border:1px solid #2b394e;border-radius:16px;padding:24px;background:#141f30;margin:24px 0}}
    .intro{{display:grid;grid-template-columns:1fr 260px;gap:28px}}.intro img{{width:100%;border-radius:10px;max-height:240px;object-fit:contain}}
    .flow{{display:flex;gap:10px;flex-wrap:wrap}}.flow span{{background:#20314a;border-radius:8px;padding:8px 12px}}
    .head,.metrics{{display:flex;align-items:center;gap:14px;flex-wrap:wrap}}.head{{justify-content:space-between}}.metrics{{margin:18px 0;font-size:14px;color:#bdcbe0}}
    b{{color:#fff}}.badge{{font-size:13px;padding:5px 12px;border-radius:20px;background:#39404d}}.ok{{background:#184637;color:#a9f9cf}}
    figure{{margin:0}}figure img{{width:100%;border-radius:8px}}figcaption{{font-size:13px;margin-top:8px}}summary{{cursor:pointer}}details{{margin-top:16px}}details p{{overflow-wrap:anywhere}}
    .note{{border-left:3px solid #e6bc71;padding-left:16px}}footer{{font-size:13px;color:#a5b2c7}}@media(max-width:680px){{.intro{{grid-template-columns:1fr}}main{{padding:24px 14px}}}}
    </style></head><body><main><div class="eyebrow">KKOKKKOK / LOCAL PIPELINE PROTOTYPE</div>
    <h1>비슷한 사진에서<br>연결 근거까지 확인하기</h1>
    <p class="muted">{mode} · 외부 이미지 전송 없음 · GPT API 호출 없음</p>
    <div class="flow"><span>① 분석본 생성</span><span>② DINOv2 검색</span><span>③ DISK + LightGlue</span><span>④ 기하 검증</span></div>
    <section class="intro"><div><h2>새 사진과 과거 사진 {result['galleryCount']}장 비교</h2>
    <p>검색 순서대로 상위 {len(result['candidates'])}장을 표시합니다. 부분 매칭 후의 순위 재정렬은 하지 않습니다.</p>
    <p class="note">{'합성 도형의 변형으로 만든 입력입니다. 모델 연결·기하 검증의 동작 확인용이며 실제 장소 사진의 성능 증거가 아닙니다.' if synthetic else '사용자가 제공한 사진입니다. 정답 관계가 없으므로 검색 정확도·같은 장소 여부를 평가한 결과는 아닙니다.'}</p>
    <p class="muted">처리 {result['elapsedSeconds']:.1f}초 · Embedding 캐시 {result['cacheHits']}건 · 실행 장치 {html.escape(info['device'])}</p>
    <p class="muted">모델 준비 {result['timings']['models']:.1f}초 / 특징 추출·검색 {result['timings']['retrieval']:.1f}초 / 부분 매칭 {result['timings']['matching']:.1f}초</p></div>
    <img src="{data_url(query)}" alt="메타데이터가 제거된 새 사진"></section>
    {''.join(cards)}
    <section class="stage"><h2>아직 하지 않는 단계</h2><p>GPT 단서 추출, 반복·추가 단서의 자동 결합, 위치 식별 유용성 평가는 연결하지 않았습니다. 이 결과는 사진 검색과 시각적 대응 확인 단계의 프로토타입입니다.</p>
    <details><summary>설정과 판정 기준</summary><p>Embedding: {html.escape(info['embeddingModel'])} · revision {html.escape(info['embeddingRevision'])}</p>
    <p>부분 특징: DISK 1,024점 · LightGlue (DISK 가중치) · 비교 이미지 최대 변 960px</p>
    <p>Homography RANSAC 4px · 통과점 ≥ {result['thresholds']['minimumInliers']} · 통과 비율 ≥ {result['thresholds']['minimumRatio']:.0%} · 양쪽 대응점 볼록 껍질 면적 ≥ {result['thresholds']['minimumCoverage']:.0%}</p>
    <p>모두 동작 확인을 위한 잠정 기준입니다. 면적은 대응점 분포 지표이며 실제 배경 일치 면적이 아닙니다. 한 평면 가정이 맞지 않는 장면은 놓칠 수 있습니다.</p></details></section>
    <footer>비공개 로컬 결과 · 이미지가 HTML 안에 포함되어 있습니다. 공개 저장소·공개 호스팅에 업로드하지 마세요. 생성 시각 {html.escape(result['createdAt'])}</footer>
    </main></body></html>'''


def synthetic_scene(seed, variant=False):
    """Procedural, non-photographic fixture. Never presented as a real place."""
    rng = np.random.default_rng(seed)
    canvas = Image.new("RGB", (800, 600), "#dce4ee")
    draw = ImageDraw.Draw(canvas)
    for row in range(10):
        for col in range(14):
            x, y = col * 60 - (30 if row % 2 else 0), row * 60
            shade = int(rng.integers(140, 200))
            draw.rectangle((x+2, y+2, x+57, y+57), fill=(shade, shade-15, shade-25))
            for _ in range(4):
                a, b = x + int(rng.integers(4, 53)), y + int(rng.integers(4, 53))
                draw.line((a, b, a+5, b+2), fill=(shade-30, shade-35, shade-40))
    for x in (90, 330, 570):
        draw.rectangle((x, 80, x+140, 360), fill="#344658", outline="#162233", width=8)
        for _ in range(30):
            a, b = x + int(rng.integers(10, 130)), int(rng.integers(90, 350))
            draw.rectangle((a, b, a+7, b+9), fill=tuple(map(int, rng.integers(60, 210, 3))))
        draw.line((x+70, 80, x+70, 360), fill="#c9d1dc", width=7)
        draw.line((x, 220, x+140, 220), fill="#c9d1dc", width=7)
    draw.rectangle((280, 420, 500, 530), fill="#f1dfab", outline="#26344a", width=4)
    for _ in range(40):
        x, y = map(int, rng.integers((290, 430), (490, 520)))
        draw.ellipse((x, y, x+4, y+4), fill="#52647a")
    draw.text((300, 455), "SYNTHETIC FIXTURE", fill="#162233")
    if variant:
        draw.rectangle((550, 420, 760, 500), fill="#e5f1bd", outline="#26344a", width=4)
        draw.text((565, 450), "ADDED PANEL", fill="#162233")
    return canvas


def make_demo():
    directory = PRIVATE / "demo-inputs"
    gallery = directory / "gallery"
    base = synthetic_scene(42)
    private_write(gallery / "shared-scene.png", png_bytes(base))
    private_write(gallery / "similar-layout.png", png_bytes(synthetic_scene(900)))
    other = Image.new("RGB", (800, 600), "#24334e")
    draw = ImageDraw.Draw(other)
    rng = np.random.default_rng(28)
    for _ in range(110):
        x, y = map(int, rng.integers(0, 540, 2))
        draw.ellipse((x, y, x+60, y+60), fill=tuple(map(int, rng.integers(30, 230, 3))))
    private_write(gallery / "unrelated.png", png_bytes(other))
    # Exact duplicate deliberately exercises self-image exclusion.
    source = np.float32([[0, 0], [799, 0], [799, 599], [0, 599]])
    target = np.float32([[30, 20], [770, 5], [790, 580], [10, 560]])
    query = Image.fromarray(cv2.warpPerspective(np.array(synthetic_scene(42, True)),
        cv2.getPerspectiveTransform(source, target), (800, 600), borderValue=(240, 240, 240)))
    path = directory / "query.png"
    private_write(path, png_bytes(query))
    private_write(gallery / "query-copy.png", png_bytes(query))
    return path, gallery


def png_bytes(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def run(args):
    start = time.perf_counter()
    if args.command == "demo":
        query_path, gallery_path = make_demo()
    else:
        query_path, gallery_path = args.query, args.gallery
    query = prepare(query_path)
    if not gallery_path.is_dir():
        raise PrototypeError("과거 사진 폴더가 필요합니다.")
    paths = sorted(p for p in gallery_path.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    if not paths or len(paths) > 100:
        raise PrototypeError("과거 사진 폴더에는 지원 이미지가 1~100장 있어야 합니다.")
    gallery, seen = [], {query["originalHash"], query["analysisHash"]}
    excluded = 0
    for path in paths:
        prepared = prepare(path)
        if prepared["originalHash"] in seen or prepared["analysisHash"] in seen:
            excluded += 1
            continue
        seen.update((prepared["originalHash"], prepared["analysisHash"]))
        if args.command == "demo":
            prepared["fixtureDescription"] = {
                "shared-scene.png": "새 사진과 같은 원본 도형. 새 사진에는 시점 변환과 패널 추가를 적용함.",
                "similar-layout.png": "배치가 같지만 무늬가 다른 도형. 공통 디자인에 의한 오대응을 관찰하기 위한 입력.",
                "unrelated.png": "관련 없는 원형 도형 묶음.",
            }[path.name]
        gallery.append(prepared)
    if not gallery:
        raise PrototypeError("자기 자신과 중복을 제외한 비교 사진이 없습니다.")
    print(f"분석본 준비 완료 · 비교 사진 {len(gallery)}장 · 동일 이미지 제외 {excluded}장", flush=True)
    model_start = time.perf_counter()
    models = Models(args.device, args.offline, args.revision)
    model_seconds = time.perf_counter() - model_start
    print(f"모델 준비 완료 · 실행 장치 {models.device}", flush=True)
    retrieval_start = time.perf_counter()
    vector, cached = models.embed(query)
    cache_hits = int(cached)
    rankings = []
    for index, prepared in enumerate(gallery):
        other, cached = models.embed(prepared)
        cache_hits += int(cached)
        rankings.append((float(np.clip(np.dot(vector, other), -1, 1)), index))
        print(f"특징 추출 {index+1}/{len(gallery)}", flush=True)
    rankings.sort(key=lambda entry: (-entry[0], gallery[entry[1]]["analysisHash"]))
    retrieval_seconds = time.perf_counter() - retrieval_start
    matching_start = time.perf_counter()
    query_image, query_features = models.local(query)
    candidates, visuals = [], []
    for rank, (similarity, index) in enumerate(rankings[:args.k], 1):
        candidate = gallery[index]
        image, features = models.local(candidate)
        points0, points1 = models.match(query_features, features)
        stats, mask = geometry(points0, points1, query_image.size, image.size,
            args.min_inliers, args.min_ratio, args.min_coverage)
        stats.update({"rank": rank, "imageId": candidate["analysisHash"], "similarity": similarity,
                      "queryPoints": points0[mask].tolist(), "candidatePoints": points1[mask].tolist(),
                      "queryMatchSize": list(query_image.size), "candidateMatchSize": list(image.size)})
        if "fixtureDescription" in candidate:
            stats["fixtureDescription"] = candidate["fixtureDescription"]
        candidates.append(stats)
        visuals.append(comparison(query_image, image, points0, points1, mask))
        print(f"부분 비교 {rank}/{min(args.k, len(gallery))} 완료", flush=True)
    matching_seconds = time.perf_counter() - matching_start
    import importlib.metadata
    direct_url = json.loads(importlib.metadata.distribution("lightglue").read_text("direct_url.json") or "{}")
    checkpoints = Path(models.torch.hub.get_dir()) / "checkpoints"
    result = {"schemaVersion": 1, "experiment": "retrieval-correspondence-prototype",
        "inputKind": "synthetic" if args.command == "demo" else "user-provided",
        "createdAt": datetime.now(timezone.utc).isoformat(), "queryImageId": query["analysisHash"],
        "galleryCount": len(gallery), "excludedDuplicates": excluded, "cacheHits": cache_hits,
        "elapsedSeconds": round(time.perf_counter()-start, 3), "preprocessing": PREPROCESS,
        "primaryJpegOnlyCount": sum(int(image["primaryJpegOnly"]) for image in [query, *gallery]),
        "timings": {"models": round(model_seconds, 3), "retrieval": round(retrieval_seconds, 3),
                    "matching": round(matching_seconds, 3)},
        "thresholds": {"minimumInliers": args.min_inliers, "minimumRatio": args.min_ratio,
                       "minimumCoverage": args.min_coverage, "ransacPixels": 4.0},
        "runtime": {"device": models.device, "embeddingModel": MODEL_ID,
                    "embeddingRevision": models.revision, "matcher": "DISK + LightGlue",
                    "lightglueCommit": direct_url.get("vcs_info", {}).get("commit_id"),
                    "matchingWeightsSha256": {name: digest((checkpoints / name).read_bytes()) for name in
                        ("depth-save.pth", "disk_lightglue_v0-1_arxiv.pth")},
                    "versions": {name: importlib.metadata.version(name) for name in
                                 ["torch", "transformers", "lightglue", "kornia", "Pillow", "numpy", "opencv-python"]}},
        "candidates": candidates,
        "limitations": ["Not a same-place or privacy risk determination", "No GPT API calls",
                        "No automated cue extraction or cumulative cue fusion", "Thresholds are provisional"]}
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + os.urandom(3).hex()
    output = PRIVATE / "runs" / run_id
    private_write(output / "report.html", report_html(result, query["image"], visuals).encode())
    private_write(output / "report.json", (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode())
    private_write(PRIVATE / "latest-report.html", report_html(result, query["image"], visuals).encode())
    print(f"완료 · {result['elapsedSeconds']:.1f}초 · 캐시 {cache_hits}건", flush=True)
    print("보고서: private-data/pipeline/latest-report.html", flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description="로컬 사진 검색·부분 대응 프로토타입 (위치 추론 없음)")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("demo", "run"):
        p = sub.add_parser(command)
        if command == "run":
            p.add_argument("--query", type=Path, required=True)
            p.add_argument("--gallery", type=Path, required=True)
        p.add_argument("--k", type=int, default=5)
        p.add_argument("--device", choices=["auto", "cpu", "cuda"], default="cpu")
        p.add_argument("--offline", action="store_true", help="모델 최초 다운로드 후 로컬 캐시만 사용")
        p.add_argument("--revision", default="main", help="DINOv2 revision; report.json의 commit hash로 고정 가능")
        p.add_argument("--min-inliers", type=int, default=12)
        p.add_argument("--min-ratio", type=float, default=0.35)
        p.add_argument("--min-coverage", type=float, default=0.02)
    args = parser.parse_args()
    if not 1 <= args.k <= 20 or args.min_inliers < 4 or not 0 <= args.min_ratio <= 1 or not 0 <= args.min_coverage <= 1:
        parser.error("K는 1~20, 최소 대응점은 4 이상, 비율·면적은 0~1이어야 합니다.")
    try:
        run(args)
    except PrototypeError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        # Avoid leaking input paths, image data, model outputs or credentials in tracebacks.
        print(f"실행 실패 ({type(error).__name__}): 의존성·모델 다운로드·메모리·장치를 확인하세요. 입력 데이터와 상세 예외는 로그에 출력하지 않습니다.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
