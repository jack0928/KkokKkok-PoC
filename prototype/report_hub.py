"""Build saved local report lists and individual review pages; no image inference or API calls."""
import argparse
import base64
import hashlib
import html
import json
from pathlib import Path
import re
import sys

from pipeline import PRIVATE, PrototypeError, private_write


def discover_groups(directory):
    reports = []
    for path in sorted(directory.glob("group-*-report.json")):
        match = re.fullmatch(r"group-([0-9]+)-report\.json", path.name)
        if not match:
            continue
        group = match[1]
        result = json.loads(path.read_text())
        candidates = result["candidates"]
        evaluation_path = directory / f"group-{group}-evaluation.json"
        evaluation = json.loads(evaluation_path.read_text()) if evaluation_path.is_file() else {}
        reference = str(evaluation.get("reference", result["queryImageId"][:12]))
        report = directory / f"group-{group}-evaluation.html"
        if not report.is_file():
            report = directory / f"group-{group}-report.html"
        if not report.is_file():
            raise PrototypeError("결과 JSON에 대응하는 HTML 보고서가 없습니다.")
        complete = all(
            all(key in candidate for key in ("allQueryPoints", "allCandidatePoints", "inlierMask"))
            and len(candidate["allQueryPoints"]) == len(candidate["allCandidatePoints"])
            == len(candidate["inlierMask"]) == candidate["matches"]
            and all(isinstance(value, bool) for value in candidate["inlierMask"])
            and sum(candidate["inlierMask"]) == candidate["inliers"]
            for candidate in candidates)
        reports.append({"group": group, "reference": reference, "page": report.name,
                        "json": path.name, "candidates": len(candidates), "complete": complete,
                        "createdAt": result["createdAt"], "matches": sum(c["matches"] for c in candidates),
                        "inliers": sum(c["inliers"] for c in candidates)})
    reports.sort(key=lambda item: int(item["group"]))
    if not reports:
        raise PrototypeError("저장된 group-N-report.json과 HTML 보고서가 필요합니다.")
    return reports


def discover_reports(directory):
    reports = []
    if list(directory.glob("group-*-report.json")):
        reports.extend(discover_groups(directory))
    for path in sorted((directory / "runs").glob("*/report.json"), reverse=True):
        if not (path.parent / "report.html").is_file():
            continue
        result = json.loads(path.read_text())
        candidates = result["candidates"]
        run_id = path.parent.name
        reports.append({"group": "run-" + run_id, "diagnostic": result.get("experiment") == "correspondence-diagnostics", "reference": result["queryImageId"][:12],
            "page": f"runs/{run_id}/report.html", "json": f"runs/{run_id}/report.json",
            "candidates": len(candidates), "complete": all("inlierMask" in c for c in candidates),
            "createdAt": result["createdAt"], "matches": sum(c["matches"] for c in candidates),
            "inliers": sum(c["inliers"] for c in candidates)})
    if not reports:
        raise PrototypeError("저장된 보고서가 없습니다.")
    metadata = read_metadata(directory)
    for report in reports:
        key = report["group"]
        report["name"] = metadata.get(key, {}).get("name") or (
            f"테스트 {report['createdAt']} · {key[-6:]}" if key.startswith("run-") else f"기존 {key}번 묶음")
        report["comment"] = metadata.get(key, {}).get("comment", "")
    return reports


