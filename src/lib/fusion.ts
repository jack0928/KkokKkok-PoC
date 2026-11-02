import { z } from "zod";
import type { OcrResult } from "./ocr";
export const FUSION_PROMPT_VERSION = "ocr-fusion-v1";
export const MAX_FUSION_LINES = 120;
const unit = z.number().finite().min(0).max(1);
export const bboxSchema = z.tuple([unit, unit, unit, unit]).refine(([x1,y1,x2,y2]) => x2 > x1 && y2 > y1, "Invalid rectangle");
export type Bbox = z.infer<typeof bboxSchema>;
const risk = z.enum(["low", "medium", "high"]);
export const fusionGroupSchema = z.object({
  ocrLineIds: z.array(z.string()).min(1).max(MAX_FUSION_LINES),
  decision: z.enum(["useful", "not_useful", "uncertain"]),
  category: z.string().min(1).max(120),
  interpretation: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000),
  uncertainty: z.string().max(1000),
  modelRisk: risk.nullable(),
  relatedCandidateIndexes: z.array(z.number().int().nonnegative()).max(40),
}).strict();
export const fusionOutputSchema = z.object({groups: z.array(fusionGroupSchema).max(MAX_FUSION_LINES)}).strict();
export type FusionOutput = z.infer<typeof fusionOutputSchema>;
export const fusionCueSchema = fusionGroupSchema.extend({
  cueId: z.string().regex(/^fusion-\d+$/), bbox: bboxSchema,
}).strict();
export type FusionCue = z.infer<typeof fusionCueSchema>;
export const fusionSchema = z.object({
  schemaVersion: z.literal(1), promptVersion: z.literal(FUSION_PROMPT_VERSION),
  coordinateSpace: z.literal("analysis-normalized"), analysisSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestedModel: z.string(), responseModel: z.string().nullable(), responseId: z.string().nullable(),
  analyzedAt: z.string().datetime(), usage: z.object({inputTokens:z.number(),outputTokens:z.number()}).nullable(),
  skippedEmptyOcr: z.boolean(), rawOutputText: z.string().max(500000), modelOutput: fusionOutputSchema,
  cues: z.array(fusionCueSchema).max(MAX_FUSION_LINES),
}).strict();
export type Fusion = z.infer<typeof fusionSchema>;
export const fusionReviewSchema = z.object({
  cueId: z.string(), status: z.enum(["unreviewed", "accepted", "rejected"]),
  featureType: z.string().max(120), observedCue: z.string().max(2000), bbox: bboxSchema,
  humanRisk: risk.nullable(), humanReason: z.string().max(3000),
}).strict();
export type FusionReview = z.infer<typeof fusionReviewSchema>;
export const fusionAttemptSchema = z.object({
  requestId: z.string().uuid(), status: z.enum(["running", "failed", "completed"]),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), error: z.string().nullable(),
}).strict();
export function boundsForLines(ocr: OcrResult, ids: string[]): Bbox {
  const lines = ids.map(id => ocr.lines.find(line => line.id === id));
  if (!ids.length || lines.some(line => !line)) throw new Error("Unknown OCR ID");
  const points = lines.flatMap(line => line!.polygon);
  return bboxSchema.parse([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
}
export function makeFusionCues(output: FusionOutput, ocr: OcrResult, candidateCount: number): FusionCue[] {
  const seen = new Set<string>();
  const cues = output.groups.map((group,index) => {
    if (group.ocrLineIds.some(id => { if (seen.has(id)) return true; seen.add(id); return false; })) throw new Error("Duplicate OCR assignment");
    if (new Set(group.relatedCandidateIndexes).size !== group.relatedCandidateIndexes.length || group.relatedCandidateIndexes.some(i=>i>=candidateCount)) throw new Error("Invalid GPT candidate reference");
    if (group.decision === "useful" && group.modelRisk === null) throw new Error("Useful cue needs a model risk assessment");
    return {...group, cueId:`fusion-${index}`, bbox:boundsForLines(ocr,group.ocrLineIds)};
  });
  if (seen.size !== ocr.lines.length) throw new Error("Not all OCR lines were reviewed");
  return cues;
}
export function newFusionReview(cue: Pick<FusionCue,"cueId"|"category"|"interpretation"|"bbox">): FusionReview {
  return {cueId:cue.cueId,status:"unreviewed",featureType:cue.category,observedCue:cue.interpretation,bbox:[...cue.bbox],humanRisk:null,humanReason:""};
}
export function isFusionReviewWritten(review: FusionReview) {
  return review.status !== "unreviewed" && !!review.humanReason.trim()
    && (review.status === "rejected" || (!!review.featureType.trim() && !!review.observedCue.trim() && review.humanRisk !== null));
}
export function fusionReviewComplete(fusion: {cues: {cueId:string;decision:string}[]}, reviews: FusionReview[]) {
  return fusion.cues.filter(cue => cue.decision === "useful" || reviews.some(r=>r.cueId===cue.cueId))
    .every(cue => reviews.some(r=>r.cueId===cue.cueId && isFusionReviewWritten(r)));
}
