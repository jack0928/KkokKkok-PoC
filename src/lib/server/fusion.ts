import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DiscoveryRecord, discoveryRecordSchema } from "../discovery";
import { FUSION_PROMPT_VERSION, MAX_FUSION_LINES, newFusionReview, type Fusion } from "../fusion";
import { withDatabase, transaction, findRecord, RecordConflict } from "./records";
import { InputError } from "./image";
import { storedImage } from "./jobs";
import { reviewOcrWithGpt } from "./fusion-analyze";
const STALE_MS=180_000;
function write(db: DatabaseSync, record: DiscoveryRecord) {
  const next=discoveryRecordSchema.parse({...record,updatedAt:new Date(Math.max(Date.now(),Date.parse(record.updatedAt)+1)).toISOString()});
  db.prepare("UPDATE discovery_records SET record_json=?, updated_at=? WHERE record_id=?").run(JSON.stringify(next),next.updatedAt,next.recordId);
  return next;
}
export function fusionStatus(id: string) {
  return withDatabase(db=>transaction(db,()=>{
    const record=findRecord(db,id);
    if(!record) throw new InputError("기록을 찾을 수 없습니다.",404);
    if(record.fusionAttempt?.status==="running" && Date.now()-Date.parse(record.fusionAttempt.startedAt)>STALE_MS)
      return write(db,{...record,fusionAttempt:{...record.fusionAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"GPT 검토가 중단되었거나 응답 시간이 지났습니다. 비용이 발생했을 수 있습니다. 확인 후 직접 재시도해 주세요."}});
    return record;
  }));
}
export async function analyzeRecordFusion(id: string, expectedVersion: string) {
  const snapshot=fusionStatus(id);
  if(snapshot.updatedAt!==expectedVersion || snapshot.fusion) throw new RecordConflict("기록이 변경되었거나 Fusion 결과가 이미 있습니다. 새로고침해 주세요.");
  if(snapshot.fusionAttempt?.status==="running") throw new RecordConflict("이미 GPT 검토 중입니다. 자동으로 다시 호출하지 않습니다.");
  if(!snapshot.analysis || !snapshot.ocr) throw new InputError("기존 분석과 OCR 추출을 먼저 완료해 주세요.",409);
  if(snapshot.ocr.lines.length>MAX_FUSION_LINES) throw new InputError(`한 번의 GPT 검토는 OCR ${MAX_FUSION_LINES}개 이하를 지원합니다. API는 호출하지 않았습니다.`,422);
  if(snapshot.ocr.lines.length && (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim())) throw new InputError("OPENAI_API_KEY와 OPENAI_MODEL 설정을 확인해 주세요.",503);
  const bytes=storedImage(id,"analysis");
  if(!bytes) throw new InputError("저장된 분석본이 필요합니다.",404);
  const requestId=randomUUID();
  const running=withDatabase(db=>transaction(db,()=>{
    const current=findRecord(db,id);
    if(!current || current.updatedAt!==expectedVersion || current.fusion || current.fusionAttempt?.status==="running") throw new RecordConflict("다른 요청이 먼저 실행됐습니다. 새로고침해 주세요.");
    return write(db,{...current,reviewCompletedAt:null,fusionAttempt:{requestId,status:"running",startedAt:new Date().toISOString(),finishedAt:null,error:null}});
  }));
  try {
    const fusion: Fusion = running.ocr!.lines.length ? await reviewOcrWithGpt(running,bytes) : {
      schemaVersion:1 as const,promptVersion:FUSION_PROMPT_VERSION,coordinateSpace:"analysis-normalized" as const,
      analysisSha256:running.image.analysisSha256,requestedModel:process.env.OPENAI_MODEL?.trim() ?? "",responseModel:null,responseId:null,
      analyzedAt:new Date().toISOString(),usage:null,skippedEmptyOcr:true,rawOutputText:"",modelOutput:{groups:[]},cues:[],
    };
    return withDatabase(db=>transaction(db,()=>{
      const current=findRecord(db,id);
      if(!current || current.fusion || current.fusionAttempt?.requestId!==requestId || current.fusionAttempt.status!=="running") throw new RecordConflict("실행 상태가 변경되어 결과를 저장할 수 없습니다.");
      return write(db,{...current,fusion,fusionReviews:fusion.cues.filter(c=>c.decision==="useful").map(newFusionReview),reviewCompletedAt:null,
        fusionAttempt:{...current.fusionAttempt,status:"completed",finishedAt:new Date().toISOString(),error:null}});
    }));
  } catch(error) {
    withDatabase(db=>transaction(db,()=>{
      const current=findRecord(db,id);
      if(current && !current.fusion && current.fusionAttempt?.requestId===requestId && current.fusionAttempt.status==="running")
        write(db,{...current,fusionAttempt:{...current.fusionAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"GPT 검토 또는 결과 저장에 실패했습니다. OCR과 기존 기록은 보존됐습니다. 비용이 발생했을 수 있으므로 확인 후 직접 재시도해 주세요."}});
    }));
    throw error;
  }
}
