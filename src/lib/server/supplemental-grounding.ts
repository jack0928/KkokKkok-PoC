import "server-only";
import sharp from "sharp";
import type { DiscoveryRecord } from "../discovery";
import { groundingSchema } from "../grounding";
import { runGrounding } from "./grounding";
export async function supplementalGrounding(record:DiscoveryRecord,bytes:Buffer) {
  const base=record.grounding!;
  if(base.supplemental) return base;
  const queries=new Map<string,number[]>();
  record.analysis?.modelOutput.candidates.forEach((candidate,index)=>{
    if(candidate.decision==="not_useful")return;
    const linked=record.fusion?.cues.some(c=>c.relatedCandidateIndexes.includes(index)&&c.decision==="useful") || record.ocrReviews?.some(r=>r.candidateIndex===index&&r.status==="linked");
    if(linked)return;
    for(const raw of candidate.detectionKeywords??[]) {
      const keyword=raw.toLowerCase().replace(/[^a-z -]/g," ").replace(/\s+/g," ").trim();
      if(keyword.length<3)continue;
      if(!queries.has(keyword)&&queries.size>=12)continue;
      queries.set(keyword,[...new Set([...(queries.get(keyword)??[]),index])]);
    }
  });
  const existing=base.detections.map(d=>({...d,candidateIndexes:[...new Set([...(d.candidateIndexes??[]),...(queries.get(d.label.trim().toLowerCase())??[])])]}));
  // A same-label detection elsewhere does not prove the observed object is covered.
  const selected=[...queries.entries()].slice(0,4);
  const requests:{requestId:string;keyword:string;candidateIndexes:number[];detectionCount:number}[]=[];
  const additions:typeof base.detections=[];
  let next=Math.max(-1,...[...base.detections,...base.duplicateDetections??[]].map(d=>Number(d.id.slice(5))))+1;
  for(const [keyword,indexes] of selected){
    const result=await runGrounding(bytes,keyword+".",base.boxThreshold,base.textThreshold);
    if(result.analysisSha256!==base.analysisSha256)throw new Error("Image mismatch");
    const requestId=`query-${requests.length}`;
    requests.push({requestId,keyword,candidateIndexes:indexes,detectionCount:result.detections.length});
    additions.push(...result.detections.map(d=>({...d,id:`dino-${next++}`,candidateIndexes:indexes,requestId})));
  }
  const facade=[...existing,...additions].find(d=>/facade|building/.test(d.label.toLowerCase()));
  const patternIndexes=record.analysis?.modelOutput.candidates.flatMap((c,i)=>(c.detectionKeywords??[]).some(k=>/window|facade|frame/.test(k.toLowerCase()))?[i]:[])??[];
  if(facade&&patternIndexes.length){
    const width=record.image.width,height=record.image.height;
    const left=Math.floor(facade.bbox[0]*width),top=Math.floor(facade.bbox[1]*height);
    const cw=Math.max(1,Math.ceil(facade.bbox[2]*width)-left),ch=Math.max(1,Math.ceil(facade.bbox[3]*height)-top);
    const crop=await sharp(bytes).extract({left,top,width:cw,height:ch}).jpeg({quality:95}).toBuffer();
    const result=await runGrounding(crop,"window. window frame.",base.boxThreshold,base.textThreshold);
    const requestId="facade-crop";
    requests.push({requestId,keyword:"window / window frame (외벽 내부)",candidateIndexes:patternIndexes,detectionCount:result.detections.length});
    additions.push(...result.detections.map(d=>({...d,id:`dino-${next++}`,candidateIndexes:patternIndexes,requestId,bbox:[(left+d.bbox[0]*cw)/width,(top+d.bbox[1]*ch)/height,(left+d.bbox[2]*cw)/width,(top+d.bbox[3]*ch)/height] as [number,number,number,number]})));
  }
  return groundingSchema.parse({...base,detections:[...existing,...additions],supplemental:{status:selected.length?"completed":"skipped",prompt:selected.map(x=>x[0]).join(". "),candidateIndexes:[...new Set(selected.flatMap(x=>x[1]))],analyzedAt:new Date().toISOString(),reason:"Per-query provenance; crop review required. Maximum 4 queries; remaining proposals retained in GPT output.",requests}});
}
