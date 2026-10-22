"""GPT-proposed ROI experiment. H fixed; keep original-scale and re-detected crop arms separate."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import ImageDraw
from pipeline import PRIVATE, Models, prepare, private_write, data_url, PREPROCESS, PrototypeError
from diagnostics import private_directory, json_write, crop_image, marked_panel, render_run
from diagnostic_geometry import estimate


def prepare_experiment(config_path):
    config=json.loads(config_path.read_text())
    if not 1 <= len(config['pairs']) <= 3:
        raise PrototypeError('영역 실험은 1~3쌍만 허용합니다.')
    directory=PRIVATE/'region-experiments'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+os.urandom(3).hex())
    blind=[];manifest=[]
    for pair in config['pairs']:
        a,b=prepare(Path(pair['query'])),prepare(Path(pair['candidate']))
        pid=os.urandom(8).hex()
        # Only clean pixel data and opaque IDs are sent to the proposal API.
        blind.append({'pairId':pid,'queryImage':data_url(a['image']),'candidateImage':data_url(b['image'])})
        manifest.append({**pair,'pairId':pid,'queryAnalysisHash':a['analysisHash'],'candidateAnalysisHash':b['analysisHash']})
    json_write(directory/'proposal-input.json',{'pairs':blind})
    json_write(directory/'manifest.json',{'pairs':manifest,'createdAt':datetime.now(timezone.utc).isoformat(),
        'protocol':'full / manual ROI / GPT ROI; fixed original-scale filtering and crop re-detection; H 4px; two diagnostic samples per arm'})
    print('영역 실험 준비 완료 · '+str(directory.relative_to(PRIVATE)),flush=True)
    return directory


def inside(points, roi, size):
    points=np.asarray(points).reshape(-1,2)
    x0,y0,x1,y1=roi
    return (points[:,0]>=x0*size[0])&(points[:,0]<=x1*size[0])&(points[:,1]>=y0*size[1])&(points[:,1]<=y1*size[1])


def filter_features(features, roi, image_size):
    points=features['keypoints'][0]
    x0,y0,x1,y1=roi
    keep=(points[:,0]>=x0*image_size[0])&(points[:,0]<=x1*image_size[0])&(points[:,1]>=y0*image_size[1])&(points[:,1]<=y1*image_size[1])
    result=dict(features)
    for key in ('keypoints','descriptors','keypoint_scores'):
        if key in features: result[key]=features[key][:,keep]
    return result


def map_points(points, box, match_size, target_size, analysis_size):
    points=np.asarray(points,dtype=np.float64).reshape(-1,2)
    mapped=points*np.array([(box[2]-box[0])/match_size[0],(box[3]-box[1])/match_size[1]])+np.array(box[:2])
    return mapped*np.array([target_size[0]/analysis_size[0],target_size[1]/analysis_size[1]])


def overlay_regions(a,b,roi0,roi1):
    pictures=[]
    for image,roi in ((a,roi0),(b,roi1)):
        im=image.copy();d=ImageDraw.Draw(im)
        d.rectangle([roi[0]*im.width,roi[1]*im.height,roi[2]*im.width,roi[3]*im.height],outline='#d69cff',width=4)
        pictures.append(data_url(im))
    return pictures


def h_comparison(p0,p1):
    h=estimate(p0,p1,'homography',4.)
    mask=np.array(h['inlierMask'],dtype=bool)
    selected=[]
    for values in (np.flatnonzero(mask),np.flatnonzero(~mask)):
        if len(values): selected.append(int(values[len(values)//2]))
    for i in np.linspace(0,max(0,len(p0)-1),min(2,len(p0)),dtype=int):
        if int(i) not in selected and len(selected)<2: selected.append(int(i))
    return {'homography':h,'fundamental':{'fitStatus':'not-run','inlierMask':[False]*len(p0),'inliers':0},
        'comparisonAvailable':False,'categories':{},'sampleIndices':selected,
        'sensitivity':{'homography':[h],'fundamental':[]}}


def validated_calls(manifest, proposals):
    calls={}
    for pair in manifest['pairs']:
        pid=pair['pairId']
        found=[c for c in proposals['calls'] if c['pairId']==pid and c['status']=='completed']
        if not found:
            raise PrototypeError('영역 제안 호출이 실패·누락되었습니다. 보류 응답과 API 실패를 구분해 먼저 확인하세요.')
        call=found[-1]
        output=call['modelOutput']
        if output['decision'] not in ('propose','abstain') or len(output['regions'])>2 or (output['decision']=='abstain') != (len(output['regions'])==0):
            raise PrototypeError('영역 제안 형식이 유효하지 않습니다.')
        calls[pid]=call
    return calls


def run_experiment(directory, device='cpu'):
    manifest=json.loads((directory/'manifest.json').read_text())
    proposals=json.loads((directory/'region-proposals.json').read_text())
    calls=validated_calls(manifest,proposals)
    started=time.perf_counter();models=Models(device,offline=True)
    run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-regions-'+os.urandom(3).hex()
    output=PRIVATE/'runs'/run_id
    candidates=[];visuals=[];samples=[];human={};sources=[];regions=[]
    cache={}
    for pair_index,pair in enumerate(manifest['pairs']):
        a,b=prepare(Path(pair['query'])),prepare(Path(pair['candidate']))
        if a['analysisHash']!=pair['queryAnalysisHash'] or b['analysisHash']!=pair['candidateAnalysisHash']:
            raise PrototypeError('영역 제안 이후 입력 이미지가 변경되었습니다.')
        for prepared in (a,b):
            if prepared['analysisHash'] not in cache: cache[prepared['analysisHash']]=models.local(prepared)
        base0,bf0=cache[a['analysisHash']];base1,bf1=cache[b['analysisHash']]
        call=calls[pair['pairId']];proposal=call['modelOutput']
        regions.append({'pairName':pair['name'],'pairId':pair['pairId'],'decision':proposal['decision'],'reason':proposal['reason'],
            'proposals':proposal['regions'],'responseId':call.get('responseId'),'responseModel':call.get('responseModel')})
        arms=[('전체 사진','full',None,None,None)]
        if pair.get('queryRoi') is not None and pair.get('candidateRoi') is not None:
            crop_image(a,pair['queryRoi']);crop_image(b,pair['candidateRoi'])
            for policy in ('fixed','crop'): arms.append(('직접 지정 영역','manual',pair['queryRoi'],pair['candidateRoi'],policy))
        for index,region in enumerate(proposal['regions']):
            crop_image(a,region['queryRoi']);crop_image(b,region['candidateRoi'])
            for policy in ('fixed','crop'): arms.append((f'GPT 제안 {index+1}','gpt',region['queryRoi'],region['candidateRoi'],policy))
        for arm_index,(label,origin,roi0,roi1,policy) in enumerate(arms):
            box0=[0,0,a['width'],a['height']];box1=[0,0,b['width'],b['height']]
            left,right=base0,base1;f0,f1=bf0,bf1
            if policy=='fixed':
                f0,f1=filter_features(bf0,roi0,base0.size),filter_features(bf1,roi1,base1.size)
            elif policy=='crop':
                im0,box0=crop_image(a,roi0);im1,box1=crop_image(b,roi1)
                left,f0=models.local({'image':im0});right,f1=models.local({'image':im1})
            p0,p1=models.match(f0,f1);comp=h_comparison(p0,p1)
            mapped0=map_points(p0,box0,left.size,base0.size,(a['width'],a['height']))
            mapped1=map_points(p1,box1,right.size,base1.size,(b['width'],b['height']))
            condition_id=f'p{pair_index+1}-a{arm_index+1}'
            selections=[]
            for point_index in comp['sampleIndices']:
                sid=hashlib.sha256(f'{run_id}:{condition_id}:{point_index}'.encode()).hexdigest()[:16]
                selections.append({'sampleId':sid,'pointIndex':point_index,'category':'H 통과' if comp['homography']['inlierMask'][point_index] else 'H 탈락'})
                # All conditions use original full-image context at the same 960px scale for review.
                samples.append({'sampleId':sid,'image':data_url(marked_panel(base0,base1,mapped0[point_index],mapped1[point_index]))})
                human[sid]=None
            diagnostics={'regionSource':origin,'scalePolicy':policy or 'full','queryRoiNormalized':roi0,'candidateRoiNormalized':roi1,
                'analysisBoxes':[box0,box1],'featureBudget':1024,'HThresholdMatchingPixels':4.,
                'note':'fixed reuses descriptors, original image_size and pixel coordinates; crop changes scale, detection, budget and H pixel tolerance'}
            if pair.get('queryRoi') is not None:
                counts=inside(mapped0,pair['queryRoi'],base0.size)&inside(mapped1,pair['candidateRoi'],base1.size)
                diagnostics['manualReferenceBothEndpoints']=int(counts.sum())
                diagnostics['manualReferenceHInliers']=int((counts&np.array(comp['homography']['inlierMask'],dtype=bool)).sum())
                diagnostics['manualReferenceMeaning']='rectangle containment only, not correct-point labels; never sent to API'
            policy_label={'fixed':'원래 해상도 · 영역 점만','crop':'잘라내기 · 다시 검출',None:''}[policy]
            name=pair['name']+' · '+label+(' · '+policy_label if policy_label else '')
            candidate={'rank':len(candidates)+1,'conditionId':condition_id,'conditionName':name,'pairName':pair['name'],
                'queryImageId':a['analysisHash'],'imageId':b['analysisHash'],'matches':len(p0),'inliers':comp['homography']['inliers'],
                'allQueryPoints':p0.tolist(),'allCandidatePoints':p1.tolist(),'inlierMask':comp['homography']['inlierMask'],
                'queryDetectedPoints':f0['keypoints'][0].cpu().tolist(),'candidateDetectedPoints':f1['keypoints'][0].cpu().tolist(),
                'queryDetectionScores':f0['keypoint_scores'][0].cpu().tolist(),'candidateDetectionScores':f1['keypoint_scores'][0].cpu().tolist(),
                'queryMatchSize':list(left.size),'candidateMatchSize':list(right.size),'mappedQueryPoints':mapped0.tolist(),'mappedCandidatePoints':mapped1.tolist(),
                'geometryComparison':comp,'roiDiagnostics':diagnostics,'reviewSamples':selections}
            candidates.append(candidate)
            visual={'queryImage':data_url(left),'image':data_url(right)}
            if roi0 is not None: visual['regionOverview']=overlay_regions(base0,base1,roi0,roi1)
            visuals.append(visual)
            print(f'영역 비교 조건 {len(candidates)}개 처리 완료',flush=True)
        sources.append({'pairId':pair['pairId'],'queryAnalysisHash':a['analysisHash'],'candidateAnalysisHash':b['analysisHash']})
    result={'schemaVersion':2,'experiment':'correspondence-diagnostics','protocol':'gpt-region-selection-v1','geometryMode':'homography-only',
        'createdAt':datetime.now(timezone.utc).isoformat(),'queryImageId':candidates[0]['queryImageId'],'elapsedSeconds':round(time.perf_counter()-started,3),
        'candidates':candidates,'sources':sources,'regionSelection':regions,'preprocessing':PREPROCESS,
        'runtime':{'device':models.device,'matchingMaxEdge':960,'maxKeypoints':1024,'embeddingRevision':models.revision,
            'matcher':'DISK + LightGlue','filterThreshold':float(models.matcher.conf.filter_threshold),'depthConfidence':-1,'widthConfidence':-1,
            'versions':{name:importlib.metadata.version(name) for name in ('torch','lightglue','kornia','numpy','opencv-python','Pillow')}},
        'sampling':'at most two per arm: one H pass and one H reject, midpoint then evenly-spaced fill; same full-image review scale; not random accuracy evaluation',
        'limitations':['ROI proposals are hypotheses, not object or same-place ground truth','Same model family for selection and review is not independent validation',
            'Manual reference rectangle containment is not matching accuracy','No geolocation or risk estimation','H 4px fixed in matching coordinates; crop changes equivalent physical tolerance']}
    json_write(output/'report.json',result);json_write(output/'visuals.json',visuals)
    batches=[{'batchId':os.urandom(8).hex(),'samples':samples[i:i+4]} for i in range(0,len(samples),4)]
    if len(batches)>10: raise PrototypeError('보조 검토 예산 10회 초과')
    json_write(output/'review-input.json',{'schemaVersion':1,'batches':batches});json_write(output/'human-review.json',human)
    json_write(output/'region-proposals.json',proposals)
    render_run(output)
    from report_hub import discover_reports,write_pages,save_metadata
    save_metadata(PRIVATE,'run-'+run_id,'영역 선택 실험 · 전체·직접 지정·GPT 제안 비교',
        'GPT 영역 제안과 원래 해상도 필터·잘라내기 재검출 비교. H 4px 유지. 영역 경계와 정확한 대응점을 사람 확인할 것. GPT 제안·보조 검토는 정답이 아님.')
    write_pages(PRIVATE,discover_reports(PRIVATE))
    print('영역 실험 회차 저장 완료 · '+run_id,flush=True)
    return output


def main():
    p=argparse.ArgumentParser(description='GPT 영역 제안과 고정 해상도·잘라내기 비교 실험')
    sub=p.add_subparsers(dest='command',required=True)
    prep=sub.add_parser('prepare');prep.add_argument('--config',type=Path,required=True)
    run=sub.add_parser('run');run.add_argument('--experiment',type=Path,required=True);run.add_argument('--device',choices=['cpu','cuda'],default='cpu')
    args=p.parse_args()
    try:
        if args.command=='prepare': prepare_experiment(private_directory(args.config))
        else: run_experiment(private_directory(args.experiment),args.device)
        return 0
    except Exception as error:
        print(f'영역 실험 실패 ({type(error).__name__}). 비공개 입력·제안 상태·모델을 확인하세요.',file=sys.stderr)
        return 1


if __name__=='__main__': sys.exit(main())
