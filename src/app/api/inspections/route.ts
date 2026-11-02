import { inspectionAccess,inspectionError } from "@/lib/server/inspection-access";
import { createInspection,parseInspection } from "@/lib/server/inspections";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {inspectionAccess(request);const result=await createInspection(await parseInspection(request));
    return Response.json(result,{status:202,headers:{"Cache-Control":"no-store","Location":`/api/inspections/${result.inspectionId}`}});
  }catch(error){return inspectionError(error);}
}
