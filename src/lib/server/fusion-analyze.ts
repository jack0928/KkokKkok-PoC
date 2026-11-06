import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { DiscoveryRecord } from "../discovery";
import { OCR_REVIEW_INSTRUCTIONS } from "../ocr-cue-policy";
import { boundsForLines, validateOcrGroups, structuredOcrOutputSchema, makeFusionCues, fusionSchema, FUSION_PROMPT_VERSION } from "../fusion";

const instructions = OCR_REVIEW_INSTRUCTIONS;

export async function reviewOcrWithGpt(record: DiscoveryRecord, bytes: Buffer) {
  if (!record.ocr || !record.analysis) throw new Error("Missing analysis");
  const model=process.env.OPENAI_MODEL?.trim();
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !model) throw new Error("Missing API configuration");
  // Only model observations are sent. Human labels, notes and edited boxes stay local.
  const evidence={coordinateSpace:record.ocr.coordinateSpace, imageSize:{width:record.image.width,height:record.image.height},
    ocr:record.ocr.lines.map(line=>({...line,bbox:boundsForLines(record.ocr!,[line.id])}))};
  const client=new OpenAI({apiKey,timeout:120_000,maxRetries:0});
  const response=await client.responses.parse({model,store:false,max_output_tokens:16000,
    input:[{role:"developer",content:instructions},{role:"user",content:[
      {type:"input_text",text:JSON.stringify(evidence)},
      {type:"input_image",image_url:`data:image/jpeg;base64,${bytes.toString("base64")}`,detail:"high"},
    ]}],text:{format:zodTextFormat(structuredOcrOutputSchema,"ocr_location_cue_review")}});
  if(response.status!=="completed" || !response.output_parsed) throw new Error("Incomplete GPT review");
  const parsed=structuredOcrOutputSchema.parse(response.output_parsed);
  const output=validateOcrGroups(parsed,record.ocr);
  return fusionSchema.parse({schemaVersion:1,promptVersion:FUSION_PROMPT_VERSION,coordinateSpace:"analysis-normalized",
    analysisSha256:record.image.analysisSha256,requestedModel:model,responseModel:response.model,responseId:response.id,
    analyzedAt:new Date().toISOString(),usage:response.usage?{inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens}:null,
    lineChecks:parsed.lineChecks,skippedEmptyOcr:false,rawOutputText:response.output_text,modelOutput:output,cues:makeFusionCues(output,record.ocr,record.analysis.modelOutput.candidates.length)});
}
