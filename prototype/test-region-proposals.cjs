/* eslint-disable @typescript-eslint/no-require-imports -- Local CLI contracts; no API calls. */
const assert=require("node:assert/strict");
const {validateProposal,contentFor}=require("./propose-regions.cjs");
const region={visualDescription:"고정 구조",queryRoi:[.1,.1,.5,.7],candidateRoi:[.2,.1,.6,.8],reason:"형태",uncertainty:"가림"};
assert.equal(validateProposal({decision:"propose",reason:"후보",regions:[region]}).regions.length,1);
assert.equal(validateProposal({decision:"abstain",reason:"불확실",regions:[]}).regions.length,0);
for(const value of [
 {decision:"propose",reason:"",regions:[]}, {decision:"abstain",reason:"",regions:[region]},
 {decision:"propose",reason:"",regions:[region,region,region]},
 {decision:"propose",reason:"",regions:[{...region,queryRoi:[.7,.1,.3,.8]}]},
 {decision:"propose",reason:"",regions:[{...region,candidateRoi:[0,0,1.1,.8]}]},
 {decision:"propose",reason:"",regions:[{...region,candidateRoi:[0,0,.001,.8]}]}
])assert.throws(()=>validateProposal(value));
const pair={pairId:"0123456789abcdef",queryImage:"data:image/jpeg;base64,AA",candidateImage:"data:image/jpeg;base64,BB",
 queryRoi:[.1,.1,.8,.8],candidateRoi:[.1,.1,.7,.7],name:"PRIVATE_TARGET",humanReview:"PRIVATE_REVIEW",comment:"PRIVATE_COMMENT",samePlace:false};
const request=JSON.stringify(contentFor(pair));
for(const forbidden of ["PRIVATE_TARGET","PRIVATE_REVIEW","PRIVATE_COMMENT","queryRoi","candidateRoi","samePlace"])assert(!request.includes(forbidden));
assert.throws(()=>contentFor({...pair,queryImage:"https://external.example/image.jpg"}));
console.log("PASS: ROI range/order/abstention/budget contracts and explicit request whitelist; no API calls");
