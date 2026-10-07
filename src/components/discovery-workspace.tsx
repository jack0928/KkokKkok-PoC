"use client";

import { useEffect, useRef, useState } from "react";
import { Analysis, analysisSchema, applyAnalysis, DiscoveryRecord, HumanReview, MAX_IMAGE_BYTES, newHumanCue, newRecord, preparedImageSchema, RISK_DEFINITION } from "@/lib/discovery";
import { deleteRecord, exportRecords, readRecords, saveRecord } from "@/lib/storage";
import { CueReview, FeatureTypeSuggestions } from "./cue-review";
import { ImageUpload } from "./image-upload";

async function responseJson(response: Response) {
  let body;
  try { body = await response.json(); } catch { throw new Error("서버 응답을 읽을 수 없습니다. 서버 상태를 확인해 주세요."); }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "요청에 실패했습니다.");
  return body;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.name === "QuotaExceededError") return "브라우저 저장 공간이 부족합니다. JSON Export 후 오래된 기록을 삭제해 주세요.";
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

export function DiscoveryWorkspace() {
  const [record, setRecord] = useState<DiscoveryRecord | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "analyze" | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    // Read this browser's storage after hydration; no server-side storage access.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setRecords(readRecords()); } catch (error) { setError(`브라우저 저장 기록을 읽지 못했습니다. ${friendlyError(error)}`); setStorageError(true); }
    setReady(true);
    return () => activeRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeRecord(next: DiscoveryRecord) { setRecord({ ...next, updatedAt: new Date().toISOString() }); setDirty(true); setNotice(""); }
  function mayLeave() { return !dirty || window.confirm("저장하지 않은 변경이 있습니다. 계속하면 현재 변경을 잃습니다. 브라우저 저장 또는 JSON Export 후 진행할 수 있습니다. 계속할까요?"); }

  async function selectImage(file: File) {
    if (busy) return;
    setError(""); setNotice("");
    if (!file.size || file.size > MAX_IMAGE_BYTES) { setError("1 byte ~ 10 MB 이미지를 선택해 주세요."); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("JPEG, PNG, WebP 정지 이미지만 사용할 수 있습니다."); return; }
    const controller = new AbortController(); activeRequest.current = controller;
    setBusy("prepare");
    try {
      const response = await fetch("/api/prepare-image", { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: controller.signal });
      const prepared = preparedImageSchema.parse(await responseJson(response));
      if (record) {
        if (record.image.originalSha256 !== prepared.image.originalSha256 || record.image.analysisSha256 !== prepared.image.analysisSha256) {
          throw new Error("저장 기록과 다른 이미지입니다. 같은 원본을 선택하거나 ‘새 실험’을 시작해 주세요.");
        }
        setPreview(prepared.dataUrl); setNotice("같은 분석 이미지를 연결했습니다.");
      } else {
        setRecord(newRecord(prepared.image)); setPreview(prepared.dataUrl); setDirty(true);
      }
      setConsent(false);
    } catch (error) { if (!controller.signal.aborted) setError(friendlyError(error)); }
    finally { if (!controller.signal.aborted) setBusy(null); activeRequest.current = null; }
  }

  async function analyze() {
    if (!record || !preview || !consent || busy || record.analysis) return;
    setBusy("analyze"); setError(""); setNotice("");
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      const response = await fetch("/api/feature-discovery", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: record.image, dataUrl: preview }), signal: controller.signal });
      const analysis: Analysis = analysisSchema.parse(await responseJson(response));
      changeRecord(applyAnalysis(record, analysis));
      setNotice("VLM 후보를 받았습니다. 사람의 위험도는 아직 미검토입니다.");
    } catch (error) { if (!controller.signal.aborted) setError(friendlyError(error)); }
    finally { if (!controller.signal.aborted) setBusy(null); activeRequest.current = null; }
  }

  function updateReview(cueId: string, patch: Partial<HumanReview>) {
    if (!record) return;
    changeRecord({ ...record, humanReviews: record.humanReviews.map((review) => review.cueId === cueId ? { ...review, ...patch } : review) });
  }

  function save() {
    if (!record) return;
    try { setRecords(saveRecord(record)); setDirty(false); setError(""); setNotice("이 브라우저에 저장했습니다. 장기 보존은 JSON Export를 이용해 주세요."); }
    catch (error) { setError(`저장하지 못했습니다. ${friendlyError(error)}`); }
  }

  function download(items: DiscoveryRecord[]) {
    try { exportRecords(items); setError(""); setNotice("JSON 다운로드를 요청했습니다. 파일에는 이미지가 없지만 관찰 내용에 개인정보가 있을 수 있습니다."); }
    catch { setError("Export할 기록의 형식을 확인해 주세요."); }
  }

  const reviewed = record?.humanReviews.filter((r) => r.appropriateness !== "unreviewed" && r.humanRisk !== null && r.humanReason.trim()).length ?? 0;

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">EXPERIMENT 01 / FEATURE DISCOVERY</div><h1>위치 단서 탐색</h1><p>사진 속 후보를 발견하고, 사람의 판단을 기록하세요.</p></div><button type="button" className="button secondary" disabled={!!busy} onClick={() => { if (!mayLeave()) return; setRecord(null); setPreview(null); setConsent(false); setDirty(false); setError(""); setNotice(""); }}>새 실험 <span aria-hidden="true">＋</span></button></div>
      <div className="research-banner"><strong>VLM 결과 ≠ Ground Truth</strong><span>AI의 제안은 Feature 후보를 탐색하기 위한 참고 자료입니다. 최종 판단은 사람이 합니다.</span></div>
      <ol className="steps" aria-label="실험 순서"><li className={!record ? "current" : "done"}><span>01</span> 이미지 준비</li><li className={record && !record.analysis ? "current" : record?.analysis ? "done" : ""}><span>02</span> VLM 후보 탐색</li><li className={record?.analysis ? "current" : ""}><span>03</span> 사람 검토·추가</li><li><span>04</span> 저장·Export</li></ol>
      <div aria-live="polite">{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success">{notice}</p>}{busy && <p className="message loading" role="status">{busy === "prepare" ? "이미지를 준비하고 있습니다…" : "VLM이 Feature 후보를 탐색하고 있습니다. 최대 약 90초가 걸릴 수 있습니다…"}</p>}</div>

      <div className="workspace-grid">
        <aside className="image-column">
          <section className="panel"><div className="panel-heading"><h2>테스트 이미지</h2><span className="eyebrow">INPUT</span></div>
            <ImageUpload preview={preview} disabled={!!busy} attachedRecord={!!record} dimensions={record ? `${record.image.width} × ${record.image.height}` : undefined} onSelect={selectImage} />
            {record && <div className="image-meta"><span>IMAGE ID</span><code>{record.image.imageId.slice(0, 8)}</code><span className="subtle">원본·분석 이미지 hash 기록</span></div>}
            {!record?.analysis && <><div className="privacy-note"><strong>외부 API 전송 안내</strong><p>분석 버튼을 누르면 이 이미지가 OpenAI로 전송되며 API 비용이 발생합니다. 서버에 사진을 저장하지 않지만 OpenAI의 별도 데이터 보존 정책이 적용됩니다.</p><label className="checkbox-label"><input type="checkbox" disabled={!!busy || !record} checked={consent} onChange={(e) => setConsent(e.target.checked)} />내가 사용할 권한이 있는 이미지이며, 외부 전송에 동의합니다.</label></div><button type="button" className="button primary wide" onClick={analyze} disabled={!record || !preview || !consent || !!busy}>VLM으로 후보 탐색 <span aria-hidden="true">↗</span></button></>}
            {record?.analysis && <div className="analysis-info"><span className="pill green">분석 완료</span><p>{record.analysis.responseModel}</p><p className="caption">한 기록의 모델 원본은 덮어쓰지 않습니다. 재분석은 새 실험으로 진행하세요.</p></div>}
          </section>
          <section className="panel risk-guide"><div className="eyebrow">RISK LEVEL의 의미</div><h2>눈에 띄는 정도가 아닌,<br />위치 식별의 유용성</h2><p>{RISK_DEFINITION}</p><dl><div><dt><span className="risk-badge low">low</span></dt><dd>일반적 단서로, 위치를 좁히는 데 제한적</dd></div><div><dt><span className="risk-badge medium">medium</span></dt><dd>다른 정보와 조합하면 위치를 좁히는 데 유용</dd></div><div><dt><span className="risk-badge high">high</span></dt><dd>구체적인 식별자로, 위치 특정에 매우 유용</dd></div></dl><p className="caption">탐지 confidence나 실제 노출 확률을 의미하지 않습니다. 잠정 기준이며 사람의 이유를 함께 기록합니다.</p></section>
        </aside>

        <section className="review-column" aria-label="Feature 후보 검토">
          <div className="review-heading"><div><h2>Feature 후보 & Human Review <span className="count">{record?.humanReviews.length ?? 0}</span></h2><p>모델 원본은 보존하고, 사람의 검토는 별도로 기록합니다.</p></div>{record && <span className="pill">검토 작성 {reviewed} / {record.humanReviews.length}</span>}</div>
          <FeatureTypeSuggestions />
          {!record?.analysis && <div className="empty-state"><div className="empty-icon" aria-hidden="true">⌕</div><h3>{record ? "분석을 시작해 후보를 발견하세요" : "첫 번째 이미지로 탐색을 시작하세요"}</h3><p>텍스트, 로고, 건물, 교통시설, 환경 단서…<br />분류는 잠정적인 예시이며 직접 새 Feature type을 입력할 수 있습니다.</p></div>}
          {record?.analysis && record.analysis.modelOutput.candidates.length === 0 && <div className="empty-state compact"><h3>VLM이 제안한 후보가 없습니다.</h3><p>위험이 없다는 뜻은 아닙니다. 이미지를 직접 검토하고 놓친 Feature를 추가해 주세요.</p></div>}
          {record?.analysis && record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>VLM의 관찰 한계 보기</summary><ul>{record.analysis.modelOutput.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
          {record?.humanReviews.map((review, index) => <CueReview key={review.cueId} review={review} candidate={review.modelCandidateIndex === null ? undefined : record.analysis?.modelOutput.candidates[review.modelCandidateIndex]} number={index + 1} disabled={!!busy} onChange={(patch) => updateReview(review.cueId, patch)} onRemove={() => changeRecord({ ...record, humanReviews: record.humanReviews.filter((r) => r.cueId !== review.cueId) })} />)}
          {record && <><button type="button" className="add-cue" disabled={!!busy || record.humanReviews.length >= 100} onClick={() => changeRecord({ ...record, humanReviews: [...record.humanReviews, newHumanCue()] })}><span aria-hidden="true">＋</span> VLM이 놓친 Feature 직접 추가</button><label className="notes-label" htmlFor="experiment-notes">실험 메모<textarea id="experiment-notes" maxLength={5000} rows={3} disabled={!!busy} value={record.notes} placeholder="분류 기준, 의문점, 후속 검토 사항을 적어 주세요" onChange={(e) => changeRecord({ ...record, notes: e.target.value })} /></label></>}
          <div className="save-bar"><span className="subtle">{dirty ? "저장하지 않은 변경이 있습니다" : record ? "브라우저 저장 기록" : "결과는 이 브라우저에 저장됩니다"}</span><div><button type="button" className="button secondary" disabled={!record || !!busy} onClick={() => record && download([record])}>JSON Export <span aria-hidden="true">↓</span></button><button type="button" className="button primary" disabled={!record || !!busy || !ready || storageError} onClick={save}>브라우저 저장</button></div></div>
        </section>
      </div>

      <section className="saved-section"><div className="panel-heading"><div><div className="eyebrow">LOCAL RECORDS</div><h2>저장된 실험 <span className="count">{records.length}</span></h2></div><button type="button" className="button secondary small" disabled={!records.length || !!busy} onClick={() => download(records)}>저장 기록 전체 Export ↓</button></div><p className="caption">이미지는 저장하지 않습니다. 기록을 열면 같은 원본을 다시 연결할 수 있습니다. 브라우저 저장소 삭제 시 기록도 사라지므로 JSON을 따로 보존하세요. 관찰 내용도 민감정보일 수 있습니다.</p>
        {!records.length && <p className="saved-empty">{ready ? "아직 저장된 실험이 없습니다." : "저장 기록을 확인하고 있습니다…"}</p>}
        <div className="saved-list">{records.map((saved) => <article key={saved.recordId} className="saved-record"><div><strong>이미지 {saved.image.imageId.slice(0, 8)}</strong><p>{new Date(saved.updatedAt).toLocaleString("ko-KR")} · Feature {saved.humanReviews.length}개 · {saved.analysis ? "분석 완료" : "분석 전"}</p></div><div><button type="button" className="button secondary small" disabled={!!busy} onClick={() => { if (!mayLeave()) return; setRecord(saved); setPreview(null); setConsent(false); setDirty(false); setError(""); setNotice("기록을 열었습니다. Preview가 필요하면 같은 원본 이미지를 다시 연결해 주세요."); }}>열기</button><button type="button" className="button ghost small" disabled={!!busy} onClick={() => { if (!window.confirm("이 브라우저에서 해당 기록을 삭제할까요? Export한 파일은 별도로 삭제해야 합니다.")) return; try { setRecords(deleteRecord(saved.recordId)); if (record?.recordId === saved.recordId) { setRecord(null); setPreview(null); setDirty(false); setConsent(false); } setNotice("브라우저 기록을 삭제했습니다."); setError(""); } catch (error) { setError(friendlyError(error)); } }}>삭제</button></div></article>)}</div>
      </section>
    </>
  );
}
