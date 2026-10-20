"""Diagnostics: geometric hypotheses, crop coordinates, blind samples and review isolation."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from diagnostic_geometry import estimate, compare_geometry
from diagnostics import crop_image, marked_panel, save_human_review, json_write, render_run, human_review_markup
from pipeline import PrototypeError, data_url


def make_fixture(directory):
    image=Image.new('RGB',(100,100),'blue')
    url=data_url(image)
    points=[[10,10],[10,80],[80,80],[80,10]]
    comparison=compare_geometry(points,points)
    sid='0123456789abcdef'
    candidate={'conditionName':'<unsafe> fixture','matches':4,'inliers':4,
        'allQueryPoints':points,'allCandidatePoints':points,'queryDetectedPoints':points,'candidateDetectedPoints':points,
        'geometryComparison':comparison,'reviewSamples':[{'sampleId':sid,'pointIndex':0,'category':'homography-only'}]}
    original={'experiment':'correspondence-diagnostics','queryImageId':'a'*64,'createdAt':'2026-10-20T00:00:00Z',
        'candidates':[{**candidate,'inlierMask':[True]*4}]}
    json_write(directory/'report.json',original)
    json_write(directory/'visuals.json',[{'queryImage':url,'image':url}])
    json_write(directory/'review-input.json',{'batches':[{'samples':[{'sampleId':sid,'image':url}]}]})
    json_write(directory/'human-review.json',{sid:None})
    json_write(directory/'model-review.json',{'calls':[{'status':'completed','modelOutput':{'reviews':[{
        'sampleId':sid,'verdict':'uncertain','reason':'<script>model</script>','uncertainty':'blur'}]}}]})
    render_run(directory)
    return sid


class DiagnosticGeometryTests(unittest.TestCase):
    def test_nonplanar_projection_supports_epipolar_model_and_rejects_outliers(self):
        rng = np.random.default_rng(27)
        xyz = rng.uniform([-1.5,-1,3],[1.5,1,9],(100,3))
        def project(points):
            return points[:,:2]/points[:,2:3]*400+250
        a = project(xyz)
        b = project(xyz+np.array([.6,.04,.1])) + rng.normal(0,.05,(100,2))
        b[-20:] = rng.uniform(0,500,(20,2))
        comp = compare_geometry(a,b)
        self.assertTrue(comp['comparisonAvailable'])
        self.assertGreater(comp['fundamental']['inliers'], comp['homography']['inliers'])
        self.assertGreaterEqual(comp['fundamental']['inliers'], 75)
        self.assertLessEqual(sum(comp['fundamental']['inlierMask'][-20:]), 3)
        self.assertEqual(len(comp['fundamental']['residuals']),100)
        self.assertEqual(sum(comp['categories'].values()),100)
        self.assertLessEqual(len(comp['sampleIndices']),4)
        self.assertEqual(comp['sampleIndices'],compare_geometry(a,b)['sampleIndices'])

    def test_insufficient_points_are_not_an_estimated_fundamental_matrix(self):
        rng=np.random.default_rng(3)
        a=rng.uniform(10,200,(11,2))
        comp=compare_geometry(a,a+10)
        self.assertEqual(comp['fundamental']['fitStatus'],'insufficient-points')
        self.assertIsNone(comp['fundamental']['matrix'])
        self.assertFalse(comp['comparisonAvailable'])
        empty=np.empty((0,2))
        self.assertEqual(compare_geometry(empty,empty)['sampleIndices'],[])

    def test_invalid_coordinate_or_method_is_rejected(self):
        with self.assertRaises(ValueError):
            estimate([[np.nan,1]],[[1,2]],'homography',4)
        with self.assertRaises(ValueError):
            estimate([],[],'invalid',4)


class DiagnosticInputTests(unittest.TestCase):
    def test_normalized_crop_uses_analysis_coordinates(self):
        image=Image.new('RGB',(800,600),'blue')
        crop,box=crop_image({'image':image,'width':800,'height':600},[.25,.25,.75,.75])
        self.assertEqual(crop.size,(400,300))
        self.assertEqual(box,[200,150,600,450])
        for invalid in ([.8,0,.2,1],[0,0,2,1],[0,0,.01,.01]):
            with self.assertRaises(PrototypeError):
                crop_image({'image':image,'width':800,'height':600},invalid)

    def test_blind_panel_has_neutral_markings_and_no_metadata(self):
        image=Image.new('RGB',(100,100),'blue')
        panel=marked_panel(image,image,[50,50],[50,50])
        self.assertEqual(panel.size,(768,640))
        self.assertEqual(dict(panel.getexif()),{})
        stream=io.BytesIO();panel.save(stream,format='JPEG')
        self.assertNotIn(b'homography',stream.getvalue())

    def test_human_review_never_overwrites_model_or_experiment_and_rejects_unknown_sample(self):
        with tempfile.TemporaryDirectory() as temporary:
            d=Path(temporary)
            original=json.dumps({'candidates':[{'reviewSamples':[{'sampleId':'known'}]}]})
            (d/'report.json').write_text(original)
            (d/'model-review.json').write_text('{"calls":[]}')
            (d/'human-review.json').write_text('{"known":null}')
            with patch('diagnostics.render_run'):
                save_human_review(d,'known','same-point','검토 이유')
                self.assertEqual(json.loads((d/'human-review.json').read_text())['known']['verdict'],'same-point')
                self.assertEqual((d/'report.json').read_text(),original)
                self.assertEqual((d/'model-review.json').read_text(),'{"calls":[]}')
                with self.assertRaises(ValueError):
                    save_human_review(d,'unknown','same-point','')
                save_human_review(d,'known',None,'')
                self.assertIsNone(json.loads((d/'human-review.json').read_text())['known'])

    def test_render_escapes_reviews_and_disables_unestimated_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            make_fixture(directory)
            content=(directory/'report.html').read_text()
            self.assertNotIn('<script>model</script>',content)
            self.assertIn('&lt;script&gt;model',content)
            self.assertIn('검증 방식 간 비교 불가',content)
            self.assertIn('추정 불가',content)
            human=human_review_markup(directory,'run-fixture')
            self.assertNotIn('<unsafe>',human)
            self.assertIn('data-sample="0123456789abcdef"',human)
            self.assertIn('미검토',human)


if __name__=='__main__':
    unittest.main()
