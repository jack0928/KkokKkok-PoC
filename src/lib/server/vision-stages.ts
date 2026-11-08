import "server-only";
import { z } from "zod";
import { PreparedImage } from "../discovery";

const stageSchema = z.object({
  pipelineVersion: z.string().max(100),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), coordinateSpace: z.literal("analysis-normalized-tlbr") }),
  ocr: z.object({ model: z.string().max(200), status: z.enum(["completed", "failed"]), items: z.array(z.object({ text: z.string().max(2000), confidence: z.number().min(0).max(1).nullable(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) })), error: z.string().max(200).optional() }),
  objectDetection: z.object({ model: z.string().max(300), threshold: z.number().min(0).max(1), status: z.enum(["completed", "failed"]), items: z.array(z.object({ label: z.string().max(120), confidence: z.number().min(0).max(1), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) })), error: z.string().max(200).optional() }),
}).strict();

export type VisionStages = z.infer<typeof stageSchema>;

export async function runVisionStages(prepared: PreparedImage): Promise<VisionStages | undefined> {
  const endpoint = process.env.ANALYSIS_VISION_STAGE_URL?.trim();
  const key = process.env.ANALYSIS_VISION_STAGE_KEY?.trim();
  if (!endpoint && !key) return undefined;
  if (!endpoint || !key) throw new Error("분석 보조 서버 URL과 키를 함께 설정해 주세요.");

  const base64 = prepared.dataUrl.slice(prepared.dataUrl.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/stages`, {
    method: "POST",
    headers: { "Content-Type": prepared.image.mimeType, "X-Analysis-Stage-Key": key },
    body: bytes,
    signal: AbortSignal.timeout(240_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`분석 보조 서버 요청에 실패했습니다. (${response.status})`);
  const stages = stageSchema.parse(await response.json());
  if (stages.image.width !== prepared.image.width || stages.image.height !== prepared.image.height) {
    throw new Error("분석 보조 서버의 이미지 좌표 기준이 일치하지 않습니다.");
  }
  return stages;
}
