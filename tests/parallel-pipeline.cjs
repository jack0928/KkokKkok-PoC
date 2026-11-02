/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
require('../scripts/register-server.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kkok-parallel-'));
process.env.SQLITE_PATH=path.join(temp,'test.sqlite');process.env.IMAGE_STORAGE_PATH=path.join(temp,'images');
const d=require('../src/lib/discovery.ts');
const calls={gpt:0,ocr:0,grounding:0};const release={};
let gating=true,failOcr=true;
async function gate(key){calls[key]++;if(gating)await new Promise(resolve=>{release[key]=resolve;});}
require.cache[require.resolve('../src/lib/server/analyze.ts')]={exports:{analyzeImage:async({image})=>{await gate('gpt');return {requestedModel:'mock',responseModel:'mock',responseId:'mock',analyzedAt:new Date().toISOString(),promptVersion:d.PROMPT_VERSION,analysisSha256:image.analysisSha256,usage:null,modelOutput:{candidates:[],limitations:[]},rawOutputText:'mock'};}}};
require.cache[require.resolve('../src/lib/server/ocr.ts')]={exports:{runOcr:async()=>{await gate('ocr');if(failOcr)throw Error('mock OCR failure');return {engine:'PaddleOCR',version:'mock',coordinateSpace:'analysis-normalized',lines:[]};}}};
require.cache[require.resolve('../src/lib/server/grounding.ts')]={exports:{runGrounding:async(bytes,prompt)=>{await gate('grounding');return {engine:'Grounding DINO',schemaVersion:1,model:'mock',revision:'mock',transformersVersion:'mock',device:'cpu',prompt,boxThreshold:.3,textThreshold:.25,coordinateSpace:'analysis-normalized',analysisSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),analyzedAt:new Date().toISOString(),elapsedMs:0,detections:[]};}}};
// Any accidental paid call fails this test.
require.cache[require.resolve('openai')]={exports:class{constructor(){throw Error('Unexpected external API');}}};
const jobs=require('../src/lib/server/jobs.ts'),records=require('../src/lib/server/records.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const bytes=await sharp({create:{width:64,height:64,channels:3,background:'white'}}).jpeg().toBuffer();
 const r=await jobs.enqueueImage(bytes,undefined,true),id=r.recordId;
 const running=jobs.processNextJob();
 await tick();assert.deepEqual(calls,{gpt:1,ocr:1,grounding:1},'all three start before any finishes');
 assert.throws(()=>records.persistRecord({...records.recordDetail(id).record,notes:'edit'},records.recordDetail(id).record.updatedAt));
 release.gpt();release.grounding();await tick();await tick();
 let mid=records.recordDetail(id).record;assert(mid.analysis);assert(mid.grounding);assert.equal(mid.pipeline.ocr.status,'running');assert(mid.objectFusion,'independent branch completes before slow OCR');
 release.ocr();await running;
 let detail=records.recordDetail(id);assert.equal(detail.job.status,'failed');assert.equal(detail.record.pipeline.ocr.status,'failed');assert.equal(detail.record.pipeline.fusion.status,'skipped');assert(detail.record.analysis&&detail.record.grounding&&detail.record.objectFusion);
 const original=JSON.stringify(detail.record.analysis);
 jobs.retryJob(id);gating=false;failOcr=false;await jobs.processNextJob();
 detail=records.recordDetail(id);assert.equal(detail.job.status,'completed');assert.deepEqual(calls,{gpt:1,ocr:2,grounding:1},'retry only missing result');assert.equal(JSON.stringify(detail.record.analysis),original);
 assert(detail.record.fusion&&detail.record.ocr);assert(d.discoveryRecordSchema.safeParse(detail.record).success);
 assert.throws(()=>records.persistRecord({...detail.record,pipeline:undefined},detail.record.updatedAt),'pipeline is immutable to browser writes');
 assert.equal(await jobs.processNextJob(),false);
 const interrupted=await jobs.enqueueImage(bytes,undefined,true);
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET job_status='analyzing' WHERE record_id=?").run(interrupted.recordId));
 jobs.recoverInterruptedJobs();const recovered=records.recordDetail(interrupted.recordId);assert.equal(recovered.job.status,'failed');assert.equal(recovered.record.pipeline.ocr.status,'failed');
 console.log('PASS simultaneous launch; independently saved branches; partial failure; dependency gating; retry skips successful work; source immutability; restart recovery. All models mocked.');
 fs.rmSync(temp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
