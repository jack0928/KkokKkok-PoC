import { inspectionAccess,inspectionError } from "@/lib/server/inspection-access";
import { readInspection } from "@/lib/server/inspections";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {inspectionAccess(request);return Response.json(readInspection((await context.params).id),{headers:{"Cache-Control":"no-store"}});}
  catch(error){return inspectionError(error);}
}
