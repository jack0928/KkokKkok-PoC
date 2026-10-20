"""Privacy/input and geometric evidence tests. No model downloads or paid API."""
import io
import base64
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest

import numpy as np
from PIL import Image

from pipeline import PrototypeError, geometry, prepare, report_html, script_json


class PreparationTests(unittest.TestCase):
    def test_mpo_jpeg_uses_only_primary_image_and_strips_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "phone.jpeg"
            primary = Image.new("RGB", (80, 40), "red")
            auxiliary = Image.new("RGB", (20, 10), "blue")
            exif = Image.Exif()
            exif[270] = "private metadata"
            primary.save(source, format="MPO", save_all=True, append_images=[auxiliary], exif=exif)
            with Image.open(source) as original:
                self.assertEqual(original.n_frames, 2)
            prepared = prepare(source)
            self.assertTrue(prepared["primaryJpegOnly"])
            with Image.open(io.BytesIO(prepared["bytes"])) as analysis:
                self.assertEqual(analysis.format, "JPEG")
                self.assertEqual(analysis.size, (80, 40))
                self.assertEqual(dict(analysis.getexif()), {})
                red, green, blue = analysis.getpixel((20, 20))
                self.assertGreater(red, 240)
                self.assertLess(blue, 10)

    def test_analysis_removes_metadata_and_normalizes_orientation(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "private-name.jpg"
            image = Image.new("RGB", (80, 40), "red")
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = "private metadata must not survive"
            image.save(source, exif=exif)
            prepared = prepare(source)
            with Image.open(io.BytesIO(prepared["bytes"])) as analysis:
                self.assertEqual(analysis.size, (40, 80))
                self.assertEqual(dict(analysis.getexif()), {})
            self.assertNotIn(b"private metadata", prepared["bytes"])
            self.assertNotEqual(prepared["originalHash"], prepared["analysisHash"])
            self.assertNotIn("path", prepared)

    def test_unsupported_and_damaged_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "private-input.gif"
            Image.new("RGB", (10, 10)).save(source)
            with self.assertRaises(PrototypeError):
                prepare(source)
            source.write_bytes(b"not an image")
            with self.assertRaises(PrototypeError):
                prepare(source)

    def test_transparent_pixels_are_flattened_to_white(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "alpha.png"
            Image.new("RGBA", (20, 20), (0, 0, 0, 0)).save(source)
            self.assertTrue(np.array(prepare(source)["image"]).min() >= 250)

    def test_large_image_is_resized_and_duplicates_are_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "large.png"
            Image.new("RGB", (2400, 1200), "blue").save(source)
            first, second = prepare(source), prepare(source)
            self.assertEqual((first["width"], first["height"]), (2048, 1024))
            self.assertEqual(first["analysisHash"], second["analysisHash"])


class GeometryTests(unittest.TestCase):
    def test_consistent_transform_is_supported_but_outliers_are_removed(self):
        rng = np.random.default_rng(9)
        points0 = rng.uniform(10, 450, (30, 2)).astype(np.float32)
        points1 = points0 * 0.8 + (20, 30)
        points1[-5:] = rng.uniform(0, 500, (5, 2))
        stats, mask = geometry(points0, points1, (500, 500), (500, 500))
        self.assertEqual(stats["status"], "visual-correspondence")
        self.assertEqual(stats["inliers"], 25)
        self.assertFalse(mask[-5:].any())

    def test_random_matches_are_not_supported(self):
        rng = np.random.default_rng(22)
        a, b = rng.uniform(0, 500, (2, 40, 2)).astype(np.float32)
        stats, _ = geometry(a, b, (500, 500), (500, 500))
        self.assertEqual(stats["status"], "insufficient-evidence")

    def test_tiny_repeated_pattern_does_not_pass_coverage(self):
        rng = np.random.default_rng(13)
        a = rng.uniform(0, 10, (30, 2)).astype(np.float32)
        stats, _ = geometry(a, a + 20, (500, 500), (500, 500))
        self.assertEqual(stats["status"], "insufficient-evidence")

    def test_no_matches_is_judgment_withheld(self):
        empty = np.empty((0, 2), dtype=np.float32)
        stats, mask = geometry(empty, empty, (500, 500), (500, 500))
        self.assertEqual(stats["inliers"], 0)
        self.assertEqual(stats["status"], "insufficient-evidence")
        self.assertEqual(len(mask), 0)


class ReportTests(unittest.TestCase):
    def render(self, legacy=False):
        image = Image.new("RGB", (100, 80), "blue")
        candidate = {"rank": 1, "imageId": "a" * 64, "status": "insufficient-evidence",
            "similarity": 0.5, "matches": 3, "inliers": 2, "inlierRatio": 2/3,
            "queryCoverage": 0.1, "candidateCoverage": 0.1,
            "queryPoints": [[10, 10], [20, 20]], "candidatePoints": [[12, 12], [22, 22]],
            "reviewLabel": "</script><script>alert('private')</script>",
            "fixtureDescription": "<img src=https://example.com/private>"}
        if not legacy:
            candidate.update(allQueryPoints=[[10, 10], [50, 50], [20, 20]],
                             allCandidatePoints=[[12, 12], [80, 2], [22, 22]],
                             inlierMask=[True, False, True])
        result = {"candidates": [candidate], "inputKind": "synthetic", "galleryCount": 1,
            "elapsedSeconds": 1, "cacheHits": 0, "createdAt": "2026-10-20T00:00:00Z",
            "timings": {"models": 0, "retrieval": 0, "matching": 1},
            "runtime": {"device": "cpu", "embeddingModel": "test", "embeddingRevision": "test"},
            "thresholds": {"minimumInliers": 12, "minimumRatio": .35, "minimumCoverage": .02}}
        return report_html(result, image, [{"query": image, "candidate": image, "comparison": image}])

    def payload(self, content):
        return json.loads(re.search(r'<script type="application/json" id="match-data">(.*?)</script>', content, re.S)[1])

    def test_full_report_preserves_rejected_points_and_blocks_script_injection(self):
        content = self.render()
        pair = self.payload(content)["pairs"][0]
        self.assertEqual(pair["queryPoints"][1], [50, 50])
        self.assertEqual(pair["inlierMask"], [True, False, True])
        self.assertTrue(pair["complete"])
        self.assertNotIn("<script>alert", content)
        self.assertNotIn("<img src=https://", content)
        # Only scripts explicitly hashed by the local generator can execute.
        script = (Path(__file__).parent / "viewer.js").read_text()
        signature = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
        self.assertIn("script-src 'sha256-" + signature + "'", content)
        self.assertNotIn("script-src 'unsafe-inline'", content)

    def test_legacy_report_does_not_invent_rejected_coordinates(self):
        pair = self.payload(self.render(legacy=True))["pairs"][0]
        self.assertFalse(pair["complete"])
        self.assertEqual(len(pair["queryPoints"]), 2)
        self.assertEqual(pair["totalMatches"], 3)
        self.assertEqual(pair["inlierMask"], [True, True])

    def test_embedded_json_cannot_close_its_script_element(self):
        text = "</script><script>unexpected()</script>&"
        encoded = script_json({"text": text})
        self.assertNotIn("<", encoded)
        self.assertNotIn("&", encoded)
        self.assertEqual(json.loads(encoded)["text"], text)


if __name__ == "__main__":
    unittest.main()
