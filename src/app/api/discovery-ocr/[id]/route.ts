import { z } from "zod";
import { checkRequest } from "@/lib/server/access";
import { InputError } from "@/lib/server/image";
import { RecordConflict } from "@/lib/server/records";
import { analyzeRecordOcr } from "@/lib/server/ocr";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{id: string}> }) {
  const headers = {"Cache-Control": "no-store"};
  try {
    checkRequest(request);
    const {id} = await context.params;
    const version = request.headers.get("x-record-version");
    if (!z.string().uuid().safeParse(id).success || !z.string().datetime().safeParse(version).success)
      throw new InputError("기록 ID와 버전을 확인해 주세요.");
    return Response.json({record: await analyzeRecordOcr(id, version!)}, {headers});
  } catch (error) {
    return Response.json({error: error instanceof InputError || error instanceof RecordConflict ? error.message : "OCR 실행에 실패했습니다. 로컬 Python·PaddleOCR·모델 설치를 확인한 뒤 다시 시도해 주세요. 기존 GPT 결과는 보존됩니다."},
      {status: error instanceof InputError ? error.status : error instanceof RecordConflict ? 409 : 500, headers});
  }
}
