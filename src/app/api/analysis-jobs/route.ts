import { z } from "zod";
import { checkRequest } from "@/lib/server/access";
import { MAX_IMAGE_BYTES } from "@/lib/discovery";
import { InputError, readLimitedBody } from "@/lib/server/image";
import { attachOriginal, enqueueImage, retryJob } from "@/lib/server/jobs";
import { RecordConflict } from "@/lib/server/records";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkRequest(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("record");
    if (id && !z.string().uuid().safeParse(id).success) throw new InputError("기록 ID가 올바르지 않습니다.");
    if (url.searchParams.get("action") === "retry") {
      if (!id) throw new InputError("기록 ID가 필요합니다.");
      return Response.json({ records: retryJob(id) });
    }
    if (request.headers.get("x-analysis-consent") !== "true") throw new InputError("이미지 보관 및 외부 전송에 동의해 주세요.");
    const bytes = await readLimitedBody(request, MAX_IMAGE_BYTES);
    if (id) {
      const expected = request.headers.get("x-record-version");
      if (!expected || !z.string().datetime().safeParse(expected).success) throw new InputError("기록 버전이 필요합니다.");
      await attachOriginal(id, bytes, expected);
      return Response.json({ attached: true });
    }
    const uploadId = request.headers.get("x-upload-id") ?? undefined;
    if (uploadId && !z.string().uuid().safeParse(uploadId).success) throw new InputError("업로드 ID가 올바르지 않습니다.");
    return Response.json({ record: await enqueueImage(bytes, uploadId) }, { status: 202 });
  } catch (error) {
    const status = error instanceof InputError ? error.status : error instanceof RecordConflict ? 409 : 500;
    return Response.json({ error: error instanceof InputError || error instanceof RecordConflict ? error.message : "이미지를 저장하지 못했습니다. 로컬 저장 경로와 권한을 확인해 주세요." }, { status });
  }
}
