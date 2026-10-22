"""Region-only matching controls, coordinate consistency and H-only protocol; no paid API."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import torch

from region_experiment import filter_features, map_points, h_comparison, validated_calls
from diagnostics import render_run
from test_diagnostics import make_fixture
from pipeline import PrototypeError


class RegionExperimentTests(unittest.TestCase):
    def test_filter_preserves_original_coordinates_descriptors_size_and_source(self):
        features={'keypoints':torch.tensor([[[10.,10.],[50.,50.],[90.,90.]]]),
            'descriptors':torch.tensor([[[1.,2.],[3.,4.],[5.,6.]]]),
            'keypoint_scores':torch.tensor([[.1,.2,.3]]),'image_size':torch.tensor([[100,100]])}
        original={k:v.clone() for k,v in features.items()}
        selected=filter_features(features,[.2,.2,.8,.8],(100,100))
        self.assertEqual(selected['keypoints'].tolist(),[[[50.,50.]]])
        self.assertEqual(selected['descriptors'].tolist(),[[[3.,4.]]])
        self.assertTrue(torch.equal(selected['image_size'],original['image_size']))
        for key in original:self.assertTrue(torch.equal(original[key],features[key]))
        empty=filter_features(features,[.2,.2,.3,.3],(100,100))
        self.assertEqual(tuple(empty['descriptors'].shape),(1,0,2))

    def test_crop_coordinates_map_back_to_same_original_review_scale(self):
        mapped=map_points([[0,0],[100,200]],[200,100,600,900],(100,200),(500,500),(1000,1000))
        np.testing.assert_allclose(mapped,[[100,50],[300,450]])
        self.assertEqual(map_points([], [0,0,100,100],(100,100),(100,100),(100,100)).shape,(0,2))

    def test_h_only_never_calls_fundamental_matrix_and_handles_no_matches(self):
        with patch('diagnostic_geometry.cv2.findFundamentalMat',side_effect=AssertionError('F must not run')):
            comparison=h_comparison(np.array([[10,10],[10,80],[80,80],[80,10]]),np.array([[12,12],[12,82],[82,82],[82,12]]))
            self.assertEqual(comparison['homography']['inliers'],4)
            self.assertEqual(comparison['fundamental']['fitStatus'],'not-run')
            self.assertEqual(len(comparison['sampleIndices']),2)
            self.assertEqual(h_comparison(np.empty((0,2)),np.empty((0,2)))['sampleIndices'],[])

    def test_abstention_is_valid_but_failed_or_missing_call_is_not(self):
        manifest={'pairs':[{'pairId':'pair'}]}
        call={'pairId':'pair','status':'completed','modelOutput':{'decision':'abstain','regions':[]}}
        self.assertEqual(validated_calls(manifest,{'calls':[call]})['pair'],call)
        with self.assertRaises(PrototypeError):validated_calls(manifest,{'calls':[]})
        with self.assertRaises(PrototypeError):validated_calls(manifest,{'calls':[{**call,'status':'failed'}]})
        with self.assertRaises(PrototypeError):validated_calls(manifest,{'calls':[{**call,'modelOutput':{'decision':'propose','regions':[]}}]})

    def test_h_only_report_explains_protocol_and_escapes_proposal_reason(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            make_fixture(directory)
            original=json.loads((directory/'report.json').read_text())
            original['geometryMode']='homography-only'
            original['regionSelection']=[{'pairName':'fixture','decision':'abstain','reason':'<script>bad</script>','proposals':[]}]
            points=np.array(original['candidates'][0]['allQueryPoints'])
            original['candidates'][0]['geometryComparison']=h_comparison(points,points)
            (directory/'report.json').write_text(json.dumps(original))
            render_run(directory)
            content=(directory/'report.html').read_text()
            self.assertIn('이번 회차에서 F는 실행하지 않습니다',content)
            self.assertNotIn('<th>F 통과</th>',content)
            self.assertNotIn('<script>bad</script>',content)
            self.assertIn('&lt;script&gt;bad',content)


if __name__=='__main__':unittest.main()
