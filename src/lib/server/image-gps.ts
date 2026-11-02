import "server-only";
import exifReader from "exif-reader";
import sharp from "sharp";
import { ImageGps } from "../image-gps";

function decimalDegrees(value: unknown, ref: unknown, limit: number, positive: string, negative: string): number | null {
  if (!Array.isArray(value) || value.length !== 3 || (ref !== positive && ref !== negative)) return null;
  if (!value.every((part) => typeof part === "number" && Number.isFinite(part) && part >= 0)) return null;
  const [degrees, minutes, seconds] = value as number[];
  if (minutes >= 60 || seconds >= 60) return null;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return decimal <= limit ? decimal * (ref === negative ? -1 : 1) : null;
}

export function parseExifGps(exif?: Buffer): ImageGps {
  if (!exif) return { status: "missing" };
  try {
    const gps = exifReader(exif).GPSInfo;
    if (!gps) return { status: "missing" };
    if (gps.GPSLatitude === undefined && gps.GPSLongitude === undefined) return { status: "missing" };
    // Google Maps uses WGS84. Do not silently treat a different datum as WGS84.
    if (gps.GPSStatus === "V" || (gps.GPSMapDatum && gps.GPSMapDatum.replace(/[\s-]/g, "").toUpperCase() !== "WGS84")) return { status: "invalid" };
    const latitude = decimalDegrees(gps.GPSLatitude, gps.GPSLatitudeRef, 90, "N", "S");
    const longitude = decimalDegrees(gps.GPSLongitude, gps.GPSLongitudeRef, 180, "E", "W");
    if (latitude === null || longitude === null) return { status: "invalid" };
    return { status: "found", latitude, longitude };
  } catch {
    return { status: "invalid" };
  }
}

export async function extractImageGps(bytes: Buffer): Promise<ImageGps> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    return parseExifGps(metadata.exif);
  } catch {
    // A malformed EXIF block must not stop an otherwise valid analysis upload.
    return { status: "invalid" };
  }
}
