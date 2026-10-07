import { InputError, prepareImage, readLimitedBody } from "@/lib/server/image";
import { MAX_IMAGE_BYTES } from "@/lib/discovery";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const prepared = await prepareImage(await readLimitedBody(request, MAX_IMAGE_BYTES));
    return Response.json(prepared, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "이미지 준비 중 오류가 발생했습니다." },
      { status: error instanceof InputError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
