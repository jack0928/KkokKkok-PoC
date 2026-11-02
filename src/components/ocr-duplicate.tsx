import type { ReactNode } from "react";
import type { DiscoveryRecord } from "@/lib/discovery";
import { relatedEvidence } from "@/lib/evidence-groups";
import { matchingOcrText } from "@/lib/ocr-duplicates";

export function OcrDuplicate({record, observation, children, cueKey}: {record?: DiscoveryRecord; observation: string; children: ReactNode; cueKey?:string}) {
  const matches = record ? matchingOcrText(record, observation) : [];
  const related=record?relatedEvidence(record,cueKey):null;
  if (!matches.length && !related) return <>{children}</>;
  if(!matches.length && related)return <details className="ocr-duplicate panel"><summary>관련 단서 그룹 · 추가 출처 펼치기</summary><p>{related.reason} <a href={`#${related.anchor}`}>대표 객체 단서 보기</a></p><p className="caption">각 모델 원본과 사람 판단은 따로 보존합니다. 필요하면 펼쳐 독립적으로 검토하세요.</p>{children}</details>;
  return <details className="ocr-duplicate panel"><summary>OCR와 같은 문구가 있는 기존 후보 · 접어서 보관</summary>
    <p className="caption">일치 문구: {matches.join(" / ")}. 문자 단서는 OCR에서 검토합니다. 문자열 일치는 동일 객체의 확정이 아닙니다. 원본과 기존 사람 검토는 보존되며, 펼쳐서 확인·수정할 수 있습니다.</p>
    {children}
  </details>;
}
