"""Loopback-only upload UI. Run with the existing pipeline venv; no new packages."""
from __future__ import annotations

import argparse
import base64
import binascii
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import threading

from service import ComparisonEngine, InputError, MAX_IMAGE, StreetViewClient, load_google_environment, reference_parameters

MAX_BODY = 71 * 1024 * 1024


class Jobs:
    def __init__(self):
        self.lock = threading.Lock()
        self.busy = False
        self.items = {}
        self.engine = ComparisonEngine()

    def start(self, uploads, address, client):
        with self.lock:
            if self.busy:
                raise InputError('다른 분석이 진행 중입니다. 완료 후 다시 요청하세요.')
            # Bound memory; older results are session-only and may expire.
            while len(self.items) >= 5:
                self.items.pop(next(iter(self.items)))
            self.busy = True
            identifier = secrets.token_hex(16)
            self.items[identifier] = {'status': 'running', 'message': '분석 준비 중입니다.'}
        def progress(message):
            with self.lock:
                self.items[identifier]['message'] = message
        def work():
            try:
                result = self.engine.compare(uploads, address, client, progress)
                value = {'status': 'completed', 'result': result}
            except InputError as error:
                value = {'status': 'failed', 'message': str(error)}
            except Exception:
                value = {'status': 'failed', 'message': '분석에 실패했습니다. 모델·이미지·메모리를 확인하세요. 상세 입력과 응답은 로그에 남기지 않습니다.'}
            finally:
                uploads.clear()
            with self.lock:
                self.items[identifier] = value
                self.busy = False
        threading.Thread(target=work, daemon=True).start()
        return identifier


def decode_request(value):
    if not isinstance(value, dict):
        raise InputError('요청 형식을 확인하세요.')
    mode = value.get('mode', 'address')
    reference = {'mode': mode, 'address': value.get('address'),
                 'source': value.get('source', 'default'), 'panorama': value.get('panorama')}
    reference_parameters(reference)
    files = value.get('images')
    if not isinstance(files, list) or not 1 <= len(files) <= 5:
        raise InputError('사진을 1~5장 선택하세요.')
    if value.get('consent') is not True:
        raise InputError('참조 주소 또는 파노라마 ID 전송과 Google 이미지 요청 비용을 확인해 주세요.')
    uploads = []
    for encoded in files:
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_IMAGE + 2) // 3):
            raise InputError('장당 10MB 이하 이미지를 선택하세요.')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise InputError('이미지 인코딩이 올바르지 않습니다.') from None
        if not content or len(content) > MAX_IMAGE:
            raise InputError('비어 있지 않은 장당 10MB 이하 이미지를 선택하세요.')
        uploads.append(content)
    # Preserve legacy address-only clients, including the existing engine interface.
    return uploads, value['address'].strip() if 'mode' not in value and 'source' not in value else reference


def handler_for(jobs, token, key, signing_secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def valid_host(self):
            return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

        def respond(self, status, value, mime='application/json; charset=utf-8'):
            data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            try:
                self.wfile.write(data)
            except (ConnectionError, OSError):
                pass

        def do_GET(self):
            if not self.valid_host():
                return self.respond(403, {'error': '허용되지 않은 호스트입니다.'})
            assets = {'/': ('index.html', 'text/html; charset=utf-8'),
                      '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                      '/style.css': ('style.css', 'text/css; charset=utf-8')}
            if self.path in assets:
                name, mime = assets[self.path]
                return self.respond(200, (Path(__file__).parent / name).read_bytes(), mime)
            if self.path == '/api/config':
                return self.respond(200, {'token': token, 'googleConfigured': bool(key)})
            if self.headers.get('X-Local-Token') != token:
                return self.respond(403, {'error': '이 페이지에서 다시 요청하세요.'})
            if re.fullmatch(r'/api/jobs/[a-f0-9]{32}', self.path):
                with jobs.lock:
                    value = jobs.items.get(self.path.rsplit('/', 1)[1])
                return self.respond(200 if value else 404, value or {'error': '결과가 만료됐습니다. 새로 분석하세요.'})
            self.respond(404, {'error': '없는 경로입니다.'})

        def do_POST(self):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            if not self.valid_host() or self.headers.get('Origin') != origin or self.headers.get('X-Local-Token') != token:
                return self.respond(403, {'error': '이 페이지에서 다시 요청하세요.'})
            if self.path != '/api/compare':
                return self.respond(404, {'error': '없는 경로입니다.'})
            try:
                if self.headers.get('Content-Type') != 'application/json':
                    raise InputError('JSON 요청만 지원합니다.')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_BODY:
                    return self.respond(413, {'error': '요청 크기를 초과했습니다.'})
                self.connection.settimeout(60)
                uploads, address = decode_request(json.loads(self.rfile.read(length)))
                client = StreetViewClient(key, signing_secret)
                identifier = jobs.start(uploads, address, client)
                self.respond(202, {'jobId': identifier})
            except (InputError, ValueError, TimeoutError) as error:
                message = str(error) if isinstance(error, InputError) else '요청 형식 또는 전송 시간을 확인하세요.'
                self.respond(400, {'error': message})

    return Handler


def main():
    parser = argparse.ArgumentParser(description='주소 기반 거리뷰 비교 — 독립 로컬 웹앱')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    load_google_environment()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(Jobs(), secrets.token_urlsafe(32),
        os.environ.get('GOOGLE_MAPS_API_KEY', '').strip(), os.environ.get('GOOGLE_MAPS_SIGNING_SECRET', '').strip()))
    print(f'거리뷰 비교: http://127.0.0.1:{server.server_port} (종료: Ctrl+C)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
