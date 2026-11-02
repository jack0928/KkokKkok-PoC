"""Offline tests. All Google HTTP responses are simulated; no API key needed."""
import base64
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

from server import Jobs, decode_request, handler_for
from service import InputError, StreetViewClient, panorama_id, reference_parameters


class Response(io.BytesIO):
    def __init__(self, content, mime):
        super().__init__(content)
        self.headers = {'Content-Type': mime}


class GoogleTests(unittest.TestCase):
    def test_indoor_panorama_link_is_selected_without_outdoor_filter(self):
        identifier = 'CIHM0ogKEICAgIDq3c3y1gE'
        requests = []
        def opener(url, timeout):
            request = urlsplit(url)
            requests.append(parse_qs(request.query))
            if request.path.endswith('metadata'):
                return Response(json.dumps({'status': 'OK', 'pano_id': identifier}).encode(), 'application/json')
            return Response(b'fixture', 'image/jpeg')
        reference = {'mode': 'panorama', 'panorama': f'https://www.google.co.kr/maps/place/campus/data=!3m6!1s{identifier}!2e10!3e11'}
        StreetViewClient('test-key', opener=opener).references(reference, lambda _: None)
        self.assertEqual(requests[0], {'pano': [identifier], 'key': ['test-key']})
        self.assertEqual([r['heading'][0] for r in requests[1:]], ['0', '90', '180', '270'])
        self.assertTrue(all(r['pano'] == [identifier] for r in requests))

    def test_unavailable_or_substituted_panorama_never_falls_back(self):
        for response in ({'status': 'ZERO_RESULTS'}, {'status': 'NOT_FOUND'}, {'status': 'OK', 'pano_id': 'different'}):
            calls = []
            def opener(url, timeout):
                calls.append(url)
                return Response(json.dumps(response).encode(), 'application/json')
            with self.assertRaises(InputError):
                StreetViewClient('test-key', opener=opener).references({'mode': 'panorama', 'panorama': 'fixture-pano'}, lambda _: None)
            self.assertEqual(len(calls), 1)

    def test_one_panorama_four_directions_and_encoded_address(self):
        requests = []
        def opener(url, timeout):
            requests.append(urlsplit(url))
            if urlsplit(url).path.endswith('metadata'):
                return Response(json.dumps({'status': 'OK', 'pano_id': 'pano-test', 'date': '2025-01'}).encode(), 'application/json')
            return Response(b'fixture', 'image/jpeg')
        metadata, images = StreetViewClient('test-key', opener=opener).references('한글 테스트 주소 & A', lambda _: None)
        self.assertEqual(parse_qs(requests[0].query)['location'], ['한글 테스트 주소 & A'])
        self.assertEqual(parse_qs(requests[0].query)['source'], ['default'])
        self.assertEqual(metadata['panoramaId'], 'pano-test')
        self.assertEqual([heading for heading, _ in images], [0, 90, 180, 270])
        for request in requests[1:]:
            parameters = parse_qs(request.query)
            self.assertEqual(parameters['pano'], ['pano-test'])
            self.assertEqual(parameters['fov'], ['90'])
            self.assertEqual(parameters['return_error_code'], ['true'])

    def test_no_imagery_does_not_request_images(self):
        calls = []
        def opener(url, timeout):
            calls.append(url)
            return Response(b'{"status":"ZERO_RESULTS"}', 'application/json')
        with self.assertRaises(InputError):
            StreetViewClient('test-key', opener=opener).references('test', lambda _: None)
        self.assertEqual(len(calls), 1)

    def test_http_failure_does_not_leak_secret_or_address(self):
        def opener(url, timeout):
            raise OSError(url)
        with self.assertRaises(InputError) as error:
            StreetViewClient('secret-fixture', opener=opener).references('private-fixture-address', lambda _: None)
        self.assertNotIn('secret-fixture', str(error.exception))
        self.assertNotIn('private-fixture-address', str(error.exception))

    def test_signed_request(self):
        requests = []
        def opener(url, timeout):
            requests.append(url)
            return Response(b'{"status":"ZERO_RESULTS"}', 'application/json')
        with self.assertRaises(InputError):
            StreetViewClient('test-key', base64.urlsafe_b64encode(b'fixture').decode(), opener).references('test', lambda _: None)
        self.assertIn('signature=', requests[0])


