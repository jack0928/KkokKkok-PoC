"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DiscoveryRecord, HumanReview, newHumanCue, reviewStatus, MAX_IMAGE_BYTES, isReviewWritten } from "@/lib/discovery";
import { exportRecords, readResults, saveRecord } from "@/lib/storage";
import { CueReview, FeatureTypeSuggestions } from "./cue-review";
import { ReviewGuide } from "./review-guide";

export function HumanReviewWorkspace({ recordId }: { recordId: string }) {
  const [record, setRecord] = useState<DiscoveryRecord | null>(null);
  const [version, setVersion] = useState<string | null>(null);
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readResults().then((data) => {
      if (cancelled) return;
      const selected = data.records.find((item) => item.recordId === recordId);
      if (!selected) { setError("기록을 찾을 수 없습니다."); return; }
      setRecord(selected); setVersion(selected.updatedAt);
      setHasOriginal(data.jobs[recordId]?.hasOriginal ?? false); setThumbnail(data.thumbnails[recordId] ?? null);
      setNextId(data.records.find((item) => item.recordId !== recordId && item.analysis && reviewStatus(item) !== "completed")?.recordId ?? null);
    }).catch(() => { if (!cancelled) setError("검토 기록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [recordId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(next: DiscoveryRecord) {
    setRecord({ ...next, reviewCompletedAt: null, updatedAt: new Date().toISOString() });
    setDirty(true); setFailed(false); setError("");
  }

  const save = useCallback(async (complete = false) => {
    if (!record?.analysis || saving) return;
    if (complete && record.humanReviews.some((item) => !isReviewWritten(item))) {
      setError("각 후보의 적절성·이유·위험도를 작성해 주세요. 판단 보류 항목은 이유를 남기면 위험도를 미검토로 둘 수 있습니다."); return;
    }
    setSaving(true); setFailed(false);
    try {
      const saved = await saveRecord({ ...record, reviewCompletedAt: complete ? new Date().toISOString() : record.reviewCompletedAt }, version, null);
      const updated = saved.find((item) => item.recordId === recordId)!;
      setRecord(updated); setVersion(updated.updatedAt); setDirty(false); setError("");
    } catch (error) { setFailed(true); setError(error instanceof Error ? error.message : "저장 실패"); }
    finally { setSaving(false); }
  }, [record, recordId, version, saving]);

  useEffect(() => {
    if (!dirty || saving || failed) return;
    const timer = setTimeout(() => { void save(); }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, saving, failed, save]);

  async function attach(file: File) {
    if (!record || !attachConsent || saving) return;
    if (file.size > MAX_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("JPEG·PNG·WebP, 10 MB 이하 이미지를 선택해 주세요."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/analysis-jobs?record=${recordId}`, { method: "POST", headers: { "Content-Type": file.type, "X-Analysis-Consent": "true", "X-Record-Version": record.updatedAt }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setHasOriginal(true); setImageError(false); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "원본 연결 실패"); }
    finally { setSaving(false); }
  }

  function mayLeave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (saving || (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?"))) event.preventDefault();
  }

  function update(cueId: string, patch: Partial<HumanReview>) {
    if (record) change({ ...record, humanReviews: record.humanReviews.map((item) => item.cueId === cueId ? { ...item, ...patch } : item) });
  }

  return <>
    <div className="page-heading"><div><h1>사람 검토</h1><p>모델 원본을 보존하며 적절성·위험도·이유를 독립적으로 기록합니다.</p></div><Link className="button secondary" href="/results" onClick={mayLeave}>결과 목록</Link></div>
    {error && <p role="alert" className="message error">{error}</p>}
    {!ready && <p>기록을 불러오고 있습니다…</p>}
    {record && !record.analysis && <p className="message loading">분석이 완료되어야 검토할 수 있습니다.</p>}
    {record?.analysis && <div className="workspace-grid">
      <aside className="image-column"><section className="panel">
        <h2>검토 이미지</h2>
        {hasOriginal ? <><div className="record-actions"><button className="button secondary small" onClick={() => { setImageKind("original"); setImageError(false); }}>원본 보기</button><button className="button secondary small" onClick={() => { setImageKind("analysis"); setImageError(false); }}>AI 입력 이미지</button></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="review-image" src={`/api/discovery-images/${recordId}?kind=${imageKind}`} alt={imageKind === "original" ? "검토용 원본 이미지" : "모델에 전송한 전처리 이미지"} onError={() => setImageError(true)} />
          <a className="button secondary small" target="_blank" rel="noopener noreferrer" href={`/api/discovery-images/${recordId}?kind=${imageKind}`}>이미지 크게 보기</a>
          {imageError && <p role="alert">이미지 파일을 읽지 못했습니다. 저장 경로를 확인해 주세요.</p>}
        </> : <>{thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="review-image" src={thumbnail} alt="기존 저화질 미리보기" />
        )}<p className="caption">기존 기록에는 원본이 없습니다. 같은 원본을 연결하면 이후 다시 업로드할 필요가 없습니다.</p><label className="checkbox-label"><input type="checkbox" checked={attachConsent} onChange={(event) => setAttachConsent(event.target.checked)} />원본의 비공개 로컬 보관에 동의합니다.</label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!attachConsent || saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); }} /></>}
      </section><ReviewGuide /></aside>
      <section><div className="review-heading"><h2>이미지 {record.image.imageId.slice(0, 8)} · 후보 {record.humanReviews.length}개</h2><span>{record.reviewCompletedAt ? "검토 완료" : dirty ? "자동 저장 대기" : "저장됨"}</span></div>
        <FeatureTypeSuggestions />
        {record.analysis.modelOutput.candidates.length === 0 && <p className="message loading">모델 후보가 0개입니다. 위험이 없다는 뜻은 아닙니다. 원본을 검토하고 놓친 요소를 추가해 주세요.</p>}
        {record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>모델 관찰 한계</summary><ul>{record.analysis.modelOutput.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {record.humanReviews.map((item, index) => <CueReview key={item.cueId} number={index + 1} review={item} candidate={item.modelCandidateIndex === null ? undefined : record.analysis!.modelOutput.candidates[item.modelCandidateIndex]} disabled={saving} onChange={(patch) => update(item.cueId, patch)} onRemove={() => change({ ...record, humanReviews: record.humanReviews.filter((cue) => cue.cueId !== item.cueId) })} />)}
        <button className="add-cue" disabled={saving || record.humanReviews.length >= 100} onClick={() => change({ ...record, humanReviews: [...record.humanReviews, newHumanCue()] })}>놓친 Feature 직접 추가</button>
        <label className="notes-label">실험 메모<textarea value={record.notes} rows={3} maxLength={5000} disabled={saving} onChange={(event) => change({ ...record, notes: event.target.value })} /></label>
        <div className="save-bar"><span role="status">{saving ? "저장 중…" : failed ? "저장 실패 · 재시도 필요" : dirty ? "자동 저장 대기 중…" : record.reviewCompletedAt ? "검토 완료" : "로컬 DB에 저장됨"}</span><div className="record-actions"><button className="button secondary" onClick={() => exportRecords([record])}>JSON Export</button><button className="button secondary" disabled={saving || !dirty} onClick={() => save()}>저장 재시도</button><button className="button primary" disabled={saving || !!record.reviewCompletedAt} onClick={() => save(true)}>검토 완료</button>{nextId && <Link className="button secondary" href={`/review/${nextId}`} onClick={mayLeave}>다음 미완료 이미지</Link>}</div></div>
      </section>
    </div>}
  </>;
}
