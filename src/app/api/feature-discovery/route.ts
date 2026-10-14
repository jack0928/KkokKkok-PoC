import { analyzeImage } from "@/lib/server/analyze";
import OpenAI from "openai";
import sharp from "sharp";
import { preparedImageSchema } from "@/lib/discovery";
import { InputError, readLimitedBody, sha256 } from "@/lib/server/image";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readLimitedBody(request, 8 * 1024 * 1024);
    let json: unknown;
    try { json = JSON.parse(body.toString("utf8")); } catch { throw new InputError("올바른 JSON 요청이 필요합니다."); }
    const parsed = preparedImageSchema.safeParse(json);
    if (!parsed.success) throw new InputError("이미지 요청 형식이 올바르지 않습니다.");
    const { image, dataUrl } = parsed.data;
    const base64 = dataUrl.slice("data:image/jpeg;base64,".length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new InputError("이미지 인코딩이 올바르지 않습니다.");
    const bytes = Buffer.from(base64, "base64");
    if (sha256(bytes) !== image.analysisSha256) throw new InputError("분석 이미지 식별자가 일치하지 않습니다.");
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 2048 * 2048 }).metadata();
      if (metadata.format !== "jpeg" || metadata.width !== image.width || metadata.height !== image.height || metadata.exif) {
        throw new Error("Invalid prepared image");
      }
    } catch { throw new InputError("준비된 분석 이미지를 다시 선택해 주세요."); }

    if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) return Response.json({ error: "OPENAI_API_KEY와 OPENAI_MODEL을 설정하고 서버를 재시작해 주세요." }, { status: 503 });
    return Response.json(await analyzeImage({ image, dataUrl }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never log image bytes, prompts, API keys, or model output.
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof OpenAI.APIError) {
      const status = error.status === 429 ? 429 : 502;
      const message = error.status === 429 ? "API 사용량 또는 요청 한도에 도달했습니다. OpenAI 프로젝트의 한도를 확인해 주세요."
        : error.status === 401 || error.status === 403 ? "OpenAI 인증 또는 모델 접근 권한을 확인해 주세요."
        : "OpenAI 요청에 실패했습니다. 모델의 이미지 입력·Structured Outputs 지원과 서버 설정을 확인해 주세요.";
      return Response.json({ error: message }, { status });
    }
    return Response.json({ error: "VLM 분석 또는 응답 검증에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
