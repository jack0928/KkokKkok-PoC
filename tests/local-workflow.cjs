/* eslint-disable @typescript-eslint/no-require-imports -- Test the same local worker module loader. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
require("../scripts/register-server.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kkokkkok-workflow-"));
process.env.SQLITE_PATH = path.join(root, "test.sqlite");
process.env.IMAGE_STORAGE_PATH = path.join(root, "images");
const discovery = require("../src/lib/discovery.ts");
let calls = 0;
let fail = true;
const analyzerPath = require.resolve("../src/lib/server/analyze.ts");
require.cache[analyzerPath] = { exports: { analyzeImage: async (prepared) => {
  calls++;
  if (fail) { fail = false; throw new Error("mock failure"); }
  const output = { candidates: [{featureType:"text",observedCue:"모의 단서",regionDescription:"왼쪽 위",modelRisk:"medium",modelReason:"모의 모델 이유"}], limitations:[] };
  return discovery.analysisSchema.parse({requestedModel:"mock",responseModel:"mock",responseId:"mock",analyzedAt:new Date().toISOString(),promptVersion:discovery.PROMPT_VERSION,analysisSha256:prepared.image.analysisSha256,usage:{inputTokens:1,outputTokens:1},modelOutput:output,rawOutputText:JSON.stringify(output)});
} } };
const jobs = require("../src/lib/server/jobs.ts");
const records = require("../src/lib/server/records.ts");
const route = require("../src/app/api/analysis-jobs/route.ts");
const images = require("../src/app/api/discovery-images/[id]/route.ts");

async function run() {
  const bytes = await sharp({create:{width:900,height:700,channels:3,background:"#cccccc"}}).jpeg().withExif({ IFD0: { Copyright: "synthetic" } }).toBuffer();
  // Selecting an image has no API side effect. Explicit requests create queue records.
  const request = new Request("http://localhost:3000/api/analysis-jobs", {method:"POST",headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","x-analysis-consent":"true"},body:bytes});
  const accepted = await route.POST(request);
  assert.equal(accepted.status,202);
  const first = (await accepted.json()).record;
  const second = await jobs.enqueueImage(bytes);
  const requestId = crypto.randomUUID();
  const once = await jobs.enqueueImage(bytes, requestId);
  const repeated = await jobs.enqueueImage(bytes, requestId);
  assert.equal(once.recordId, repeated.recordId);
  assert.equal(records.listRecords().filter(item=>item.recordId===requestId).length,1);
  records.removeRecord(requestId,once.updatedAt);
  const concurrentId = crypto.randomUUID();
  const concurrent = await Promise.all([jobs.enqueueImage(bytes, concurrentId), jobs.enqueueImage(bytes, concurrentId)]);
  assert.equal(concurrent[0].recordId,concurrent[1].recordId);
  assert.deepEqual(jobs.storedImage(concurrentId,"original"),bytes);
  records.removeRecord(concurrentId,concurrent[0].updatedAt);
  assert.deepEqual(jobs.storedImage(first.recordId,"original"), bytes);
  assert(!(await sharp(jobs.storedImage(first.recordId,"analysis")).metadata()).exif);
  assert.equal(records.listResults().jobs[first.recordId].status,"queued");
  assert.throws(() => records.persistRecord(first, first.updatedAt), records.RecordConflict);
  assert(await jobs.processNextJob()); // failure
  assert(await jobs.processNextJob()); // later image still succeeds
  assert.equal(calls,2);
  assert.equal(await jobs.processNextJob(),false); // no implicit retry
  let results = records.listResults();
  const failed = results.records.find(item => results.jobs[item.recordId].status==="failed");
  const complete = results.records.find(item => item.analysis);
  assert(failed && complete);
  assert.equal(complete.humanReviews[0].humanRisk,null);
  jobs.retryJob(failed.recordId);
  await jobs.processNextJob();
  assert.equal(records.listResults().jobs[failed.recordId].status,"completed");
  results = records.listResults();
  const current = results.records.find(item=>item.recordId===complete.recordId);
  assert.equal(discovery.reviewStatus(current),"unreviewed");
  assert.equal(discovery.reviewStatus({...current,humanReviews:current.humanReviews.map(item=>({...item,featureType:"수정한 분류"}))}),"in_progress");
  const reviewing = {...current,humanReviews:current.humanReviews.map(item=>({...item,appropriateness:"uncertain",humanReason:"판단 근거가 부족함"}))};
  assert.equal(discovery.reviewStatus(reviewing),"in_progress");
  const blank = {...discovery.newHumanCue(),appropriateness:"appropriate",humanRisk:"high",humanReason:"합성 이유"};
  assert(!discovery.discoveryRecordSchema.safeParse({...current,humanReviews:[...reviewing.humanReviews,blank],reviewCompletedAt:new Date().toISOString()}).success);
  assert(discovery.isReviewWritten({...reviewing.humanReviews[0],appropriateness:"inappropriate",humanRisk:null}));
  assert(!discovery.isReviewWritten({...reviewing.humanReviews[0],appropriateness:"appropriate",humanRisk:null}));
  const final = records.persistRecord({...reviewing,reviewCompletedAt:new Date().toISOString()},current.updatedAt).find(item=>item.recordId===current.recordId);
  assert.equal(discovery.reviewStatus(final),"completed");
  assert.equal(final.humanReviews[0].humanRisk,null);
  assert.throws(()=>records.persistRecord({...final,analysis:{...final.analysis,rawOutputText:"changed"}},final.updatedAt),records.RecordConflict);
  assert.throws(()=>records.persistRecord(final,current.updatedAt),records.RecordConflict);
  const original = await images.GET(new Request("http://localhost:3000", {headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000"}}), {params:Promise.resolve({id:complete.recordId})});
  assert.equal(original.status,200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  const denied = await route.POST(new Request("http://localhost:3000/api/analysis-jobs",{method:"POST",headers:{host:"127.0.0.1:3000",origin:"https://example.com"},body:bytes}));
  assert.equal(denied.status,403);
  const withoutConsent = await route.POST(new Request("http://localhost:3000/api/analysis-jobs",{method:"POST",headers:{host:"localhost:3000"},body:bytes}));
  assert.equal(withoutConsent.status,400);
  const interrupted = await jobs.enqueueImage(bytes);
  records.withDatabase(db=>db.prepare("UPDATE discovery_records SET job_status='analyzing' WHERE record_id=?").run(interrupted.recordId));
  jobs.recoverInterruptedJobs();
  assert.equal(records.listResults().jobs[interrupted.recordId].status,"failed");
  assert.equal(await jobs.processNextJob(),false);
  const legacy = discovery.newRecord((await require("../src/lib/server/image.ts").prepareImage(bytes)).image);
  const old = {...legacy}; delete old.reviewCompletedAt;
  const savedLegacy = records.migrateRecords([old]).find(item=>item.recordId===legacy.recordId);
  assert.equal(savedLegacy.reviewCompletedAt,null);
  await jobs.attachOriginal(savedLegacy.recordId,bytes,savedLegacy.updatedAt);
  assert(records.listResults().jobs[savedLegacy.recordId].hasOriginal);
  const summaries = records.listSummaries();
  assert(!JSON.stringify(summaries).includes("rawOutputText"));
  assert(!JSON.stringify(summaries).includes("base64"));
  assert.equal(records.recordDetail(final.recordId).record.recordId,final.recordId);
  const originalPath=path.join(root,"images",final.recordId+".original");
  const analysisPath=path.join(root,"images",final.recordId+".jpeg");
  const normalRename=fs.renameSync;
  fs.renameSync=(source,target)=>{ if(source===analysisPath) throw new Error("synthetic rename failure"); return normalRename(source,target); };
  try { assert.throws(()=>records.removeRecord(final.recordId,final.updatedAt)); } finally { fs.renameSync=normalRename; }
  assert.deepEqual(fs.readFileSync(originalPath),bytes);
  assert(fs.existsSync(analysisPath));
  assert(records.recordDetail(final.recordId));
  // Simulate a crash before the DB commit: staged files must be restored on access.
  fs.renameSync(originalPath,originalPath+".pending-delete");
  assert(records.recordDetail(final.recordId));
  assert.deepEqual(fs.readFileSync(originalPath),bytes);
  records.removeRecord(final.recordId,final.updatedAt);
  assert.equal(jobs.storedImage(final.recordId,"original"),null);
  assert(!fs.existsSync(path.join(root,"images",final.recordId+".original")));
  assert(!fs.existsSync(path.join(root,"images",final.recordId+".jpeg")));
  assert(!JSON.stringify(records.listResults().records).includes(root));
  assert(first && second);
  const {ReviewSaveQueue}=require("../src/lib/review-save-queue.ts");
  const pending=[];
  const queue=new ReviewSaveQueue(current,(snapshot,version)=>new Promise(resolve=>pending.push({snapshot,version,resolve})),()=>{});
  queue.update({...current,notes:"first edit"});
  const firstSave=queue.save(); await Promise.resolve();
  queue.update({...queue.current,notes:"second edit during save"});
  pending[0].resolve({...pending[0].snapshot,updatedAt:new Date(Date.parse(current.updatedAt)+1).toISOString()});
  assert(await firstSave); assert.equal(queue.current.notes,"second edit during save"); assert(queue.dirty);
  const secondSave=queue.save(); await Promise.resolve();
  assert.equal(pending[1].version,new Date(Date.parse(current.updatedAt)+1).toISOString());
  pending[1].resolve({...pending[1].snapshot,updatedAt:new Date(Date.parse(current.updatedAt)+2).toISOString()});
  assert(await secondSave); assert(!queue.dirty); assert.equal(queue.current.notes,"second edit during save");
  console.log("PASS: upload consent, private originals, EXIF stripping, sequential queue, partial failure/retry, restart recovery, legacy attach, review status/completion, model immutability, optimistic conflict, local access and file deletion. Mock VLM only.");
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
