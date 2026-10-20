/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free CLI contract tests. */
const assert = require("node:assert/strict");
const {validateReviews} = require("./review-diagnostics.cjs");
const samples=[{sampleId:"sample-a"},{sampleId:"sample-b"}];
const item=sampleId=>({sampleId,verdict:"uncertain",reason:"반복 요소",uncertainty:"중심 확인 불가"});
assert.equal(validateReviews({reviews:[item("sample-a"),item("sample-b")]},samples).reviews.length,2);
for(const reviews of [[item("sample-a")],[item("sample-a"),item("sample-a")],[item("sample-a"),item("other")]]) {
  assert.throws(()=>validateReviews({reviews},samples));
}
assert.throws(()=>validateReviews({reviews:[{...item("sample-a"),verdict:"ground-truth"},item("sample-b")]},samples));
console.log("PASS: model-review schema, missing/duplicate/unknown sample rejection; no API calls");
