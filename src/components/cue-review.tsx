"use client";

import { FEATURE_SUGGESTIONS, HumanReview, ModelCandidate } from "@/lib/discovery";
import { useState, useEffect, useRef } from "react";
import { APPROPRIATENESS_LABELS, REASON_OPTIONS } from "@/lib/review-reasons";

type Props = { review: HumanReview; candidate?: ModelCandidate; number: number; disabled: boolean;
  onChange: (patch: Partial<HumanReview>) => void; onRemove: () => void };

export function CueReview({ review, candidate, number, disabled, onChange, onRemove }: Props) {
  const id = review.cueId;
  const [editingObservation, setEditingObservation] = useState(review.source === "human" && (!review.featureType.trim() || !review.observedCue.trim()));
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [directInput, setDirectInput] = useState(false);
  const reasonOptions = REASON_OPTIONS[review.appropriateness];
  const selectedReason = reasonOptions.find((option) => option.reason === review.humanReason);

  useEffect(() => { if (directInput) reasonInput.current?.focus(); }, [directInput]);

  return (
    <article className="cue-card" id={`cue-${id}`}>
      <div className="cue-heading"><span className="cue-number">{String(number).padStart(2, "0")}</span><strong>{candidate ? "VLM Feature 후보" : "사람이 추가한 Feature"}</strong><span className={`pill ${candidate ? "" : "green"}`}>{candidate ? "MODEL" : "HUMAN"}</span>{!candidate && <button className="button ghost small" disabled={disabled} onClick={onRemove} type="button" aria-label={`Feature ${number} 삭제`}>삭제</button>}</div>
      {candidate && <details className="model-evidence model-disclosure"><summary>VLM 원본·위험도·이유 보기 <span className="subtle">사람 판단 후 비교</span></summary><div className="model-evidence-top"><span className="eyebrow">VLM 원본 · 보존됨</span><span className={`risk-badge ${candidate.modelRisk}`}>modelRisk: {candidate.modelRisk}</span></div><strong>{candidate.featureType}</strong><p>{candidate.observedCue}</p><p className="caption">영역: {candidate.regionDescription || "설명 없음"}</p><p className="model-reason">{candidate.modelReason}</p></details>}

      <fieldset className="review-fields" disabled={disabled}>
        <legend>Human Review</legend>
        <div className="field-grid">
          <div className="full observation-summary">
            <div className="panel-heading"><strong>검토할 요소</strong><button type="button" className="button secondary small" disabled={disabled} aria-expanded={editingObservation} aria-controls={`${id}-observation-editor`} onClick={() => setEditingObservation((value) => !value)}>{editingObservation ? "입력 접기" : "내용 수정"}</button></div>
            {!editingObservation && <><p><strong>분류:</strong> {review.featureType || "미작성"}</p><p className="observed-description">{review.observedCue || "관찰 내용 미작성"}</p><p className="subtle">영역: {review.regionDescription || "미작성"}</p></>}
            {editingObservation && <div className="field-grid" id={`${id}-observation-editor`}>
          <label htmlFor={`${id}-type`}>Feature type<input id={`${id}-type`} list="feature-types" maxLength={120} placeholder="분류 선택 또는 직접 입력" value={review.featureType} onChange={(e) => onChange({ featureType: e.target.value })} /></label>
          <label htmlFor={`${id}-region`}>이미지 내 영역<input id={`${id}-region`} maxLength={500} placeholder="예: 오른쪽 위 간판" value={review.regionDescription} onChange={(e) => onChange({ regionDescription: e.target.value })} /></label>
          <label className="full" htmlFor={`${id}-cue`}>Observed cue<textarea id={`${id}-cue`} maxLength={2000} placeholder="실제로 보이는 단서를 기술해 주세요" value={review.observedCue} onChange={(e) => onChange({ observedCue: e.target.value })} rows={2} /></label>
            </div>}
            {candidate && <p className="subtle">모델의 관찰 내용을 기본으로 입력했습니다. 사진과 다르거나 분류를 바꾸려면 수정하세요.</p>}
          </div>
          <label htmlFor={`${id}-appropriate`}>위치 단서 후보로 볼 근거가 있나요?<select id={`${id}-appropriate`} aria-describedby={`${id}-appropriate-help`} value={review.appropriateness} onChange={(e) => { setDirectInput(false); onChange({ appropriateness: e.target.value as HumanReview["appropriateness"], reasonNeedsConfirmation: !!review.humanReason.trim() }); }}><option value="unreviewed">미검토</option><option value="appropriate">적절 · 후보로 볼 근거 있음</option><option value="inappropriate">부적절 · 후보로 볼 근거 없음</option><option value="uncertain">판단 보류 · 근거가 불확실함</option></select><span id={`${id}-appropriate-help`} className="subtle">후보로서의 적절성을 판단합니다. 희미한 간판도 후보일 수 있으며, 읽기 어려운 정도는 위험도와 이유에 반영하세요.</span></label>
          <label htmlFor={`${id}-risk`}>Human risk level · {review.appropriateness === "appropriate" ? "필수" : "선택 사항"}<select id={`${id}-risk`} aria-describedby={`${id}-risk-help`} value={review.humanRisk ?? ""} onChange={(e) => onChange({ humanRisk: (e.target.value || null) as HumanReview["humanRisk"] })}><option value="">{review.appropriateness === "appropriate" || review.appropriateness === "unreviewed" ? "미검토 · 선택해 주세요" : "평가하지 않음 · 선택 사항"}</option><option value="low">low · 위치를 좁히는 데 제한적</option><option value="medium">medium · 다른 정보와 조합하면 유용</option><option value="high">high · 구체적인 위치 식별에 매우 유용</option></select><span id={`${id}-risk-help`} className="subtle">실제로 확인 가능한 정보의 유용성을 판단합니다. 적절한 후보도 low일 수 있습니다. 부적절·판단 보류는 위험도를 미검토로 두어도 됩니다.</span></label>
          <div className="full reason-options">
            <p id={`${id}-reason-choices`}>{review.appropriateness === "unreviewed" ? "사람의 판단 이유" : `${APPROPRIATENESS_LABELS[review.appropriateness]} 판단의 이유`} · 선택해서 입력</p>
            {review.reasonNeedsConfirmation && <div className="reason-confirmation"><p>적절성이 바뀌었습니다. 기존 이유가 이번 판단에도 맞는지 확인하거나 다른 이유를 선택해 주세요.</p><button type="button" className="button secondary small" onClick={() => onChange({ reasonNeedsConfirmation: false })}>기존 이유 확인 · 유지</button></div>}
            {review.appropriateness === "unreviewed" && <p className="subtle">위에서 적절성을 선택하면 해당 판단에 맞는 이유가 표시됩니다. 직접 입력도 가능합니다.</p>}
            <div className="reason-buttons" role="group" aria-labelledby={`${id}-reason-choices`}>
              {reasonOptions.map((option) => <button key={option.label} type="button" className="button secondary small" aria-pressed={!directInput && selectedReason?.reason === option.reason} onClick={() => { setDirectInput(false); onChange({ humanReason: option.reason, reasonNeedsConfirmation: false }); }}>{option.label}</button>)}
              <button type="button" className="button secondary small" aria-pressed={directInput || (!selectedReason && !!review.humanReason)} onClick={() => setDirectInput(true)}>직접 입력</button>
            </div>
            <p className="subtle">선택하면 아래 문장이 입력됩니다. 적절성을 바꿔도 기존 이유는 유지되므로 내용을 확인해 주세요. 위험도는 별도로 판단합니다.</p>
          </div>
          {directInput || (!selectedReason && !!review.humanReason) ? <label className="full" htmlFor={`${id}-reason`}>사람의 판단 이유 · 직접 입력/수정<textarea ref={reasonInput} id={`${id}-reason`} maxLength={3000} rows={2} placeholder="이번 사진에서 위치 식별에 얼마나 유용한지 적어 주세요" value={review.humanReason} onChange={(event) => onChange({ humanReason: event.target.value, reasonNeedsConfirmation: false })} /></label>
            : review.humanReason && <div className="full chosen-reason"><p>{review.humanReason}</p><button type="button" className="button secondary small" onClick={() => setDirectInput(true)}>문장 수정</button></div>}

        </div>
      </fieldset>
    </article>
  );
}

export function FeatureTypeSuggestions() {
  return <datalist id="feature-types">{FEATURE_SUGGESTIONS.map((type) => <option key={type} value={type} />)}</datalist>;
}
