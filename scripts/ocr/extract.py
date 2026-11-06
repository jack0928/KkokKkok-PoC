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
        passes = [("full", 0, 0, image)]
        size, stride = 1024, 819
        def starts(length):
            return sorted(set(list(range(0, max(1, length-size+1), stride)) + [max(0, length-size)]))
        if width > size or height > size:
            for y in starts(height):
                for x in starts(width):
                    passes.append((f"tile-{x}-{y}", x, y, image.crop((x,y,min(width,x+size),min(height,y+size)))))
        lines, raw, unread, pass_info = [], [], [], []
        def polygon(points, x, y):
            return [[max(0,min(1,(float(px)+x)/width)),max(0,min(1,(float(py)+y)/height))] for px,py in points]
        def overlap(a,b):
            ax=[p[0] for p in a]; ay=[p[1] for p in a]; bx=[p[0] for p in b]; by=[p[1] for p in b]
            inter=max(0,min(max(ax),max(bx))-max(min(ax),min(bx)))*max(0,min(max(ay),max(by))-max(min(ay),min(by)))
            union=(max(ax)-min(ax))*(max(ay)-min(ay))+(max(bx)-min(bx))*(max(by)-min(by))-inter
            return inter/union if union else 0
        for name,x,y,crop in passes:
            results=list(model.predict(np.array(crop)[:,:,::-1]))
            if len(results)!=1: raise ValueError("Expected one result")
            data=results[0].json["res"]
            texts,scores,polys=data["rec_texts"],data["rec_scores"],data["rec_polys"]
            if not len(texts)==len(scores)==len(polys): raise ValueError("Invalid results")
            pass_info.append({"id":name,"x":x,"y":y,"width":crop.width,"height":crop.height,"count":len(texts)})
            recognized=[]
            for text,score,points in zip(texts,scores,polys):
                poly=polygon(points,x,y)
                entry={"text":str(text),"score":float(score),"polygon":poly,"passId":name}
                raw.append(entry)
                if not str(text).strip():
                    unread.append({"polygon":poly,"passId":name}); continue
                recognized.append(poly)
                duplicate=next((line for line in lines if line["text"].replace(" ","")==str(text).replace(" ","") and overlap(line["polygon"],poly)>.6),None)
                if duplicate:
                    if score>duplicate["score"]: duplicate.update(entry)
                else: lines.append(entry)
            for points in data.get("dt_polys",[]):
                poly=polygon(points,x,y)
                if not any(overlap(poly,r)>.5 for r in recognized): unread.append({"polygon":poly,"passId":name})
        conflicts=[]
        for i,line in enumerate(lines):
            for j in range(i):
                if line["text"].replace(" ","")!=lines[j]["text"].replace(" ","") and overlap(line["polygon"],lines[j]["polygon"])>.6:
                    conflicts.append([f"ocr-{j}",f"ocr-{i}"])
        if len(lines)>500 or len(raw)>4000 or len(unread)>4000: raise ValueError("OCR result limit exceeded")
    return {"engine":"PaddleOCR","version":version("paddleocr"),"coordinateSpace":"analysis-normalized",
        "lines":[{"id":f"ocr-{i}",**line} for i,line in enumerate(lines)],
        "diagnostics":{"version":"tiled-v1","inputWidth":width,"inputHeight":height,"passes":pass_info,"rawReadings":raw,"unreadRegions":unread,"conflicts":conflicts}}

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
