"""Persistence and localhost request boundaries, without models or API calls."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from report_hub import discover_reports, hub_html
from report_server import handler_for
from test_diagnostics import make_fixture


class ReviewTests(unittest.TestCase):
    def test_runs_and_persistent_review_with_request_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            run = directory / 'runs' / 'test-run'
            run.mkdir(parents=True)
            result = {'queryImageId': 'a' * 64, 'createdAt': '2026-10-20T12:00:00Z', 'candidates': []}
            original = json.dumps(result)
            (run / 'report.json').write_text(original)
            (run / 'report.html').write_text('<!doctype html><title>fixture</title>')
            server = HTTPServer(('127.0.0.1', 0), handler_for(directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = HTTPConnection('127.0.0.1', server.server_port)
            origin = f'http://127.0.0.1:{server.server_port}'
            try:
                reports = discover_reports(directory)
                self.assertIn('2026-10-20', reports[0]['name'])
                body = json.dumps({'key': 'run-test-run', 'name': '<script>name</script>', 'comment': '검토 메모'})
                connection.request('POST', '/api/review', body, {'Origin': origin, 'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                response.read()
                reports = discover_reports(directory)
                self.assertEqual(reports[0]['comment'], '검토 메모')
                self.assertIn('&lt;script&gt;name', hub_html(reports))
                self.assertEqual((run / 'report.json').read_text(), original)
                for path, expected in [('/', 200), ('/review-run-test-run.html', 200), ('/runs/test-run/report.html', 200), ('/review-metadata.json', 404), ('/../models/weights', 404)]:
                    connection.request('GET', path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    response.read()
                connection.request('POST', '/api/review', body, {'Origin': 'http://external.example', 'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
                connection.request('GET', '/', headers={'Host': 'external.example'})
                response = connection.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join()


    def test_point_review_endpoint_persists_separate_human_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            run=directory/'runs'/'fixture'
            run.mkdir(parents=True)
            sid=make_fixture(run)
            experiment=(run/'report.json').read_bytes()
            model=(run/'model-review.json').read_bytes()
            server=HTTPServer(('127.0.0.1',0),handler_for(directory))
            thread=threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            connection=HTTPConnection('127.0.0.1',server.server_port)
            headers={'Origin':f'http://127.0.0.1:{server.server_port}','Content-Type':'application/json'}
            try:
                connection.request('GET','/review-run-fixture.html')
                response=connection.getresponse()
                self.assertEqual(response.status,200)
                self.assertIn(b'point-review-form',response.read())
                for sample,verdict,expected in [(sid,'same-point',200),('unknown','same-point',400),(sid,'ground-truth',400),(sid,None,200)]:
                    connection.request('POST','/api/point-review',json.dumps({'key':'run-fixture','sampleId':sample,'verdict':verdict,'reason':'사람 이유'}),headers)
                    response=connection.getresponse()
                    self.assertEqual(response.status,expected)
                    response.read()
                self.assertIsNone(json.loads((run/'human-review.json').read_text())[sid])
                self.assertEqual((run/'report.json').read_bytes(),experiment)
                self.assertEqual((run/'model-review.json').read_bytes(),model)
            finally:
                connection.close();server.shutdown();server.server_close();thread.join()


if __name__ == '__main__':
    unittest.main()
