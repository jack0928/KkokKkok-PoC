import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { InputError } from "./image";
import { RecordConflict } from "./records";

function key() {
  const value=process.env.NODE_ANALYSIS_API_KEY;
  if(!value?.trim()) throw new InputError("분석 서버 접근 키가 설정되지 않았습니다.",503);
  return value;
}
function equal(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function inspectionAccess(request:Request) {
  if(!equal(key(),request.headers.get("x-analysis-api-key")??"")) throw new InputError("서버 접근 키가 올바르지 않습니다.",401);
}
function signature(id:string,expires:string) {return createHmac("sha256",key()).update(`analysis-image:${id}:${expires}`).digest("hex");}
export function inspectionImageUrl(id:string) {
  const base=process.env.INSPECTION_PUBLIC_BASE_URL;
  if(!base) return null;
  const url=new URL(`/api/inspections/${id}/image`,base);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password) throw new InputError("이미지 공개 주소 설정을 확인해 주세요.",503);
  const expires=String(Math.floor(Date.now()/1000)+900);
  url.searchParams.set("expires",expires);url.searchParams.set("signature",signature(id,expires));return url.toString();
}
export function inspectionImageAccess(request:Request,id:string) {
  if(request.headers.has("x-analysis-api-key")){inspectionAccess(request);return;}
  const params=new URL(request.url).searchParams,expires=params.get("expires")??"";
  if(!/^\d{10}$/.test(expires)||Number(expires)<Math.floor(Date.now()/1000)||Number(expires)>Math.floor(Date.now()/1000)+900||!equal(signature(id,expires),params.get("signature")??""))
    throw new InputError("이미지 링크가 만료되었거나 올바르지 않습니다.",401);
}
export function inspectionError(error:unknown) {
  const status=error instanceof InputError?error.status:error instanceof RecordConflict?409:500;
  const code:Record<number,string>={400:"INVALID_REQUEST",401:"ACCESS_DENIED",404:"INSPECTION_NOT_FOUND",409:"IDEMPOTENCY_CONFLICT",413:"PHOTO_TOO_LARGE",415:"UNSUPPORTED_MEDIA_TYPE",503:"ANALYSIS_NOT_CONFIGURED"};
  return Response.json({error:{code:code[status]??"INTERNAL_ERROR",message:error instanceof InputError||error instanceof RecordConflict?error.message:"검사 요청을 처리하지 못했습니다."}},{status,headers:{"Cache-Control":"no-store"}});
}
