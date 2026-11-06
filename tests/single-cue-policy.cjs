/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require('../scripts/register-server.cjs');
const policy=require('../src/lib/single-cue-policy.ts');
const d=require('../src/lib/discovery.ts'),f=require('../src/lib/fusion.ts'),g=require('../src/lib/grounding.ts');
const input=(ruleId,certainty='clear',decision='useful')=>({decision,assessment:{ruleId,certainty,evidence:'합성 관찰',limitation:'실제 장소·유일성 미검증'}});
const brand=policy.assessCue(input('chain_brand'));
assert.equal(brand.modelRisk,'low');assert.equal(brand.assessment.role,'indirect');assert.equal(brand.assessment.displayMode,'notice');
assert.equal(brand.assessment.estimatedScope,'country_region');
const address=policy.assessCue(input('address_number'));
assert.throws(()=>policy.assessVisualCue(input('address_number')),/OCR/);
assert.equal(address.modelRisk,'high');assert.equal(address.assessment.displayMode,'warning');assert.equal(address.assessment.scopeVerified,false);
for(const cue of [policy.assessCue(input('address_number','partial')),policy.assessCue(input('address_number','clear','uncertain')),policy.assessCue(input('unknown')),policy.assessCue(input('portable_context'))])assert.equal(cue.modelRisk,null);
assert.equal(policy.assessCue(input('distinctive_fixed_structure')).modelRisk,'medium','distinctive is not proven unique');
assert.equal(policy.assessCue(input('irrelevant','clear','not_useful')).assessment.displayMode,'excluded');
assert.throws(()=>policy.assessCue(input('address_number','clear','not_useful')));
assert.throws(()=>policy.assertAssessment({...brand,modelRisk:'high'}));
assert.throws(()=>policy.assertAssessment({...brand,assessment:{...brand.assessment,role:'direct'}}));
const rawGroup={ocrLineIds:['ocr-0'],category:'브랜드',interpretation:'브랜드만 보임',reason:'간접 단서 보존',uncertainty:'',relatedCandidateIndexes:[],...input('chain_brand')};
assert(!f.singleFusionOutputSchema.safeParse({groups:[{...rawGroup,modelRisk:'high'}]}).success,'GPT must not assign risk');
const ocr={lines:[{id:'ocr-0',text:'BRAND',score:.9,polygon:[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]}]};
const cue=f.makeFusionCues({groups:[policy.assessCue(rawGroup)]},ocr,0)[0];
assert.deepEqual(cue.bbox,[.1,.1,.2,.2]);
const legacy={...rawGroup,modelRisk:'medium'};delete legacy.assessment;
assert.equal(f.makeFusionCues({groups:[legacy]},ocr,0)[0].assessment,undefined);
assert(f.isFusionReviewWritten({...f.newFusionReview(cue),status:'accepted',humanReason:'간접 단서 보존, 평가 보류',riskNotAssessed:true}));
const format=require('openai/helpers/zod').zodTextFormat;
for(const schema of [d.singleModelOutputSchema,f.singleFusionOutputSchema,g.singleObjectOutputSchema])assert(format(schema,'single_cue').schema);
// Render actual cards without a browser; indirect observations must remain visible.
Module._extensions['.tsx']=(loaded,filename)=>loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {CueAssessment}=require('../src/components/cue-assessment.tsx');
const html=renderToStaticMarkup(React.createElement(CueAssessment,{assessment:brand.assessment,risk:brand.modelRisk}));
assert(html.includes('간접 단서'));assert(html.includes('data-display-mode="notice"'));assert(!html.includes('data-display-mode="warning"'));
const {FusionReview}=require('../src/components/fusion-review.tsx');
const record={recordId:'synthetic',image:{width:100,height:100},ocr,fusion:{cues:[cue]},fusionReviews:[]};
const card=renderToStaticMarkup(React.createElement(FusionReview,{record}));
assert(card.includes('data-display-mode="notice"'));assert(card.includes('<rect '));
const {inspectionFactors}=require('../src/lib/inspection-result.ts');
const factors=inspectionFactors({...record,humanReviews:[]},'none');
assert.equal(factors[0].assessment.displayMode,'notice');
// Existing saved records still parse without migration or regrading (print counts only).
let count=0;
for(const file of ['private-data/grounding-pilot-20261028/latest-record.json','private-data/grounding-pilot-20261028/crop-comparison-record.json']) {
  if(fs.existsSync(file)){d.discoveryRecordSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));count++;}
}
console.log(`PASS deterministic grading, null/unknown, indirect display, OCR bbox, legacy validation (${count} saved samples), structured schemas, API metadata. No paid calls.`);
