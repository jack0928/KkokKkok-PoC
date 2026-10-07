import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, PreparedImage } from "@/lib/discovery";

export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readLimitedBody(request: Request, maximum: number): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maximum) throw new InputError("파일 또는 요청 크기가 제한을 초과했습니다.", 413);
  if (!request.body) throw new InputError("이미지가 필요합니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new InputError("파일 또는 요청 크기가 제한을 초과했습니다.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function prepareImage(bytes: Buffer): Promise<PreparedImage> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new InputError("1 byte ~ 10 MB 이미지를 선택해 주세요.", 413);
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new InputError("정지 이미지 JPEG, PNG, WebP만 지원합니다.");
    }
    const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
    return { image: { imageId: randomUUID(), originalSha256: sha256(bytes), analysisSha256: sha256(data),
      width: info.width, height: info.height, mimeType: "image/jpeg",
      preprocessing: "auto-rotate; max-edge=2048; jpeg-quality=95; metadata-stripped; white-background" },
      dataUrl: `data:image/jpeg;base64,${data.toString("base64")}` };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("이미지를 읽을 수 없습니다. 손상된 파일이나 4,000만 픽셀을 넘는 이미지는 사용할 수 없습니다.");
  }
}
