/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
let captured,invalid=false;
const candidate={featureType:'고정 배경',observedCue:'창문 배열',regionDescription:'왼쪽',modelReason:'반복 비교용 관찰',decision:'useful',assessment:{ruleId:'standard_fixed_structure',certainty:'clear',evidence:'창문 배열이 보임',limitation:'장소 유일성 미검증'}};
require.cache[require.resolve('openai')]={exports:class{constructor(){this.responses={parse:async request=>{
  captured=request;
  const output={candidates:[invalid?{...candidate,assessment:{...candidate.assessment,ruleId:'invented_rule'}}:candidate],limitations:[]};
  return {status:'completed',output_parsed:output,output_text:JSON.stringify(output),model:'mock',id:'mock',usage:{input_tokens:1,output_tokens:1}};
}};}}};
require('../scripts/register-server.cjs');
const {analyzeImage}=require('../src/lib/server/analyze.ts');
const d=require('../src/lib/discovery.ts');
(async()=>{
 process.env.OPENAI_API_KEY='mock';process.env.OPENAI_MODEL='mock';
 const image={analysisSha256:'a'.repeat(64)};
 const analysis=await analyzeImage({image,dataUrl:'data:image/jpeg;base64,mock'});
 assert.equal(analysis.promptVersion,d.PROMPT_VERSION);
 assert.equal(analysis.modelOutput.candidates[0].modelRisk,'low');
 assert.equal(analysis.modelOutput.candidates[0].assessment.displayMode,'notice');
 assert(!('modelRisk' in JSON.parse(analysis.rawOutputText).candidates[0]),'raw model output preserved before grading');
 assert(!/[가-힣]/.test(captured.input[0].content),'developer prompt is English');
 assert(!/[가-힣]/.test(captured.input[1].content[0].text),'user instruction is English');
 assert(captured.input[0].content.includes('combination rules are OUT OF SCOPE'));
 assert(!d.analysisSchema.safeParse({...analysis,modelOutput:{...analysis.modelOutput,candidates:[{...analysis.modelOutput.candidates[0],modelRisk:'high'}]}}).success);
 invalid=true;await assert.rejects(()=>analyzeImage({image,dataUrl:'data:image/jpeg;base64,mock'}));
 console.log('PASS initial GPT mocked transport, English instructions, rule-derived grade, immutable raw output and invalid response rejection. No paid calls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
