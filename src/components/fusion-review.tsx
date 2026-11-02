"use client";
import { OcrDuplicate } from "./ocr-duplicate";
import { useRef, useState } from "react";
import type { DiscoveryRecord } from "@/lib/discovery";
import { bboxSchema, Bbox, FusionCue, FusionReview as Review, newFusionReview } from "@/lib/fusion";

export function CueImage({record,bbox,originalBox,editable,onChange,label}: {record:DiscoveryRecord;bbox:Bbox;originalBox:Bbox;editable:boolean;onChange:(box:Bbox)=>void;label:string}) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState<Bbox|null>(null);
  const start=useRef<[number,number]|null>(null);
  const [message,setMessage]=useState("");
  const [imageFailed,setImageFailed]=useState(false);
  const box=draft??bbox;
  function point(event:React.PointerEvent<SVGSVGElement>):[number,number] {
    const rect=event.currentTarget.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];
  }
  function rectangle(a:[number,number],b:[number,number]):Bbox {return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];}
  return <div className="fusion-image">
    <svg viewBox={`0 0 ${record.image.width} ${record.image.height}`} role="img" aria-label={label} style={{width:"100%",aspectRatio:`${record.image.width}/${record.image.height}`,touchAction:editing?"none":"auto",cursor:editing?"crosshair":"default"}}
      onPointerDown={event=>{if(!editing||!editable)return;start.current=point(event);event.currentTarget.setPointerCapture(event.pointerId);setMessage("");}}
      onPointerMove={event=>{if(start.current)setDraft(rectangle(start.current,point(event)));}}
      onPointerUp={event=>{if(!start.current)return;const next=rectangle(start.current,point(event));start.current=null;setDraft(null);if(!editable)return;if(bboxSchema.safeParse(next).success&&next[2]-next[0]>.002&&next[3]-next[1]>.002){onChange(next);setMessage("수정한 영역은 사람 검토값으로 저장됩니다.");}else setMessage("너무 작은 영역입니다. 다시 그려 주세요.");}}
      onPointerCancel={()=>{start.current=null;setDraft(null);}}>
      <image href={`/api/discovery-images/${record.recordId}?kind=analysis`} width={record.image.width} height={record.image.height} onError={()=>setImageFailed(true)}/>
      <rect x={box[0]*record.image.width} y={box[1]*record.image.height} width={(box[2]-box[0])*record.image.width} height={(box[3]-box[1])*record.image.height} fill="#e89b2420" stroke="#d97800" strokeWidth={3} vectorEffect="non-scaling-stroke"/>
    </svg>
    {imageFailed&&<p role="alert">분석본을 읽지 못했습니다. 이미지 파일을 확인해 주세요.</p>}
    <p className="caption">주황색 상자: 이 단서의 영역 · AI 입력 이미지 기준</p>
    {editable&&<details className="fusion-box-editor"><summary>사람이 영역 수정</summary>
      <label className="checkbox-label"><input type="checkbox" checked={editing} onChange={e=>setEditing(e.target.checked)}/>이미지 위에 사각형 다시 그리기</label>
      <div className="fusion-coordinates">{["왼쪽","위","오른쪽","아래"].map((text,i)=><label key={text}>{text} (%)<input aria-label={`${text} 좌표 (%)`} type="number" min={0} max={100} step={0.1} value={Number((bbox[i]*100).toFixed(2))} onChange={e=>{const next=[...bbox] as Bbox;next[i]=Number(e.target.value)/100;if(bboxSchema.safeParse(next).success){onChange(next);setMessage("");}else setMessage("왼쪽은 오른쪽보다, 위는 아래보다 작아야 합니다.");}}/></label>)}</div>
      <button type="button" className="button secondary small" onClick={()=>{onChange([...originalBox]);setMessage("탐지 원본 영역으로 복원했습니다.");}}>탐지 원본 영역으로 복원</button>
      {message&&<p role="status" className="caption">{message}</p>}
    </details>}
  </div>;
}

export function FusionCard({record,cue,review,disabled,onChange,evidence,sourceLabel="OCR + GPT"}: {record:DiscoveryRecord;cue:FusionCue;review:Review;disabled:boolean;evidence?:string[];sourceLabel?:string;onChange?:(review:Review)=>void}) {
  const rawLines=(record.ocr?.lines??[]).filter(line=>cue.ocrLineIds.includes(line.id));
  const editable=!!onChange&&!disabled;
  return <OcrDuplicate cueKey={cue.cueId} record={cue.cueId.startsWith("object-") ? record : undefined} observation={cue.interpretation}><article className="cue-card fusion-card" id={`fusion-cue-${cue.cueId}`}>
    <div className="cue-heading"><span className="pill">{sourceLabel}</span><strong>VLM Feature 후보</strong><h3>{review.observedCue||cue.interpretation}</h3></div>
    <p className="fusion-model-reason">{cue.reason}</p>
    {cue.uncertainty&&<p className="caption">불확실성: {cue.uncertainty}</p>}
    <CueImage record={record} bbox={review.bbox} originalBox={cue.bbox} editable={editable} onChange={bbox=>onChange?.({...review,bbox,status:"unreviewed"})} label={`Fusion 단서 ${cue.cueId} 위치`}/>
    <details className="model-evidence"><summary>탐지 원문·GPT 판단·출처 보기</summary>
      <ul>{evidence?.map((text,i)=><li key={i}>{text}</li>)}{rawLines.map(line=><li key={line.id}>{line.id}: {line.text} (OCR 인식 점수 {line.score.toFixed(3)})</li>)}</ul>
      <p>GPT 해석: {cue.interpretation}</p><p>GPT 분류: {cue.category} · 제안 위험도: {cue.modelRisk??"판단 보류"}</p>
      <p>기존 GPT 후보 연결 제안: {cue.relatedCandidateIndexes.length?cue.relatedCandidateIndexes.map(i=>`#${i+1}`).join(", "):"없음 · 탐지에서 새로 발견한 단서"}</p>
      <p className="caption">좌표 출처: {sourceLabel}의 탐지 원본 경계 사각형. 사람의 영역 수정은 원본과 따로 저장합니다.</p>
    </details>
    {onChange?<fieldset disabled={disabled} className="fusion-human"><legend>사람 검토</legend>
      <label>단서 분류<input value={review.featureType} maxLength={120} onChange={e=>onChange({...review,featureType:e.target.value})}/></label>
      <label>단서 내용<textarea value={review.observedCue} maxLength={2000} rows={2} onChange={e=>onChange({...review,observedCue:e.target.value})}/></label>
      <label>사람의 위험도<select value={review.humanRisk??""} onChange={e=>onChange({...review,humanRisk:(e.target.value||null) as Review["humanRisk"]})}><option value="">미검토</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
      <label>사람의 판단 이유<textarea value={review.humanReason} maxLength={3000} rows={2} onChange={e=>onChange({...review,humanReason:e.target.value})}/></label>
      <label>단서 유지 여부<select value={review.status} onChange={e=>onChange({...review,status:e.target.value as Review["status"]})}><option value="unreviewed">미검토</option><option value="accepted">유용한 단서로 유지</option><option value="rejected" disabled={!review.humanReason.trim()}>제외 (이유를 먼저 작성)</option></select></label>
    </fieldset>:<p>사람 판단: {review.status==="accepted"?"유지":review.status==="rejected"?"제외":"미검토"} · 위험도: {review.humanRisk??"미검토"} · 이유: {review.humanReason||"미작성"}</p>}
  </article></OcrDuplicate>;
}

