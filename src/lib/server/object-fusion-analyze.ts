import "server-only";
import { objectCrops } from "./object-crops";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { DiscoveryRecord } from "../discovery";
import { SINGLE_CUE_INSTRUCTIONS, assessVisualCue } from "../single-cue-policy";
import { objectOutputSchema, singleObjectOutputSchema, objectFusionSchema, makeObjectCues } from "../grounding";

export async function reviewObjectsWithGpt(record:DiscoveryRecord,bytes:Buffer) {
  if(!record.grounding||!record.analysis)throw new Error("Missing detections");
  const model=process.env.OPENAI_MODEL?.trim(),apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!model||!apiKey)throw new Error("Missing API configuration");
  const client=new OpenAI({apiKey,timeout:120_000,maxRetries:0});
  const crops=await objectCrops(record,bytes);
  const content: Array<{type:"input_text";text:string}|{type:"input_image";image_url:string;detail:"high"}> = [];
  for (const crop of crops) {
    content.push({type:"input_text",text:JSON.stringify({detectionId:crop.id,detectorLabel:crop.label,originalBbox:crop.bbox,associationProposals:(record.grounding.detections.find(d=>d.id===crop.id)?.candidateIndexes??[]).map(index=>({index,observation:record.analysis!.modelOutput.candidates[index].observedCue})),instruction:"The next image is ONLY this ID's crop, with an ID header. Describe only this crop."})});
    content.push({type:"input_image",image_url:crop.imageUrl,detail:"high"});
  }
  const response=await client.responses.parse({model,store:false,max_output_tokens:16000,
    input:[{role:"developer",content:`${SINGLE_CUE_INSTRUCTIONS}
First verify that the requested detector label matches the visible object INSIDE its crop. A confident label is not proof. For a clear mismatch use not_useful with ruleId irrelevant and explain the mismatch. If the crop is ambiguous or incomplete use uncertain with ruleId unknown. Never reinterpret an incorrect detection as a useful different object.
Then describe concrete visible shape, materials or spatial arrangement. Words such as distinctive, unique or recognizable alone are not evidence. Never infer rarity, a brand, place identity or geographical usefulness from a generic object.
Only after verifying the object select a supported rule. Ordinary fixed structures use standard_fixed_structure and are background comparison material, not prominent location evidence. Generic portable objects without a visible contextual clue use irrelevant. Independently visible logos may be described without reading lettering; if identity is not visually established do not guess it.
Text-only meaning already belongs to OCR. Do not turn a plain text board frame into a distinctive structure merely to retain it.
Review each supplied Grounding DINO bbox crop independently. Each header is a software detection ID, not scene evidence. Match observations ONLY to that ID's crop; never borrow evidence from another crop.
Describe visible appearance before choosing a rule. If contents cannot be verified, use uncertain. The full scene is absent. Association proposals are untrusted observations, not verified evidence. Detector labels may be wrong; detection confidence is not risk.
Every supplied detection ID must occur exactly once. Each group MUST contain exactly one ID. Do not merge objects or invent coordinates. relatedCandidateIndexes may contain ONLY supplied associationProposals indexes whose concrete visible object matches this crop. These proposals are untrusted. Omit unsupported associations and use [] for mismatches/uncertainty. A matching object does not verify scene-wide spatial relations or repetition.
Text transcription belongs exclusively to OCR review. Do not transcribe or paraphrase lettering. A text-bearing sign/menu board may still have independent non-text shape, frame, mounting or fixed layout worth retaining. Assess only that appearance; if no independent observation is available, explain why instead of reading text.
Common fixed architecture may be useful indirect evidence for later comparison; do not reject it merely because it is generic. Portable objects do not identify a fixed venue. Record occlusion and reflections without inventing missing content.
For building facade crops, describe visible window grid, frame shape and repeated arrangement. A facade bbox is a pattern-support region, not the exact boundary of an individual window. State this distinction in interpretation.
Use Korean for category, interpretation, reason and uncertainty. Software derives boxes from detection IDs.`},
      {role:"user",content}],
    text:{format:zodTextFormat(singleObjectOutputSchema,"object_location_cue_review")}});
  if(response.status!=="completed"||!response.output_parsed)throw new Error("Incomplete GPT response");
  const output=objectOutputSchema.parse({groups:singleObjectOutputSchema.parse(response.output_parsed).groups.map(assessVisualCue)});
  if(output.groups.some(group=>group.detectionIds.length!==1||group.relatedCandidateIndexes.some(index=>!record.grounding!.detections.find(d=>d.id===group.detectionIds[0])?.candidateIndexes?.includes(index)))) throw new Error("Crop identity contract violated");
  return objectFusionSchema.parse({schemaVersion:1,promptVersion:"object-fusion-v6-guided",coordinateSpace:"analysis-normalized",analysisSha256:record.image.analysisSha256,
    requestedModel:model,responseModel:response.model,responseId:response.id,analyzedAt:new Date().toISOString(),usage:response.usage?{inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens}:null,
    skippedEmptyDetections:false,rawOutputText:response.output_text,modelOutput:output,cues:makeObjectCues(output,record.grounding,record.analysis.modelOutput.candidates.length)});
}
