import type { DiscoveryRecord } from "./discovery";

// Conservative display grouping only. This is not a spatial match or a model judgment.
export function matchingOcrText(record: DiscoveryRecord, observation: string): string[] {
  const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const target = normalize(observation);
  return [...new Set((record.ocr?.lines ?? []).filter(line => {
    const text = normalize(line.text);
    return text.length >= 4 && /\p{L}/u.test(text) && target.includes(text);
  }).map(line => line.text))];
}
