/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
require('../scripts/register-server.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kkok-inspections-'));
process.env.SQLITE_PATH=path.join(temp,'test.sqlite');process.env.IMAGE_STORAGE_PATH=path.join(temp,'images');
process.env.NODE_ANALYSIS_API_KEY='test-only-key';process.env.INSPECTION_PUBLIC_BASE_URL='http://127.0.0.1:3000';
const discovery=require('../src/lib/discovery.ts');
require.cache[require.resolve('../src/lib/server/analyze.ts')]={exports:{analyzeImage:async({image})=>({requestedModel:'mock',responseModel:'mock',responseId:'mock',analyzedAt:new Date().toISOString(),promptVersion:discovery.PROMPT_VERSION,analysisSha256:image.analysisSha256,usage:null,modelOutput:{candidates:[{featureType:'building',observedCue:'synthetic building',regionDescription:'left',modelRisk:'low',modelReason:'mock candidate'}],limitations:[]},rawOutputText:'mock'})}};
require.cache[require.resolve('../src/lib/server/ocr.ts')]={exports:{runOcr:async()=>({engine:'PaddleOCR',version:'mock',coordinateSpace:'analysis-normalized',lines:[]})}};
require.cache[require.resolve('../src/lib/server/grounding.ts')]={exports:{runGrounding:async(bytes,prompt)=>({engine:'Grounding DINO',schemaVersion:1,model:'mock',revision:'mock',transformersVersion:'mock',device:'cpu',prompt,boxThreshold:.3,textThreshold:.25,coordinateSpace:'analysis-normalized',analysisSha256:crypto.createHash('sha256').update(bytes).digest('hex'),analyzedAt:new Date().toISOString(),elapsedMs:0,detections:[]})}};
require.cache[require.resolve('openai')]={exports:class{constructor(){throw Error('Paid call forbidden');}}};
const post=require('../src/app/api/inspections/route.ts').POST;
const get=require('../src/app/api/inspections/[id]/route.ts').GET;
const image=require('../src/app/api/inspections/[id]/image/route.ts').GET;
const jobs=require('../src/lib/server/jobs.ts'),records=require('../src/lib/server/records.ts');
const context=id=>({params:Promise.resolve({id})});
function request(photo,key,address='synthetic address',history='true') {
 const body=new FormData();body.set('photo',new Blob([photo],{type:'image/jpeg'}),'photo.jpg');body.set('address',address);body.set('compareHistory',history);
 return new Request('http://node.internal/api/inspections',{method:'POST',headers:{'X-Analysis-Api-Key':'test-only-key','Idempotency-Key':key},body});
}
(async()=>{try {
 const photo=await sharp({create:{width:64,height:48,channels:3,background:'white'}}).jpeg().toBuffer();
 assert.equal((await post(new Request('http://node.internal/api/inspections',{method:'POST'}))).status,401);
 const key=crypto.randomUUID();
 const responses=await Promise.all([post(request(photo,key)),post(request(photo,key))]);
 assert(responses.every(r=>r.status===202));const a=await responses[0].json(),b=await responses[1].json();
 assert.equal(a.inspectionId,b.inspectionId);assert.equal(a.status,'queued');assert.equal(a.riskSummary.score,null);assert.equal(a.repeatedExposure.status,'unavailable');
 assert.equal(records.listRecords().length,1);assert.equal((await post(request(photo,key,'changed'))).status,409);
 assert.equal((await post(request(photo,crypto.randomUUID(),'address','yes'))).status,400);
 const headers={'X-Analysis-Api-Key':'test-only-key'};
 assert.equal((await get(new Request('http://node.internal',{headers}),context(crypto.randomUUID()))).status,404);
 const signed=await image(new Request(a.image.url),context(a.inspectionId));assert.equal(signed.status,200);
 const modified=new URL(a.image.url);modified.searchParams.set('expires','1000000000');assert.equal((await image(new Request(modified),context(a.inspectionId))).status,401);
 assert.equal((await image(new Request(a.image.url),context(crypto.randomUUID()))).status,401);
 await jobs.processNextJob();
 const done=await (await get(new Request('http://node.internal',{headers}),context(a.inspectionId))).json();
 assert.equal(done.status,'completed');assert.equal(done.riskFactors[0].bbox,null);assert.equal(done.riskFactors[0].assessmentSource,'model_candidate');
 assert.equal(done.metadata.gpsStatus,'missing');assert(!JSON.stringify(done).includes('synthetic address'));
 const retry=await (await post(request(photo,key))).json();assert.equal(retry.inspectionId,a.inspectionId);assert.equal(retry.status,'completed');assert.equal(await jobs.processNextJob(),false);
 records.withDatabase(db=>db.prepare("UPDATE discovery_records SET job_status='failed' WHERE record_id=?").run(a.inspectionId));
 const failed=await (await get(new Request('http://node.internal',{headers}),context(a.inspectionId))).json();assert.equal(failed.status,'failed');assert.equal(failed.riskFactors.length,1);
 const {inspectionFactors}=require('../src/lib/inspection-result.ts');
 const factor=inspectionFactors(records.recordDetail(a.inspectionId).record,'found').find(f=>f.type==='gps_metadata');assert.equal(factor.bbox,null);
 delete process.env.NODE_ANALYSIS_API_KEY;assert.equal((await get(new Request('http://node.internal',{headers}),context(a.inspectionId))).status,503);
 console.log('PASS inspection multipart, server authentication, concurrent idempotency, conflicts, signed analysis image, mocked pipeline, polling, partial failure, GPS bbox=null. No paid APIs.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
