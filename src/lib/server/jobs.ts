import "server-only";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { applyAnalysis, newRecord, DiscoveryRecord } from "../discovery";
import { analyzeImage } from "./analyze";
import { prepareImage, sha256 } from "./image";
import { allRecords, findRecord, RecordConflict, transaction, withDatabase } from "./records";

function imageRoot() { return resolve(process.env.IMAGE_STORAGE_PATH || "private-data/images"); }

export async function enqueueImage(bytes: Buffer, requestId?: string): Promise<DiscoveryRecord> {
  if (requestId) {
    const existing = withDatabase((db) => findRecord(db, requestId));
    if (existing) {
      if (existing.image.originalSha256 !== sha256(bytes)) throw new RecordConflict("같은 업로드 요청에 다른 이미지를 사용할 수 없습니다.");
      return existing;
    }
  }
  const prepared = await prepareImage(bytes);
  const record = newRecord(prepared.image);
  if (requestId) record.recordId = requestId;
  mkdirSync(imageRoot(), { recursive: true, mode: 0o700 });
  const originalPath = join(imageRoot(), `${record.recordId}.original`);
  const analysisPath = join(imageRoot(), `${record.recordId}.jpeg`);
  let wroteOriginal = false;
  let wroteAnalysis = false;
  try {
    writeFileSync(originalPath, bytes, { flag: "wx", mode: 0o600 });
    wroteOriginal = true;
    writeFileSync(analysisPath, Buffer.from(prepared.dataUrl.split(",")[1], "base64"), { flag: "wx", mode: 0o600 });
    wroteAnalysis = true;
    withDatabase((db) => db.prepare(`INSERT INTO discovery_records
      (record_id, updated_at, record_json, thumbnail, original_path, analysis_path, job_status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')`).run(record.recordId, record.updatedAt, JSON.stringify(record),
        Buffer.from(prepared.thumbnailDataUrl!.split(",")[1], "base64"), originalPath, analysisPath));
    return record;
  } catch (error) {
    // A concurrent retry may own these files. Clean up only files we created.
    if (wroteOriginal) rmSync(originalPath, { force: true });
    if (wroteAnalysis) rmSync(analysisPath, { force: true });
    if (requestId && !wroteOriginal) {
      const existing = withDatabase((db) => findRecord(db, requestId));
      if (existing && existing.image.originalSha256 === sha256(bytes)) return existing;
    }
    throw error;
  }
}

export function recoverInterruptedJobs() {
  withDatabase((db) => db.prepare("UPDATE discovery_records SET job_status = 'failed', job_error = ? WHERE job_status = 'analyzing'")
    .run("로컬 작업 프로세스가 중단되었습니다. 비용이 발생했을 수 있으므로 확인 후 직접 재시도해 주세요."));
}

export function retryJob(id: string) {
  return withDatabase((db) => transaction(db, () => {
    const row = db.prepare("SELECT job_status, analysis_path FROM discovery_records WHERE record_id = ?").get(id);
    const record = findRecord(db, id);
    if (!record || record.analysis || !row?.analysis_path || row.job_status !== "failed") throw new RecordConflict("실패한 분석만 재시도할 수 있습니다.");
    db.prepare("UPDATE discovery_records SET job_status = 'queued', job_error = NULL WHERE record_id = ?").run(id);
    return allRecords(db);
  }));
}

export async function processNextJob(): Promise<boolean> {
  const job = withDatabase((db) => transaction(db, () => {
    const row = db.prepare("SELECT record_id, analysis_path FROM discovery_records WHERE job_status = 'queued' ORDER BY updated_at, record_id LIMIT 1").get();
    if (!row) return null;
    db.prepare("UPDATE discovery_records SET job_status = 'analyzing', job_error = NULL WHERE record_id = ?").run(row.record_id);
    return { id: String(row.record_id), path: String(row.analysis_path), record: findRecord(db, String(row.record_id))! };
  }));
  if (!job) return false;
  try {
    const bytes = readFileSync(job.path);
    if (sha256(bytes) !== job.record.image.analysisSha256) throw new Error("Invalid saved image");
    const analysis = await analyzeImage({ image: job.record.image, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` });
    withDatabase((db) => transaction(db, () => {
      const current = findRecord(db, job.id);
      if (!current || current.analysis) throw new RecordConflict("이미 분석되었거나 삭제된 기록입니다.");
      const next = applyAnalysis(current, analysis);
      db.prepare("UPDATE discovery_records SET record_json = ?, updated_at = ?, job_status = 'completed', job_error = NULL WHERE record_id = ?")
        .run(JSON.stringify(next), next.updatedAt, job.id);
    }));
  } catch (error) {
    const message = error instanceof OpenAI.APIError && error.status === 429 ? "API 사용량 또는 요청 한도에 도달했습니다. 확인 후 재시도해 주세요."
      : error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403) ? "API 인증 또는 모델 접근 권한을 확인해 주세요."
      : "분석에 실패했습니다. 모델·API 설정과 저장된 이미지 파일을 확인하고 직접 재시도해 주세요.";
    withDatabase((db) => db.prepare("UPDATE discovery_records SET job_status = 'failed', job_error = ? WHERE record_id = ?").run(message, job.id));
  }
  return true;
}

export function storedImage(id: string, kind: "original" | "analysis") {
  return withDatabase((db) => {
    const row = db.prepare("SELECT original_path, analysis_path FROM discovery_records WHERE record_id = ?").get(id);
    const path = row?.[kind === "original" ? "original_path" : "analysis_path"];
    if (typeof path !== "string") return null;
    const record = findRecord(db, id)!;
    const bytes = readFileSync(path);
    if (sha256(bytes) !== (kind === "original" ? record.image.originalSha256 : record.image.analysisSha256)) throw new Error("Invalid image hash");
    return bytes;
  });
}

export async function attachOriginal(id: string, bytes: Buffer, expectedUpdatedAt: string) {
  const existing = withDatabase((db) => findRecord(db, id));
  if (!existing || sha256(bytes) !== existing.image.originalSha256) throw new RecordConflict("같은 원본 이미지만 연결할 수 있습니다.");
  const prepared = await prepareImage(bytes);
  if (prepared.image.analysisSha256 !== existing.image.analysisSha256) throw new RecordConflict("분석 이미지 hash가 다릅니다.");
  mkdirSync(imageRoot(), { recursive: true, mode: 0o700 });
  return withDatabase((db) => transaction(db, () => {
    const record = findRecord(db, id);
    if (!record || record.updatedAt !== expectedUpdatedAt) throw new RecordConflict("기록이 변경되었습니다. 새로고침해 주세요.");
    const row = db.prepare("SELECT original_path FROM discovery_records WHERE record_id = ?").get(id);
    if (row?.original_path) throw new RecordConflict("이미 원본이 저장되어 있습니다.");
    const originalPath = join(imageRoot(), `${id}.original`);
    const analysisPath = join(imageRoot(), `${id}.jpeg`);
    try {
      writeFileSync(originalPath, bytes, { flag: "wx", mode: 0o600 });
      writeFileSync(analysisPath, Buffer.from(prepared.dataUrl.split(",")[1], "base64"), { flag: "wx", mode: 0o600 });
      db.prepare("UPDATE discovery_records SET original_path = ?, analysis_path = ?, job_status = ? WHERE record_id = ?")
        .run(originalPath, analysisPath, record.analysis ? "completed" : "failed", id);
    } catch (error) { rmSync(originalPath, { force: true }); rmSync(analysisPath, { force: true }); throw error; }
  }));
}
