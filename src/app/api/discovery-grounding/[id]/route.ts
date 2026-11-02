import { z } from "zod";
import { checkRequest } from "@/lib/server/access";
import { groundingRequestSchema } from "@/lib/grounding";
import { groundingStatus, analyzeRecordGrounding } from "@/lib/server/grounding";
import { InputError } from "@/lib/server/image";
import { RecordConflict } from "@/lib/server/records";
export const runtime="nodejs";
export const maxDuration=660;
async function run(request:Request,context:{params:Promise<{id:string}>},start:boolean) {
  try {
    checkRequest(request);const {id}=await context.params;
    if(!z.string().uuid().safeParse(id).success)throw new InputError("잘못된 기록 ID입니다.");
    if(!start)return Response.json({record:groundingStatus(id)},{headers:{"Cache-Control":"no-store"}});
    const version=request.headers.get("x-record-version");
    if(!z.string().datetime().safeParse(version).success)throw new InputError("기록 버전이 필요합니다.");
    const body=groundingRequestSchema.safeParse(await request.json());if(!body.success)throw new InputError("탐지 프롬프트는 3~400자, 점수 기준은 0.1~0.9여야 합니다.");
    return Response.json({record:await analyzeRecordGrounding(id,version!,body.data.prompt,body.data.boxThreshold,body.data.textThreshold)},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof InputError||error instanceof RecordConflict?error.message:"객체 탐지 실행에 실패했습니다. 설치와 모델 캐시를 확인해 주세요."},{status:error instanceof InputError?error.status:error instanceof RecordConflict?409:500});}
}
export async function GET(r:Request,c:{params:Promise<{id:string}>}){return run(r,c,false);}
export async function POST(r:Request,c:{params:Promise<{id:string}>}){return run(r,c,true);}