def read_metadata(directory):
    path = directory / "review-metadata.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def save_metadata(directory, key, name, comment):
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError("회차 이름은 1~120자로 입력하세요.")
    if not isinstance(comment, str) or len(comment) > 10000:
        raise ValueError("코멘트는 10,000자 이하로 입력하세요.")
    if key not in {r["group"] for r in discover_reports(directory)}:
        raise ValueError("없는 회차입니다.")
    metadata = read_metadata(directory)
    metadata[key] = {"name": name.strip(), "comment": comment}
    temporary = directory / "review-metadata.tmp"
    private_write(temporary, (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode())
    temporary.replace(directory / "review-metadata.json")


def page_html(title, body):
    style = (Path(__file__).parent / "report_hub.css").read_text()
    script = (Path(__file__).parent / "report_hub.js").read_text()
    signature = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; frame-src 'self' file:; connect-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-{signature}'; base-uri 'none'; form-action 'none'">
    <title>{html.escape(title)} · 꼭꼭</title><style>{style}</style></head><body>{body}<script>{script}</script></body></html>'''


def hub_html(reports):
    cards = []
    for report in reports:
        key = html.escape(report["group"], quote=True)
        name = html.escape(report.get("name", key))
        cards.append(f'''<article class="run-card"><h2><a href="review-{key}.html">{name}</a></h2>
        <p>기준 {html.escape(report['reference'])} · 후보 {report['candidates']}장</p>
        <p>{html.escape(report['createdAt'])} · 대응점 {report['matches']:,}개 · 검증 통과 {report['inliers']:,}개</p>
        <p class="comment-preview">{html.escape(report.get('comment', '') or '코멘트 없음')}</p></article>''')
    return page_html("테스트 회차 목록", f'''<header><h1>테스트 회차 목록</h1>
    <p>총 {len(reports)}개 · 회차를 선택하면 개별 페이지로 이동합니다. 새 실행 후 목록을 새로고침하세요.</p></header>
    <main class="run-list">{''.join(cards)}</main>''')


def review_html(report, directory=None):
    human = ''
    if report.get('diagnostic') and directory is not None:
        from diagnostics import human_review_markup
        human = human_review_markup(directory / Path(report['json']).parent, report['group'])
    key = html.escape(report["group"], quote=True)
    name = html.escape(report.get("name", key), quote=True)
    comment = html.escape(report.get("comment", ""))
    return page_html(report.get("name", key), f'''<header><a href="index.html">← 회차 목록</a><h1 data-review-title>{name}</h1>
    <p>기준 {html.escape(report['reference'])} · 후보 {report['candidates']}장 · {html.escape(report['createdAt'])}</p></header>
    <form class="review-form" data-key="{key}"><label>회차 이름<input name="name" maxlength="120" required value="{name}"></label>
    <label>검토 코멘트<textarea name="comment" maxlength="10000" rows="2">{comment}</textarea></label>
    <button type="submit">저장</button><span class="save-status" role="status"></span>
    <small>메모는 모델 입력에 사용하지 않습니다.</small></form>
    <div class="links"><a href="{html.escape(report['page'], quote=True)}">결과만 열기</a>
    <a href="{html.escape(report['json'], quote=True)}">대응점 JSON</a></div>
    <iframe class="review-result" title="사진 비교 결과" src="{html.escape(report['page'], quote=True)}" sandbox="allow-scripts"></iframe>{human}''')


def write_pages(directory, reports):
    private_write(directory / "index.html", hub_html(reports).encode())
    for report in reports:
        private_write(directory / f"review-{report['group']}.html", review_html(report, directory).encode())


def main():
    parser = argparse.ArgumentParser(description="저장된 묶음별 회차별 보고서 만들기 (추론 없음)")
    parser.add_argument("--serve", action="store_true", help="127.0.0.1:8765에서 회차·메모 저장 UI 실행")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reports-dir", type=Path, default=PRIVATE)
    args = parser.parse_args()
    try:
        directory = args.reports_dir.resolve()
        # Both sources and output contain private images; public/ is never valid.
        if directory != PRIVATE.resolve() and PRIVATE.resolve() not in directory.parents:
            raise PrototypeError("보고서는 private-data/pipeline 안에서만 묶을 수 있습니다.")
        if args.serve:
            from report_server import serve
            serve(directory, args.port)
            return 0
        reports = discover_reports(directory)
        write_pages(directory, reports)
        print(f"저장된 {len(reports)}개 묶음의 회차 페이지를 만들었습니다. 모델·API 호출 없음.")
        print("보고서 폴더의 index.html을 브라우저에서 여세요.")
    except (PrototypeError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, PrototypeError) else "저장된 보고서의 파일·형식을 확인하세요.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
