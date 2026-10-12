import Link from "next/link";

export default function DetectionEvaluationPage() {
  return (
    <section className="test-home">
      <div className="page-heading"><div><h1>Detection Evaluation 테스트</h1><p>Experiment 2 · 확정한 기준으로 VLM의 Feature 탐지 결과를 평가합니다.</p></div></div>
      <p className="message loading">추후 구현 예정입니다. 현재는 테스트 진행 순서만 안내하며, 실제 테스트 기능은 아직 제공하지 않습니다.</p>
      <section className="panel">
        <div className="panel-heading"><h2>테스트 진행 순서</h2></div>
        <ol className="evaluation-flow">
          <li>Feature Discovery 결과를 검토해 분류 기준을 별도로 확정합니다.</li>
          <li>새로운 이미지에 사람이 Annotation을 작성하고 확정합니다.</li>
          <li>사람의 Annotation을 모델에 보내지 않고 VLM 탐지를 실행합니다.</li>
          <li>사람이 결과를 연결하고 Matched / Missed / VLM Only를 비교합니다.</li>
        </ol>
      </section>
      <p className="hero-note">평가 데이터는 Feature Discovery 기록과 별도로 관리합니다.</p>
      <Link className="button secondary" href="/">테스트 선택으로 돌아가기</Link>
    </section>
  );
}
