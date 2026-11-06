import type { Assessment } from "./single-cue-policy";
import type { DiscoveryRecord } from "./discovery";
import type { Bbox } from "./fusion";
import { matchingOcrText } from "./ocr-duplicates";
import { relatedEvidence } from "./evidence-groups";

export type RiskFactor={id:string;type:string;title:string;description:string;text:string|null;bbox:Bbox|null;sources:string[];reviewStatus:string;modelRisk:string|null;humanRisk:string|null;relatedToId:string|null;assessmentSource:string;assessment?:Assessment;decision?:string};
/** Transport adapter: raw model records and human edits remain stored separately. */
export function inspectionFactors(record:DiscoveryRecord,gpsStatus:string):RiskFactor[] {
  const factors:RiskFactor[]=[];
  for(const [result,reviews,source] of [[record.fusion,record.fusionReviews,"ocr"],[record.objectFusion,record.objectFusionReviews,"grounding_dino"]] as const) {
    for(const cue of result?.cues??[]) {
      const review=reviews?.find(r=>r.cueId===cue.cueId);
      if(review?.status==="rejected" || (cue.decision!=="useful"&&!(cue.assessment&&cue.decision==="uncertain")&&review?.status!=="accepted"))continue;
      const accepted=review?.status==="accepted";
      const relation=relatedEvidence(record,cue.cueId);
      const text="ocrLineIds" in cue?record.ocr?.lines.filter(l=>cue.ocrLineIds.includes(l.id)).map(l=>l.text).join(" ")??null:null;
      factors.push({id:cue.cueId,type:accepted?review.featureType:cue.category,title:accepted?review.observedCue:cue.interpretation,
        description:accepted?review.humanReason:cue.reason,text,bbox:accepted?review.bbox:cue.bbox,sources:[source,"gpt"],
        assessment:cue.assessment,decision:cue.decision,reviewStatus:review?.status??"unreviewed",modelRisk:cue.modelRisk,humanRisk:review?.humanRisk??null,
        relatedToId:relation?.anchor.replace("fusion-cue-","")??null,assessmentSource:accepted?"human":"model_candidate"});
    }
  }
  record.analysis?.modelOutput.candidates.forEach((cue,index)=>{
    const review=record.humanReviews.find(r=>r.modelCandidateIndex===index);
    if(review?.appropriateness==="inappropriate")return;
    const accepted=review?.appropriateness==="appropriate";
    // Keep legacy text duplicates in the stored raw result, not as an additional UI factor.
    if(!accepted&&cue.assessment&&cue.decision==="not_useful")return;
    if(!accepted&&matchingOcrText(record,cue.observedCue).length)return;
    factors.push({id:`gpt-${index}`,type:accepted?review.featureType:cue.featureType,title:accepted?review.observedCue:cue.observedCue,
      description:accepted?review.humanReason:cue.modelReason,text:null,bbox:null,sources:["gpt"],reviewStatus:review?.appropriateness??"unreviewed",
      assessment:cue.assessment,decision:cue.decision,modelRisk:cue.modelRisk,humanRisk:review?.humanRisk??null,relatedToId:relatedEvidence(record,`gpt-${index}`)?.anchor.replace("fusion-cue-","")??null,assessmentSource:accepted?"human":"model_candidate"});
  });
  for(const cue of record.humanReviews.filter(r=>r.source==="human"&&r.appropriateness==="appropriate"))factors.push({id:cue.cueId,type:cue.featureType,title:cue.observedCue,description:cue.humanReason,text:null,bbox:null,sources:["human"],reviewStatus:cue.appropriateness,modelRisk:null,humanRisk:cue.humanRisk,relatedToId:null,assessmentSource:"human"});
  if(gpsStatus==="found")factors.push({id:"gps-metadata",type:"gps_metadata",title:"사진에 GPS 정보가 포함되어 있습니다.",description:"원본 메타데이터에서 좌표가 확인되었습니다. 촬영 장소의 진위나 민감 장소와의 관계는 검증하지 않았습니다.",text:null,bbox:null,sources:["exif"],reviewStatus:"unreviewed",modelRisk:null,humanRisk:null,relatedToId:null,assessmentSource:"metadata"});
  const ids=new Set(factors.map(f=>f.id));for(const factor of factors)if(factor.relatedToId&&!ids.has(factor.relatedToId))factor.relatedToId=null;
  return factors;
}
