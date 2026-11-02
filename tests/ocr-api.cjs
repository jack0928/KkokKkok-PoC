/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {EventEmitter}=require("node:events");
const {PassThrough}=require("node:stream");
const childProcess=require("node:child_process");
let mode="success", onStart=()=>{}, calls=0;
childProcess.spawn=()=>{
 calls++;
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 child.stdin.on("finish",()=>setImmediate(()=>{
  onStart();
  if(mode==="success") child.stdout.emit("data",Buffer.from(JSON.stringify({engine:"PaddleOCR",version:"mock",coordinateSpace:"analysis-normalized",lines:[]})));
  if(mode==="invalid") child.stdout.emit("data",Buffer.from("not json"));
  child.emit("close",mode==="failure"?1:0);
 }));
 return child;
};
require("../scripts/register-server.cjs");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"kkok-ocr-api-"));
process.env.SQLITE_PATH=path.join(root,"test.sqlite");process.env.IMAGE_STORAGE_PATH=path.join(root,"images");
const jobs=require("../src/lib/server/jobs.ts");
const records=require("../src/lib/server/records.ts");
const d=require("../src/lib/discovery.ts");
const ocr=require("../src/lib/server/ocr.ts");
const route=require("../src/app/api/discovery-ocr/[id]/route.ts");
async function create(){
 const bytes=await require("sharp")({create:{width:100,height:100,channels:3,background:"white"}}).jpeg().toBuffer();
 let r=await jobs.enqueueImage(bytes);
 r=d.applyAnalysis(r,{requestedModel:"mock",responseModel:"mock",responseId:"mock",analyzedAt:new Date().toISOString(),promptVersion:d.PROMPT_VERSION,analysisSha256:r.image.analysisSha256,usage:null,modelOutput:{candidates:[],limitations:[]},rawOutputText:"mock"});
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET record_json=?,job_status='completed' WHERE record_id=?").run(JSON.stringify(r),r.recordId));
 return r;
}
async function run(){
 let r=await create();
 const request=(origin="http://127.0.0.1:3000")=>new Request("http://127.0.0.1:3000/api/discovery-ocr/"+r.recordId,{method:"POST",headers:{host:"127.0.0.1:3000",origin,"x-record-version":r.updatedAt}});
 assert.equal((await route.POST(request("https://evil.example"),{params:Promise.resolve({id:r.recordId})})).status,403);
 assert.equal(calls,0);
 mode="failure";
 assert.equal((await route.POST(request(),{params:Promise.resolve({id:r.recordId})})).status,500);
 assert.deepEqual(records.recordDetail(r.recordId).record,r);
 mode="invalid";await assert.rejects(()=>ocr.analyzeRecordOcr(r.recordId,r.updatedAt));
 mode="success";
 const first=ocr.analyzeRecordOcr(r.recordId,r.updatedAt);
 await assert.rejects(()=>ocr.analyzeRecordOcr(r.recordId,r.updatedAt));
 const next=await first;assert.equal(next.ocr.lines.length,0);assert.deepEqual(next.analysis,r.analysis);
 await assert.rejects(()=>ocr.analyzeRecordOcr(r.recordId,next.updatedAt));
 r=await create();onStart=()=>records.persistRecord({...r,notes:"concurrent edit"},r.updatedAt);
 await assert.rejects(()=>ocr.analyzeRecordOcr(r.recordId,r.updatedAt),records.RecordConflict);
 assert.equal(records.recordDetail(r.recordId).record.ocr,undefined);
 assert.equal(records.recordDetail(r.recordId).record.notes,"concurrent edit");
 fs.rmSync(root,{recursive:true,force:true});
 console.log("OCR API: failure/invalid output preserve records; empty success, busy lock, stale result rejection, no overwrite, local access passed (mock subprocess).");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
