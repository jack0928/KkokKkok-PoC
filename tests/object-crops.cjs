/* eslint-disable @typescript-eslint/no-require-imports */
const root=require('node:path').resolve(__dirname,'..');
const path=require('node:path'),assert=require('node:assert/strict');
const sharp=require(path.join(root,'node_modules/sharp'));
let captured,mode='valid';
const group=id=>({detectionIds:[id],decision:'uncertain',category:'object',interpretation:'확인 보류',reason:'불확실',uncertainty:'불확실',assessment:{ruleId:'unknown',certainty:'unverifiable',evidence:'확인 불가',limitation:'식별 범위 미검증'},relatedCandidateIndexes:[]});
require.cache[require.resolve(path.join(root,'node_modules/openai'))]={exports:class{constructor(){this.responses={parse:async req=>{captured=req;const groups=mode==='valid'?[group('dino-0'),group('dino-1')]:[{...group('dino-0'),detectionIds:['dino-0','dino-1']}];return {status:'completed',output_parsed:{groups},output_text:JSON.stringify({groups}),model:'mock',id:'mock',usage:null};}}}}};
require(path.join(root,'scripts/register-server.cjs'));
const {objectCrops}=require(path.join(root,'src/lib/server/object-crops.ts'));
const {reviewObjectsWithGpt}=require(path.join(root,'src/lib/server/object-fusion-analyze.ts'));
const {groundingRequestSchema}=require(path.join(root,'src/lib/grounding.ts'));
(async()=>{
 const red=await sharp({create:{width:50,height:50,channels:3,background:'red'}}).png().toBuffer();
 const bytes=await sharp({create:{width:100,height:50,channels:3,background:'blue'}}).composite([{input:red,left:0,top:0}]).png().toBuffer();
 const record={image:{width:100,height:50,analysisSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')},analysis:{modelOutput:{candidates:[{observedCue:'FORBIDDEN_MENU_TEXT'}]}},ocr:{lines:[{text:'FORBIDDEN_OCR'}]},grounding:{detections:[{id:'dino-0',label:'window',bbox:[.5,0,1,1]},{id:'dino-1',label:'sign',bbox:[0,0,.5,1]}]}};
 const crops=await objectCrops(record,bytes);
 const pixels=await sharp(Buffer.from(crops[0].imageUrl.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
 const offset=((32+25)*pixels.info.width+25)*pixels.info.channels;
 assert(pixels.data[offset+2]>200&&pixels.data[offset]<40,'right bbox must contain blue, not left red');
 await assert.rejects(()=>objectCrops(record,Buffer.from('different image')));
 process.env.OPENAI_API_KEY='mock';process.env.OPENAI_MODEL='mock';
 const result=await reviewObjectsWithGpt(record,bytes);
 assert.equal(result.promptVersion,'object-fusion-v4-single');
 assert.equal(captured.input[1].content.filter(x=>x.type==='input_image').length,2);
 assert(!JSON.stringify(captured).includes('FORBIDDEN_MENU_TEXT'));assert(!JSON.stringify(captured).includes('FORBIDDEN_OCR'));
 mode='merged';await assert.rejects(()=>reviewObjectsWithGpt(record,bytes),/identity contract/);
 assert(!groundingRequestSchema.safeParse({prompt:'window.',boxThreshold:0}).success);
 console.log('PASS crop pixel alignment, image hash guard, per-ID image inputs, exclusion of old text, merged-ID rejection, threshold validation. Mock GPT only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
