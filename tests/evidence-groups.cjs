/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');require('../scripts/register-server.cjs');
const {relatedEvidence}=require('../src/lib/evidence-groups.ts');
const record={objectFusion:{cues:[{cueId:'object-0',decision:'useful',interpretation:'목재 선반',bbox:[.1,.1,.3,.4]},{cueId:'object-1',decision:'useful',interpretation:'내장 선반',bbox:[.11,.1,.31,.4]},{cueId:'object-2',decision:'useful',interpretation:'별도 선반',bbox:[.6,.1,.8,.4]}]},analysis:{modelOutput:{candidates:[{observedCue:'목재 선반',regionDescription:'왼쪽 상단'},{observedCue:'천장 조명',regionDescription:'상단'}]}}};
assert.equal(relatedEvidence(record,'object-1').anchor,'fusion-cue-object-0');
assert.equal(relatedEvidence(record,'object-2'),null,'separate shelves must not be merged');
assert.equal(relatedEvidence(record,'gpt-0').anchor,'fusion-cue-object-0');
assert.equal(relatedEvidence(record,'gpt-1'),null);
const before=JSON.stringify(record);relatedEvidence(record,'gpt-0');assert.equal(JSON.stringify(record),before);
console.log('PASS duplicate overlap versus separate objects, related GPT evidence and immutable sources.');
