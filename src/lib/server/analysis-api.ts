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
    visualObservations: candidates.map((candidate, index) => ({
      id: riskFactors[index].id,
      category: candidate.featureType,
      name: candidate.observedCue,
      regionDescription: candidate.regionDescription,
      modelReason: candidate.modelReason,
      bbox: null,
    })),
    error: status === "failed" ? { message: job.error ?? "분석에 실패했습니다." } : null,
    model: record.analysis?.responseModel ?? null,
  };
}
