import { z } from "zod";
import { checkRequest } from "@/lib/server/access";
import { InputError } from "@/lib/server/image";
import { extractImageGps } from "@/lib/server/image-gps";
import { storedImage } from "@/lib/server/jobs";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkRequest(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new InputError("기록 ID가 올바르지 않습니다.");
    const bytes = storedImage(id, "original");
    if (!bytes) throw new InputError("저장된 원본이 없습니다. 같은 원본을 먼저 연결해 주세요.", 404);
    return Response.json({ gps: await extractImageGps(bytes) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "원본의 GPS 정보를 읽지 못했습니다." },
      { status: error instanceof InputError ? error.status : 500, headers });
  }
}
