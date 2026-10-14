import Link from "next/link";

export default function Home() {
  return (
    <section className="test-home">
      <h1>Location Cue Detection 테스트</h1>
      <p className="hero-description">진행할 테스트를 선택하세요. 테스트는 각각의 페이지에서 진행합니다.</p>
      <div className="test-options">
        <article className="test-option">
          <h2>1. Feature Discovery</h2>
          <p>이미지에서 위치 단서가 될 수 있는 Feature 후보를 탐색합니다. VLM의 제안을 사람이 검토하고, 놓친 단서를 직접 추가합니다.</p>
          <p className="caption">여러 이미지 분석 → 별도 사람 검토 → 완료·결과 조회</p>
          <Link className="button primary" href="/feature-discovery">이미지 분석 시작</Link>
        </article>
        <article className="test-option">
          <h2>2. Detection Evaluation · 추후 구현 예정</h2>
          <p>확정한 분류 기준과 별도의 이미지로 VLM 탐지 결과를 평가합니다. 사람의 Annotation을 먼저 확정하고, 모델 결과와 사람이 직접 비교합니다.</p>
          <p className="caption">Human Annotation → 확정 → VLM 탐지 → 수동 비교</p>
          <Link className="button secondary" href="/detection-evaluation">추후 구현 예정 · 테스트 안내</Link>
        </article>
      </div>
      <p className="hero-note">VLM 결과는 Feature 후보입니다. 실제 촬영 위치를 추론하지 않습니다.</p>
    </section>
  );
}
