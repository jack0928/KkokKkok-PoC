import { z } from "zod";

// Kept outside discovery records and model inputs: this is original-file metadata.
export const imageGpsSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
  z.object({ status: z.enum(["missing", "invalid"]) }).strict(),
]);
export type ImageGps = z.infer<typeof imageGpsSchema>;

export function streetViewUrl(gps: Extract<ImageGps, { status: "found" }>): string {
  const params = new URLSearchParams({ api: "1", map_action: "pano", viewpoint: `${gps.latitude},${gps.longitude}` });
  return `https://www.google.com/maps/@?${params}`;
}
