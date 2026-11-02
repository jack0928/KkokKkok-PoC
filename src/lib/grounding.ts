import { z } from "zod";
import { bboxSchema, fusionGroupSchema, fusionSchema, type Bbox } from "./fusion";

export const GROUNDING_PROMPTS = {
  indoor: "window. door. counter. display case. shelf. table. chair. ceiling light. coffee machine. refrigerator. plant. cup. bottle. wall decoration.",
  outdoor: "building. entrance. window. balcony. stairs. fence. bench. street lamp. bus stop. bicycle. sculpture. tree.",
};
export const GROUNDING_PROMPT = GROUNDING_PROMPTS.indoor;
export const groundingRequestSchema = z.object({prompt:z.string().trim().min(3).max(400),boxThreshold:z.number().min(0.1).max(0.9).default(0.3),textThreshold:z.number().min(0.1).max(0.9).default(0.25)}).strict();
export const groundingSchema = z.object({
  engine:z.literal("Grounding DINO"), schemaVersion:z.literal(1),
  model:z.string(), revision:z.string(), transformersVersion:z.string(), device:z.string(),
  prompt:z.string().min(3).max(400), boxThreshold:z.number().min(0).max(1), textThreshold:z.number().min(0).max(1),
  coordinateSpace:z.literal("analysis-normalized"), analysisSha256:z.string().regex(/^[a-f0-9]{64}$/),
  analyzedAt:z.string().datetime(), elapsedMs:z.number().nonnegative(),
  detections:z.array(z.object({id:z.string().regex(/^dino-\d+$/),label:z.string().min(1).max(400),score:z.number().min(0).max(1),bbox:bboxSchema}).strict()).max(900),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.detections.map(d=>d.id)).size!==value.detections.length) ctx.addIssue({code:"custom",message:"Duplicate detection ID"});
});
export type Grounding = z.infer<typeof groundingSchema>;
export const objectGroupSchema = fusionGroupSchema.omit({ocrLineIds:true}).extend({detectionIds:z.array(z.string()).min(1).max(120)}).strict();
export const objectOutputSchema = z.object({groups:z.array(objectGroupSchema).max(120)}).strict();
export type ObjectOutput = z.infer<typeof objectOutputSchema>;
export const objectCueSchema = objectGroupSchema.extend({cueId:z.string().regex(/^object-\d+$/),bbox:bboxSchema}).strict();
export const objectFusionSchema = fusionSchema.omit({promptVersion:true,modelOutput:true,cues:true,skippedEmptyOcr:true}).extend({
  promptVersion:z.enum(["object-fusion-v1","object-fusion-v2-nontext","object-fusion-v3-crops"]),modelOutput:objectOutputSchema,cues:z.array(objectCueSchema).max(120),skippedEmptyDetections:z.boolean(),
}).strict();
export type ObjectFusion = z.infer<typeof objectFusionSchema>;
export function makeObjectCues(output:ObjectOutput, grounding:Grounding, candidateCount:number) {
  const seen = new Set<string>();
  const cues=output.groups.map((group,index)=>{
    const boxes=group.detectionIds.map(id=>{
      const detection=grounding.detections.find(d=>d.id===id);
      if(!detection||seen.has(id)) throw new Error("Unknown or duplicated detection ID");
      seen.add(id); return detection.bbox;
    });
    if(!boxes.length||group.relatedCandidateIndexes.some(i=>i>=candidateCount)||new Set(group.relatedCandidateIndexes).size!==group.relatedCandidateIndexes.length) throw new Error("Invalid reference");
    if(group.decision==="useful" && !group.modelRisk) throw new Error("Missing risk");
    const bbox:Bbox=bboxSchema.parse([Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))]);
    return {...group,cueId:`object-${index}`,bbox};
  });
  if(seen.size!==grounding.detections.length) throw new Error("Missing detections");
  return cues;
}
