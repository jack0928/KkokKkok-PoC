"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DiscoveryRecord, RISK_DEFINITION, RecordSummary, RecordDetail } from "@/lib/discovery";
import { deleteRecord, exportRecords, readSummaries, readRecord, readRecords } from "@/lib/storage";
import { LegacyRecords } from "./legacy-records";

const appropriateness = { unreviewed: "미검토", appropriate: "적절", inappropriate: "부적절", uncertain: "판단 보류" };

export function DiscoveryResults() {
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [details, setDetails] = useState<Record<string, RecordDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await readSummaries();
        if (!cancelled) { setRecords(data); }
      } catch { if (!cancelled) setError("저장된 결과를 읽지 못했습니다. 로컬 DB 설정을 확인해 주세요."); }
      finally { if (!cancelled) setLoading(false); }
      if (!cancelled) timer = setTimeout(load, 3000);
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  async function refresh() {
    if (deletingId) return;
    setLoading(true); setError(""); setNotice("");
    try { const data = await readSummaries(); setRecords(data); }
    catch { setError("저장된 결과를 읽지 못했습니다. 로컬 DB 설정을 확인해 주세요."); }
    finally { setLoading(false); }
  }

  function download(items: DiscoveryRecord[]) {
    try { exportRecords(items); setNotice("JSON 다운로드를 요청했습니다. 관찰 내용도 민감정보일 수 있으므로 비공개로 공유해 주세요."); }
    catch { setError("JSON Export에 실패했습니다."); }
  }

  async function remove(record: RecordSummary) {
    if (loading || deletingId || !window.confirm("이 결과와 원본·분석본·미리보기를 로컬 DB에서 삭제할까요? 삭제 후 복구할 수 없습니다. Export한 파일과 기존 브라우저 기록은 그대로 남습니다.")) return;
    setDeletingId(record.recordId); setError(""); setNotice("");
    try {
      await deleteRecord(record.recordId, record.updatedAt);
      setRecords((current) => current.filter((item) => item.recordId !== record.recordId));
      setNotice("결과와 보관된 이미지를 삭제했습니다.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "결과를 삭제하지 못했습니다. 다시 시도해 주세요.");
    } finally { setDeletingId(null); }
  }

  function state(record: RecordSummary) {
    return record.hasAnalysis ? record.reviewStatus : record.job.status;
  }
  const statusLabels: Record<string, string> = { queued: "분석 대기", analyzing: "분석 중", failed: "분석 실패", legacy: "기존 미완료 기록", unreviewed: "검토 전", in_progress: "검토 중", completed: "검토 완료" };
  const filtered = records.filter((record) => filter === "all" || state(record) === filter);

  async function retry(id: string) {
    if (!window.confirm("재시도하면 API 비용이 발생할 수 있습니다. 분석을 다시 요청할까요?")) return;
    try {
      const response = await fetch(`/api/analysis-jobs?action=retry&record=${id}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "재시도 실패"); }
  }

  return (
    <>
      <div className="page-heading"><div><h1>테스트 결과</h1><p>로컬 DB에 저장한 Feature Discovery 결과를 확인합니다.</p></div><Link className="button secondary" href="/feature-discovery">새 테스트 진행</Link></div>
      <p className="results-note">VLM 후보와 Human Review는 별도 기록입니다. Risk Level: {RISK_DEFINITION}. 원본·분석본은 비공개 로컬 폴더에 보관합니다. JSON Export에는 이미지를 포함하지 않습니다.</p>
      <div className="results-toolbar"><label>진행 상태 <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체 · {records.length}개</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="record-actions"><button type="button" className="button secondary small" disabled={loading || !!deletingId} onClick={refresh}>새로고침</button><button type="button" className="button secondary small" disabled={loading || !!deletingId || !records.length} onClick={async () => { try { download(await readRecords()); } catch { setError("Export할 기록을 읽지 못했습니다."); } }}>전체 JSON Export</button></div></div>
      <LegacyRecords onMigrated={refresh} />
      <div aria-live="polite">{loading && <p className="message loading">결과를 불러오고 있습니다…</p>}{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success">{notice}</p>}</div>
      {!loading && !error && !records.length && <div className="empty-state"><h2>저장된 결과가 없습니다.</h2><p>Feature Discovery에서 테스트하면 결과가 자동 저장되어 이 페이지에서 확인할 수 있습니다.</p></div>}
      {!loading && records.length > 0 && !filtered.length && <p className="caption">이 상태의 결과가 없습니다.</p>}
      <div className="results-list">{filtered.map((record) => {
        const reviewed = record.reviewedCount;
        const detail = details[record.recordId]?.record;
        return <details className="result-record" key={record.recordId} onToggle={async (event) => {
          if (!event.currentTarget.open) return;
          if (details[record.recordId]?.record.updatedAt === record.updatedAt) return;
          try { const loaded = await readRecord(record.recordId); setDetails((current) => ({ ...current, [record.recordId]: loaded })); setDetailErrors((current) => ({ ...current, [record.recordId]: "" })); }
          catch { setDetailErrors((current) => ({ ...current, [record.recordId]: "상세 내용을 읽지 못했습니다. 카드를 다시 열어 주세요." })); }
        }}>
          <summary>
            <div className="result-card-image">
              {record.hasThumbnail ? (
                // Local, compressed preview only.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/discovery-images/${record.recordId}?kind=thumbnail`} alt={`이미지 ${record.image.imageId.slice(0, 8)} 미리보기`} loading="lazy" />
              ) : <span>미리보기 없음</span>}
            </div>
            <div className="result-card-summary">
              <strong>이미지 {record.image.imageId.slice(0, 8)}</strong>
              <span className="result-date">{new Date(record.updatedAt).toLocaleString("ko-KR")}</span>
              <p><span className={`status-badge status-${state(record)}`}>{statusLabels[state(record)]}</span></p><p>Feature {record.featureCount}개 · 검토 {reviewed}/{record.featureCount}</p>
              <p className="result-card-types">{record.featureTypes.join(" · ") || "작성된 Feature 없음"}</p>
              {record.model && <p className="result-card-model">{record.model}</p>}
              <span className="result-card-toggle"><span className="when-closed">상세 보기</span><span className="when-open">상세 닫기</span></span>
            </div>
          </summary>
          <div className="result-body">
            <p className="caption">카드는 작은 미리보기입니다. 검토 페이지에서 원본과 AI 입력 이미지를 확인할 수 있습니다.</p>{record.job.error && <p className="message error">{record.job.error}</p>}
            <div className="record-actions">
              {record.hasAnalysis && <Link className="button primary small" href={`/review/${record.recordId}`}>{record.reviewStatus === "completed" ? "검토 확인·수정" : record.reviewStatus === "in_progress" ? "검토 계속" : "사람 검토 시작"}</Link>}
              {!record.hasAnalysis && record.job.status === "failed" && record.job.hasOriginal && <button className="button secondary small" onClick={() => retry(record.recordId)}>분석 재시도</button>}
              {record.job.hasOriginal && <a className="button secondary small" href={`/api/discovery-images/${record.recordId}`} target="_blank" rel="noopener noreferrer">원본 보기</a>}
              <button type="button" className="button secondary small" disabled={!detail || loading || !!deletingId} onClick={() => detail && download([detail])}>이 기록 JSON Export</button><button type="button" className="button secondary small danger" disabled={loading || !!deletingId || record.job.status === "analyzing"} onClick={() => remove(record)} aria-label={`이미지 ${record.image.imageId.slice(0, 8)} 결과 삭제`}>{deletingId === record.recordId ? "삭제 중…" : "결과 삭제"}</button></div>
            {detailErrors[record.recordId] && <p role="alert">{detailErrors[record.recordId]}</p>}
            {!detail && !detailErrors[record.recordId] && <p>상세 내용을 불러오고 있습니다…</p>}
            {detail && <>
            <dl className="result-meta"><div><dt>실험 ID</dt><dd>{record.recordId}</dd></div><div><dt>이미지</dt><dd>{record.image.width} × {record.image.height} · {record.image.mimeType}</dd></div><div><dt>생성 / 저장</dt><dd>{new Date(record.createdAt).toLocaleString("ko-KR")} / {new Date(record.updatedAt).toLocaleString("ko-KR")}</dd></div>
              {detail.analysis && <><div><dt>모델</dt><dd>{detail.analysis.responseModel} (요청: {detail.analysis.requestedModel})</dd></div><div><dt>분석 / 프롬프트</dt><dd>{new Date(detail.analysis.analyzedAt).toLocaleString("ko-KR")} · {detail.analysis.promptVersion}</dd></div><div><dt>토큰 사용량</dt><dd>{detail.analysis.usage ? `입력 ${detail.analysis.usage.inputTokens} / 출력 ${detail.analysis.usage.outputTokens}` : "기록 없음"}</dd></div></>}
            </dl>
            {detail.analysis && detail.analysis.modelOutput.candidates.length === 0 && <p className="caption">모델 후보가 0개입니다. 위험이 없다는 뜻은 아닙니다.</p>}
            {detail.analysis && detail.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>VLM 관찰 한계</summary><ul>{detail.analysis.modelOutput.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
            {detail.humanReviews.map((review, index) => {
              const candidate = review.modelCandidateIndex === null ? undefined : detail.analysis?.modelOutput.candidates[review.modelCandidateIndex];
              return <section className="result-cue" key={review.cueId}><h2>Feature {index + 1} · {candidate ? "모델 후보" : "사람이 직접 추가"}</h2><div className="result-comparison">
                <div><h3>VLM 원본</h3>{candidate ? <><p><strong>분류:</strong> {candidate.featureType}</p><p><strong>관찰:</strong> {candidate.observedCue}</p><p><strong>영역:</strong> {candidate.regionDescription || "설명 없음"}</p><p><strong>modelRisk:</strong> {candidate.modelRisk}</p><p><strong>모델 이유:</strong> {candidate.modelReason}</p></> : <p>사람이 추가한 항목으로 모델 판단이 없습니다.</p>}</div>
                <div><h3>Human Review</h3><p><strong>분류:</strong> {review.featureType || "미작성"}</p><p><strong>관찰:</strong> {review.observedCue || "미작성"}</p><p><strong>영역:</strong> {review.regionDescription || "미작성"}</p><p><strong>적절성:</strong> {appropriateness[review.appropriateness]}</p><p><strong>humanRisk:</strong> {review.humanRisk ?? "미검토"}</p><p><strong>사람 이유:</strong> {review.humanReason || "미작성"}</p></div>
              </div></section>;
            })}
            <section className="result-notes"><h2>실험 메모</h2><p>{detail.notes || "작성된 메모가 없습니다."}</p></section>
            {detail.analysis && <details className="result-raw"><summary>모델 원본 JSON 보기</summary><pre>{detail.analysis.rawOutputText}</pre></details>}</>}

          </div>
        </details>;
      })}</div>
    </>
  );
}
