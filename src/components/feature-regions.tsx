"use client";
import type { DiscoveryRecord } from "@/lib/discovery";
import { boundsForLines, type Bbox } from "@/lib/fusion";

// Associations reference immutable model indexes, never free-text guesses.
export function FeatureRegions({record,candidateIndex}:{record:DiscoveryRecord;candidateIndex:number}) {
  const regions:{id:string;box:Bbox;label:string;color:string}[]=[];
  for(const cue of record.fusion?.cues??[]) if(cue.relatedCandidateIndexes.includes(candidateIndex)) {
    const review=record.fusionReviews?.find(r=>r.cueId===cue.cueId);
    regions.push({id:cue.cueId,box:review?.bbox??cue.bbox,label:`OCR · GPT 연결 제안${review?.status==="rejected"?" · 사람 제외":""}`,color:"#d97800"});
  }
  for(const review of record.ocrReviews??[]) if(record.ocr&&review.status==="linked"&&review.candidateIndex===candidateIndex)
    regions.push({id:review.lineId,box:boundsForLines(record.ocr,[review.lineId]),label:"OCR · 사람 연결",color:"#d97800"});
  for(const cue of record.objectFusion?.cues??[]) if(cue.relatedCandidateIndexes.includes(candidateIndex)) {
    const review=record.objectFusionReviews?.find(r=>r.cueId===cue.cueId);
    regions.push({id:cue.cueId,box:review?.bbox??cue.bbox,label:`Grounding DINO · GPT 연결 제안${review?.status==="rejected"?" · 사람 제외":""}`,color:"#2563eb"});
  }
  return <div className="feature-regions">
    <svg viewBox={`0 0 ${record.image.width} ${record.image.height}`} role="img" aria-label={`VLM Feature 후보 ${candidateIndex+1}의 OCR·객체 영역`} style={{width:"100%",display:"block",aspectRatio:`${record.image.width}/${record.image.height}`}}>
      <image href={`/api/discovery-images/${record.recordId}?kind=analysis`} width={record.image.width} height={record.image.height}/>
      {regions.map((r,i)=><g key={r.id}>
        <rect x={r.box[0]*record.image.width} y={r.box[1]*record.image.height} width={(r.box[2]-r.box[0])*record.image.width} height={(r.box[3]-r.box[1])*record.image.height} fill="transparent" stroke={r.color} strokeWidth={3} vectorEffect="non-scaling-stroke"/>
        <text x={r.box[0]*record.image.width} y={Math.max(20,r.box[1]*record.image.height)} fontSize={Math.max(20,record.image.width/40)} fill={r.color} stroke="white" strokeWidth={3} paintOrder="stroke">{i+1}</text>
      </g>)}
    </svg>
    {regions.length?<ol className="caption">{regions.map(r=><li key={r.id}>{r.label} ({r.id})</li>)}</ol>:<p className="caption">이 후보에 연결된 탐지 좌표가 아직 없습니다. OCR·객체 검토 후 연결된 영역을 표시합니다.</p>}
  </div>;
}
