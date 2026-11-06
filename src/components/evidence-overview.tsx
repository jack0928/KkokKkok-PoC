"use client";
import { objectDisplayGroup } from "@/lib/grounding";
import { useState } from "react";
import type { DiscoveryRecord } from "@/lib/discovery";
import { boundsForLines, type Bbox } from "@/lib/fusion";

export function EvidenceOverview({record}:{record:DiscoveryRecord}) {
  const [selected,setSelected]=useState("");
  const [filter,setFilter]=useState("전체");
  const [showBackground,setShowBackground]=useState(false);
  const [failed,setFailed]=useState(false);
  const items:{id:string;source:string;title:string;reason:string;boxes:Bbox[]}[]=[];
  for (const [source,fusion,reviews] of [["OCR",record.fusion,record.fusionReviews],["DINO",record.objectFusion,record.objectFusionReviews]] as const) {
    for(const cue of fusion?.cues??[]) {
      const review=reviews?.find(r=>r.cueId===cue.cueId);
      if(source==="DINO" && !showBackground && objectDisplayGroup(cue)==="background") continue;
      if(review?.status==="rejected" || !(cue.decision==="useful" || (cue.assessment && cue.decision==="uncertain") || review)) continue;
      items.push({id:`${source}-${cue.cueId}`,source,title:review?.observedCue||cue.interpretation,reason:cue.reason,boxes:[review?.bbox??cue.bbox]});
    }
  }
  record.analysis?.modelOutput.candidates.forEach((candidate,index)=>{
    const boxes:Bbox[]=[];
    for(const [fusion,reviews] of [[record.fusion,record.fusionReviews],[record.objectFusion,record.objectFusionReviews]] as const)
      for(const cue of fusion?.cues??[]) if(cue.relatedCandidateIndexes.includes(index)) {
        const review=reviews?.find(r=>r.cueId===cue.cueId);
        if(review?.status!=="rejected") boxes.push(review?.bbox??cue.bbox);
      }
    for(const review of record.ocrReviews??[]) if(record.ocr&&review.status==="linked"&&review.candidateIndex===index) boxes.push(boundsForLines(record.ocr,[review.lineId]));
    items.push({id:`gpt-${index}`,source:"GPT",title:candidate.observedCue,reason:candidate.modelReason,boxes});
  });
  const visible=items.map((item,index)=>({...item,number:index+1})).filter(item=>filter==="전체"||item.source===filter);
  const active=visible.find(item=>item.id===selected)??visible[0];
  const w=record.image.width,h=record.image.height;
  const color=(source:string)=>source==="OCR"?"#b45309":source==="DINO"?"#1d4ed8":"#7e22ce";
  return <section className="panel" aria-label="사진에서 단서 모아 보기">
    <h2>사진에서 단서 모아 보기 · {items.length}개</h2><label><input type="checkbox" checked={showBackground} onChange={e=>setShowBackground(e.target.checked)}/> DINO 배경 비교 자료 포함</label>
    <p>상자 또는 아래 번호를 선택하면 설명이 표시됩니다. GPT 영역은 OCR·객체와 연결된 영역 제안입니다.</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>{["전체","OCR","DINO","GPT"].map(source=><button type="button" className="button secondary small" key={source} aria-pressed={filter===source} onClick={()=>setFilter(source)}>{source}</button>)}</div>
    <svg viewBox={`0 0 ${w} ${h}`} aria-label="번호가 표시된 단서 위치" style={{display:"block",width:"100%",maxHeight:"70vh",background:"#eee"}}>
      <image href={`/api/discovery-images/${record.recordId}?kind=analysis`} width={w} height={h} onError={()=>setFailed(true)}/>
      {[...visible.filter(i=>i.id!==active?.id),...visible.filter(i=>i.id===active?.id)].map(item=>item.boxes.map((box,index)=><g key={`${item.id}-${index}`} role="button" tabIndex={0} aria-label={`${item.number}번 ${item.source}: ${item.title}`} aria-pressed={active?.id===item.id} onClick={()=>setSelected(item.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelected(item.id);}}} style={{cursor:"pointer"}}>
        <rect x={box[0]*w} y={box[1]*h} width={(box[2]-box[0])*w} height={(box[3]-box[1])*h} fill={active?.id===item.id?`${color(item.source)}30`:"transparent"} stroke={color(item.source)} strokeWidth={active?.id===item.id?5:2} vectorEffect="non-scaling-stroke"/>
        <text x={box[0]*w+3} y={Math.min(h-4,box[1]*h+Math.max(24,w/35))} fontSize={Math.max(24,w/35)} fontWeight="bold" fill={color(item.source)} stroke="white" strokeWidth={4} paintOrder="stroke">{item.number}</text>
      </g>))}
    </svg>
    {failed&&<p role="alert">분석 이미지를 불러오지 못했습니다.</p>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>{visible.map(item=><button type="button" key={item.id} className="button secondary small" aria-pressed={active?.id===item.id} onClick={()=>setSelected(item.id)} style={{borderColor:color(item.source),outline:active?.id===item.id?`2px solid ${color(item.source)}`:undefined}}>{item.number}. {item.source}{!item.boxes.length?" · 좌표 없음":""}</button>)}</div>
    {active?<div aria-live="polite" style={{marginTop:16}}><h3>{active.number}. {active.title}</h3><p>{active.reason}</p><p className="caption">출처: {active.source}{active.source==="GPT"?" · 연결된 탐지 영역 제안":" + GPT"} · {active.boxes.length?`영역 ${active.boxes.length}개`:"연결된 좌표가 없어 설명만 표시합니다."}</p></div>:<p>표시할 단서가 없습니다.</p>}
  </section>;
}
