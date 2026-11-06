"use client";
import { useState } from "react";
import type { DiscoveryRecord } from "@/lib/discovery";
import { GROUNDING_PROMPT, GROUNDING_PROMPTS, objectDisplayGroup } from "@/lib/grounding";
import { newFusionReview, type FusionReview as Review } from "@/lib/fusion";
import { CueImage, FusionCard } from "./fusion-review";

export function GroundingReview({record,disabled=false,actionsDisabled=false,onDetect,onReview,onChange}:{
  record:DiscoveryRecord;disabled?:boolean;actionsDisabled?:boolean;onDetect?:(prompt:string,boxThreshold:number,textThreshold:number)=>void;onReview?:()=>void;onChange?:(reviews:Review[])=>void;
}) {
  const [prompt,setPrompt]=useState(GROUNDING_PROMPT),[consent,setConsent]=useState(false);
  const [boxThreshold,setBoxThreshold]=useState(0.3),[textThreshold,setTextThreshold]=useState(0.25);
  const grounding=record.grounding,fusion=record.objectFusion,reviews=record.objectFusionReviews??[];
  const running=record.groundingAttempt?.status==="running"||record.objectFusionAttempt?.status==="running";
  function save(review:Review){onChange?.([...reviews.filter(r=>r.cueId!==review.cueId),review]);}
  const visible=fusion?.cues.filter(c=>{const r=reviews.find(r=>r.cueId===c.cueId);return r?.status!=="rejected"&&(c.decision==="useful"||(c.assessment && c.decision==="uncertain")||!!r);})??[];
  const hidden=fusion?.cues.filter(c=>!visible.some(v=>v.cueId===c.cueId))??[];
  return <section className="fusion-panel" aria-label="Grounding DINO 객체 단서">
    <h2>Grounding DINO · 객체 Fusion {fusion?`· ${visible.length}개`:""}</h2>
    <p>외관·출입구 등의 영역을 로컬에서 탐지하고 GPT가 비문자 관찰과 적용 규칙을 정리합니다. 직접 단서는 경고, 간접 단서는 안내로 표시합니다. 문자 간판·메뉴판의 내용은 OCR에서만 검토합니다. 탐지 점수는 위치 위험도가 아닙니다.</p>
    {!grounding&&onDetect&&<div className="panel">
      <p>기본 공통 목록으로 탐지합니다. 실내·실외 선택은 선택 사항입니다.</p><div><button className="button secondary small" disabled={disabled} onClick={()=>setPrompt(GROUNDING_PROMPTS.common)}>공통 목록</button><button className="button secondary small" disabled={disabled} onClick={()=>setPrompt(GROUNDING_PROMPTS.indoor)}>실내 객체 목록</button><button className="button secondary small" disabled={disabled} onClick={()=>setPrompt(GROUNDING_PROMPTS.outdoor)}>실외 객체 목록</button></div>
      <p className="caption">입력한 객체 이름에 해당하는 영역을 찾습니다. 사진 속 모든 물체를 찾는 것은 아닙니다.</p>
      <label>객체 점수 기준<input type="number" min={0.1} max={0.9} step={0.05} value={boxThreshold} disabled={disabled} onChange={e=>setBoxThreshold(Number(e.target.value))}/></label>
      <label>레이블 단어 점수 기준<input type="number" min={0.1} max={0.9} step={0.05} value={textThreshold} disabled={disabled} onChange={e=>setTextThreshold(Number(e.target.value))}/></label>
      <p className="caption">객체 점수 기준을 낮추면 후보와 오탐이 함께 늘 수 있습니다. 레이블 단어 기준은 객체 이름에 포함할 단어를 정합니다.</p>
      <label>찾을 객체 (영어, 마침표로 구분)<textarea value={prompt} maxLength={400} rows={2} disabled={disabled} onChange={e=>setPrompt(e.target.value)}/></label>
      <button className="button secondary" disabled={disabled||actionsDisabled||running||prompt.trim().length<3||![boxThreshold,textThreshold].every(v=>Number.isFinite(v)&&v>=0.1&&v<=0.9)} onClick={()=>onDetect(prompt.trim(),boxThreshold,textThreshold)}>Grounding DINO 객체 탐지</button>
      <p className="caption">최초 실행은 모델 다운로드가 필요합니다. 사진은 로컬에서 처리하며 최대 10분이 걸릴 수 있습니다.</p>
    </div>}
    {running&&<p role="status">객체 추가 탐지 또는 GPT 검토 중입니다. 새로고침해도 실행 상태를 확인할 수 있습니다.</p>}
    {record.groundingAttempt?.status==="failed"&&<p role="alert">{record.groundingAttempt.error}</p>}
    {record.objectFusionAttempt?.status==="failed"&&<p role="alert">{record.objectFusionAttempt.error}</p>}
    {grounding&&<>
      <details><summary>GPT 관찰 → 검색어 → 탐지 → 검토 과정</summary>{record.analysis?.modelOutput.candidates.map((c,i)=><div key={i}><p>#{i+1} {c.observedCue}</p><p>제안 검색어: {c.detectionKeywords?.join(", ")||"없음"}</p><p>실행: {grounding.supplemental?.requests?.filter(r=>r.candidateIndexes.includes(i)).map(r=>`${r.keyword}: 탐지 ${r.detectionCount}개`).join(" / ")||"추가 요청 없음 (한도·검색어 없음·미실행 확인)"}</p><p>검토 연결: {record.objectFusion?.cues.filter(c=>c.relatedCandidateIndexes.includes(i)).map(c=>`${c.cueId} (${c.decision})`).join(", ")||"연결 없음"}</p></div>)}</details>
      <p className="caption">{grounding.supplemental?`GPT 관찰 기반 추가 탐지: ${grounding.supplemental.status==="completed"?"완료":"대상 없음"} · 검색어: ${grounding.supplemental.prompt||"없음"}`:"객체 검토 시 GPT 검색어로 추가 탐지를 최대 4개 검색 요청 실행합니다."}</p>
      <p className="caption">{grounding.model} · {grounding.device} · 탐지 {grounding.detections.length}개 · {(grounding.elapsedMs/1000).toFixed(1)}초</p>
      {!fusion&&onReview&&<div className="panel">
        <label className="checkbox-label"><input type="checkbox" disabled={disabled} checked={consent} onChange={e=>setConsent(e.target.checked)}/>객체별 잘라낸 이미지·ID·탐지 레이블·좌표의 OpenAI 전송 및 추가 API 비용 발생에 동의합니다.</label>
        <button className="button primary" disabled={disabled||actionsDisabled||running||!consent} onClick={onReview}>GPT로 객체 검토하고 Fusion 단서 만들기</button>
      </div>}
      {fusion&&!["object-fusion-v3-crops","object-fusion-v4-single","object-fusion-v5-verified","object-fusion-v6-guided"].includes(fusion.promptVersion)&&<p className="caption">이 기록은 이전 전체 이미지 검토 방식입니다. 기존 응답과 상자는 보존되며, 새 crop 방식은 새 분석에 적용됩니다.</p>}
      {fusion&&<p className="caption">검토 모델: {fusion.responseModel??"탐지 0개 · 호출 생략"}</p>}
      {fusion&&!visible.length&&<p>유용한 객체 단서로 표시된 항목이 없습니다. 아래 보류·제외 항목도 확인해 주세요.</p>}
      {visible.map(cue=><details key={cue.cueId} open={objectDisplayGroup(cue)==="primary"}><summary>{objectDisplayGroup(cue)==="background"?"배경 비교 자료":objectDisplayGroup(cue)==="review"?"판단 보류":"주요 단서"} · {cue.interpretation}</summary><FusionCard key={cue.cueId} record={record} cue={{...cue,ocrLineIds:[]}} review={reviews.find(r=>r.cueId===cue.cueId)??newFusionReview(cue)} disabled={disabled} sourceLabel="Grounding DINO + GPT" evidence={cue.detectionIds.map(id=>{const d=grounding.detections.find(d=>d.id===id)!;return `${id}: ${d.label} · 탐지 점수 ${d.score.toFixed(3)}`;})} onChange={onChange?save:undefined}/></details>)}
      {fusion&&<details><summary>객체 보류·제외 항목 ({hidden.length}개)</summary>{hidden.map(cue=><div className="panel" key={cue.cueId}>
        <h3>{cue.interpretation}</h3><p>{cue.decision} · {cue.reason}</p>
        <CueImage record={record} bbox={cue.bbox} originalBox={cue.bbox} editable={false} onChange={()=>{}} label={`${cue.cueId} 보류 영역`}/>
        <p>{reviews.find(r=>r.cueId===cue.cueId)?.humanReason}</p>
        {onChange&&<button className="button secondary" disabled={disabled} onClick={()=>save({...newFusionReview(cue),...reviews.find(r=>r.cueId===cue.cueId),status:"unreviewed"})}>객체 단서로 복원</button>}
      </div>)}</details>}
      <details><summary>중복 탐지 원본 · {grounding.duplicateDetections?.length??0}개</summary>{grounding.duplicateDetections?.map(d=><div key={d.id}><p>{d.id} · {d.label} · {d.score.toFixed(3)}</p><CueImage record={record} bbox={d.bbox} originalBox={d.bbox} editable={false} onChange={()=>{}} label="중복 탐지 영역"/></div>)}</details><details open={!fusion}><summary>전체 객체 탐지 원본 · {grounding.detections.length}개</summary>
        <p className="caption">프롬프트: {grounding.prompt} · 객체 기준 {grounding.boxThreshold} · 단어 기준 {grounding.textThreshold}</p>
        {grounding.detections.map(d=><article className="cue-card" key={d.id}><h3>탐지 후보 · {d.label}</h3><p className="caption">{d.id} · 탐지 점수 {d.score.toFixed(3)} · GPT 검토 전 탐지 원본</p><CueImage record={record} bbox={d.bbox} originalBox={d.bbox} editable={false} onChange={()=>{}} label={`Grounding DINO ${d.id} 위치`}/></article>)}
      </details>
    </>}
  </section>;
}
