"""Local correspondence diagnostics, separate from the main Feature Discovery workflow."""
import argparse
from datetime import datetime, timezone
import hashlib
import html
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw
from pipeline import (PRIVATE, ROOT, Models, PrototypeError, PREPROCESS, prepare, private_write,
                      data_url, script_json, viewer_markup)
from diagnostic_geometry import compare_geometry


def crop_image(prepared, region):
    if region is None:
        return prepared['image'].copy(), [0, 0, prepared['width'], prepared['height']]
    if len(region) != 4 or not all(isinstance(v, (float, int)) and np.isfinite(v) and 0 <= v <= 1 for v in region):
        raise PrototypeError('영역은 0~1 사이의 좌표 네 개여야 합니다.')
    x0, y0, x1, y1 = region
    if x1 <= x0 or y1 <= y0:
        raise PrototypeError('영역의 너비·높이는 양수여야 합니다.')
    box = [round(x0*prepared['width']), round(y0*prepared['height']), round(x1*prepared['width']), round(y1*prepared['height'])]
    if min(box[2]-box[0], box[3]-box[1]) < 32:
        raise PrototypeError('선택 영역은 최소 32px이어야 합니다.')
    return prepared['image'].crop(box), box


def marked_panel(image0, image1, point0, point1):
    """Neutral context and close-ups; contains no algorithm verdict, category or human labels."""
    panel = Image.new('RGB', (768, 640), '#101827')
    draw = ImageDraw.Draw(panel)
    for side, (source, point) in enumerate(((image0, point0), (image1, point1))):
        offset = side * 384
        context = source.copy()
        context.thumbnail((376, 300))
        x, y = point[0]*context.width/source.width, point[1]*context.height/source.height
        panel.paste(context, (offset, 20))
        draw.ellipse((offset+x-5, 20+y-5, offset+x+5, 20+y+5), outline='white', width=2)
        draw.text((offset+8, 4), 'A' if side == 0 else 'B', fill='white')
        radius = 64
        box = (round(point[0])-radius, round(point[1])-radius, round(point[0])+radius, round(point[1])+radius)
        zoom = source.crop(box).resize((288, 288), Image.Resampling.NEAREST)
        px, py = offset+44, 342
        panel.paste(zoom, (px, py))
        x, y = px+144, py+144
        for color, width in [('black', 5), ('white', 2)]:
            draw.line((x-10, y, x+10, y), fill=color, width=width)
            draw.line((x, y-10, x, y+10), fill=color, width=width)
    return panel


def private_directory(path):
    path = path.resolve()
    if path != PRIVATE.resolve() and PRIVATE.resolve() not in path.parents:
        raise PrototypeError('진단 파일은 private-data/pipeline 안에 보관하세요.')
    return path


def json_write(path, value):
    private_write(path, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode())


def load_reviews(directory):
    def read(name, default):
        path = directory / name
        return json.loads(path.read_text()) if path.is_file() else default
    return read('model-review.json', None), read('human-review.json', {})


def build_summary(directory):
    from collections import Counter
    original=json.loads((directory/'report.json').read_text())
    model,human=load_reviews(directory)
    opinions={s['sampleId']:s for call in (model or {}).get('calls',[]) if call['status']=='completed' for s in call['modelOutput']['reviews']}
    conditions=[]
    for candidate in original['candidates']:
        comp=candidate['geometryComparison']
        conditions.append({'conditionName':candidate['conditionName'],'matches':candidate['matches'],
            'homographyInliers':comp['homography']['inliers'],
            'fundamentalInliers':comp['fundamental']['inliers'] if comp['fundamental']['fitStatus']=='estimated' else None,
            'sampleModelVerdicts':dict(Counter(opinions[s['sampleId']]['verdict'] for s in candidate['reviewSamples'] if s['sampleId'] in opinions)),
            'sampleCount':len(candidate['reviewSamples']),
            'humanReviewed':sum(human.get(s['sampleId']) is not None for s in candidate['reviewSamples'])})
    return {'sourceCreatedAt':original['createdAt'],'conditions':conditions,
            'completedApiCalls':sum(c['status']=='completed' for c in (model or {}).get('calls',[])),
            'failedApiCalls':sum(c['status']!='completed' for c in (model or {}).get('calls',[])),
            'usage':{key:sum(c.get('usage',{}).get(key,0) for c in (model or {}).get('calls',[]) if c.get('usage')) for key in ('input_tokens','output_tokens')},
            'interpretation':'Diagnostic model opinions only. Not accuracy, same-place labels, or risk scores.'}


