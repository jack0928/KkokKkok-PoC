/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const sharp=require("sharp");
let calls=0, mode="success", onCall=()=>{}, captured=null;
const output={groups:[
 {ocrLineIds:["ocr-0","ocr-1"],decision:"useful",category:"상호·지점명",interpretation:"카페 봄날 흑석점",reason:"상호와 지점명이 함께 보여 장소를 구별할 단서 후보",uncertainty:"실제 촬영 장소는 확인하지 않음",modelRisk:"high",relatedCandidateIndexes:[]},
 {ocrLineIds:["ocr-2"],decision:"not_useful",category:"홍보 문구",interpretation:"오늘 20% 할인",reason:"일반적인 할인 문구",uncertainty:"",modelRisk:null,relatedCandidateIndexes:[]},
 {ocrLineIds:["ocr-3"],decision:"uncertain",category:"가려진 문자",interpretation:"판독이 불확실한 문자",reason:"가림으로 판독 불가",uncertainty:"원문 확인 필요",modelRisk:null,relatedCandidateIndexes:[]},
]};
class FakeOpenAI {
 constructor(options) {
  assert.equal(options.maxRetries,0); assert.equal(options.timeout,120000);
  this.responses={parse:async request=>{
   calls++;captured=request;await onCall();
   if(mode==="failure")throw new Error("mock API failure");
   const parsed={groups:output.groups.map((g,i)=>({...Object.fromEntries(Object.entries(g).filter(([key])=>key!=="modelRisk")),assessment:{ruleId:["branch_identifier","irrelevant","partial_identifier"][i],certainty:i===2?"partial":"clear",evidence:g.interpretation,limitation:"실제 장소 미검증"}}))};
   if(mode==="missing")parsed.groups.pop();
   return {status:mode==="incomplete"?"incomplete":"completed",output_parsed:parsed,model:"mock-gpt",id:"response-mock",usage:{input_tokens:10,output_tokens:20},output_text:JSON.stringify(parsed)};
  }};
 }
}
require.cache[require.resolve("openai")]={exports:FakeOpenAI};
require("../scripts/register-server.cjs");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"kkok-fusion-"));
process.env.SQLITE_PATH=path.join(root,"test.sqlite");process.env.IMAGE_STORAGE_PATH=path.join(root,"images");
process.env.OPENAI_API_KEY="mock-only";process.env.OPENAI_MODEL="mock-gpt";
const jobs=require("../src/lib/server/jobs.ts");
const records=require("../src/lib/server/records.ts");
const d=require("../src/lib/discovery.ts");
const f=require("../src/lib/fusion.ts");
const service=require("../src/lib/server/fusion.ts");
const route=require("../src/app/api/discovery-fusion/[id]/route.ts");
const ocr={engine:"PaddleOCR",version:"mock",coordinateSpace:"analysis-normalized",lines:[
 {id:"ocr-0",text:"카페 봄날",score:.9,polygon:[[.1,.1],[.3,.1],[.3,.2],[.1,.2]]},
 {id:"ocr-1",text:"흑석점",score:.8,polygon:[[.3,.1],[.5,.1],[.5,.2],[.3,.2]]},
 {id:"ocr-2",text:"오늘 20% 할인",score:.9,polygon:[[.1,.5],[.4,.5],[.4,.6],[.1,.6]]},
 {id:"ocr-3",text:"가림",score:.3,polygon:[[.6,.5],[.9,.5],[.9,.6],[.6,.6]]},
]};
async function create(lines=ocr.lines){
 const bytes=await sharp({create:{width:800,height:400,channels:3,background:"white"}}).jpeg().toBuffer();
 let r=await jobs.enqueueImage(bytes);
 r=d.applyAnalysis(r,{requestedModel:"legacy-mock",responseModel:"legacy-mock",responseId:"legacy",analyzedAt:new Date().toISOString(),promptVersion:d.PROMPT_VERSION,analysisSha256:r.image.analysisSha256,usage:null,modelOutput:{candidates:[],limitations:[]},rawOutputText:"legacy mock"});
 r={...r,ocr:{...ocr,lines},ocrReviews:[],notes:"HUMAN_NOTE_MUST_NOT_BE_SENT"};
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET record_json=?,job_status='completed' WHERE record_id=?").run(JSON.stringify(r),r.recordId));
 return r;
}
const read=r=>records.recordDetail(r.recordId).record;
async function run(){
 assert.deepEqual(f.boundsForLines(ocr,["ocr-0","ocr-1"]),[.1,.1,.5,.2]);
 assert.throws(()=>f.makeFusionCues({...output,groups:[...output.groups,output.groups[0]]},ocr,0));
 assert.throws(()=>f.makeFusionCues({groups:output.groups.slice(0,2)},ocr,0));
 assert.throws(()=>f.makeFusionCues({groups:[{...output.groups[0],ocrLineIds:["unknown"]}]},ocr,0));
 assert.throws(()=>f.makeFusionCues({groups:output.groups.map((g,i)=>i?g:{...g,relatedCandidateIndexes:[0]})},ocr,0));
 const original=await create();
 const request=(consent,origin="http://127.0.0.1:3000")=>new Request("http://127.0.0.1:3000/api/discovery-fusion/"+original.recordId,{method:"POST",headers:{host:"127.0.0.1:3000",origin,"x-fusion-consent":consent,"x-record-version":original.updatedAt}});
 const context={params:Promise.resolve({id:original.recordId})};
 assert.equal((await route.POST(request("false"),context)).status,400);
 assert.equal((await route.POST(request("true","https://evil.example"),context)).status,403);assert.equal(calls,0);
 onCall=()=>{
  const running=read(original);assert.equal(running.fusionAttempt.status,"running");
  assert.throws(()=>records.removeRecord(running.recordId,running.updatedAt),records.RecordConflict);
  records.persistRecord({...running,notes:"concurrent human edit"},running.updatedAt);
 };
 let result=await service.analyzeRecordFusion(original.recordId,original.updatedAt);
 assert.equal(calls,1);assert.equal(result.notes,"concurrent human edit");
 assert.equal(result.fusionAttempt.status,"completed");assert.deepEqual(result.analysis,original.analysis);assert.deepEqual(result.ocr,original.ocr);
 assert.equal(result.fusion.cues.length,3);assert.equal(result.fusionReviews.length,1);assert.equal(result.fusionReviews[0].humanRisk,null);
 assert.deepEqual(result.fusion.cues[0].bbox,[.1,.1,.5,.2]);
 assert.equal(captured.store,false);assert(!JSON.stringify(captured).includes("HUMAN_NOTE_MUST_NOT_BE_SENT"));
 assert(JSON.stringify(captured).includes("ocr-0"));assert.equal(captured.input[1].content[1].type,"input_image");
 assert.equal(captured.tools,undefined);
 await assert.rejects(()=>service.analyzeRecordFusion(result.recordId,result.updatedAt),records.RecordConflict);assert.equal(calls,1);
 assert.throws(()=>records.persistRecord({...result,fusion:{...result.fusion,responseModel:"tamper"}},result.updatedAt),records.RecordConflict);
 assert.throws(()=>records.persistRecord({...result,fusionAttempt:undefined},result.updatedAt),records.RecordConflict);
 assert(!d.discoveryRecordSchema.safeParse({...result,fusion:{...result.fusion,cues:result.fusion.cues.map((c,i)=>i?c:{...c,bbox:[0,0,1,1]})}}).success);
 assert(!d.discoveryRecordSchema.safeParse({...result,reviewCompletedAt:new Date().toISOString()}).success);
 const review={...result.fusionReviews[0],status:"accepted",humanRisk:"medium",humanReason:"사람이 확인",bbox:[.11,.11,.49,.21]};
 records.persistRecord({...result,fusionReviews:[review],reviewCompletedAt:new Date().toISOString()},result.updatedAt);
 result=read(result);assert.deepEqual(result.fusion.cues[0].bbox,[.1,.1,.5,.2]);assert.deepEqual(result.fusionReviews[0].bbox,review.bbox);
 assert(d.storedRecordsSchema.safeParse(JSON.parse(JSON.stringify([result]))).success);
 assert(!d.discoveryRecordSchema.safeParse({...result,fusionReviews:[review,{...review,cueId:"unknown"}]}).success);
 // Failed or partial output must not become a useful/empty result or trigger a retry.
 onCall=()=>{};
 for(const failure of ["failure","missing","incomplete"]){
  mode=failure;const r=await create();const before=calls;
  await assert.rejects(()=>service.analyzeRecordFusion(r.recordId,r.updatedAt));
  const failed=read(r);assert.equal(calls,before+1);assert.equal(failed.fusionAttempt.status,"failed");assert.equal(failed.fusion,undefined);assert.deepEqual(failed.ocr,r.ocr);
 }
 mode="success";
 const r=await create();let release;onCall=()=>new Promise(resolve=>{release=resolve;});
 const running=service.analyzeRecordFusion(r.recordId,r.updatedAt);
 await assert.rejects(()=>service.analyzeRecordFusion(r.recordId,r.updatedAt),records.RecordConflict);
 release();await running;
 const stale=await create();stale.fusionAttempt={requestId:crypto.randomUUID(),status:"running",startedAt:new Date(Date.now()-200000).toISOString(),finishedAt:null,error:null};
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET record_json=? WHERE record_id=?").run(JSON.stringify(stale),stale.recordId));
 const before=calls;assert.equal(service.fusionStatus(stale.recordId).fusionAttempt.status,"failed");assert.equal(calls,before);
 onCall=()=>{};
 const empty=await create([]);delete process.env.OPENAI_API_KEY;
 const emptyResult=await service.analyzeRecordFusion(empty.recordId,empty.updatedAt);assert(emptyResult.fusion.skippedEmptyOcr);assert.equal(calls,before);
 fs.rmSync(root,{recursive:true,force:true});
 console.log("PASS Fusion: grouped OCR bbox lineage, coverage/ID validation, consent, immutable originals, concurrent edits, human bbox corrections, export, failure/retry guards, stale recovery and empty OCR. GPT API mocked; no paid calls.");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
