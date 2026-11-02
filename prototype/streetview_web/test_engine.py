"""Engine orchestration tests and an opt-in real offline-model smoke test."""
import io
import os
import sys
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from service import ComparisonEngine, InputError, ROOT
sys.path.insert(0, str(ROOT / 'prototype'))
from pipeline import PRIVATE


def fixture():
    stream = io.BytesIO()
    Image.new('RGB', (100, 100), '#607a91').save(stream, 'PNG')
    return stream.getvalue()


class References:
    def __init__(self, content):
        self.content, self.calls = content, 0

    def references(self, address, progress):
        self.calls += 1
        return {'date': 'synthetic', 'copyright': 'synthetic', 'panoramaId': 'fixture'}, [(h, self.content) for h in (0, 90, 180, 270)]


class FakeModels:
    device = 'cpu'
    revision = 'fixture'

    def local(self, prepared):
        return prepared['image'], {}

    def match(self, a, b):
        return np.empty((0, 2), np.float32), np.empty((0, 2), np.float32)


class EngineTests(unittest.TestCase):
    def test_multiple_queries_all_directions_no_persistent_image_or_vector(self):
        references = References(fixture())
        runtime = PRIVATE.parent / 'streetview-web' / 'runtime'
        before = set(runtime.glob('*')) if runtime.exists() else set()
        engine = ComparisonEngine(FakeModels)
        with patch.object(engine, '_embed', return_value=np.array([1., 0.])):
            result = engine.compare([fixture(), fixture()], 'fixture-address', references, lambda _: None)
        self.assertEqual(len(result['queries']), 2)
        self.assertEqual(references.calls, 1)
        for query in result['queries']:
            self.assertEqual({c['heading'] for c in query['candidates']}, {0, 90, 180, 270})
        self.assertEqual(set(runtime.glob('*')), before)
        self.assertEqual(len(result['references']), 4)

    def test_invalid_upload_before_google_or_model_loading(self):
        references = References(fixture())
        def model_factory():
            self.fail('Invalid uploads must fail before loading models')
        with self.assertRaises(InputError):
            ComparisonEngine(model_factory).compare([b'not-image'], 'fixture-address', references, lambda _: None)
        self.assertEqual(references.calls, 0)

    @unittest.skipUnless(os.environ.get('RUN_STREETVIEW_MODEL_TEST') == '1', 'Opt-in real models; Google remains mocked')
    def test_real_offline_models_with_synthetic_references(self):
        from pipeline import png_bytes, synthetic_scene
        content = png_bytes(synthetic_scene(42))
        result = ComparisonEngine().compare([content], 'synthetic-no-network', References(content), lambda _: None)
        self.assertEqual(len(result['queries'][0]['candidates']), 4)
        self.assertTrue(all(p['inliers'] >= 12 for p in result['queries'][0]['candidates']))
        self.assertTrue(result['embeddingRevision'])


if __name__ == '__main__':
    unittest.main()