class InputTests(unittest.TestCase):
    def test_panorama_formats_and_untrusted_links(self):
        identifier = 'CIHM0ogKEICAgIDq3c3y1gE'
        for value in (identifier, f'https://www.google.com/maps/@?api=1&map_action=pano&pano={identifier}',
                      f'https://www.google.co.kr/maps/place/test/data=%213m6%211s{identifier}%212e10'):
            self.assertEqual(panorama_id(value), identifier)
        for value in ('', None, 'http://localhost/private', 'https://google.com.attacker.com/!1sfixture',
                      'https://maps.app.goo.gl/short', 'https://www.google.com/maps/place/test/data=!1s0x123:0xabc'):
            with self.assertRaises(InputError):
                panorama_id(value)

    def test_source_and_reference_validation(self):
        self.assertEqual(reference_parameters('test')['source'], 'default')
        self.assertEqual(reference_parameters({'address': 'test', 'source': 'outdoor'})['source'], 'outdoor')
        for value in ({'address': 'https://www.google.com/maps'}, {'mode': 'unexpected'}, {'address': 'test', 'source': 'indoor'}):
            with self.assertRaises(InputError):
                reference_parameters(value)
        request = {'mode': 'panorama', 'panorama': 'fixture-pano', 'images': ['eA=='], 'consent': True}
        uploads, reference = decode_request(request)
        self.assertEqual(uploads, [b'x'])
        self.assertEqual(reference_parameters(reference), {'pano': 'fixture-pano'})

    def test_limits_consent_and_encoding(self):
        valid = {'address': 'test', 'images': ['eA=='], 'consent': True}
        self.assertEqual(decode_request(valid), ([b'x'], 'test'))
        for change in ({'address': ''}, {'images': []}, {'images': ['eA=='] * 6},
                       {'images': ['!']}, {'consent': False}, {'images': ['']}):
            with self.assertRaises(InputError):
                decode_request({**valid, **change})


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(Jobs(), 'test-token', '', ''))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, **headers):
        connection = HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return result

    def test_page_and_configuration_do_not_expose_key(self):
        status, body, headers = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('Cache-Control', headers)
        self.assertIn('참조 주소', body.decode())
        status, body, _ = self.request('GET', '/api/config')
        self.assertEqual(json.loads(body), {'token': 'test-token', 'googleConfigured': False})

    def test_other_host_and_private_paths_rejected(self):
        self.assertEqual(self.request('GET', '/', Host='evil.example')[0], 403)
        self.assertEqual(self.request('GET', '/api/jobs/' + 'a' * 32)[0], 403)
        self.assertEqual(self.request('GET', '/../../.env.local', **{'X-Local-Token': 'test-token'})[0], 404)

    def test_post_requires_origin_and_token(self):
        self.assertEqual(self.request('POST', '/api/compare', '{}', **{'Content-Type': 'application/json'})[0], 403)

    def test_missing_key_fails_without_model_or_google_call(self):
        payload = json.dumps({'address': 'test', 'images': ['eA=='], 'consent': True})
        status, body, _ = self.request('POST', '/api/compare', payload,
            **{'Origin': f'http://127.0.0.1:{self.port}', 'X-Local-Token': 'test-token', 'Content-Type': 'application/json'})
        self.assertEqual(status, 400)
        self.assertIn('GOOGLE_MAPS_API_KEY', json.loads(body)['error'])


if __name__ == '__main__':
    unittest.main()
