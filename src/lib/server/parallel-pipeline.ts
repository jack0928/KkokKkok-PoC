import "server-only";
import { applyAnalysis, discoveryRecordSchema, type DiscoveryRecord } from "../discovery";
import { PIPELINE_LABELS } from "../pipeline";
import { GROUNDING_PROMPT } from "../grounding";
import { runOcr } from "./ocr";
import { runGrounding } from "./grounding";
import { analyzeImage } from "./analyze";
import { analyzeRecordFusion } from "./fusion";
import { analyzeRecordObjectFusion } from "./object-fusion";
import { storedImage } from "./jobs";
import { withDatabase, transaction, findRecord } from "./records";
type Stage=keyof typeof PIPELINE_LABELS;
function update(id:string,fn:(r:DiscoveryRecord)=>DiscoveryRecord){return withDatabase(db=>transaction(db,()=>{
  const r=findRecord(db,id);if(!r)throw new Error("Missing pipeline record");
  const next=discoveryRecordSchema.parse({...fn(r),updatedAt:new Date(Math.max(Date.now(),Date.parse(r.updatedAt)+1)).toISOString()});
  db.prepare("UPDATE discovery_records SET record_json=?,updated_at=? WHERE record_id=?").run(JSON.stringify(next),next.updatedAt,id);return next;
}));}
function read(id:string){return withDatabase(db=>findRecord(db,id)!);}
const fields={gpt:"analysis",ocr:"ocr",grounding:"grounding",fusion:"fusion",objects:"objectFusion"} as const;
function status(id:string,key:Stage,state:"running"|"completed"|"failed"|"skipped",error:string|null=null){return update(id,r=>({...r,pipeline:{...r.pipeline!,[key]:{status:state,error}}}));}
export function recoverParallelJobs(){
  const ids=withDatabase(db=>db.prepare("SELECT record_id FROM discovery_records WHERE job_status='analyzing'").all().map(x=>String(x.record_id)));
  for(const id of ids){if(!read(id).pipeline)continue;update(id,r=>{
    const p={...r.pipeline!};for(const key of Object.keys(PIPELINE_LABELS) as Stage[])p[key]={status:r[fields[key]]?"completed":"failed",error:r[fields[key]]?null:"작업 중단 · 완료 결과는 보존됨. 직접 재시도해 주세요."};
    const next={...r,pipeline:p};for(const key of ["fusionAttempt","objectFusionAttempt","groundingAttempt"] as const){const a=next[key];if(a?.status==="running")next[key]={...a,status:"failed",finishedAt:new Date().toISOString(),error:"작업 프로세스 중단"};}return next;
  });}
}
export async function runParallelPipeline(id:string){
  async function stage(key:Stage,run:()=>Promise<void>){
    if(read(id)[fields[key]]){status(id,key,"completed");return true;}
    status(id,key,"running");
    try{await run();status(id,key,"completed");return true;}
    catch{status(id,key,"failed",`${PIPELINE_LABELS[key]} 실패 · 완료된 다른 결과는 보존했습니다. 직접 재시도해 주세요.`);return false;}
  }
  try{
    const bytes=storedImage(id,"analysis");if(!bytes)throw new Error("Missing analysis image");
    const initial=read(id);
    const gpt=stage("gpt",async()=>{const result=await analyzeImage({image:initial.image,dataUrl:`data:image/jpeg;base64,${bytes.toString("base64")}`});update(id,r=>r.analysis?r:applyAnalysis(r,result));});
    const ocr=stage("ocr",async()=>{const result=await runOcr(bytes);update(id,r=>({...r,ocr:result,ocrReviews:result.lines.map(line=>({lineId:line.id,candidateIndex:null,status:"unreviewed" as const}))}));});
    const grounding=stage("grounding",async()=>{const options=initial.pipeline?.groundingOptions;const result=await runGrounding(bytes,options?.prompt??GROUNDING_PROMPT,options?.boxThreshold??0.3,options?.textThreshold??0.25);update(id,r=>({...r,grounding:result}));});
    const fusion=Promise.all([gpt,ocr]).then(async ok=>{if(!ok.every(Boolean)){status(id,"fusion","skipped","GPT 개별 분석과 OCR 추출이 필요합니다.");return;}await stage("fusion",async()=>{const r=read(id);await analyzeRecordFusion(id,r.updatedAt);});});
    const objects=Promise.all([gpt,grounding]).then(async ok=>{if(!ok.every(Boolean)){status(id,"objects","skipped","GPT 개별 분석과 객체 탐지가 필요합니다.");return;}await stage("objects",async()=>{const r=read(id);await analyzeRecordObjectFusion(id,r.updatedAt);});});
    await Promise.allSettled([gpt,ocr,grounding,fusion,objects]);
    const r=read(id),failed=(Object.keys(PIPELINE_LABELS) as Stage[]).some(k=>r.pipeline![k].status!=="completed");
    withDatabase(db=>db.prepare("UPDATE discovery_records SET job_status=?,job_error=? WHERE record_id=?").run(failed?"failed":"completed",failed?"일부 단계 실패 · 재시도하면 미완료 단계만 실행합니다.":null,id));
  }catch{
    for(const key of Object.keys(PIPELINE_LABELS) as Stage[]){const r=read(id);if(["pending","running"].includes(r.pipeline![key].status))status(id,key,"failed","작업 중단 · 직접 재시도해 주세요.");}
    withDatabase(db=>db.prepare("UPDATE discovery_records SET job_status='failed',job_error=? WHERE record_id=?").run("분석 실행에 실패했습니다. 완료 결과는 보존했습니다.",id));
  }
}
