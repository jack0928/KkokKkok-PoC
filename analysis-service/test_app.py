import io
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import app


class VisionStageTests(unittest.TestCase):
    def test_bbox_is_normalized_left_top_right_bottom(self):
        self.assertEqual(app._rect([[20, 10], [60, 10], [60, 30], [20, 30]], 100, 50),
                         [0.2, 0.2, 0.6, 0.6])

    def test_bbox_clips_to_image_and_rejects_empty_region(self):
        self.assertEqual(app._rect([[-5, 5], [20, 5], [20, 20], [-5, 20]], 100, 100),
                         [0.0, 0.05, 0.2, 0.2])
        self.assertIsNone(app._rect([[10, 10], [10, 10]], 100, 100))

    def test_image_validation_rejects_animated_or_unsupported_format(self):
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="GIF")
        with self.assertRaises(HTTPException) as error:
            app._open_image(buffer.getvalue())
        self.assertEqual(error.exception.status_code, 415)


if __name__ == "__main__":
    unittest.main()
