import { z } from "zod";
import sharp from "sharp";
import { discoveryRecordSchema, storedRecordsSchema } from "@/lib/discovery";
import { InputError, readLimitedBody } from "@/lib/server/image";
import { listRecords, listResults, migrateRecords, persistRecord, RecordConflict, removeRecord } from "@/lib/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), record: discoveryRecordSchema, expectedUpdatedAt: z.string().datetime().nullable(), thumbnailDataUrl: z.string().max(200000).nullable().optional() }).strict(),
  z.object({ action: z.literal("migrate"), records: storedRecordsSchema }).strict(),
]);
const deleteSchema = z.object({ recordId: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }).strict();

function checkRequest(request: Request) {
  // Next.js may normalize request.url to localhost even when the browser uses
  // 127.0.0.1. Compare Origin with the actual HTTP Host, not that internal URL.
  const host = request.headers.get("host");
  let url: URL;
  let source: URL | null;
  const origin = request.headers.get("origin");
  try {
    if (!host) throw new Error("Missing host");
    url = new URL(`http://${host}`);
    source = origin ? new URL(origin) : null;
  } catch { throw new InputError("로컬 테스트 페이지에서만 기록에 접근할 수 있습니다.", 403); }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || (source && (!["http:", "https:"].includes(source.protocol) || source.host !== url.host))
    || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new InputError("로컬 테스트 페이지에서만 기록에 접근할 수 있습니다.", 403);
  }
}

async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new InputError("JSON 요청이 필요합니다.", 415);
  const body = await readLimitedBody(request, 50 * 1024 * 1024);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new InputError("올바른 JSON 요청이 필요합니다."); }
}

function result(records: unknown) { return Response.json({ records }, { headers: { "Cache-Control": "no-store" } }); }

async function thumbnailBytes(dataUrl: string | null | undefined) {
  if (!dataUrl) return null;
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new InputError("미리보기 이미지 형식이 올바르지 않습니다.");
  try {
    const bytes = Buffer.from(dataUrl.slice("data:image/jpeg;base64,".length), "base64");
    const image = sharp(bytes, { limitInputPixels: 480 * 480 });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width > 480 || metadata.height > 480) throw new Error("Invalid thumbnail");
    // Re-encode only this small preview; never persist analysis/original bytes or metadata.
    return await image.jpeg({ quality: 65 }).toBuffer();
  } catch { throw new InputError("최대 480px의 JPEG 미리보기만 저장할 수 있습니다."); }
}
function failure(error: unknown) {
  if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof RecordConflict) return Response.json({ error: error.message }, { status: 409 });
  // Never expose DB contents, local paths, or the original exception in logs/responses.
  return Response.json({ error: "로컬 DB 작업에 실패했습니다. 저장 경로와 파일 권한을 확인해 주세요. 현재 결과는 JSON Export로 보존할 수 있습니다." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    checkRequest(request);
    if (new URL(request.url).searchParams.get("thumbnails") === "1") return Response.json(listResults(), { headers: { "Cache-Control": "no-store" } });
    return result(listRecords());
  }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    checkRequest(request);
    const parsed = saveSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new InputError("실험 기록 형식이 올바르지 않습니다.");
    return result(parsed.data.action === "save"
      ? persistRecord(parsed.data.record, parsed.data.expectedUpdatedAt, await thumbnailBytes(parsed.data.thumbnailDataUrl)) : migrateRecords(parsed.data.records));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    checkRequest(request);
    const parsed = deleteSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new InputError("삭제할 기록 형식이 올바르지 않습니다.");
    return result(removeRecord(parsed.data.recordId, parsed.data.expectedUpdatedAt));
  } catch (error) { return failure(error); }
}
