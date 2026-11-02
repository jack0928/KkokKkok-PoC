/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require('../scripts/register-server.cjs');
Module._extensions['.tsx']=(loaded,filename)=>loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {FeatureRegions}=require('../src/components/feature-regions.tsx');
const {FusionCard}=require('../src/components/fusion-review.tsx');
const {newFusionReview}=require('../src/lib/fusion.ts');
const base={recordId:'render-only',image:{width:1000,height:500},ocr:{lines:[{id:'ocr-0',text:'CAFE',score:.9,polygon:[[.1,.1],[.3,.1],[.3,.2],[.1,.2]]}]},ocrReviews:[],fusionReviews:[],objectFusionReviews:[]};
const cue={cueId:'fusion-0',ocrLineIds:['ocr-0'],decision:'useful',category:'sign',interpretation:'CAFE',reason:'test',uncertainty:'',modelRisk:'medium',relatedCandidateIndexes:[0],bbox:[.1,.1,.3,.2]};
const object={...cue,cueId:'object-0',bbox:[.5,.2,.9,.8],detectionIds:['dino-0']};
const record={...base,fusion:{cues:[cue]},objectFusion:{cues:[object]}};
const html=renderToStaticMarkup(React.createElement(FeatureRegions,{record,candidateIndex:0}));
assert.equal((html.match(/<rect /g)||[]).length,2);assert(html.includes('stroke="#d97800"'));assert(html.includes('stroke="#2563eb"'));
assert(html.includes('x="100"'));assert(html.includes('x="500"'));assert(html.includes('GPT 연결 제안'));assert(html.includes('kind=analysis'));
const unmatched=renderToStaticMarkup(React.createElement(FeatureRegions,{record,candidateIndex:1}));assert(!unmatched.includes('<rect '));assert(unmatched.includes('좌표가 아직 없습니다'));
for(const [c,label] of [[cue,'OCR + GPT'],[object,'Grounding DINO + GPT']]){
 const card=renderToStaticMarkup(React.createElement(FusionCard,{record,cue:{...c,ocrLineIds:c.detectionIds?[]:c.ocrLineIds},review:newFusionReview(c),disabled:false,sourceLabel:label,evidence:c.detectionIds?['dino-0']:undefined}));
 assert(card.includes('VLM Feature 후보'));assert(card.includes('<rect '));assert(card.includes('kind=analysis'));assert(card.includes(label));
}
const edited={...record,objectFusionReviews:[{...newFusionReview(object),bbox:[.6,.2,.9,.8]}]};
assert(renderToStaticMarkup(React.createElement(FeatureRegions,{record:edited,candidateIndex:0})).includes('x="600"'));
console.log('PASS candidate component renders: OCR + DINO per-candidate boxes, source labels, human bbox edits and honest unmatched state. Static React render; not browser automation.');
