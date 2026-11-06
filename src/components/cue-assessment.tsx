import type { Assessment } from "@/lib/single-cue-policy";

export function CueAssessment({assessment,risk}:{assessment?:Assessment;risk:string|null}) {
  if (!assessment) return <p className="caption">이전 기준 분석 · 직접/간접 구분 없음 · 기존 위험도: {risk ?? "판단 보류"}</p>;
  const title = {warning:"직접 단서 · 위치 식별 정보 주의",notice:"간접 단서 · 누적 분석용 안내",review:"판단 보류 · 관찰 근거 확인 필요",excluded:"분석 대상 제외 제안"}[assessment.displayMode];
  const role = {direct:"직접",indirect:"간접",unknown:"미정",none:"해당 없음"}[assessment.role];
  const scope = {single_place:"특정 장소 수준",few_places_or_neighborhood:"몇 곳·동네 수준",city_district:"도시·구 수준",country_region:"국가·광역 수준",unknown:"판단 불가"}[assessment.estimatedScope];
  return <div className="panel cue-assessment" data-display-mode={assessment.displayMode}>
    <strong>{title}</strong>
    <p>{assessment.evidence}</p>
    {assessment.displayMode === "notice" && <p>이 단서만으로 구체적인 위치를 확인하지 않았습니다. 관찰 내용을 저장해 이후 누적 분석에서 비교할 수 있습니다.</p>}
    <p className="caption">단서 역할: {role} · 개별 규칙 등급: {risk ?? "평가 보류"} · 식별 범위 추정: {scope}</p>
    <p className="caption">{assessment.limitation} 실제 후보 수·장소 유일성·촬영 위치를 검증한 결과가 아닙니다.</p>
    <details><summary>적용 규칙 보기</summary><p>{assessment.policyVersion} / {assessment.ruleId} · 판독·관찰 상태: {assessment.certainty}</p></details>
  </div>;
}
