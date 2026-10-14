"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DiscoveryRecord, HumanReview, newHumanCue, reviewStatus, MAX_IMAGE_BYTES, isReviewWritten } from "@/lib/discovery";
import { exportRecords, readRecord, saveRecord } from "@/lib/storage";
import { CueReview, FeatureTypeSuggestions } from "./cue-review";
import { ReviewSaveQueue } from "@/lib/review-save-queue";
import { ReviewGuide } from "./review-guide";

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readRecord(recordId).then((data) => {
      if (cancelled) return;
      const selected = data.record;
      const state = new ReviewSaveQueue(selected, (item, version) => saveRecord(item, version, null), () => {
        if (cancelled) return;
        setRecord(state.current); setDirty(state.dirty); setSaving(state.saving); setFailed(!!state.error);
        if (state.error) setError(state.error);
      });
      queue.current = state; setRecord(selected);
      setHasOriginal(data.job.hasOriginal); setThumbnail(data.thumbnailDataUrl); setNextId(data.nextId);
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
    queue.current?.update({ ...next, reviewCompletedAt: null, updatedAt: new Date().toISOString() });
    setDirty(true); setFailed(false); setError("");
  }

  const save = useCallback(async (complete = false, keepLocked = false) => {
    const state = queue.current;
    if (!state?.current.analysis) return false;
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
    if (finishing || attaching) return;
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
      </section><details className="review-guide-toggle"><summary>적절성·위험도 판단 기준 보기</summary><ReviewGuide /></details></aside>
      <section><div className="review-heading"><h2>이미지 {record.image.imageId.slice(0, 8)} · 후보 {record.humanReviews.length}개</h2><span className={`status-badge status-${reviewStatus(record)}`}>{record.reviewCompletedAt ? "검토 완료" : dirty ? "자동 저장 대기" : reviewStatus(record) === "unreviewed" ? "검토 전" : "검토 중"}</span></div>
        <FeatureTypeSuggestions />
        {record.analysis.modelOutput.candidates.length === 0 && <p className="message loading">모델 후보가 0개입니다. 위험이 없다는 뜻은 아닙니다. 원본을 검토하고 놓친 요소를 추가해 주세요.</p>}
        {record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>모델 관찰 한계</summary><ul>{record.analysis.modelOutput.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {record.humanReviews.map((item, index) => <CueReview key={item.cueId} number={index + 1} review={item} candidate={item.modelCandidateIndex === null ? undefined : record.analysis!.modelOutput.candidates[item.modelCandidateIndex]} disabled={finishing || attaching} onChange={(patch) => update(item.cueId, patch)} onRemove={() => change({ ...record, humanReviews: record.humanReviews.filter((cue) => cue.cueId !== item.cueId) })} />)}
        <button className="add-cue" disabled={finishing || attaching || record.humanReviews.length >= 100} onClick={() => change({ ...record, humanReviews: [...record.humanReviews, newHumanCue()] })}>놓친 Feature 직접 추가</button>
        <label className="notes-label">실험 메모<textarea value={record.notes} rows={3} maxLength={5000} disabled={finishing || attaching} onChange={(event) => change({ ...record, notes: event.target.value })} /></label>
        <div className="save-bar"><span role="status">{saving ? "저장 중…" : failed ? "저장 실패 · 재시도 필요" : dirty ? "자동 저장 대기 중…" : record.reviewCompletedAt ? "검토 완료" : "로컬 DB에 저장됨"}</span>{error && <p className="review-inline-error">{error}</p>}<div className="record-actions"><button className="button secondary" onClick={() => exportRecords([record])}>JSON Export</button><button className="button secondary" disabled={saving || !dirty} onClick={() => save()}>저장 재시도</button><button className="button primary" disabled={finishing || attaching} onClick={finishAndNext}>{finishing ? "완료 처리 중…" : record.reviewCompletedAt ? "다음 미완료 이미지" : "완료하고 다음"}</button><button className="button secondary" disabled={finishing || attaching || !!record.reviewCompletedAt} onClick={() => save(true)}>완료만 저장</button>{nextId && <Link className="button secondary" href={`/review/${nextId}`} onClick={mayLeave}>다음 미완료 이미지</Link>}</div></div>
      </section>
    </div>}
  </>;
}
