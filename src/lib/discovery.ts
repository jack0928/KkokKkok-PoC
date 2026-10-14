import { z } from "zod";

export const RISK_DEFINITION =
  "해당 Feature가 외부 정보와 결합되었을 때 실제 촬영 위치를 좁히거나 특정하는 데 얼마나 유용한가";
export const PROMPT_VERSION = "feature-discovery-v1";
export const STORAGE_KEY = "kkokkkok:feature-discovery:v1";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const FEATURE_SUGGESTIONS = [
  "text", "logo / sign", "landmark / building", "transportation", "environmental", "other",
];

export const riskSchema = z.enum(["low", "medium", "high"]);
const shortText = z.string().max(120);
const observation = z.string().max(2000);
const reason = z.string().max(3000);

// Open-ended featureType is intentional: this experiment discovers the taxonomy.
export const modelOutputSchema = z.object({
  candidates: z.array(z.object({
    featureType: shortText,
    observedCue: observation,
    regionDescription: z.string().max(500),
    modelRisk: riskSchema,
    modelReason: reason,
  }).strict()).max(40),
  limitations: z.array(z.string().max(1000)).max(10),
}).strict();

export const imageDescriptorSchema = z.object({
  imageId: z.string().uuid(),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
  analysisSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(2048),
  height: z.number().int().positive().max(2048),
  mimeType: z.literal("image/jpeg"),
  preprocessing: z.literal("auto-rotate; max-edge=2048; jpeg-quality=95; metadata-stripped; white-background"),
}).strict();

export const preparedImageSchema = z.object({
  image: imageDescriptorSchema,
  dataUrl: z.string().startsWith("data:image/jpeg;base64,").max(8 * 1024 * 1024),
  thumbnailDataUrl: z.string().startsWith("data:image/jpeg;base64,").max(200000).optional(),
}).strict();

export const humanReviewSchema = z.object({
  cueId: z.string().uuid(),
  modelCandidateIndex: z.number().int().nonnegative().nullable(),
  source: z.enum(["model", "human"]),
  featureType: shortText,
  observedCue: observation,
  regionDescription: z.string().max(500),
  appropriateness: z.enum(["unreviewed", "appropriate", "inappropriate", "uncertain"]),
  humanRisk: riskSchema.nullable(),
  humanReason: reason,
}).strict();

export const analysisSchema = z.object({
  requestedModel: z.string().max(200),
  responseModel: z.string().max(200),
  responseId: z.string().max(200),
  analyzedAt: z.string().datetime(),
  promptVersion: z.literal(PROMPT_VERSION),
  analysisSha256: z.string().regex(/^[a-f0-9]{64}$/),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  modelOutput: modelOutputSchema,
  rawOutputText: z.string().max(300000),
}).strict();

export const discoveryRecordSchema = z.object({
  schemaVersion: z.literal(1),
  experiment: z.literal("feature-discovery"),
  recordId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  riskDefinition: z.literal(RISK_DEFINITION),
  image: imageDescriptorSchema,
  analysis: analysisSchema.nullable(),
  humanReviews: z.array(humanReviewSchema).max(100),
  notes: z.string().max(5000),
  reviewCompletedAt: z.string().datetime().nullable().default(null),
}).strict().superRefine((record, context) => {
  if (record.reviewCompletedAt && (!record.analysis || record.humanReviews.some((item) => item.appropriateness === "unreviewed" || !item.humanReason.trim() || (item.humanRisk === null && item.appropriateness !== "uncertain")))) {
    context.addIssue({ code: "custom", message: "Completed review requires an analysis and reviewed cues" });
  }
  const indexes = new Set<number>();
  const ids = new Set<string>();
  for (const review of record.humanReviews) {
    if (ids.has(review.cueId)) context.addIssue({ code: "custom", message: "Duplicate cue ID" });
    ids.add(review.cueId);
    if (review.source === "human") {
      if (review.modelCandidateIndex !== null) context.addIssue({ code: "custom", message: "Human cue cannot link to model candidate" });
    } else {
      const index = review.modelCandidateIndex;
      if (index === null || !record.analysis || index >= record.analysis.modelOutput.candidates.length || indexes.has(index)) {
        context.addIssue({ code: "custom", message: "Invalid model candidate link" });
      } else indexes.add(index);
    }
  }
  if (record.analysis && indexes.size !== record.analysis.modelOutput.candidates.length) {
    context.addIssue({ code: "custom", message: "Every model candidate must retain its review" });
  }
  if (record.analysis && record.analysis.analysisSha256 !== record.image.analysisSha256) {
    context.addIssue({ code: "custom", message: "Analysis image mismatch" });
  }
});

