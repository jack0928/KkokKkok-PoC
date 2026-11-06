import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DiscoveryRecord, discoveryRecordSchema } from "../discovery";
import { MAX_FUSION_LINES, newFusionReview } from "../fusion";
import type { ObjectFusion } from "../grounding";
import { withDatabase, transaction, findRecord, RecordConflict } from "./records";
import { InputError } from "./image";
import { storedImage } from "./jobs";
import { reviewObjectsWithGpt } from "./object-fusion-analyze";
import { supplementalGrounding } from "./supplemental-grounding";
const STALE_MS=3_360_000;
function write(db: DatabaseSync, record: DiscoveryRecord) {
  const next=discoveryRecordSchema.parse({...record,updatedAt:new Date(Math.max(Date.now(),Date.parse(record.updatedAt)+1)).toISOString()});
  db.prepare("UPDATE discovery_records SET record_json=?, updated_at=? WHERE record_id=?").run(JSON.stringify(next),next.updatedAt,next.recordId);
  return next;
}
export function objectFusionStatus(id: string) {
  return withDatabase(db=>transaction(db,()=>{
    const record=findRecord(db,id);
    if(!record) throw new InputError("기록을 찾을 수 없습니다.",404);
    if(record.objectFusionAttempt?.status==="running" && Date.now()-Date.parse(record.objectFusionAttempt.startedAt)>STALE_MS)
      return write(db,{...record,objectFusionAttempt:{...record.objectFusionAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"GPT 검토가 중단되었거나 응답 시간이 지났습니다. 비용이 발생했을 수 있습니다. 확인 후 직접 재시도해 주세요."}});
    return record;
  }));
}
export async function analyzeRecordObjectFusion(id: string, expectedVersion: string) {
  const snapshot=objectFusionStatus(id);
  if(snapshot.updatedAt!==expectedVersion || snapshot.objectFusion) throw new RecordConflict("기록이 변경되었거나 Fusion 결과가 이미 있습니다. 새로고침해 주세요.");
  if(snapshot.objectFusionAttempt?.status==="running") throw new RecordConflict("이미 GPT 검토 중입니다. 자동으로 다시 호출하지 않습니다.");
  if(!snapshot.analysis || !snapshot.grounding) throw new InputError("기존 분석과 객체 탐지을 먼저 완료해 주세요.",409);
  if(snapshot.grounding.detections.length>MAX_FUSION_LINES) throw new InputError(`한 번의 GPT 검토는 객체 ${MAX_FUSION_LINES}개 이하를 지원합니다. API는 호출하지 않았습니다.`,422);
  if(snapshot.grounding.detections.length && (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim())) throw new InputError("OPENAI_API_KEY와 OPENAI_MODEL 설정을 확인해 주세요.",503);
  const bytes=storedImage(id,"analysis");
  if(!bytes) throw new InputError("저장된 분석본이 필요합니다.",404);
  const requestId=randomUUID();
  let running=withDatabase(db=>transaction(db,()=>{
    const current=findRecord(db,id);
    if(!current || current.updatedAt!==expectedVersion || current.objectFusion || current.objectFusionAttempt?.status==="running") throw new RecordConflict("다른 요청이 먼저 실행됐습니다. 새로고침해 주세요.");
    return write(db,{...current,reviewCompletedAt:null,objectFusionAttempt:{requestId,status:"running",startedAt:new Date().toISOString(),finishedAt:null,error:null}});
  }));
  try {
    const grounding=await supplementalGrounding(running,bytes);
    running=withDatabase(db=>transaction(db,()=>{const current=findRecord(db,id);if(!current||current.objectFusionAttempt?.requestId!==requestId||current.objectFusionAttempt.status!=="running")throw new RecordConflict("실행 상태 변경");return write(db,{...current,grounding});}));
    if(grounding.detections.length>MAX_FUSION_LINES)throw new InputError("추가 탐지 후 객체 수가 검토 한도를 초과했습니다. 탐지 결과는 보존했습니다.",422);
    const fusion: ObjectFusion = running.grounding!.detections.length ? await reviewObjectsWithGpt(running,bytes) : {
      schemaVersion:1 as const,promptVersion:"object-fusion-v4-single" as const,coordinateSpace:"analysis-normalized" as const,
      analysisSha256:running.image.analysisSha256,requestedModel:process.env.OPENAI_MODEL?.trim() ?? "",responseModel:null,responseId:null,
      analyzedAt:new Date().toISOString(),usage:null,skippedEmptyDetections:true,rawOutputText:"",modelOutput:{groups:[]},cues:[],
    };
    return withDatabase(db=>transaction(db,()=>{
      const current=findRecord(db,id);
      if(!current || current.objectFusion || current.objectFusionAttempt?.requestId!==requestId || current.objectFusionAttempt.status!=="running") throw new RecordConflict("실행 상태가 변경되어 결과를 저장할 수 없습니다.");
      return write(db,{...current,objectFusion:fusion,objectFusionReviews:fusion.cues.filter(c=>c.decision==="useful").map(newFusionReview),reviewCompletedAt:null,
        objectFusionAttempt:{...current.objectFusionAttempt,status:"completed",finishedAt:new Date().toISOString(),error:null}});
    }));
  } catch(error) {
    withDatabase(db=>transaction(db,()=>{
      const current=findRecord(db,id);
      if(current && !current.objectFusion && current.objectFusionAttempt?.requestId===requestId && current.objectFusionAttempt.status==="running")
        write(db,{...current,objectFusionAttempt:{...current.objectFusionAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"GPT 검토 또는 결과 저장에 실패했습니다. 객체 원본과 기존 기록은 보존됐습니다. 비용이 발생했을 수 있으므로 확인 후 직접 재시도해 주세요."}});
    }));
    throw error;
  }
}
