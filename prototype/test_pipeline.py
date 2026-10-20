"""Privacy/input and geometric evidence tests. No model downloads or paid API."""
import io
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from pipeline import PrototypeError, geometry, prepare


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


if __name__ == "__main__":
    unittest.main()
