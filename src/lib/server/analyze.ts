import { SINGLE_CUE_INSTRUCTIONS, assessVisualCue } from "../single-cue-policy";
import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { singleModelOutputSchema, PROMPT_VERSION, analysisSchema, PreparedImage } from "../discovery";

const instructions = `${SINGLE_CUE_INSTRUCTIONS}
For repeated architectural patterns, describe concrete window/frame geometry and propose the enclosing building facade as well as windows. A facade region can support a pattern observation even when individual windows cannot be localized.
For each candidate return detectionKeywords: up to 3 short concrete English object phrases visible in this observation, suitable for Grounding DINO (e.g. circular ceiling light, pedestrian railing). Use [] for abstract observations without localizable objects. Do not include instructions, location guesses, or text transcription. These are search proposals, not verified boxes.
Discover non-text observations from the whole photo. Text transcription belongs exclusively to OCR review; do not read or paraphrase lettering, brand names in text or menu contents.
A text-bearing object's independent shape, mounting and surrounding fixed structure may be retained without using its text as evidence.
Do not claim EXIF/GPS exists: the input is pixels without metadata. List distinct visible cues with image-relative region descriptions. Keep generic fixed backgrounds for later comparison.
Use Korean for featureType, observedCue, regionDescription, modelReason and limitations. Return an empty candidates array when no defensible observation exists. Maximum 40 candidates.`;

export async function analyzeImage({ image, dataUrl }: PreparedImage) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_MODEL?.trim();
    if (!apiKey || !model) {
      throw new Error("OPENAI_API_KEY와 OPENAI_MODEL 설정을 확인해 주세요.");
    }
    const client = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 0 });
    const response = await client.responses.parse({
      model, store: false, max_output_tokens: 12000,
      input: [
        { role: "developer", content: instructions },
        { role: "user", content: [
          { type: "input_text", text: "Discover individual non-text cues in this photo. Retain indirect observations. Do not infer the actual shooting location or combine cues." },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ] },
      ],
      text: { format: zodTextFormat(singleModelOutputSchema, "location_cue_candidates") },
    });
    if (response.status !== "completed" || !response.output_parsed) {
      throw new Error("VLM 응답이 완료되지 않았습니다.");
    }
    const analysis = analysisSchema.parse({
      requestedModel: model, responseModel: response.model, responseId: response.id,
      analyzedAt: new Date().toISOString(), promptVersion: PROMPT_VERSION,
      analysisSha256: image.analysisSha256,
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null,
      modelOutput: {...response.output_parsed, candidates: response.output_parsed.candidates.map(assessVisualCue)}, rawOutputText: response.output_text,
    });
    return analysis;
}
