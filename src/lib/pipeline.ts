import { groundingRequestSchema, GROUNDING_PROMPT } from "./grounding";
import { z } from "zod";
export const pipelineStageSchema=z.object({status:z.enum(["pending","running","completed","failed","skipped"]),error:z.string().nullable()}).strict();
export const pipelineSchema=z.object({version:z.literal(1),groundingOptions:groundingRequestSchema.optional(),gpt:pipelineStageSchema,ocr:pipelineStageSchema,grounding:pipelineStageSchema,fusion:pipelineStageSchema,objects:pipelineStageSchema}).strict();
export type Pipeline=z.infer<typeof pipelineSchema>;
export const PIPELINE_LABELS={gpt:"GPT 개별 단서",ocr:"OCR 추출",grounding:"DINO 탐지",fusion:"OCR GPT 검토",objects:"객체 GPT 검토"};
export function newPipeline(options?:z.infer<typeof groundingRequestSchema>):Pipeline {return {version:1,groundingOptions:options??{prompt:GROUNDING_PROMPT,boxThreshold:0.3,textThreshold:0.25},gpt:{status:"pending",error:null},ocr:{status:"pending",error:null},grounding:{status:"pending",error:null},fusion:{status:"pending",error:null},objects:{status:"pending",error:null}};}
export function pipelineActive(p?:Pipeline){return !!p&&Object.keys(PIPELINE_LABELS).some(k=>["pending","running"].includes(p[k as keyof typeof PIPELINE_LABELS].status));}
