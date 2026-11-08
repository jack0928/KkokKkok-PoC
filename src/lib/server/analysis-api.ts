import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { DiscoveryRecord } from "../discovery";
import { InputError } from "./image";

export function requireAnalysisApiKey(supplied: string | null) {
  const expected = process.env.ANALYSIS_API_KEY?.trim();
  if (!expected) throw new InputError("분석 서버 API 키가 설정되지 않았습니다.", 503);
  if (!supplied) throw new InputError("분석 서버 인증에 실패했습니다.", 401);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes))
    throw new InputError("분석 서버 인증에 실패했습니다.", 401);
}

export function toInspectionResponse(record: DiscoveryRecord, job: { status: string; error: string | null }) {
  const status = record.analysis ? "completed"
    : job.status === "queued" ? "queued"
      : job.status === "analyzing" ? "processing" : "failed";
  const candidates = record.analysis?.modelOutput.candidates ?? [];
  const visionStages = record.analysis?.visionStages;
  const riskFactors = candidates.map((candidate, index) => ({
    id: `${record.recordId}:${index + 1}`,
    type: candidate.featureType,
    title: candidate.featureType,
    description: candidate.observedCue,
    detail: candidate.regionDescription,
    bbox: null,
    sources: ["feature-discovery-vlm"],
    assessmentSource: "model",
    modelRisk: candidate.modelRisk,
    humanRisk: null,
    modelReason: candidate.modelReason,
  }));

  return {
    inspectionId: record.recordId,
    status,
    mock: false,
    pipelineVersion: record.analysis?.promptVersion ?? "feature-discovery-v1",
    image: {
      width: record.image.width,
      height: record.image.height,
      coordinateSpace: "analysis-normalized",
      url: null,
    },
    progress: { featureDiscovery: status },
    riskSummary: { score: null, level: "not_assessed" },
    riskFactors,
    visualObservations: [
      ...candidates.map((candidate, index) => ({
        id: riskFactors[index].id,
        category: candidate.featureType,
        name: candidate.observedCue,
        regionDescription: candidate.regionDescription,
        modelReason: candidate.modelReason,
        source: "feature-discovery-vlm",
        confidence: null,
        bbox: null,
      })),
      ...(visionStages?.ocr.items.map((item, index) => ({
        id: `${record.recordId}:ocr:${index + 1}`,
        category: "text",
        name: item.text,
        regionDescription: "문자 인식 영역",
        modelReason: "PaddleOCR이 사진에서 읽은 글자입니다. 위치 위험 판단은 완료되지 않았습니다.",
        source: "paddleocr",
        confidence: item.confidence,
        bbox: item.bbox,
        coordinateSpace: "analysis-normalized",
      })) ?? []),
      ...(visionStages?.objectDetection.items.map((item, index) => ({
        id: `${record.recordId}:object:${index + 1}`,
        category: "object",
        name: item.label,
        regionDescription: "객체 탐지 영역",
        modelReason: "Grounding DINO가 찾은 객체 후보입니다. 위치 위험 판단은 완료되지 않았습니다.",
        source: "grounding-dino",
        confidence: item.confidence,
        bbox: item.bbox,
        coordinateSpace: "analysis-normalized",
      })) ?? []),
    ],
    pipelineStages: {
      visualObservation: record.analysis ? "completed" : status,
      ocr: visionStages?.ocr.status ?? "unavailable",
      objectDetection: visionStages?.objectDetection.status ?? "unavailable",
    },
    error: status === "failed" ? { message: job.error ?? "분석에 실패했습니다." } : null,
    model: record.analysis?.responseModel ?? null,
  };
}
