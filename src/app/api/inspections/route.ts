import { z } from "zod";
import { checkAnalysisRequest } from "@/lib/server/access";
import { MAX_IMAGE_BYTES } from "@/lib/discovery";
import { InputError } from "@/lib/server/image";
import { requireAnalysisApiKey, toInspectionResponse } from "@/lib/server/analysis-api";
import { enqueueImage } from "@/lib/server/jobs";
import { recordDetail, RecordConflict } from "@/lib/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof RecordConflict) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ error: "분석 요청을 접수하지 못했습니다." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    checkAnalysisRequest(request);
    requireAnalysisApiKey(request.headers.get("x-analysis-api-key"));
    if (request.headers.get("x-analysis-consent") !== "true")
      throw new InputError("사진 보관 및 외부 분석 전송에 대한 동의가 필요합니다.", 400);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES + 128_000) throw new InputError("파일 크기가 제한을 초과했습니다.", 413);
    const key = request.headers.get("idempotency-key");
    if (!z.string().uuid().safeParse(key).success) throw new InputError("요청 키 형식이 올바르지 않습니다.");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new InputError("사진 업로드 요청 형식이 올바르지 않습니다.", 415);
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new InputError("사진 업로드 요청을 읽지 못했습니다."); }
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size < 1) throw new InputError("분석할 사진을 첨부해 주세요.");
    if (photo.size > MAX_IMAGE_BYTES) throw new InputError("사진은 10MB 이하여야 합니다.", 413);
    const record = await enqueueImage(Buffer.from(await photo.arrayBuffer()), key!);
    const detail = recordDetail(record.recordId);
    if (!detail) throw new Error("Analysis record missing after enqueue");
    return Response.json(toInspectionResponse(record, {
      status: String(detail.job.status), error: typeof detail.job.error === "string" ? detail.job.error : null,
    }), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