export const storedRecordsSchema = z.array(discoveryRecordSchema);
export type DiscoveryRecord = z.infer<typeof discoveryRecordSchema>;
export type HumanReview = z.infer<typeof humanReviewSchema>;
export type ModelCandidate = z.infer<typeof modelOutputSchema>["candidates"][number];
export type PreparedImage = z.infer<typeof preparedImageSchema>;
export type Analysis = z.infer<typeof analysisSchema>;

export function isReviewWritten(item: HumanReview): boolean {
  return item.appropriateness !== "unreviewed" && !!item.humanReason.trim() && (item.humanRisk !== null || item.appropriateness === "uncertain");
}

export function newRecord(image: PreparedImage["image"]): DiscoveryRecord {
  const now = new Date().toISOString();
  return { schemaVersion: 1, experiment: "feature-discovery", recordId: crypto.randomUUID(),
    createdAt: now, updatedAt: now, riskDefinition: RISK_DEFINITION,
    image, analysis: null, humanReviews: [], notes: "", reviewCompletedAt: null };
}

export function newHumanCue(): HumanReview {
  return { cueId: crypto.randomUUID(), modelCandidateIndex: null, source: "human",
    featureType: "", observedCue: "", regionDescription: "", appropriateness: "unreviewed",
    humanRisk: null, humanReason: "" };
}

export function applyAnalysis(record: DiscoveryRecord, analysis: Analysis): DiscoveryRecord {
  // Analysis runs become separate records in the UI. Never overwrite an existing model output.
  if (record.analysis) throw new Error("이미 분석된 기록입니다. 새 실험으로 분석해 주세요.");
  return { ...record, analysis, updatedAt: new Date().toISOString(),
    humanReviews: [
      ...analysis.modelOutput.candidates.map((candidate, index): HumanReview => ({
        cueId: crypto.randomUUID(), modelCandidateIndex: index, source: "model",
        featureType: candidate.featureType, observedCue: candidate.observedCue,
        regionDescription: candidate.regionDescription, appropriateness: "unreviewed",
        humanRisk: null, humanReason: "",
      })),
      ...record.humanReviews.filter((review) => review.source === "human"),
    ] };
}


export function reviewStatus(record: DiscoveryRecord): "unreviewed" | "in_progress" | "completed" {
  if (record.reviewCompletedAt) return "completed";
  return record.notes.trim() || record.humanReviews.some((item) => {
    const candidate = item.modelCandidateIndex === null ? undefined : record.analysis?.modelOutput.candidates[item.modelCandidateIndex];
    return item.source === "human" || item.appropriateness !== "unreviewed" || item.humanRisk !== null || item.humanReason.trim()
      || (candidate && (item.featureType !== candidate.featureType || item.observedCue !== candidate.observedCue || item.regionDescription !== candidate.regionDescription));
  }) ? "in_progress" : "unreviewed";
}

export const jobInfoSchema = z.object({
  status: z.enum(["queued", "analyzing", "completed", "failed", "legacy"]),
  error: z.string().nullable(),
  hasOriginal: z.boolean(),
});
export const resultsSchema = z.object({
  records: storedRecordsSchema,
  thumbnails: z.record(z.string().uuid(), z.string().startsWith("data:image/jpeg;base64,").max(200000)),
  jobs: z.record(z.string().uuid(), jobInfoSchema).default({}),
});
export type JobInfo = z.infer<typeof jobInfoSchema>;