def render_report(directory):
    result = json.loads((directory/'report.json').read_text())
    images = json.loads((directory/'visuals.json').read_text())
    inputs = json.loads((directory/'review-input.json').read_text())
    model, human = load_reviews(directory)
    model_items = {s['sampleId']: s for call in (model or {}).get('calls', []) if call.get('status') == 'completed' for s in call['modelOutput']['reviews']}
    sample_images = {s['sampleId']: s['image'] for batch in inputs['batches'] for s in batch['samples']}
    cards, pairs = [], []
    for index, (candidate, visual) in enumerate(zip(result['candidates'], images)):
        comp = candidate['geometryComparison']
        comparable = comp['homography']['fitStatus'] == comp['fundamental']['fitStatus'] == 'estimated'
        pairs.append({**visual, 'queryPoints': candidate['allQueryPoints'], 'candidatePoints': candidate['allCandidatePoints'],
            'queryDetectedPoints': candidate['queryDetectedPoints'], 'candidateDetectedPoints': candidate['candidateDetectedPoints'],
            'geometryMasks': {k: comp[k]['inlierMask'] for k in ('homography', 'fundamental')},
            'geometryAvailable': {k: comp[k]['fitStatus'] == 'estimated' for k in ('homography', 'fundamental')},
            'inlierMask': comp['homography']['inlierMask'], 'totalMatches': candidate['matches'],
            'totalInliers': candidate['inliers'], 'complete': True})
        samples = []
        for sample in candidate['reviewSamples']:
            sid = sample['sampleId']
            review = model_items.get(sid)
            person = human.get(sid)
            model_text = '미실행 · 실제 GPT 검토 결과 없음' if not review else f"{review['verdict']} · {review['reason']} · 불확실성: {review['uncertainty']}"
            human_text = '미검토' if not person else f"{person['verdict']} · {person['reason']}"
            category = sample['category'] if comparable else '검증 방식 간 비교 불가 · 추정 실패 또는 점 수 부족'
            samples.append(f'''<details id="sample-{sid}"><summary>표본 #{sample['pointIndex']+1} · {html.escape(category)}</summary>
            <img class="sample-panel" src="{sample_images[sid]}" alt="중립 표시의 대응점 문맥과 확대 이미지">
            <p>GPT 보조 의견: {html.escape(model_text)}</p><p>사람 검토: {html.escape(human_text)}</p></details>''')
        sensitivity = ''.join(f"<li>{method}: "+' / '.join(f"{run['thresholdPixels']:g}px → {run['inliers']}개" for run in comp['sensitivity'][method])+"</li>" for method in ('homography','fundamental'))
        f_count = str(comp['fundamental']['inliers'])+'개' if comp['fundamental']['fitStatus']=='estimated' else '추정 불가 (F RANSAC은 최소 15쌍 필요)'
        agreement = f"둘 다 {comp['categories']['both']}개 · H만 {comp['categories']['homography-only']}개 · F만 {comp['categories']['fundamental-only']}개" if comparable else '한쪽 변환을 추정하지 못해 통과·탈락 비교 불가'
        cards.append(f'''<article data-pair="{index}"><h2>{html.escape(candidate['conditionName'])}</h2>
        <p>처음 검출한 점 A {len(candidate['queryDetectedPoints'])}개 / B {len(candidate['candidateDetectedPoints'])}개 · 연결 {candidate['matches']}쌍</p>
        <p>H 통과 {comp['homography']['inliers']}개 / F 통과 {f_count} · {agreement}</p>
        <p>H: {html.escape(comp['homography']['fitStatus'])} / F: {html.escape(comp['fundamental']['fitStatus'])}</p>
        <p class="viewer-error" hidden>대응점 뷰어를 열지 못했습니다.</p>{viewer_markup()}
        <details><summary>임계값 민감도와 영역 내 점 수</summary><ul>{sensitivity}</ul><pre>{html.escape(json.dumps(candidate.get('roiDiagnostics'), ensure_ascii=False, indent=2))}</pre>
        <p>사각형 안에는 다른 물체·가림도 포함됩니다. 영역 내 점 수가 대상 물체에 속한 정확한 점 수는 아닙니다.</p></details>
        <h3>자동 검토 표본 · 정확도 평가용 무작위 표본 아님</h3>{''.join(samples)}</article>''')
    summary = build_summary(directory)
    rows = ''.join(f"<tr><td>{html.escape(c['conditionName'])}</td><td>{c['matches']}</td><td>{c['homographyInliers']}</td><td>{c['fundamentalInliers'] if c['fundamentalInliers'] is not None else '추정 불가'}</td><td>{c['humanReviewed']}/{c['sampleCount']}</td></tr>" for c in summary['conditions'])
    script = (Path(__file__).parent/'viewer.js').read_text()
    css = (Path(__file__).parent/'viewer.css').read_text()
    payload = script_json({'queryImage': images[0]['queryImage'], 'pairs': pairs})
    def signature(text):
        import base64
        return base64.b64encode(hashlib.sha256(text.encode()).digest()).decode()
    api_status = '실제 GPT API 보조 검토 있음 · 원본과 별도 저장' if model and model_items else 'GPT API 검토 미완료'
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-{signature(script)}' 'sha256-{signature(payload)}'; base-uri 'none'; form-action 'none'">
    <title>대응점 원인 분석</title><style>body{{margin:0;background:#0c1321;color:#e7edf6;font:15px/1.6 system-ui}}main{{max-width:1160px;margin:auto;padding:24px}}article{{background:#141f30;border:1px solid #34445b;border-radius:12px;margin:24px 0;padding:20px}}.sample-panel{{width:100%;max-width:768px}}details{{margin:14px 0}}summary{{cursor:pointer}}table{{width:100%;border-collapse:collapse}}th,td{{border-bottom:1px solid #34445b;padding:8px;text-align:left}}.table-scroll{{overflow:auto}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}{css}</style></head>
    <body><main><h1>대응점 원인 분석</h1><p>실제 DISK + LightGlue 실행 · {api_status}</p>
    <p>검증 방식을 바꿔도 같은 조건의 대응점 목록을 사용합니다. 처음 검출한 점은 하늘색, 연결은 선택한 검증 방식의 통과·탈락 색으로 표시합니다.</p>
    <p>H는 후보 사진의 재투영 거리 4px, F는 두 방향 점-에피폴라선 거리의 최댓값 1px 기준입니다. 오차 정의가 달라 통과 수로 우열을 판단하지 않습니다. F는 평면·반복 요소에서도 잘못된 연결을 통과시킬 수 있습니다.</p>
    <p>잘라내기는 영역·해상도·특징점 예산을 함께 바꿉니다. 대상 영역은 사람이 지정한 진단 조건이며 자동 검출 성능을 뜻하지 않습니다. 같은 물체와 같은 정확한 지점을 구분하세요.</p>
    <div class="table-scroll"><table><caption>실제 모델 실행 결과 · 사람 검토 수는 표본 기준</caption><thead><tr><th>조건</th><th>연결</th><th>H 통과</th><th>F 통과</th><th>사람 검토</th></tr></thead><tbody>{rows}</tbody></table></div>{''.join(cards)}<p>모델 의견은 정답이 아닙니다. 사람 미검토는 null로 별도 보관합니다. 실제 촬영 위치 추론은 하지 않습니다.</p>
    </main><script type="application/json" id="match-data">{payload}</script><script>{script}</script></body></html>'''


def render_run(directory):
    json_write(directory/'diagnostic-summary.json', build_summary(directory))
    private_write(directory/'report.html', render_report(directory).encode())


def run(config_path, device='cpu', offline=True):
    config = json.loads(config_path.read_text())
    if not 1 <= len(config['pairs']) <= 10:
        raise PrototypeError('한 진단 회차는 1~10쌍이어야 합니다.')
    started = time.perf_counter()
    models = Models(device, offline=offline)
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-diagnostic-'+os.urandom(3).hex()
    directory = PRIVATE/'runs'/run_id
    candidates, visuals, batches, human, sources = [], [], [], {}, []
    for pair_index, pair in enumerate(config['pairs']):
        a, b = prepare(Path(pair['query'])), prepare(Path(pair['candidate']))
        variants = [('전체 사진', None, None)]
        if pair.get('queryRoi') is not None and pair.get('candidateRoi') is not None:
            variants.append(('영역 잘라내기', pair['queryRoi'], pair['candidateRoi']))
        full_features = None
        for variant_index, (variant, roi0, roi1) in enumerate(variants):
            im0, box0 = crop_image(a, roi0)
            im1, box1 = crop_image(b, roi1)
            left, f0 = models.local({'image': im0})
            right, f1 = models.local({'image': im1})
            points0, points1 = models.match(f0, f1)
            detected0 = f0['keypoints'][0].cpu().numpy()
            detected1 = f1['keypoints'][0].cpu().numpy()
            comp = compare_geometry(points0, points1)
            masks = {key: np.array(comp[key]['inlierMask'], dtype=bool) for key in ('homography','fundamental')}
            condition_id = f'p{pair_index+1}-v{variant_index+1}'
            samples, blind = [], []
            for sample_index in comp['sampleIndices']:
                sid = hashlib.sha256(f'{run_id}:{condition_id}:{sample_index}'.encode()).hexdigest()[:16]
                h, f = masks['homography'][sample_index], masks['fundamental'][sample_index]
                category = 'both' if h and f else 'homography-only' if h else 'fundamental-only' if f else 'neither'
                samples.append({'sampleId': sid, 'pointIndex': sample_index, 'category': category})
                blind.append({'sampleId': sid, 'image': data_url(marked_panel(left, right, points0[sample_index], points1[sample_index]))})
                human[sid] = None
            roi_diagnostics = None
            if variant_index == 0:
                full_features = (left.size, right.size, detected0, detected1, points0, points1)
            if pair.get('queryRoi') is not None:
                sizes = full_features[:2]
                counts = []
                for side, region in enumerate((pair['queryRoi'], pair['candidateRoi'])):
                    size = sizes[side]
                    def inside(points):
                        x0, y0, x1, y1 = region
                        return (points[:,0] >= x0*size[0]) & (points[:,0] <= x1*size[0]) & (points[:,1] >= y0*size[1]) & (points[:,1] <= y1*size[1])
                    counts.append({'detectedInFullImageRoi': int(inside(full_features[2+side]).sum()),
                                   'matchedEndpointsInFullImageRoi': int(inside(full_features[4+side]).sum())})
                roi_diagnostics = {'queryRoiNormalized': pair['queryRoi'], 'candidateRoiNormalized': pair['candidateRoi'],
                                   'fullImageRegionCounts': counts, 'cropBoxesOnAnalysis': [box0,box1] if variant_index else None,
                                   'roiSource': 'manual diagnostic rectangle; not object ground truth'}
            candidate = {'rank': len(candidates)+1, 'imageId': b['analysisHash'], 'conditionId': condition_id,
                'conditionName': pair['name']+' · '+variant, 'queryImageId': a['analysisHash'],
                'matches': len(points0), 'inliers': comp['homography']['inliers'],
                'allQueryPoints': points0.tolist(), 'allCandidatePoints': points1.tolist(),
                'inlierMask': comp['homography']['inlierMask'], 'queryDetectedPoints': detected0.tolist(),
                'candidateDetectedPoints': detected1.tolist(), 'queryDetectionScores': f0['keypoint_scores'][0].cpu().tolist(),
                'candidateDetectionScores': f1['keypoint_scores'][0].cpu().tolist(),
                'queryMatchSize': list(left.size), 'candidateMatchSize': list(right.size),
                'geometryComparison': comp, 'roiDiagnostics': roi_diagnostics, 'reviewSamples': samples}
            candidates.append(candidate)
            visuals.append({'queryImage': data_url(left), 'image': data_url(right)})
            batches.append({'batchId': os.urandom(8).hex(), 'samples': blind})
            print(f'진단 조건 {len(candidates)}개 처리 완료', flush=True)
        sources.append({'pairId': f'p{pair_index+1}', 'queryAnalysisHash': a['analysisHash'], 'candidateAnalysisHash': b['analysisHash'],
                        'queryOriginalHash': a['originalHash'], 'candidateOriginalHash': b['originalHash']})
    checkpoints = Path(models.torch.hub.get_dir())/'checkpoints'
    result = {'schemaVersion': 1, 'experiment': 'correspondence-diagnostics', 'createdAt': datetime.now(timezone.utc).isoformat(),
        'queryImageId': candidates[0]['queryImageId'], 'elapsedSeconds': round(time.perf_counter()-started,3),
        'candidates': candidates, 'sources': sources, 'preprocessing': PREPROCESS,
        'runtime': {'device': models.device, 'matchingMaxEdge': 960, 'maxKeypoints': 1024, 'embeddingRevision': models.revision,
                    'matcher': 'DISK + LightGlue', 'depthConfidence': -1, 'widthConfidence': -1,
                    'matchFilterThreshold': float(models.matcher.conf.filter_threshold),
                    'versions': {name: importlib.metadata.version(name) for name in ('torch','lightglue','kornia','numpy','opencv-python','Pillow')},
                    'weightsSha256': {name: hashlib.sha256((checkpoints/name).read_bytes()).hexdigest() for name in ('depth-save.pth','disk_lightglue_v0-1_arxiv.pth')}},
        'sampling': 'up to four per condition: one per H/F category then evenly spaced fill; diagnostic, not accuracy estimate',
        'limitations': ['No geolocation', 'No same-place determination', 'No risk scoring', 'Manual ROI changes resolution and keypoint budget', 'GPT is not ground truth']}
    json_write(directory/'report.json', result)
    json_write(directory/'visuals.json', visuals)
    json_write(directory/'review-input.json', {'schemaVersion':1, 'batches':batches})
    json_write(directory/'human-review.json', human)
    render_run(directory)
    from report_hub import discover_reports, write_pages
    write_pages(PRIVATE, discover_reports(PRIVATE))
    print('진단 회차 저장 완료 · '+run_id, flush=True)
    return directory


def main():
    parser = argparse.ArgumentParser(description='대표 사진 쌍의 대응점·영역·기하 검증 진단')
    sub = parser.add_subparsers(dest='command', required=True)
    execute = sub.add_parser('run')
    execute.add_argument('--config', type=Path, required=True)
    execute.add_argument('--device', choices=['cpu','cuda'], default='cpu')
    execute.add_argument('--download', action='store_true', help='필요한 공개 모델 다운로드 허용')
    render = sub.add_parser('render')
    render.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'run':
            run(private_directory(args.config), args.device, not args.download)
        else:
            render_run(private_directory(args.run))
        return 0
    except Exception as error:
        print(f'진단 실패 ({type(error).__name__}). 입력·모델·설정을 확인하세요. 비공개 상세 내용은 출력하지 않습니다.', file=sys.stderr)
        return 1


def save_human_review(directory, sample_id, verdict, reason):
    allowed = {'same-point','same-object-different-point','different-object','uncertain'}
    if verdict is not None and verdict not in allowed:
        raise ValueError('Invalid review verdict')
    if not isinstance(reason, str) or len(reason) > 2000:
        raise ValueError('Invalid review reason')
    original = json.loads((directory/'report.json').read_text())
    known = {sample['sampleId'] for candidate in original['candidates'] for sample in candidate['reviewSamples']}
    if sample_id not in known:
        raise ValueError('Unknown review sample')
    _, reviews = load_reviews(directory)
    reviews[sample_id] = None if verdict is None else {'verdict':verdict, 'reason':reason, 'reviewedAt':datetime.now(timezone.utc).isoformat()}
    temporary = directory/'human-review.tmp'
    json_write(temporary, reviews)
    temporary.replace(directory/'human-review.json')
    render_run(directory)


def human_review_markup(directory, key):
    original = json.loads((directory/'report.json').read_text())
    inputs = json.loads((directory/'review-input.json').read_text())
    model, human = load_reviews(directory)
    model_items = {sample['sampleId']: sample for call in (model or {}).get('calls', []) if call['status']=='completed' for sample in call['modelOutput']['reviews']}
    images = {s['sampleId']:s['image'] for b in inputs['batches'] for s in b['samples']}
    labels = {'':'미검토', 'same-point':'같은 지점', 'same-object-different-point':'같은 물체의 다른 지점', 'different-object':'다른 물체', 'uncertain':'판단 불가'}
    items=[]
    for candidate in original['candidates']:
        for sample in candidate['reviewSamples']:
            sid=sample['sampleId']
            opinion=model_items.get(sid)
            person=human.get(sid)
            selected=person['verdict'] if person else ''
            reason=person['reason'] if person else ''
            options=''.join(f'<option value="{value}" {"selected" if value==selected else ""}>{label}</option>' for value,label in labels.items())
            text='실제 GPT 검토 없음' if not opinion else labels[opinion['verdict']]+' · '+opinion['reason']+' · 불확실성: '+opinion['uncertainty']
            items.append(f'''<details class="human-sample"><summary>{html.escape(candidate['conditionName'])} · 표본 #{sample['pointIndex']+1} · 사람 {labels[selected]}</summary>
            <img src="{images[sid]}" alt="대응점 문맥과 확대" class="sample-panel"><p>GPT 보조 의견 (정답 아님): {html.escape(text)}</p>
            <form class="point-review-form" data-key="{html.escape(key, quote=True)}" data-sample="{sid}">
            <label>사람 판단<select name="verdict">{options}</select></label><label>사람 이유<textarea name="reason" maxlength="2000">{html.escape(reason)}</textarea></label>
            <button type="submit">사람 검토 저장</button><span role="status" class="save-status"></span></form></details>''')
    return '<section class="human-reviews"><h2>표본별 사람 검토</h2><p>모델 의견과 별도로 저장합니다. 미검토는 null이며 API에 전송하지 않습니다.</p>'+''.join(items)+'</section>'


if __name__ == '__main__':
    sys.exit(main())
