import { RISK_DEFINITION } from "@/lib/discovery";

export function ReviewGuide() {
  return (
    <section className="panel review-guide" aria-label="적절성과 위험도 판단 기준">
      <h2>검토 기준</h2>
      <h3>1. 적절성 · 후보로 볼 근거가 있나요?</h3>
      <dl>
        <div><dt>적절</dt><dd>사진에서 해당 요소의 존재를 확인할 수 있고, 위치 단서 후보로 볼 근거가 있음</dd></div>
        <div><dt>부적절</dt><dd>사진에 없는 요소를 모델이 제안했거나, 위치 단서 후보로 볼 근거가 없음</dd></div>
        <div><dt>판단 보류</dt><dd>요소의 존재나 후보로서의 의미를 판단할 근거가 부족함</dd></div>
      </dl>
      <h3>2. 위험도 · 이번 사진에서 얼마나 유용한가요?</h3>
      <p>{RISK_DEFINITION}</p>
      <dl>
        <div><dt>low</dt><dd>흔한 요소이거나 식별 정보가 부족해 위치를 좁히는 데 제한적</dd></div>
        <div><dt>medium</dt><dd>구분 가능한 특징이 있어 다른 단서·외부 자료와 조합하면 위치를 좁히는 데 유용</dd></div>
        <div><dt>high</dt><dd>읽을 수 있는 고유 이름·표식 또는 매우 독특한 특징이 있어 특정 장소 식별에 매우 유용</dd></div>
      </dl>
      <p className="caption">선명도나 탐지 confidence 자체를 평가하지 않습니다. 실제로 읽거나 구분할 수 있는 정보의 위치 식별 유용성을 판단하세요. 애매하면 위험도는 미검토로 두고 이유에 남길 수 있습니다.</p>
      <div className="review-example"><strong>예: 희미한 간판</strong><p>간판은 보이지만 글자를 읽을 수 없다면 ‘적절 + low’가 가능합니다. 다만 간판 모양이나 배치만으로도 다른 자료와 대조할 수 있다면 medium 이상일 수 있습니다. 간판 자체가 있는지도 불확실하면 ‘판단 보류’로 기록하세요.</p></div>
    </section>
  );
}
