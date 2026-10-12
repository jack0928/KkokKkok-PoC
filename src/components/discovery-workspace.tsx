"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Analysis, analysisSchema, applyAnalysis, DiscoveryRecord, HumanReview, MAX_IMAGE_BYTES, newHumanCue, newRecord, preparedImageSchema, RISK_DEFINITION } from "@/lib/discovery";
import { deleteRecord, exportRecords, migrateBrowserRecords, readBrowserRecords, readRecords, saveRecord } from "@/lib/storage";
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
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [browserRecords, setBrowserRecords] = useState<DiscoveryRecord[]>([]);
  const [busy, setBusy] = useState<"prepare" | "analyze" | "save" | "delete" | "migrate" | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const saved = await readRecords();
        if (!cancelled) {
          setRecords(saved);

        }
      } catch (error) {
        if (!cancelled) setError(`로컬 DB 기록을 읽지 못했습니다. ${friendlyError(error)}`);
      } finally { if (!cancelled) setReady(true); }
      if (cancelled) return;
      try { setBrowserRecords(readBrowserRecords()); }
      catch (error) { setError((previous) => [previous, friendlyError(error)].filter(Boolean).join(" ")); }
    }
    void load();
    return () => { cancelled = true; activeRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeRecord(next: DiscoveryRecord) { setSaveFailed(false); setRecord({ ...next, updatedAt: new Date().toISOString() }); setDirty(true); setNotice(""); }
  function mayLeave() { return !dirty || window.confirm("저장하지 않은 변경이 있습니다. 계속하면 현재 변경을 잃습니다. 로컬 DB 저장 또는 JSON Export 후 진행할 수 있습니다. 계속할까요?"); }

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
        setPreview(prepared.dataUrl); setThumbnail(prepared.thumbnailDataUrl ?? null); setDirty(testStarted); setSaveFailed(false); setNotice("같은 분석 이미지를 연결했습니다.");
      } else {
        setRecord(newRecord(prepared.image)); setPreview(prepared.dataUrl); setThumbnail(prepared.thumbnailDataUrl ?? null); setDirty(false); setSaveFailed(false);
      }
      setConsent(false);
    } catch (error) { if (!controller.signal.aborted) setError(friendlyError(error)); }
    finally { if (!controller.signal.aborted) setBusy(null); activeRequest.current = null; }
  }

  async function analyze() {
    if (!record || !preview || !consent || busy || record.analysis) return;
    setTestStarted(true); setDirty(true); setSaveFailed(false);
    setBusy("analyze"); setError(""); setNotice("");
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      // Start persistence only when the user actually runs this experiment.
      // Save the small preview before the VLM call so a failed analysis remains
      // distinguishable from an image that was merely selected.
      try {
        const saved = await saveRecord(record, records.find((item) => item.recordId === record.recordId)?.updatedAt ?? null, thumbnail);
        setRecords(saved); setRecord(saved.find((item) => item.recordId === record.recordId) ?? record); setDirty(false);
      } catch (error) { setSaveFailed(true); throw error; }
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

  const save = useCallback(async () => {
    if (!record || busy || !ready || !testStarted) return;
    setBusy("save"); setSaveFailed(false);
    try {
      const saved = await saveRecord(record, records.find((item) => item.recordId === record.recordId)?.updatedAt ?? null, thumbnail);
      setRecords(saved); setRecord(saved.find((item) => item.recordId === record.recordId) ?? record);
      setDirty(false); setError(""); setNotice("로컬 DB에 저장했습니다. 공유·장기 보존은 JSON Export를 이용해 주세요.");
    } catch (error) { setSaveFailed(true); setError(`자동 저장하지 못했습니다. ${friendlyError(error)}`); }
    finally { setBusy(null); }
  }, [record, records, busy, ready, thumbnail, testStarted]);

  useEffect(() => {
    if (!testStarted || !dirty || !record || !ready || busy || saveFailed) return;
    const timer = window.setTimeout(() => { void save(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [testStarted, dirty, record, ready, busy, saveFailed, save]);

  function download(items: DiscoveryRecord[]) {
    try { exportRecords(items); setError(""); setNotice("JSON 다운로드를 요청했습니다. 파일에는 이미지가 없지만 관찰 내용에 개인정보가 있을 수 있습니다."); }
    catch { setError("Export할 기록의 형식을 확인해 주세요."); }
  }

  const reviewed = record?.humanReviews.filter((r) => r.appropriateness !== "unreviewed" && r.humanRisk !== null && r.humanReason.trim()).length ?? 0;

  return (
    <>
      <div className="page-heading"><div><h1>Feature Discovery 테스트</h1><p>Experiment 1 · 이미지 분석 → 후보 검토 → 결과 저장</p></div><button type="button" className="button secondary" disabled={!!busy} onClick={() => { if (!mayLeave()) return; setTestStarted(false); setRecord(null); setPreview(null); setThumbnail(null); setSaveFailed(false); setConsent(false); setDirty(false); setError(""); setNotice(""); }}>새 실험 <span aria-hidden="true">＋</span></button></div>
      <section className="discovery-guide" aria-label="Feature Discovery 가이드">
        <div className="guide-purpose">
          <div><h2>왜 하나요?</h2><p>사진 속 어떤 요소를 위치 단서로 정의할지 탐색합니다. VLM과 사람의 판단 차이, 놓친 단서와 불필요한 후보를 확인합니다.</p></div>
          <div><h2>결과는 어디에 쓰나요?</h2><p>저장·Export한 후보와 검토 이유를 사람이 모아 살펴보고, Feature 분류와 위험도 판단 기준을 정리합니다. 이 기준은 추후 Detection Evaluation에 사용하며, 평가에는 별도의 이미지를 씁니다.</p></div>
        </div>
        <details className="guide-method">
          <summary>테스트 방법 보기</summary>
          <ol>
            <li>사용 권한이 있는 JPEG·PNG·WebP 이미지(최대 10 MB)를 선택하고 Preview를 확인합니다.</li>
            <li>외부 전송에 동의한 뒤 ‘VLM으로 후보 탐색’을 누릅니다. 이때 이미지가 OpenAI로 전송되고 API 비용이 발생합니다.</li>
            <li>후보마다 분류·관찰 내용·영역을 확인하고, 적절성·사람의 위험도·판단 이유를 작성합니다. 위험도는 외부 정보와 결합했을 때 위치 식별에 얼마나 유용한지를 기준으로 판단합니다.</li>
            <li>놓친 Feature를 직접 추가하고, 애매한 기준이나 의문점은 실험 메모에 남깁니다. 판단하기 어려운 항목은 ‘판단 보류’로 기록합니다.</li>
            <li>후보 탐색을 실행한 기록부터 분석·검토 변경이 로컬 DB에 자동 저장됩니다. 저장 완료를 확인하고, 공유·장기 보존할 결과는 JSON Export합니다. 결과 확인용 작은 미리보기만 DB에 저장됩니다. 원본은 비공개로 따로 관리합니다.</li>
          </ol>
          <p>모델 원본과 사람의 검토는 따로 보존합니다. 결과는 확정된 정답이나 탐지 성능 점수가 아니며, 다시 분석하려면 ‘새 실험’을 시작하세요.</p>
        </details>
      </section>
      <div className="research-banner"><strong>VLM 결과 ≠ Ground Truth</strong><span>AI의 제안은 Feature 후보를 탐색하기 위한 참고 자료입니다. 최종 판단은 사람이 합니다.</span></div>
      <ol className="steps" aria-label="실험 순서"><li className={!record ? "current" : "done"}><span>01</span> 이미지 준비</li><li className={record && !record.analysis ? "current" : record?.analysis ? "done" : ""}><span>02</span> VLM 후보 탐색</li><li className={record?.analysis ? "current" : ""}><span>03</span> 사람 검토·추가</li><li><span>04</span> 저장·Export</li></ol>
      <div aria-live="polite">{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success">{notice}</p>}{busy && <p className="message loading" role="status">{busy === "prepare" ? "이미지를 준비하고 있습니다…" : busy === "analyze" ? "VLM이 Feature 후보를 탐색하고 있습니다. 최대 약 90초가 걸릴 수 있습니다…" : "로컬 DB 작업을 진행하고 있습니다…"}</p>}</div>

      <div className="workspace-grid">
        <aside className="image-column">
          <section className="panel"><div className="panel-heading"><h2>테스트 이미지</h2><span className="eyebrow">INPUT</span></div>
            <p className="caption">이미지 선택만으로는 저장하지 않습니다. 후보 탐색 실행 후 결과와 최대 480px JPEG 미리보기를 로컬 DB에 자동 저장합니다. 원본·분석본은 저장하지 않습니다.</p>
            <ImageUpload preview={preview} disabled={!!busy} attachedRecord={!!record} dimensions={record ? `${record.image.width} × ${record.image.height}` : undefined} onSelect={selectImage} />
            {record && <div className="image-meta"><span>IMAGE ID</span><code>{record.image.imageId.slice(0, 8)}</code><span className="subtle">원본·분석 이미지 hash 기록</span></div>}
            {!record?.analysis && <><div className="privacy-note"><strong>외부 API 전송 안내</strong><p>분석 버튼을 누르면 이 이미지가 OpenAI로 전송되며 API 비용이 발생합니다. 서버에 원본·분석본을 저장하지 않지만 OpenAI의 별도 데이터 보존 정책이 적용됩니다.</p><label className="checkbox-label"><input type="checkbox" disabled={!!busy || !record} checked={consent} onChange={(e) => setConsent(e.target.checked)} />내가 사용할 권한이 있는 이미지이며, 외부 전송에 동의합니다.</label></div><button type="button" className="button primary wide" onClick={analyze} disabled={!record || !preview || !consent || !!busy}>VLM으로 후보 탐색 <span aria-hidden="true">↗</span></button></>}
            {record?.analysis && <div className="analysis-info"><span className="pill green">분석 완료</span><p>{record.analysis.responseModel}</p><p className="caption">한 기록의 모델 원본은 덮어쓰지 않습니다. 재분석은 새 실험으로 진행하세요.</p></div>}
          </section>
          <section className="panel risk-guide"><h2>Risk Level 기준</h2><p>{RISK_DEFINITION}</p><dl><div><dt><span className="risk-badge low">low</span></dt><dd>일반적 단서로, 위치를 좁히는 데 제한적</dd></div><div><dt><span className="risk-badge medium">medium</span></dt><dd>다른 정보와 조합하면 위치를 좁히는 데 유용</dd></div><div><dt><span className="risk-badge high">high</span></dt><dd>구체적인 식별자로, 위치 특정에 매우 유용</dd></div></dl><p className="caption">탐지 confidence나 실제 노출 확률을 의미하지 않습니다. 잠정 기준이며 사람의 이유를 함께 기록합니다.</p></section>
        </aside>

        <section className="review-column" aria-label="Feature 후보 검토">
          <div className="review-heading"><div><h2>Feature 후보 & Human Review <span className="count">{record?.humanReviews.length ?? 0}</span></h2><p>모델 원본은 보존하고, 사람의 검토는 별도로 기록합니다.</p></div>{record && <span className="pill">검토 작성 {reviewed} / {record.humanReviews.length}</span>}</div>
          <FeatureTypeSuggestions />
          {!record?.analysis && <div className="empty-state"><h3>{record ? "분석을 시작해 후보를 발견하세요" : "첫 번째 이미지로 탐색을 시작하세요"}</h3><p>텍스트, 로고, 건물, 교통시설, 환경 단서…<br />분류는 잠정적인 예시이며 직접 새 Feature type을 입력할 수 있습니다.</p></div>}
          {record?.analysis && record.analysis.modelOutput.candidates.length === 0 && <div className="empty-state compact"><h3>VLM이 제안한 후보가 없습니다.</h3><p>위험이 없다는 뜻은 아닙니다. 이미지를 직접 검토하고 놓친 Feature를 추가해 주세요.</p></div>}
          {record?.analysis && record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>VLM의 관찰 한계 보기</summary><ul>{record.analysis.modelOutput.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
          {record?.humanReviews.map((review, index) => <CueReview key={review.cueId} review={review} candidate={review.modelCandidateIndex === null ? undefined : record.analysis?.modelOutput.candidates[review.modelCandidateIndex]} number={index + 1} disabled={!!busy} onChange={(patch) => updateReview(review.cueId, patch)} onRemove={() => changeRecord({ ...record, humanReviews: record.humanReviews.filter((r) => r.cueId !== review.cueId) })} />)}
          {record && <><button type="button" className="add-cue" disabled={!!busy || record.humanReviews.length >= 100} onClick={() => changeRecord({ ...record, humanReviews: [...record.humanReviews, newHumanCue()] })}><span aria-hidden="true">＋</span> VLM이 놓친 Feature 직접 추가</button><label className="notes-label" htmlFor="experiment-notes">실험 메모<textarea id="experiment-notes" maxLength={5000} rows={3} disabled={!!busy} value={record.notes} placeholder="분류 기준, 의문점, 후속 검토 사항을 적어 주세요" onChange={(e) => changeRecord({ ...record, notes: e.target.value })} /></label></>}
          <div className="save-bar"><span className="subtle">{busy === "save" ? "로컬 DB 저장 중…" : saveFailed ? "자동 저장 실패 · 재시도 또는 JSON Export해 주세요" : !testStarted && record ? "분석 전 · 아직 DB에 저장하지 않았습니다" : dirty ? "변경 사항 자동 저장 대기 중…" : record ? "로컬 DB에 저장됨" : "결과와 작은 이미지 미리보기는 로컬 DB에 자동 저장됩니다"}</span><div><button type="button" className="button secondary" disabled={!record || !!busy} onClick={() => record && download([record])}>JSON Export <span aria-hidden="true">↓</span></button><button type="button" className="button primary" disabled={!record || !!busy || !ready || !dirty || !testStarted} onClick={save}>{saveFailed ? "저장 재시도" : "지금 저장"}</button></div></div>
        </section>
      </div>

      {browserRecords.length > 0 && <section className="panel legacy-records" aria-label="기존 브라우저 기록">
        <div className="panel-heading"><h2>기존 브라우저 기록 {browserRecords.length}개</h2></div>
        <p className="caption">이전에 저장한 기록을 로컬 DB에 옮길 수 있습니다. 기존 브라우저 기록은 그대로 남으며, 같은 ID의 다른 DB 기록은 덮어쓰지 않습니다.</p>
        <div className="legacy-actions">
          <button type="button" className="button secondary" disabled={!!busy} onClick={() => download(browserRecords)}>기존 기록 JSON Export</button>
          <button type="button" className="button secondary" disabled={!!busy || !ready} onClick={async () => {
            setBusy("migrate");
            try {
              setRecords(await migrateBrowserRecords(browserRecords));
              setBrowserRecords([]); setError(""); setNotice("기존 브라우저 기록을 로컬 DB에 옮겼습니다. 브라우저 원본도 유지했습니다.");
            } catch (error) { setError(friendlyError(error)); }
            finally { setBusy(null); }
          }}>로컬 DB로 옮기기</button>
        </div>
      </section>}

      <section className="saved-section"><div className="panel-heading"><div><div className="eyebrow">LOCAL RECORDS</div><h2>저장된 실험 <span className="count">{records.length}</span></h2></div><div className="record-actions"><Link className="button secondary small" href="/results" onClick={(event) => { if (busy || !mayLeave()) event.preventDefault(); }}>결과 모아보기</Link><button type="button" className="button secondary small" disabled={!records.length || !!busy} onClick={() => download(records)}>저장 기록 전체 Export ↓</button></div></div><p className="caption">최대 480px의 이미지 미리보기를 결과와 함께 저장합니다. 기록을 열면 분석용 Preview를 위해 같은 원본을 다시 연결할 수 있습니다. 기록은 이 컴퓨터의 로컬 DB에 보관됩니다. 공유·백업을 위해 JSON을 따로 보존하세요. 관찰 내용도 민감정보일 수 있습니다.</p>
        {!records.length && <p className="saved-empty">{ready ? "아직 저장된 실험이 없습니다." : "저장 기록을 확인하고 있습니다…"}</p>}
        <div className="saved-list">{records.map((saved) => <article key={saved.recordId} className="saved-record"><div><strong>이미지 {saved.image.imageId.slice(0, 8)}</strong><p>{new Date(saved.updatedAt).toLocaleString("ko-KR")} · Feature {saved.humanReviews.length}개 · {saved.analysis ? "분석 완료" : "분석 전"}</p></div><div><button type="button" className="button secondary small" disabled={!!busy} onClick={() => { if (!mayLeave()) return; setTestStarted(true); setRecord(saved); setPreview(null); setThumbnail(null); setSaveFailed(false); setConsent(false); setDirty(false); setError(""); setNotice("기록을 열었습니다. Preview가 필요하면 같은 원본 이미지를 다시 연결해 주세요."); }}>열기</button><button type="button" className="button ghost small" disabled={!!busy} onClick={async () => {
              if (busy || !window.confirm("로컬 DB에서 해당 기록을 삭제할까요? 기존 브라우저 기록과 Export한 파일은 별도로 남습니다.")) return;
              setBusy("delete");
              try {
                setRecords(await deleteRecord(saved.recordId, saved.updatedAt));
                if (record?.recordId === saved.recordId) { setTestStarted(false); setRecord(null); setPreview(null); setThumbnail(null); setSaveFailed(false); setDirty(false); setConsent(false); }
                setNotice("로컬 DB 기록을 삭제했습니다."); setError("");
              } catch (error) { setError(friendlyError(error)); }
              finally { setBusy(null); }
            }}>삭제</button></div></article>)}</div>
      </section>
    </>
  );
}
