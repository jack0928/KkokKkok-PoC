import { z } from "zod";
import { checkAnalysisRequest } from "@/lib/server/access";
import { InputError } from "@/lib/server/image";
import { requireAnalysisApiKey, toInspectionResponse } from "@/lib/server/analysis-api";
import { recordDetail } from "@/lib/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkAnalysisRequest(request);
    requireAnalysisApiKey(request.headers.get("x-analysis-api-key"));
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new InputError("분석 ID 형식이 올바르지 않습니다.");
    const detail = recordDetail(id);
    if (!detail) throw new InputError("분석 작업을 찾을 수 없습니다.", 404);
    return Response.json(toInspectionResponse(detail.record, {
      status: String(detail.job.status), error: typeof detail.job.error === "string" ? detail.job.error : null,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "분석 결과를 조회하지 못했습니다." }, { status: 500 });
  }
}
