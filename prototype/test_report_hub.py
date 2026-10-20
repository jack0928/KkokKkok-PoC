"""Saved report discovery, completeness and escaping; no model execution."""
import json
from pathlib import Path
import tempfile
import unittest

from pipeline import PrototypeError
from report_hub import discover_reports, hub_html, review_html


class HubTests(unittest.TestCase):
    def save(self, directory, group, complete=True):
        candidate = {"matches": 2, "inliers": 1}
        if complete:
            candidate.update(allQueryPoints=[[1, 2], [3, 4]], allCandidatePoints=[[2, 3], [4, 5]],
                             inlierMask=[True, False])
        data = {"queryImageId": "a" * 64, "candidates": [candidate], "createdAt": "2026-10-20T00:00:00Z"}
        (directory / f"group-{group}-report.json").write_text(json.dumps(data))
        (directory / f"group-{group}-report.html").write_text("<!doctype html><title>test fixture</title>")

    def test_groups_sort_numerically_and_saved_coordinate_completeness_is_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for group in (10, 2, 1):
                self.save(directory, group, complete=group != 2)
            reports = discover_reports(directory)
            self.assertEqual([r["group"] for r in reports], ["1", "2", "10"])
            self.assertEqual([r["complete"] for r in reports], [True, False, True])
            self.assertEqual(reports[0]["matches"], 2)

    def test_truncated_point_arrays_are_not_described_as_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.save(directory, 1)
            path = directory / "group-1-report.json"
            data = json.loads(path.read_text())
            data["candidates"][0]["inlierMask"] = [True]
            path.write_text(json.dumps(data))
            self.assertFalse(discover_reports(directory)[0]["complete"])

    def test_evaluation_page_is_preferred_and_reference_label_is_escaped(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.save(directory, 1)
            (directory / "group-1-evaluation.html").write_text("<!doctype html><title>evaluation</title>")
            (directory / "group-1-evaluation.json").write_text(json.dumps({"reference": '<img src="private">'}))
            reports = discover_reports(directory)
            self.assertEqual(reports[0]["page"], "group-1-evaluation.html")
            content = review_html(reports[0])
            self.assertNotIn('<img src="private">', content)
            self.assertIn('sandbox="allow-scripts"', content)
            self.assertNotIn('allow-same-origin', content)
            self.assertNotIn('role="tab"', hub_html(reports))
            self.assertIn('review-1.html', hub_html(reports))
            self.assertIn("script-src 'sha256-", content)

    def test_missing_html_or_empty_directory_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaises(PrototypeError):
                discover_reports(directory)
            self.save(directory, 1)
            (directory / "group-1-report.html").unlink()
            with self.assertRaises(PrototypeError):
                discover_reports(directory)


if __name__ == "__main__":
    unittest.main()
