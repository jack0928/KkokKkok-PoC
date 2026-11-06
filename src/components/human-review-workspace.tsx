"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { pipelineActive } from "@/lib/pipeline";
import { PipelineProgress } from "./pipeline-progress";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DiscoveryRecord, HumanReview, newHumanCue, reviewStatus, MAX_IMAGE_BYTES, isReviewWritten, discoveryRecordSchema } from "@/lib/discovery";
import { exportRecords, readRecord, saveRecord } from "@/lib/storage";
import { CueReview, FeatureTypeSuggestions } from "./cue-review";
import { ReviewSaveQueue } from "@/lib/review-save-queue";
import { ReviewGuide } from "./review-guide";
import { GroundingReview } from "./grounding-review";
import { EvidenceOverview } from "./evidence-overview";
import { FusionReview } from "./fusion-review";
import { fusionReviewComplete } from "@/lib/fusion";
import { OcrReview } from "./ocr-review";
import { ImageGps } from "./image-gps";

export function HumanReviewWorkspace({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [record, setRecord] = useState<DiscoveryRecord | null>(null);
  const queue = useRef<ReviewSaveQueue | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [hasOriginal, setHasOriginal] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [imageKind, setImageKind] = useState<"original" | "analysis">("original");
  const [imageError, setImageError] = useState(false);
  const [attachConsent, setAttachConsent] = useState(false);
  const [fusionRunning, setFusionRunning] = useState(false);
  const [objectRunning, setObjectRunning] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ready, setReady] = useState(false);

  const installRecord = useCallback((selected: DiscoveryRecord) => {
    const state = new ReviewSaveQueue(selected, (item, version) => saveRecord(item, version, null), () => {
      if (queue.current !== state) return;
      setRecord(state.current); setDirty(state.dirty); setSaving(state.saving); setFailed(!!state.error);
      if (state.error) setError(state.error);
    });
    queue.current = state; setRecord(selected); setDirty(false); setSaving(false); setFailed(false);
  }, []);
  const locked = pipelineActive(record?.pipeline) || ocrRunning || fusionRunning || objectRunning || record?.groundingAttempt?.status === "running" || record?.objectFusionAttempt?.status === "running" || record?.fusionAttempt?.status === "running";

  useEffect(() => {
    let cancelled = false;
    void readRecord(recordId).then((data) => {
      if (cancelled) return;
      installRecord(data.record);
      setHasOriginal(data.job.hasOriginal); setThumbnail(data.thumbnailDataUrl); setNextId(data.nextId);
    }).catch(() => { if (!cancelled) setError("검토 기록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [recordId, installRecord]);

  useEffect(()=>{
    if(!pipelineActive(record?.pipeline)||dirty)return;
    let cancelled=false;const timer=setInterval(()=>{void readRecord(recordId).then(data=>{if(!cancelled)installRecord(data.record);}).catch(()=>{if(!cancelled)setError("자동 분석 상태를 읽지 못했습니다.");});},2000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[record?.pipeline,recordId,dirty,installRecord]);

  useEffect(() => {
    if (!dirty && !locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, locked]);

  function change(next: DiscoveryRecord) {
    queue.current?.update({ ...next, reviewCompletedAt: null, updatedAt: new Date().toISOString() });
    setDirty(true); setFailed(false); setError("");
  }

  const save = useCallback(async (complete = false, keepLocked = false) => {
    const state = queue.current;
    if (!state?.current.analysis) return false;
    if (complete && (state.current.groundingAttempt?.status==="running" || state.current.objectFusionAttempt?.status==="running" || (state.current.grounding && !state.current.objectFusion) || (state.current.objectFusion && !fusionReviewComplete(state.current.objectFusion,state.current.objectFusionReviews??[])))) {
      setError("객체 GPT 검토와 객체 단서의 사람 판단을 완료해 주세요."); return false;
    }
    if (complete && state.current.ocr && !state.current.fusion && state.current.ocr.lines.some(line => !state.current.ocrReviews?.some(r => r.lineId === line.id && r.status !== "unreviewed"))) {
      setError("OCR 문자별 연결·독립 보존·제외 판단을 완료해 주세요."); return false;
    }
    if (complete && state.current.fusion && !fusionReviewComplete(state.current.fusion, state.current.fusionReviews ?? [])) {
      setError("Fusion 단서의 유지 여부·분류·내용·사람 위험도·이유를 확인해 주세요."); return false;
    }
    if (complete && state.current.humanReviews.some((item) => !isReviewWritten(item))) {
      setError("분류·관찰 내용·적절성·이유를 작성하고, 판단을 바꿨다면 기존 이유를 다시 확인해 주세요. 위험도는 적절한 후보에서만 필수입니다.");
      const missing = state.current.humanReviews.find((item) => !isReviewWritten(item));
      if (missing) document.getElementById(`cue-${missing.cueId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    if (complete) setFinishing(true);
    const success = await state.save(complete);
    if (success) setError("");
    if (complete && !keepLocked) setFinishing(false);
    return success;
  }, []);

  useEffect(() => {
    if (!dirty || saving || failed) return;
    const timer = setTimeout(() => { void save(); }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, saving, failed, save]);

  async function runOcr() {
    if (!record || dirty || saving || finishing || locked) return;
    setOcrRunning(true); setError("");
    try {
      const response = await fetch(`/api/discovery-ocr/${recordId}`, {method: "POST", headers: {"X-Record-Version": record.updatedAt}});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      installRecord(discoveryRecordSchema.parse(body.record));
    } catch (error) { setError(error instanceof Error ? error.message : "OCR 실행 실패"); }
    finally { setOcrRunning(false); }
  }

  // A reloaded page can observe an existing request without issuing another paid call.
  useEffect(() => {
    if (record?.fusionAttempt?.status !== "running" || fusionRunning || dirty) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void fetch(`/api/discovery-fusion/${recordId}`, {cache:"no-store"}).then(async response => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!cancelled) installRecord(discoveryRecordSchema.parse(body.record));
      }).catch(() => { if (!cancelled) setError("GPT 검토 상태를 읽지 못했습니다. 새로고침해 주세요."); });
    }, 3000);
    return () => {cancelled=true; clearInterval(timer);};
  }, [record?.fusionAttempt?.status, recordId, fusionRunning, dirty, installRecord]);

  async function runFusion() {
    if (!record || dirty || saving || finishing || locked) return;
    setFusionRunning(true); setError("");
    try {
      const response = await fetch(`/api/discovery-fusion/${recordId}`, {method:"POST",headers:{"X-Record-Version":record.updatedAt,"X-Fusion-Consent":"true"}});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      installRecord(discoveryRecordSchema.parse(body.record));
    } catch (error) {
      setError(error instanceof Error ? error.message : "GPT 검토 실패");
      // Read persisted failed/running state; never automatically retry the API call.
      try { const response=await fetch(`/api/discovery-fusion/${recordId}`,{cache:"no-store"});
        if(response.ok) installRecord(discoveryRecordSchema.parse((await response.json()).record));
      } catch { /* Keep the original error and enable manual refresh. */ }
    } finally { setFusionRunning(false); }
  }

  useEffect(() => {
    const endpoint=record?.groundingAttempt?.status==="running"?"discovery-grounding":record?.objectFusionAttempt?.status==="running"?"discovery-object-fusion":null;
    if(!endpoint||objectRunning||dirty)return;
    let cancelled=false;
    const timer=setInterval(()=>{void fetch(`/api/${endpoint}/${recordId}`,{cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error();const body=await response.json();if(!cancelled)installRecord(discoveryRecordSchema.parse(body.record));
    }).catch(()=>{if(!cancelled)setError("객체 작업 상태를 읽지 못했습니다. 새로고침해 주세요.");});},3000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[record?.groundingAttempt?.status,record?.objectFusionAttempt?.status,objectRunning,dirty,recordId,installRecord]);

  async function runObjectStep(kind:"detect"|"review",prompt?:string,boxThreshold=0.3,textThreshold=0.25) {
    if(!record||dirty||saving||finishing||locked)return;
    const endpoint=kind==="detect"?"discovery-grounding":"discovery-object-fusion";
    setObjectRunning(true);setError("");
    try {
      const response=await fetch(`/api/${endpoint}/${recordId}`,{method:"POST",headers:{"Content-Type":"application/json","X-Record-Version":record.updatedAt,"X-Object-Consent":"true"},body:kind==="detect"?JSON.stringify({prompt,boxThreshold,textThreshold}):undefined});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      installRecord(discoveryRecordSchema.parse(body.record));
    } catch(error) {
      setError(error instanceof Error?error.message:"객체 처리 실패");
      try{const response=await fetch(`/api/${endpoint}/${recordId}`,{cache:"no-store"});if(response.ok)installRecord(discoveryRecordSchema.parse((await response.json()).record));}catch{/* retain error */}
    }finally{setObjectRunning(false);}
  }

  async function attach(file: File) {
    if (!record || !attachConsent || saving || dirty) return;
    if (file.size > MAX_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("JPEG·PNG·WebP, 10 MB 이하 이미지를 선택해 주세요."); return; }
    setAttaching(true);
    try {
      const response = await fetch(`/api/analysis-jobs?record=${recordId}`, { method: "POST", headers: { "Content-Type": file.type, "X-Analysis-Consent": "true", "X-Record-Version": record.updatedAt }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setHasOriginal(true); setImageError(false); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "원본 연결 실패"); }
    finally { setAttaching(false); }
  }

  async function finishAndNext() {
    if (locked || finishing || attaching) return;
    setFinishing(true);
    try {
      if (!queue.current?.current.reviewCompletedAt || queue.current.dirty) {
        if (!await save(true, true)) return;
      } else if (queue.current.saving && !await queue.current.save()) return;
      setFinishing(true);
      const latest = await readRecord(recordId);
      setNextId(latest.nextId);
      router.push(latest.nextId ? `/review/${latest.nextId}` : "/results");
    } catch { setError("검토는 저장됐지만 다음 기록을 읽지 못했습니다. 결과 목록에서 계속할 수 있습니다."); }
    finally { setFinishing(false); }
  }

  function mayLeave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (locked || saving || (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?"))) event.preventDefault();
  }

  function update(cueId: string, patch: Partial<HumanReview>) {
    if (record) change({ ...record, humanReviews: record.humanReviews.map((item) => item.cueId === cueId ? { ...item, ...patch } : item) });
  }

  return <>
    <div className="page-heading"><div><h1>사람 검토</h1><p>모델 원본을 보존하며 적절성·위험도·이유를 독립적으로 기록합니다.</p></div><Link className="button secondary" href="/results" onClick={mayLeave}>결과 목록</Link></div>
    {error && <p role="alert" className="message error">{error}</p>}
    {!ready && <p>기록을 불러오고 있습니다…</p>}
    {record && !record.analysis && <PipelineProgress pipeline={record.pipeline}/>}
    {record && !record.analysis && <p className="message loading">분석이 완료되어야 검토할 수 있습니다.</p>}
    {record?.analysis && <div className="workspace-grid">
      <aside className="image-column review-image-column"><section className="panel">
        <h2>검토 이미지</h2>
        {hasOriginal ? <><div className="record-actions"><button className="button secondary small" onClick={() => { setImageKind("original"); setImageError(false); }}>원본 보기</button><button className="button secondary small" onClick={() => { setImageKind("analysis"); setImageError(false); }}>AI 입력 이미지</button></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="review-image" src={`/api/discovery-images/${recordId}?kind=${imageKind}`} alt={imageKind === "original" ? "검토용 원본 이미지" : "모델에 전송한 전처리 이미지"} onError={() => setImageError(true)} />
          <a className="button secondary small" target="_blank" rel="noopener noreferrer" href={`/api/discovery-images/${recordId}?kind=${imageKind}`}>이미지 크게 보기</a>
          {imageError && <p role="alert">이미지 파일을 읽지 못했습니다. 저장 경로를 확인해 주세요.</p>}
        </> : <>{thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="review-image" src={thumbnail} alt="기존 저화질 미리보기" />
        )}<p className="caption">기존 기록에는 원본이 없습니다. 같은 원본을 연결하면 이후 다시 업로드할 필요가 없습니다.</p><label className="checkbox-label"><input type="checkbox" checked={attachConsent} onChange={(event) => setAttachConsent(event.target.checked)} />원본의 비공개 로컬 보관에 동의합니다.</label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!attachConsent || saving || dirty || attaching} onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); }} /></>}
        {hasOriginal && <ImageGps key={recordId} recordId={recordId} />}
      </section><details className="review-guide-toggle"><summary>적절성·위험도 판단 기준 보기</summary><ReviewGuide /></details></aside>
      <section><div className="review-heading"><h2>이미지 {record.image.imageId.slice(0, 8)} · 후보 {record.humanReviews.length}개</h2><span className={`status-badge status-${reviewStatus(record)}`}>{record.reviewCompletedAt ? "검토 완료" : dirty ? "자동 저장 대기" : reviewStatus(record) === "unreviewed" ? "검토 전" : "검토 중"}</span></div>
        {ocrRunning && <p role="status">로컬 OCR 실행 중… 이 페이지에서 기다려 주세요. 최대 5분 후 시간 초과로 처리합니다.</p>}
        {(fusionRunning || record.fusionAttempt?.status === "running") && <p role="status">GPT가 OCR 문자와 이미지 맥락을 검토하고 있습니다. 페이지를 다시 열면 진행 상태를 확인합니다.</p>}
        <EvidenceOverview record={record}/><FusionReview record={record} disabled={locked || finishing || attaching || (!record.fusion && (dirty || saving || !hasOriginal))} running={fusionRunning || record.fusionAttempt?.status === "running"} onRun={runFusion} onChange={reviews => change({...record, fusionReviews: reviews})}/>
        {objectRunning&&<p role="status">Grounding DINO / GPT 처리 중… 로컬 탐지는 최대 10분이 걸릴 수 있습니다.</p>}
        <PipelineProgress pipeline={record.pipeline}/>
        <GroundingReview record={record} disabled={locked||finishing||attaching} actionsDisabled={dirty||saving||!hasOriginal} onDetect={(prompt,boxThreshold,textThreshold)=>runObjectStep("detect",prompt,boxThreshold,textThreshold)} onReview={()=>runObjectStep("review")} onChange={reviews=>change({...record,objectFusionReviews:reviews})}/>
        <details open={!record.ocr}><summary>OCR 추출·전체 문자 원문 확인</summary>
        <OcrReview record={record} disabled={locked || finishing || attaching || (!record.ocr && (dirty || saving || !hasOriginal))} onRun={runOcr} onChange={reviews => change({...record, ocrReviews: reviews})} />
        </details>
        <h2>기존 GPT 후보·사람이 추가한 단서</h2><FeatureTypeSuggestions />
        {record.analysis.modelOutput.candidates.length === 0 && <p className="message loading">모델 후보가 0개입니다. 위험이 없다는 뜻은 아닙니다. 원본을 검토하고 놓친 요소를 추가해 주세요.</p>}
        {record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>모델 관찰 한계</summary><ul>{record.analysis.modelOutput.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {record.humanReviews.map((item, index) => <CueReview record={record} key={item.cueId} number={index + 1} review={item} candidate={item.modelCandidateIndex === null ? undefined : record.analysis!.modelOutput.candidates[item.modelCandidateIndex]} disabled={locked || finishing || attaching} onChange={(patch) => update(item.cueId, patch)} onRemove={() => change({ ...record, humanReviews: record.humanReviews.filter((cue) => cue.cueId !== item.cueId) })} />)}
        <button className="add-cue" disabled={locked || finishing || attaching || record.humanReviews.length >= 100} onClick={() => change({ ...record, humanReviews: [...record.humanReviews, newHumanCue()] })}>놓친 Feature 직접 추가</button>
        <label className="notes-label">실험 메모<textarea value={record.notes} rows={3} maxLength={5000} disabled={locked || finishing || attaching} onChange={(event) => change({ ...record, notes: event.target.value })} /></label>
        <div className="save-bar"><span role="status">{saving ? "저장 중…" : failed ? "저장 실패 · 재시도 필요" : dirty ? "자동 저장 대기 중…" : record.reviewCompletedAt ? "검토 완료" : "로컬 DB에 저장됨"}</span>{error && <p className="review-inline-error">{error}</p>}<div className="record-actions"><button className="button secondary" onClick={() => exportRecords([record])}>JSON Export</button><button className="button secondary" disabled={saving || !dirty} onClick={() => save()}>저장 재시도</button><button className="button primary" disabled={locked || finishing || attaching} onClick={finishAndNext}>{finishing ? "완료 처리 중…" : record.reviewCompletedAt ? "다음 미완료 이미지" : "완료하고 다음"}</button><button className="button secondary" disabled={locked || finishing || attaching || !!record.reviewCompletedAt} onClick={() => save(true)}>완료만 저장</button>{nextId && <Link className="button secondary" href={`/review/${nextId}`} onClick={mayLeave}>다음 미완료 이미지</Link>}</div></div>
      </section>
    </div>}
  </>;
}

