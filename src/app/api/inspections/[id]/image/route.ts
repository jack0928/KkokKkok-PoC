import { inspectionImageAccess,inspectionError } from "@/lib/server/inspection-access";
import { inspectionId,readInspection } from "@/lib/server/inspections";
import { storedImage } from "@/lib/server/jobs";
import { InputError } from "@/lib/server/image";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {const id=inspectionId((await context.params).id);inspectionImageAccess(request,id);readInspection(id);
    const image=storedImage(id,"analysis");if(!image)throw new InputError("분석 이미지가 없습니다.",404);
    return new Response(new Uint8Array(image),{headers:{"Content-Type":"image/jpeg","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  }catch(error){return inspectionError(error);}
}
