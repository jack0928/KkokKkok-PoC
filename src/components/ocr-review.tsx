"use client";
import { CueImage } from "./fusion-review";
import { boundsForLines } from "@/lib/fusion";
import { useState } from "react";
import { DiscoveryRecord } from "@/lib/discovery";
import { suggestCandidates, OcrReview as Review } from "@/lib/ocr";
export function OcrReview({record, disabled, onChange, onRun}: {
  record: DiscoveryRecord; disabled: boolean; onChange: (reviews: Review[]) => void; onRun: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const ocr = record.ocr;
  const candidates = record.analysis?.modelOutput.candidates ?? [];
  function update(lineId: string, value: string) {
    const candidateIndex = value.startsWith("candidate:") ? Number(value.slice(10)) : null;
    const status: Review["status"] = candidateIndex !== null ? "linked" : value as Review["status"];
    const reviews = ocr!.lines.map(line => (record.ocrReviews ?? []).find(r => r.lineId === line.id) ?? {lineId: line.id, candidateIndex: null, status: "unreviewed" as const});
    onChange(reviews.map(review => review.lineId === lineId ? {...review, candidateIndex, status} : review));
  }
  return <section className="panel" aria-label="OCR 문자와 GPT 후보 연결">
    <h2>OCR 문자 · GPT 후보 연결</h2>
    <p className="caption">분석본에서 추출한 문자 영역입니다. 문자열 일치는 연결 제안이며, 같은 간판인지 사람이 확인해야 합니다. 인식 점수는 위험도가 아닙니다.</p>
    {!ocr ? <><p>로컬 PaddleOCR로 문자를 추출합니다. GPT를 다시 호출하지 않습니다. 최초 실행은 공개 모델 다운로드로 시간이 걸릴 수 있습니다.</p><button className="button secondary" disabled={disabled} onClick={onRun}>로컬 OCR 실행</button></> : <>
      {ocr.diagnostics&&<details><summary>OCR 검사 과정 · {ocr.diagnostics.passes.length}회 · 판독 불일치 {ocr.diagnostics.conflicts.length}쌍 · 미판독 영역 {ocr.diagnostics.unreadRegions.length}개</summary><p>입력 {ocr.diagnostics.inputWidth} × {ocr.diagnostics.inputHeight} · 전체/분할 검사 좌표를 같은 분석본 비율로 환산했습니다. 불일치 문자열은 모두 후보로 보존합니다.</p>{ocr.diagnostics.passes.map(p=><p key={p.id}>{p.id}: ({p.x}, {p.y}), {p.width}×{p.height} · 결과 {p.count}개</p>)}<details><summary>검사별 원문·좌표 보기</summary><pre>{JSON.stringify(ocr.diagnostics,null,2)}</pre></details></details>}
      <p>{ocr.engine} {ocr.version} · 문자 {ocr.lines.length}개 · 좌표: 방향 정규화된 AI 입력 이미지</p>
      <svg viewBox={`0 0 ${record.image.width} ${record.image.height}`} role="img" aria-label="OCR 문자 영역 표시" style={{width: "100%", maxHeight: 600, background: "#eee"}}>
        <image href={`/api/discovery-images/${record.recordId}?kind=analysis`} width={record.image.width} height={record.image.height} />
        {ocr.lines.map((line, index) => <g key={line.id}>
          <polygon points={line.polygon.map(([x,y]) => `${x*record.image.width},${y*record.image.height}`).join(" ")} fill={selected === line.id ? "#fbbf2440" : "transparent"} stroke={selected === line.id ? "#ff9900" : "#00d9ff"} strokeWidth={selected === line.id ? 4 : 2} vectorEffect="non-scaling-stroke" />
          <text x={line.polygon[0][0]*record.image.width} y={Math.max(18,line.polygon[0][1]*record.image.height)} fill="#111" stroke="white" strokeWidth={3} paintOrder="stroke" fontSize={Math.max(18,record.image.width/45)}>{index+1}</text>
        </g>)}
      </svg>
      {ocr.lines.length === 0 && <p>인식된 문자가 없습니다. 문자나 위치 단서가 없다는 뜻은 아닙니다.</p>}
      {ocr.lines.map((line, index) => {
        const review = record.ocrReviews?.find(r => r.lineId === line.id);
        const suggestions = suggestCandidates(line.text, candidates);
        return <div key={line.id} style={{borderTop: "1px solid #ddd", padding: "12px 0"}}>
          <button type="button" className="button secondary small" aria-pressed={selected === line.id} onClick={() => setSelected(line.id)}>영역 {index+1} 강조</button>
          <p><strong>{line.text}</strong> · OCR 인식 점수 {line.score.toFixed(3)} · 검사: {line.passId??"기존 전체 검사"} · Fusion: {record.fusion?.cues.filter(c=>c.ocrLineIds.includes(line.id)).map(c=>c.decision).join(", ")||"연결 결과 없음"}</p>
          <CueImage record={record} bbox={boundsForLines(ocr,[line.id])} originalBox={boundsForLines(ocr,[line.id])} editable={false} onChange={()=>{}} label={`OCR 문자 ${index+1} 위치`}/>
          <p className="caption">{suggestions.length ? `문자열 일치 제안: GPT 후보 ${suggestions.map(i => i+1).join(", ")} (미확정)` : "문자열 일치 제안 없음 · 직접 연결하거나 독립 단서로 남길 수 있습니다."}</p>
          <label>사람의 연결 판단 <select disabled={disabled} value={review?.status === "linked" ? `candidate:${review.candidateIndex}` : review?.status ?? "unreviewed"} onChange={e => update(line.id,e.target.value)}>
            <option value="unreviewed">미검토</option><option value="standalone">독립 문자 단서로 보존</option><option value="excluded">위치 단서에서 제외 (원문 보존)</option>
            {candidates.map((candidate,i) => <option key={i} value={`candidate:${i}`}>GPT 후보 {i+1}: {candidate.observedCue.slice(0,100)}</option>)}
          </select></label>
        </div>;
      })}
      <p className="caption">독립 문자 단서의 위험도·이유는 아래 ‘놓친 Feature 직접 추가’로 기록할 수 있습니다. 제외해도 OCR 원문은 삭제되지 않습니다.</p>
    </>}
  </section>;
}
