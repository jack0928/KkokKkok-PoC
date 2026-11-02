import "server-only";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { groundingSchema, type Grounding } from "../grounding";
import { discoveryRecordSchema, type DiscoveryRecord } from "../discovery";
import { storedImage } from "./jobs";
import { findRecord, withDatabase, transaction, RecordConflict } from "./records";
import { InputError } from "./image";

export function runGrounding(bytes:Buffer,prompt:string,boxThreshold=0.3,textThreshold=0.25):Promise<Grounding> {
  const cache=resolve(process.env.GROUNDING_CACHE_PATH||"private-data/grounding-models");mkdirSync(cache,{recursive:true});
  const python=process.env.GROUNDING_PYTHON||resolve("private-data/grounding-venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
  return new Promise((accept,reject)=>{
    const child=spawn(python,["-X","utf8",resolve("scripts/grounding/detect.py"),prompt,String(boxThreshold),String(textThreshold)],{windowsHide:true,
      env:{...process.env,HF_HOME:cache,HF_HUB_DISABLE_TELEMETRY:"1",HF_HUB_DISABLE_SYMLINKS_WARNING:"1"},stdio:["pipe","pipe","pipe"]});
    let output=Buffer.alloc(0),settled=false;
    const fail=()=>{if(!settled){settled=true;clearTimeout(timer);child.kill();reject(new Error("Grounding inference failed"));}};
    const timer=setTimeout(fail,600_000);
    child.on("error",fail);child.stdin.on("error",fail);
    child.stdout.on("data",(part:Buffer)=>{output=Buffer.concat([output,part]);if(output.length>2_000_000)fail();});
    child.stderr.on("data",()=>{/* Model/input text must not be logged. */});
    child.on("close",code=>{
      if(settled)return;
      if(code!==0){fail();return;}
      try{const result=groundingSchema.parse(JSON.parse(output.toString("utf8")));settled=true;clearTimeout(timer);accept(result);}catch{fail();}
    });
    child.stdin.end(bytes);
  });
}
function write(db:import("node:sqlite").DatabaseSync,record:DiscoveryRecord) {
  const next=discoveryRecordSchema.parse({...record,updatedAt:new Date(Math.max(Date.now(),Date.parse(record.updatedAt)+1)).toISOString()});
  db.prepare("UPDATE discovery_records SET record_json=?,updated_at=? WHERE record_id=?").run(JSON.stringify(next),next.updatedAt,next.recordId);
  return next;
}
export function groundingStatus(id:string) {
  return withDatabase(db=>transaction(db,()=>{
    const r=findRecord(db,id);if(!r)throw new InputError("기록이 없습니다.",404);
    if(r.groundingAttempt?.status==="running" && Date.now()-Date.parse(r.groundingAttempt.startedAt)>660_000)
      return write(db,{...r,groundingAttempt:{...r.groundingAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"객체 탐지가 중단되었습니다. 다시 실행해 주세요."}});
    return r;
  }));
}
export async function analyzeRecordGrounding(id:string,version:string,prompt:string,boxThreshold=0.3,textThreshold=0.25) {
  const initial=groundingStatus(id);
  if(initial?.pipeline&&Object.values(initial.pipeline).some(s=>typeof s==="object"&&"status" in s&&s.status==="running"))throw new RecordConflict("자동 분석이 진행 중입니다.");
  if(initial.updatedAt!==version||initial.grounding||initial.groundingAttempt?.status==="running")throw new RecordConflict("기록이 변경되었거나 객체 탐지가 이미 실행됐습니다.");
  if(!initial.analysis)throw new InputError("기존 GPT 분석을 먼저 완료해 주세요.",409);
  const bytes=storedImage(id,"analysis");if(!bytes)throw new InputError("분석본 이미지가 없습니다.",404);
  const requestId=randomUUID();
  withDatabase(db=>transaction(db,()=>{
    const r=findRecord(db,id);if(!r||r.updatedAt!==version)throw new RecordConflict("기록이 변경되었습니다.");
    // Serialize local detector jobs across tabs/records, including dev-server reloads.
    const rows=db.prepare("SELECT record_json FROM discovery_records").all();
    if(rows.some(row=>{const attempt=JSON.parse(String(row.record_json)).groundingAttempt;return attempt?.status==="running"&&Date.now()-Date.parse(attempt.startedAt)<660_000;}))
      throw new InputError("다른 객체 탐지가 실행 중입니다. 완료 후 실행해 주세요.",409);
    write(db,{...r,reviewCompletedAt:null,groundingAttempt:{requestId,status:"running",startedAt:new Date().toISOString(),finishedAt:null,error:null}});
  }));
  try {
    const grounding=await runGrounding(bytes,prompt,boxThreshold,textThreshold);
    return withDatabase(db=>transaction(db,()=>{
      const r=findRecord(db,id);if(!r||r.grounding||r.groundingAttempt?.requestId!==requestId||r.groundingAttempt.status!=="running")throw new RecordConflict("실행 상태가 변경되었습니다.");
      return write(db,{...r,grounding,groundingAttempt:{...r.groundingAttempt,status:"completed",finishedAt:new Date().toISOString(),error:null}});
    }));
  } catch(error) {
    withDatabase(db=>transaction(db,()=>{
      const r=findRecord(db,id);if(r?.groundingAttempt?.requestId===requestId&&r.groundingAttempt.status==="running")
        write(db,{...r,groundingAttempt:{...r.groundingAttempt,status:"failed",finishedAt:new Date().toISOString(),error:"객체 탐지에 실패했습니다. Python 환경과 모델 캐시를 확인해 주세요. 기존 기록은 보존했습니다."}});
    }));throw error;
  }
}
