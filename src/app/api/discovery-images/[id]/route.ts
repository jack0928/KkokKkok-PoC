import { z } from "zod";
import sharp from "sharp";
import { checkRequest } from "@/lib/server/access";
import { InputError } from "@/lib/server/image";
import { storedImage } from "@/lib/server/jobs";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkRequest(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new InputError("기록 ID가 올바르지 않습니다.");
    const bytes = storedImage(id, new URL(request.url).searchParams.get("kind") === "analysis" ? "analysis" : "original");
    if (!bytes) return Response.json({ error: "저장된 원본이 없습니다." }, { status: 404 });
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    const mime = metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: "이미지를 읽을 수 없습니다." }, { status: error instanceof InputError ? error.status : 500 });
  }
}
