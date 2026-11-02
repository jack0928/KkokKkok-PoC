"""Independent Street View comparison. Existing pipeline files are imported, never edited."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'prototype'))

MAX_IMAGE = 10 * 1024 * 1024
HEADINGS = (0, 90, 180, 270)


class InputError(Exception):
    pass


def panorama_id(value):
    """Extract an ID locally, without following user-supplied URLs."""
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 8192:
        raise InputError('Google Maps 거리뷰 링크 또는 파노라마 ID를 입력하세요.')
    value = value.strip()
    if value.startswith(('https://', 'http://')):
        url = urlsplit(value)
        allowed = {'google.com', 'www.google.com', 'maps.google.com',
                   'google.co.kr', 'www.google.co.kr', 'maps.google.co.kr'}
        if url.hostname not in allowed:
            raise InputError('전체 Google Maps 거리뷰 링크 또는 파노라마 ID를 입력하세요. 단축 링크는 지원하지 않습니다.')
        parameters = parse_qs(url.query)
        candidate = parameters.get('pano', parameters.get('pano_id', ['']))[0]
        if not candidate:
            match = re.search(r'!1s([^!/?&#]+)', unquote(value))
            candidate = match.group(1) if match else ''
        value = unquote(candidate)
    if not re.fullmatch(r'[A-Za-z0-9_-]{2,256}', value):
        raise InputError('파노라마 ID를 찾지 못했습니다. 장소 링크가 아닌 거리뷰 전체 링크 또는 ID를 입력하세요.')
    return value


def reference_parameters(value):
    """Legacy address strings remain supported; new requests can select a panorama."""
    if isinstance(value, str):
        value = {'mode': 'address', 'address': value}
    if not isinstance(value, dict):
        raise InputError('참조 입력 형식을 확인하세요.')
    mode = value.get('mode', 'address')
    if mode == 'panorama':
        return {'pano': panorama_id(value.get('panorama'))}
    if mode != 'address':
        raise InputError('주소 검색 또는 특정 거리뷰 지정 방식을 선택하세요.')
    address = value.get('address')
    if not isinstance(address, str) or not 1 <= len(address.strip()) <= 500:
        raise InputError('참조 주소를 1~500자로 입력하세요.')
    if address.strip().startswith(('http://', 'https://')):
        raise InputError('Google Maps 링크는 특정 거리뷰 지정 입력란에 넣으세요.')
    source = value.get('source', 'default')
    if source not in ('default', 'outdoor'):
        raise InputError('실내 포함 또는 야외만 검색을 선택하세요.')
    return {'location': address.strip(), 'source': source}


def load_google_environment():
    """Read only these two server secrets; never return their values to the browser."""
    file = ROOT / '.env.local'
    if file.is_file():
        for line in file.read_text(encoding='utf-8-sig').splitlines():
            key, separator, value = line.strip().partition('=')
            if separator and key in ('GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SIGNING_SECRET'):
                os.environ.setdefault(key, value.strip().strip('\"\''))


class StreetViewClient:
    def __init__(self, key, signing_secret='', opener=urlopen):
        if not key:
            raise InputError('서버의 GOOGLE_MAPS_API_KEY를 설정하고 재시작하세요.')
        self.key, self.signing_secret, self.opener = key, signing_secret, opener

    def _get(self, suffix, parameters, limit):
        query = urlencode({**parameters, 'key': self.key})
        resource = '/maps/api/streetview' + suffix + '?' + query
        if self.signing_secret:
            try:
                secret = base64.urlsafe_b64decode(self.signing_secret + '=' * (-len(self.signing_secret) % 4))
                signature = base64.urlsafe_b64encode(hmac.new(secret, resource.encode(), hashlib.sha1).digest()).decode()
                resource += '&signature=' + signature
            except (ValueError, TypeError):
                raise InputError('Google URL 서명 설정을 확인하세요.') from None
        try:
            with self.opener('https://maps.googleapis.com' + resource, timeout=30) as response:
                content_type = response.headers.get('Content-Type', '')
                data = response.read(limit + 1)
            if len(data) > limit:
                raise InputError('Google 응답 크기가 허용 범위를 초과했습니다.')
            return data, content_type
        except InputError:
            raise
        except Exception:
            # HTTP errors can include an API key in the URL; do not propagate them.
            raise InputError('Google 요청에 실패했습니다. API 활성화·결제·키 제한·네트워크를 확인하세요. 자동 재시도하지 않습니다.') from None

    def references(self, address, progress):
        import json
        parameters = reference_parameters(address)
        specific = 'pano' in parameters
        progress('지정한 실내·외 파노라마를 확인하고 있습니다.' if specific else '입력한 주소 주변의 파노라마를 확인하고 있습니다.')
        data, _ = self._get('/metadata', parameters, 128 * 1024)
        try:
            metadata = json.loads(data)
            status = metadata.get('status')
            if status in ('ZERO_RESULTS', 'NOT_FOUND'):
                if specific:
                    raise InputError('지정한 거리뷰를 공식 API에서 제공하지 않거나 ID가 변경되었습니다. Google Maps에서 보이는 사진도 API에서는 제공되지 않을 수 있습니다. 다른 장소로 자동 대체하지 않습니다.')
                raise InputError('입력한 주소 주변에 선택 조건에 맞는 거리뷰가 없습니다. 실내는 특정 거리뷰 링크 또는 ID로 지정해 보세요.')
            if status != 'OK' or not isinstance(metadata.get('pano_id'), str):
                raise InputError('거리뷰 메타데이터를 가져오지 못했습니다. 키·결제·주소를 확인하세요.')
            pano = metadata['pano_id']
            if specific and pano != parameters['pano']:
                raise InputError('Google이 다른 파노라마를 반환하여 중단했습니다. 거리뷰 링크 또는 ID를 다시 확인하세요.')
        except (ValueError, AttributeError):
            raise InputError('Google 메타데이터 응답 형식을 확인할 수 없습니다.') from None
        images = []
        for heading in HEADINGS:
            progress(f'같은 파노라마의 {heading}° 이미지를 가져오고 있습니다.')
            content, mime = self._get('', {'pano': pano, 'heading': heading, 'size': '640x640',
                'fov': 90, 'pitch': 0, 'return_error_code': 'true'}, MAX_IMAGE)
            if not mime.startswith('image/'):
                raise InputError('Google이 거리뷰 이미지 대신 오류를 반환했습니다.')
            images.append((heading, content))
        # The supplied address is not a verified shooting location.
        return {'date': metadata.get('date'), 'copyright': metadata.get('copyright', ''),
                'panoramaId': pano, 'referenceMode': 'panorama' if specific else 'address',
                'searchSource': parameters.get('source')}, images


class ComparisonEngine:
    def __init__(self, model_factory=None):
        self.models = None
        self.model_factory = model_factory

    def _models(self):
        if self.models is None:
            if self.model_factory is None:
                from pipeline import Models
                self.model_factory = lambda: Models('cpu', offline=True)
            self.models = self.model_factory()
        return self.models

    @staticmethod
    def _embed(models, prepared):
        # Deliberately do not call Models.embed(): it persists image-derived vectors.
        inputs = models.processor(images=prepared['image'], return_tensors='pt').to(models.device)
        with models.torch.inference_mode():
            vector = models.encoder(**inputs).last_hidden_state[:, 0, :]
            return models.torch.nn.functional.normalize(vector, dim=-1)[0].cpu().numpy()

    def compare(self, uploads, address, client, progress):
        from pipeline import PRIVATE, PrototypeError, data_url, geometry, prepare
        import numpy as np
        started = time.perf_counter()
        runtime = PRIVATE.parent / 'streetview-web' / 'runtime'
        runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Originals and Google images are transient and removed even on failure.
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            directory = Path(temporary)
            def prepared_bytes(content, name):
                target = directory / name
                try:
                    target.write_bytes(content)
                    return prepare(target)
                except PrototypeError:
                    raise InputError('지원하지 않거나 손상된 이미지입니다. 정지 JPEG/PNG/WebP, 10MB·4,000만 픽셀 이하를 사용하세요.') from None
                finally:
                    target.unlink(missing_ok=True)
            progress('업로드 사진을 검증하고 메타데이터를 제거하고 있습니다.')
            queries = [prepared_bytes(content, f'query-{i}') for i, content in enumerate(uploads)]
            # Reject invalid uploads before any paid Google image requests.
            progress('다운로드된 분석 모델을 준비하고 있습니다.')
            try:
                models = self._models()
            except Exception:
                raise InputError('로컬 모델을 준비하지 못했습니다. 기존 합성 데모의 offline 실행과 모델 캐시를 확인하세요.') from None
            metadata, contents = client.references(address, progress)
            gallery = [(heading, prepared_bytes(content, f'heading-{heading}')) for heading, content in contents]
            gallery_vectors, gallery_features = [], []
            for index, (_, image) in enumerate(gallery):
                progress(f'거리뷰 {index + 1}/4의 DINOv2·DISK 특징을 추출하고 있습니다.')
                gallery_vectors.append(self._embed(models, image))
                gallery_features.append(models.local(image))
            results = []
            for index, query in enumerate(queries):
                progress(f'업로드 사진 {index + 1}/{len(queries)}을 네 방향과 비교하고 있습니다.')
                vector = self._embed(models, query)
                query_image, query_features = models.local(query)
                pairs = []
                for candidate_index, (heading, _) in enumerate(gallery):
                    candidate_image, candidate_features = gallery_features[candidate_index]
                    a, b = models.match(query_features, candidate_features)
                    stats, mask = geometry(a, b, query_image.size, candidate_image.size)
                    chosen = np.flatnonzero(mask)
                    if len(chosen) > 60:
                        chosen = chosen[np.linspace(0, len(chosen) - 1, 60, dtype=int)]
                    pairs.append({**stats, 'heading': heading,
                        'similarity': float(np.clip(np.dot(vector, gallery_vectors[candidate_index]), -1, 1)),
                        'queryPoints': a[chosen].tolist(), 'candidatePoints': b[chosen].tolist(),
                        'querySize': list(query_image.size), 'candidateSize': list(candidate_image.size)})
                pairs.sort(key=lambda pair: -pair['similarity'])
                results.append({'number': index + 1, 'image': data_url(query_image), 'candidates': pairs})
            # Original Google JPEGs preserve supplied attribution. No disk report/cache.
            references = [{'heading': heading, 'image': 'data:image/jpeg;base64,' + base64.b64encode(content).decode()}
                          for heading, content in contents]
            return {'queries': results, 'references': references, 'metadata': metadata,
                'seconds': round(time.perf_counter() - started, 2), 'device': models.device,
                'embeddingRevision': models.revision, 'allDirectionsCompared': True}
