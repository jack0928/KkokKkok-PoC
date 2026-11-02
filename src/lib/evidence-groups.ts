import type { DiscoveryRecord } from "./discovery";
import type { Bbox } from "./fusion";
export function boxIou(a:Bbox,b:Bbox){const intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));return intersection/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection);}
const concepts=[/창문|유리창|창밖|창가|window/i,/선반|shelf/i,/카운터|counter/i,/출입구|입구|entrance/i,/천장|ceiling/i,/의자|chair/i,/진열대|진열장|display case/i];
function shared(a:string,b:string){return concepts.some(re=>re.test(a)&&re.test(b));}
export function relatedEvidence(record:DiscoveryRecord,key?:string):{anchor:string;reason:string}|null{
  if(!key)return null;
  const objects=(record.objectFusion?.cues??[]).filter(c=>{const r=record.objectFusionReviews?.find(r=>r.cueId===c.cueId);return r?.status!=="rejected"&&(c.decision==="useful"||!!r);});
  if(key.startsWith("object-")){
    const current=objects.find(c=>c.cueId===key);if(!current)return null;
    const index=objects.indexOf(current);
    const target=objects.slice(0,index).find(c=>boxIou(c.bbox,current.bbox)>=0.7&&shared(c.interpretation,current.interpretation));
    return target?{anchor:`fusion-cue-${target.cueId}`,reason:"같은 종류의 객체 영역이 70% 이상 겹칩니다. 중복 가능 후보로 묶었습니다."}:null;
  }
  if(key.startsWith("gpt-")){
    const index=Number(key.slice(4)),candidate=record.analysis?.modelOutput.candidates[index];if(!candidate)return null;
    const region=candidate.regionDescription;
    const target=objects.find(c=>{
      if(!shared(candidate.observedCue,c.interpretation))return false;
      const x=(c.bbox[0]+c.bbox[2])/2,y=(c.bbox[1]+c.bbox[3])/2;
      if(/오른쪽|우측/.test(region)&&x<0.5)return false;
      if(/왼쪽|좌측/.test(region)&&x>0.5)return false;
      if(/상단/.test(region)&&y>0.5)return false;
      if(/하단/.test(region)&&y<0.5)return false;
      return true;
    });
    return target?{anchor:`fusion-cue-${target.cueId}`,reason:"같은 종류의 비문자 요소를 설명하는 GPT·객체 후보입니다. 동일 객체로 확정하지 않고 관련 근거로 묶었습니다."}:null;
  }
  return null;
}
