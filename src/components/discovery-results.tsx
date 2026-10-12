"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DiscoveryRecord, RISK_DEFINITION } from "@/lib/discovery";
import { exportRecords, readResults } from "@/lib/storage";

const appropriateness = { unreviewed: "미검토", appropriate: "적절", inappropriate: "부적절", uncertain: "판단 보류" };

export function DiscoveryResults() {
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readResults().then((data) => { if (!cancelled) { setRecords(data.records); setThumbnails(data.thumbnails); } })
      .catch(() => { if (!cancelled) setError("저장된 결과를 읽지 못했습니다. 로컬 DB 설정을 확인해 주세요."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    setLoading(true); setError(""); setNotice("");
    try { const data = await readResults(); setRecords(data.records); setThumbnails(data.thumbnails); }
    catch { setError("저장된 결과를 읽지 못했습니다. 로컬 DB 설정을 확인해 주세요."); }
    finally { setLoading(false); }
  }

  function download(items: DiscoveryRecord[]) {
    try { exportRecords(items); setNotice("JSON 다운로드를 요청했습니다. 관찰 내용도 민감정보일 수 있으므로 비공개로 공유해 주세요."); }
    catch { setError("JSON Export에 실패했습니다."); }
  }

  return (
    <>
      <div className="page-heading"><div><h1>테스트 결과</h1><p>로컬 DB에 저장한 Feature Discovery 결과를 확인합니다.</p></div><Link className="button secondary" href="/feature-discovery">새 테스트 진행</Link></div>
      <p className="results-note">VLM 후보와 Human Review는 별도 기록입니다. Risk Level: {RISK_DEFINITION}. 최대 480px 미리보기만 저장하며 원본·분석본과 Export JSON에는 이미지가 없습니다.</p>
      <div className="results-toolbar"><span>저장된 실험 {records.length}개</span><div className="record-actions"><button type="button" className="button secondary small" disabled={loading} onClick={refresh}>새로고침</button><button type="button" className="button secondary small" disabled={loading || !records.length} onClick={() => download(records)}>전체 JSON Export</button></div></div>
      <div aria-live="polite">{loading && <p className="message loading">결과를 불러오고 있습니다…</p>}{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success">{notice}</p>}</div>
      {!loading && !error && !records.length && <div className="empty-state"><h2>저장된 결과가 없습니다.</h2><p>Feature Discovery에서 테스트하면 결과가 자동 저장되어 이 페이지에서 확인할 수 있습니다.</p></div>}
      <div className="results-list">{records.map((record) => {
        const reviewed = record.humanReviews.filter((item) => item.appropriateness !== "unreviewed" && item.humanRisk !== null && item.humanReason.trim()).length;
        return <details className="result-record" key={record.recordId}>
          <summary>
            <div className="result-card-image">
              {thumbnails[record.recordId] ? (
                // Local, compressed preview only.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnails[record.recordId]} alt={`이미지 ${record.image.imageId.slice(0, 8)} 미리보기`} loading="lazy" />
              ) : <span>미리보기 없음</span>}
            </div>
            <div className="result-card-summary">
              <strong>이미지 {record.image.imageId.slice(0, 8)}</strong>
              <span className="result-date">{new Date(record.updatedAt).toLocaleString("ko-KR")}</span>
              <p>{record.analysis ? "분석 완료" : "분석 미완료"} · Feature {record.humanReviews.length}개 · 검토 {reviewed}/{record.humanReviews.length}</p>
              <p className="result-card-types">{[...new Set(record.humanReviews.map((item) => item.featureType).filter(Boolean))].slice(0, 4).join(" · ") || "작성된 Feature 없음"}</p>
              {record.analysis && <p className="result-card-model">{record.analysis.responseModel}</p>}
              <span className="result-card-toggle"><span className="when-closed">상세 보기</span><span className="when-open">상세 닫기</span></span>
            </div>
          </summary>
          <div className="result-body">
            <p className="caption">결과 확인용 저화질 미리보기입니다. 세부 단서의 판독에는 원본을 사용하세요.</p>
            <div className="record-actions"><button type="button" className="button secondary small" onClick={() => download([record])}>이 기록 JSON Export</button></div>
            <dl className="result-meta"><div><dt>실험 ID</dt><dd>{record.recordId}</dd></div><div><dt>이미지</dt><dd>{record.image.width} × {record.image.height} · {record.image.mimeType}</dd></div><div><dt>생성 / 저장</dt><dd>{new Date(record.createdAt).toLocaleString("ko-KR")} / {new Date(record.updatedAt).toLocaleString("ko-KR")}</dd></div>
              {record.analysis && <><div><dt>모델</dt><dd>{record.analysis.responseModel} (요청: {record.analysis.requestedModel})</dd></div><div><dt>분석 / 프롬프트</dt><dd>{new Date(record.analysis.analyzedAt).toLocaleString("ko-KR")} · {record.analysis.promptVersion}</dd></div><div><dt>토큰 사용량</dt><dd>{record.analysis.usage ? `입력 ${record.analysis.usage.inputTokens} / 출력 ${record.analysis.usage.outputTokens}` : "기록 없음"}</dd></div></>}
            </dl>
            {record.analysis && record.analysis.modelOutput.candidates.length === 0 && <p className="caption">모델 후보가 0개입니다. 위험이 없다는 뜻은 아닙니다.</p>}
            {record.analysis && record.analysis.modelOutput.limitations.length > 0 && <details className="limitations"><summary>VLM 관찰 한계</summary><ul>{record.analysis.modelOutput.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
            {record.humanReviews.map((review, index) => {
              const candidate = review.modelCandidateIndex === null ? undefined : record.analysis?.modelOutput.candidates[review.modelCandidateIndex];
              return <section className="result-cue" key={review.cueId}><h2>Feature {index + 1} · {candidate ? "모델 후보" : "사람이 직접 추가"}</h2><div className="result-comparison">
                <div><h3>VLM 원본</h3>{candidate ? <><p><strong>분류:</strong> {candidate.featureType}</p><p><strong>관찰:</strong> {candidate.observedCue}</p><p><strong>영역:</strong> {candidate.regionDescription || "설명 없음"}</p><p><strong>modelRisk:</strong> {candidate.modelRisk}</p><p><strong>모델 이유:</strong> {candidate.modelReason}</p></> : <p>사람이 추가한 항목으로 모델 판단이 없습니다.</p>}</div>
                <div><h3>Human Review</h3><p><strong>분류:</strong> {review.featureType || "미작성"}</p><p><strong>관찰:</strong> {review.observedCue || "미작성"}</p><p><strong>영역:</strong> {review.regionDescription || "미작성"}</p><p><strong>적절성:</strong> {appropriateness[review.appropriateness]}</p><p><strong>humanRisk:</strong> {review.humanRisk ?? "미검토"}</p><p><strong>사람 이유:</strong> {review.humanReason || "미작성"}</p></div>
              </div></section>;
            })}
            <section className="result-notes"><h2>실험 메모</h2><p>{record.notes || "작성된 메모가 없습니다."}</p></section>
            {record.analysis && <details className="result-raw"><summary>모델 원본 JSON 보기</summary><pre>{record.analysis.rawOutputText}</pre></details>}
          </div>
        </details>;
      })}</div>
    </>
  );
}
