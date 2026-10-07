"use client";

import { FEATURE_SUGGESTIONS, HumanReview, ModelCandidate } from "@/lib/discovery";

type Props = { review: HumanReview; candidate?: ModelCandidate; number: number; disabled: boolean;
  onChange: (patch: Partial<HumanReview>) => void; onRemove: () => void };

export function CueReview({ review, candidate, number, disabled, onChange, onRemove }: Props) {
  const id = review.cueId;
  return (
    <article className="cue-card">
      <div className="cue-heading"><span className="cue-number">{String(number).padStart(2, "0")}</span><strong>{candidate ? "VLM Feature 후보" : "사람이 추가한 Feature"}</strong><span className={`pill ${candidate ? "" : "green"}`}>{candidate ? "MODEL" : "HUMAN"}</span>{!candidate && <button className="button ghost small" disabled={disabled} onClick={onRemove} type="button" aria-label={`Feature ${number} 삭제`}>삭제</button>}</div>
      {candidate && <div className="model-evidence"><div className="model-evidence-top"><span className="eyebrow">VLM 원본 · 보존됨</span><span className={`risk-badge ${candidate.modelRisk}`}>modelRisk: {candidate.modelRisk}</span></div><strong>{candidate.featureType}</strong><p>{candidate.observedCue}</p><p className="caption">영역: {candidate.regionDescription || "설명 없음"}</p><p className="model-reason">{candidate.modelReason}</p></div>}
      <fieldset className="review-fields" disabled={disabled}>
        <legend>Human Review</legend>
        <div className="field-grid">
          <label htmlFor={`${id}-type`}>Feature type<input id={`${id}-type`} list="feature-types" maxLength={120} placeholder="분류 선택 또는 직접 입력" value={review.featureType} onChange={(e) => onChange({ featureType: e.target.value })} /></label>
          <label htmlFor={`${id}-region`}>이미지 내 영역<input id={`${id}-region`} maxLength={500} placeholder="예: 오른쪽 위 간판" value={review.regionDescription} onChange={(e) => onChange({ regionDescription: e.target.value })} /></label>
          <label className="full" htmlFor={`${id}-cue`}>Observed cue<textarea id={`${id}-cue`} maxLength={2000} placeholder="실제로 보이는 단서를 기술해 주세요" value={review.observedCue} onChange={(e) => onChange({ observedCue: e.target.value })} rows={2} /></label>
          <label htmlFor={`${id}-appropriate`}>위치 노출 Feature로 적절한가요?<select id={`${id}-appropriate`} value={review.appropriateness} onChange={(e) => onChange({ appropriateness: e.target.value as HumanReview["appropriateness"] })}><option value="unreviewed">미검토</option><option value="appropriate">적절</option><option value="inappropriate">부적절</option><option value="uncertain">판단 보류</option></select></label>
          <label htmlFor={`${id}-risk`}>Human risk level<select id={`${id}-risk`} value={review.humanRisk ?? ""} onChange={(e) => onChange({ humanRisk: (e.target.value || null) as HumanReview["humanRisk"] })}><option value="">미검토 · 선택해 주세요</option><option value="low">low · 위치를 좁히는 데 제한적</option><option value="medium">medium · 다른 정보와 조합하면 유용</option><option value="high">high · 구체적인 위치 식별에 매우 유용</option></select></label>
          <label className="full" htmlFor={`${id}-reason`}>사람의 판단 이유<textarea id={`${id}-reason`} maxLength={3000} rows={2} placeholder="외부 정보와 결합할 때의 유용성을 설명해 주세요" value={review.humanReason} onChange={(e) => onChange({ humanReason: e.target.value })} /></label>
        </div>
      </fieldset>
    </article>
  );
}

export function FeatureTypeSuggestions() {
  return <datalist id="feature-types">{FEATURE_SUGGESTIONS.map((type) => <option key={type} value={type} />)}</datalist>;
}
