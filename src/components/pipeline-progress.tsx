import { PIPELINE_LABELS, type Pipeline } from "@/lib/pipeline";
const labels={pending:"대기",running:"실행 중",completed:"완료",failed:"실패",skipped:"선행 단계 대기"};
export function PipelineProgress({pipeline}:{pipeline?:Pipeline}){if(!pipeline)return null;return <div className="panel" aria-label="분석 단계 진행 상황"><strong>병렬 분석 진행 상황</strong><ul>{(Object.keys(PIPELINE_LABELS) as (keyof typeof PIPELINE_LABELS)[]).map(key=><li key={key}>{PIPELINE_LABELS[key]}: {labels[pipeline[key].status]}{pipeline[key].error&&<span> · {pipeline[key].error}</span>}</li>)}</ul></div>;}
