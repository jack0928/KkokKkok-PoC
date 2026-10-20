"""Loopback-only review UI; serve only discovered reports, never input/cache files."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit, unquote

from report_hub import discover_reports, hub_html, review_html, save_metadata
from pipeline import PrototypeError


def handler_for(directory):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log private request paths or review content.

        def respond(self, status, body, content_type):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.end_headers()
            self.wfile.write(body)

        def valid_host(self):
            return self.headers.get("Host") == f"{self.server.server_address[0]}:{self.server.server_port}"

        def do_GET(self):
            if not self.valid_host():
                return self.respond(403, b"Forbidden", "text/plain")
            try:
                path = unquote(urlsplit(self.path).path).lstrip("/")
                reports = discover_reports(directory)
                if path in ("", "index.html", "latest-report.html"):
                    return self.respond(200, hub_html(reports).encode(), "text/html; charset=utf-8")
                for report in reports:
                    if path == f"review-{report['group']}.html":
                        return self.respond(200, review_html(report, directory).encode(), "text/html; charset=utf-8")
                allowed = {r[field] for r in reports for field in ("page", "json")}
                if path not in allowed:
                    return self.respond(404, b"Not found", "text/plain")
                target = (directory / path).resolve()
                if directory.resolve() not in target.parents:
                    return self.respond(403, b"Forbidden", "text/plain")
                self.respond(200, target.read_bytes(), "application/json" if path.endswith(".json") else "text/html; charset=utf-8")
            except (PrototypeError, OSError, ValueError, KeyError):
                self.respond(500, b"Unable to read reports", "text/plain")

        def do_POST(self):
            origin = f"http://{self.server.server_address[0]}:{self.server.server_port}"
            if not self.valid_host() or self.headers.get("Origin") != origin or self.path not in ("/api/review", "/api/point-review"):
                return self.respond(403, b"Forbidden", "text/plain")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65000 or self.headers.get("Content-Type") != "application/json":
                    raise ValueError()
                data = json.loads(self.rfile.read(length))
                if self.path == "/api/review":
                    save_metadata(directory, data["key"], data["name"], data["comment"])
                else:
                    from diagnostics import save_human_review
                    report = next((r for r in discover_reports(directory) if r['group'] == data['key'] and r.get('diagnostic')), None)
                    if report is None:
                        raise ValueError('Unknown diagnostic run')
                    target = (directory / Path(report['json']).parent).resolve()
                    if directory.resolve() not in target.parents:
                        raise ValueError('Invalid run path')
                    save_human_review(target, data['sampleId'], data['verdict'], data['reason'])
                self.respond(200, b'{"saved":true}', "application/json")
            except (ValueError, KeyError, TypeError, OSError):
                self.respond(400, b'{"saved":false}', "application/json")
    return Handler


def serve(directory, port=8765):
    server = HTTPServer(("127.0.0.1", port), handler_for(directory))
    print(f"회차 목록·메모: http://127.0.0.1:{port} (종료: Ctrl+C)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