export function FusionReview({record,disabled=false,running=false,onChange,onRun}: {record:DiscoveryRecord;disabled?:boolean;running?:boolean;onChange?:(reviews:Review[])=>void;onRun?:()=>void}) {
  const [consent,setConsent]=useState(false);
  const fusion=record.fusion;
  const reviews=record.fusionReviews??[];
  function save(review:Review) {onChange?.([...reviews.filter(r=>r.cueId!==review.cueId),review]);}
  const visible=fusion?.cues.filter(cue=>{const r=reviews.find(r=>r.cueId===cue.cueId);return r?.status!=="rejected"&&(cue.decision==="useful"||!!r);})??[];
  const hidden=fusion?.cues.filter(cue=>!visible.some(v=>v.cueId===cue.cueId))??[];
  return <section className="fusion-panel" aria-label="Fusion 단서">
    <h2>Fusion 단서 {fusion?`· ${visible.length}개`:""}</h2>
    <p>OCR에서 읽은 글자와 위치를 GPT가 이미지 맥락과 함께 검토합니다. 유용하다고 제안한 단서가 여기에 표시됩니다.</p>
    {!fusion&&onRun&&<div className="panel">
      {!record.ocr?<p>먼저 아래에서 로컬 OCR을 실행해 주세요.</p>:<>
        <p>저장된 OCR {record.ocr.lines.length}개를 검토합니다. 유용한 단서로 묶거나 제외·판단 보류 이유를 기록합니다.</p>
        <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={disabled||running} onChange={e=>setConsent(e.target.checked)}/>분석본·OCR 원문과 좌표·기존 GPT 관찰의 OpenAI 전송 및 추가 API 비용 발생에 동의합니다.</label>
        <button className="button primary" disabled={disabled||running||!consent} onClick={onRun}>{running?"GPT 검토 중…":record.fusionAttempt?.status==="failed"?"GPT 검토 다시 실행":"GPT로 검토하고 Fusion 단서 만들기"}</button>
      </>}
      {record.fusionAttempt?.status==="failed"&&<p role="alert">{record.fusionAttempt.error}</p>}
    </div>}
    {fusion&&<>
      <p className="caption">{fusion.skippedEmptyOcr?"OCR 문자 0개로 GPT 호출 없이 완료":`검토 모델: ${fusion.responseModel}`} · GPT 판단은 후보이며 실제 장소를 확정하지 않습니다.</p>
      {!visible.length&&<p className="message loading">현재 표시할 Fusion 단서가 없습니다. 위치 노출 위험이 없다는 뜻은 아닙니다. 아래 보류·제외 항목과 원본도 확인할 수 있습니다.</p>}
      {visible.map(cue=><FusionCard key={cue.cueId} record={record} cue={cue} review={reviews.find(r=>r.cueId===cue.cueId)??newFusionReview(cue)} disabled={disabled} onChange={onChange?save:undefined}/>)}
      <details className="fusion-hidden"><summary>보류·제외된 항목 확인 ({hidden.length}개)</summary>
        {hidden.map(cue=><div className="panel" key={cue.cueId}>
          <h3>{cue.interpretation}</h3><p>{cue.decision==="uncertain"?"GPT 판단 보류":cue.decision==="not_useful"?"GPT 제외 제안":"사람이 제외"}: {cue.reason}</p>
          <p>OCR 원문: {record.ocr?.lines.filter(l=>cue.ocrLineIds.includes(l.id)).map(l=>l.text).join(" / ")}</p>
          {reviews.find(r=>r.cueId===cue.cueId)?.humanReason&&<p>사람 이유: {reviews.find(r=>r.cueId===cue.cueId)?.humanReason}</p>}
          {onChange&&<button className="button secondary small" disabled={disabled} onClick={()=>save({...(reviews.find(r=>r.cueId===cue.cueId)??newFusionReview(cue)),status:"unreviewed"})}>사람 검토 단서로 복원</button>}
        </div>)}
      </details>
    </>}
  </section>;
}
