import { z } from "zod";
import { checkRequest } from "@/lib/server/access";
import { InputError } from "@/lib/server/image";
import { RecordConflict } from "@/lib/server/records";
import { analyzeRecordObjectFusion, objectFusionStatus } from "@/lib/server/object-fusion";
export const runtime="nodejs";
export const maxDuration=180;
const headers={"Cache-Control":"no-store"};
async function run(request:Request, context:{params:Promise<{id:string}>}, start:boolean) {
  try {
    checkRequest(request);
    const {id}=await context.params;
    if(!z.string().uuid().safeParse(id).success) throw new InputError("기록 ID가 올바르지 않습니다.");
    if(!start) return Response.json({record:objectFusionStatus(id)},{headers});
    if(request.headers.get("x-object-consent")!=="true") throw new InputError("분석본·객체 탐지 결과의 OpenAI 전송과 API 비용 발생에 동의해 주세요.");
    const version=request.headers.get("x-record-version");
    if(!z.string().datetime().safeParse(version).success) throw new InputError("기록 버전이 필요합니다.");
    return Response.json({record:await analyzeRecordObjectFusion(id,version!)},{headers});
  } catch(error) {
    return Response.json({error:error instanceof InputError || error instanceof RecordConflict ? error.message : "GPT 검토에 실패했습니다. API 설정·한도를 확인해 주세요. 자동 재시도하지 않습니다."},
      {status:error instanceof InputError?error.status:error instanceof RecordConflict?409:500,headers});
  }
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) { return run(request,context,true); }
export async function GET(request:Request,context:{params:Promise<{id:string}>}) { return run(request,context,false); }
