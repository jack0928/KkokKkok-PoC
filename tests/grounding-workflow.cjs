/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
let calls=0,fail=false,captured;
const groups=[{detectionIds:['dino-0'],decision:'useful',category:'간판',interpretation:'특징적인 간판',reason:'장소를 구별할 시각적 후보',uncertainty:'실제 장소 미확인',modelRisk:'medium',relatedCandidateIndexes:[]}];
require.cache[require.resolve('openai')]={exports:class {constructor(){this.responses={parse:async request=>{calls++;captured=request;if(fail)throw Error('mock');return {status:'completed',output_parsed:{groups},output_text:JSON.stringify({groups}),model:'mock',id:'mock',usage:null};}};}}};
require('../scripts/register-server.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kkok-grounding-'));
process.env.SQLITE_PATH=path.join(root,'test.sqlite');process.env.IMAGE_STORAGE_PATH=path.join(root,'images');process.env.OPENAI_MODEL='mock';process.env.OPENAI_API_KEY='mock';
const d=require('../src/lib/discovery.ts'),g=require('../src/lib/grounding.ts'),f=require('../src/lib/fusion.ts'),records=require('../src/lib/server/records.ts'),jobs=require('../src/lib/server/jobs.ts');
const service=require('../src/lib/server/object-fusion.ts');
async function create(){
 let r=await jobs.enqueueImage(await sharp({create:{width:80,height:40,channels:3,background:'white'}}).jpeg().toBuffer());
 r=d.applyAnalysis(r,{requestedModel:'mock',responseModel:'mock',responseId:'mock',analyzedAt:new Date().toISOString(),promptVersion:d.PROMPT_VERSION,analysisSha256:r.image.analysisSha256,usage:null,rawOutputText:'mock',modelOutput:{candidates:[],limitations:[]}});
 r.grounding={engine:'Grounding DINO',schemaVersion:1,model:'mock-detector',revision:'mock-revision',transformersVersion:'mock',device:'cpu',prompt:'sign.',boxThreshold:.3,textThreshold:.25,coordinateSpace:'analysis-normalized',analysisSha256:r.image.analysisSha256,analyzedAt:new Date().toISOString(),elapsedMs:10,detections:[{id:'dino-0',label:'sign',score:.8,bbox:[.1,.2,.4,.5]}]};
 r.notes='PRIVATE_HUMAN_LABEL';
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET record_json=?,job_status='completed' WHERE record_id=?").run(JSON.stringify(r),r.recordId));return r;
}
(async()=>{
 let r=await create();
 assert.deepEqual(g.makeObjectCues({groups},r.grounding,0)[0].bbox,[.1,.2,.4,.5]);
 assert.throws(()=>g.makeObjectCues({groups:[]},r.grounding,0));
 assert.throws(()=>g.makeObjectCues({groups:[...groups,...groups]},r.grounding,0));
 assert.throws(()=>g.makeObjectCues({groups:[{...groups[0],detectionIds:['missing']}]},r.grounding,0));
 assert(!g.groundingSchema.safeParse({...r.grounding,detections:[...r.grounding.detections,...r.grounding.detections]}).success);
 assert(!d.discoveryRecordSchema.safeParse({...r,grounding:{...r.grounding,analysisSha256:'0'.repeat(64)}}).success);
 assert(!d.discoveryRecordSchema.safeParse({...r,reviewCompletedAt:new Date().toISOString()}).success);
 r=await service.analyzeRecordObjectFusion(r.recordId,r.updatedAt);
 assert.equal(calls,1);assert.equal(r.objectFusionReviews[0].humanRisk,null);assert(!JSON.stringify(captured).includes('PRIVATE_HUMAN_LABEL'));
 assert.equal(captured.store,false);assert.equal(captured.tools,undefined);
 await assert.rejects(()=>service.analyzeRecordObjectFusion(r.recordId,r.updatedAt));assert.equal(calls,1);
 assert.throws(()=>records.persistRecord({...r,grounding:undefined},r.updatedAt));
 assert.throws(()=>records.persistRecord({...r,objectFusion:{...r.objectFusion,responseId:'tamper'}},r.updatedAt),records.RecordConflict);
 const changed={...f.newFusionReview(r.objectFusion.cues[0]),bbox:[.2,.2,.6,.6],status:'accepted',humanRisk:'low',humanReason:'실제 검토'};
 records.persistRecord({...r,objectFusionReviews:[changed],reviewCompletedAt:new Date().toISOString()},r.updatedAt);
 const saved=records.recordDetail(r.recordId).record;assert.deepEqual(saved.grounding.detections[0].bbox,[.1,.2,.4,.5]);assert.deepEqual(saved.objectFusionReviews[0].bbox,changed.bbox);
 assert(d.discoveryRecordSchema.safeParse(JSON.parse(JSON.stringify(saved))).success);
 const failed=await create();fail=true;await assert.rejects(()=>service.analyzeRecordObjectFusion(failed.recordId,failed.updatedAt));
 assert.equal(records.recordDetail(failed.recordId).record.objectFusionAttempt.status,'failed');assert.equal(records.recordDetail(failed.recordId).record.objectFusion,undefined);
 console.log('PASS object Fusion IDs, bbox lineage, immutable originals, separate human boxes, completion/export, private-label isolation, retries and failure preservation (mock GPT).');
 fs.rmSync(root,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
