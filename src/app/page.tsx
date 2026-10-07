import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="home-hero">
        <div className="eyebrow"><span className="status-dot" /> LOCATION PRIVACY RESEARCH</div>
        <h1>사진 속 작은 단서,<br /><span>어디까지 드러낼까요?</span></h1>
        <p className="hero-description">SNS 사진의 위치 노출 단서를 탐색하는 실험 공간입니다.<br />AI가 제안한 후보를 사람이 검토하며, 탐지 기준을 만들어 갑니다.</p>
        <Link className="button primary large" href="/feature-discovery">Feature Discovery 시작하기 <span aria-hidden="true">→</span></Link>
        <p className="hero-note">실제 촬영 위치·주소·지역을 추론하지 않습니다.</p>
        <div className="hero-art" aria-hidden="true"><div className="art-grid" /><div className="cue-frame frame-one"><span>TEXT / SIGN</span></div><div className="cue-frame frame-two"><span>VISUAL CUE</span></div><div className="art-caption">OBSERVE · REVIEW · DISCOVER</div></div>
      </section>

      <section className="experiment-grid" aria-label="실험 안내">
        <article className="experiment-card active"><div className="card-top"><span className="eyebrow">EXPERIMENT 01</span><span className="pill green">지금 시작할 수 있어요</span></div><h2>Feature Discovery</h2><p>어떤 시각적 요소가 위치 노출 단서가 될 수 있을까요? VLM 후보와 사람의 검토를 함께 기록합니다.</p><div className="flow-text">이미지 → AI 후보 → Human Review → JSON</div><Link className="text-link" href="/feature-discovery">탐색 실험 열기 <span aria-hidden="true">↗</span></Link></article>
        <article className="experiment-card muted"><div className="card-top"><span className="eyebrow">EXPERIMENT 02</span><span className="pill">후속 단계</span></div><h2>Detection Evaluation</h2><p>별도로 확정한 기준과 새로운 이미지로 탐지 성능을 평가합니다. 사람의 정답을 먼저 확정하고 결과를 비교합니다.</p><div className="flow-text">Human Annotation → 확정 → AI 탐지 → 수동 비교</div><span className="subtle">Feature Discovery 검증 후 진행 예정</span></article>
      </section>
      <aside className="principle"><span className="principle-icon" aria-hidden="true">✳</span><div><h2>AI의 제안은 출발점입니다.</h2><p>VLM 결과는 Ground Truth가 아닙니다. Feature 후보와 위험도는 사람이 확인하며, 모델의 원래 판단과 사람의 판단을 따로 보존합니다.</p></div></aside>
    </>
  );
}
