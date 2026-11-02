import { z } from "zod";
const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
export const ocrResultSchema = z.object({
  engine: z.literal("PaddleOCR"), version: z.string().max(80),
  coordinateSpace: z.literal("analysis-normalized"),
  lines: z.array(z.object({ id: z.string().regex(/^ocr-\d+$/), text: z.string().max(2000),
    score: z.number().min(0).max(1), polygon: z.array(point).length(4),
  }).strict()).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.lines.map(line => line.id)).size !== value.lines.length)
    ctx.addIssue({code: "custom", message: "Duplicate OCR ID"});
});
export const ocrReviewSchema = z.object({
  lineId: z.string(), candidateIndex: z.number().int().nonnegative().nullable(),
  status: z.enum(["unreviewed", "linked", "standalone", "excluded"]),
}).strict();
export type OcrResult = z.infer<typeof ocrResultSchema>;
export type OcrReview = z.infer<typeof ocrReviewSchema>;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
// Text agreement is only a suggestion, never proof of spatial correspondence.
export function suggestCandidates(text: string, candidates: { observedCue: string }[]): number[] {
  const needle = normalize(text);
  if (needle.length < 2) return [];
  return candidates.flatMap((candidate, index) => normalize(candidate.observedCue).includes(needle) ? [index] : []);
}
