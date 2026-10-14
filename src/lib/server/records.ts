import "server-only";
import { mkdirSync, rmSync, existsSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { DiscoveryRecord, discoveryRecordSchema, storedRecordsSchema, isReviewWritten, reviewStatus } from "../discovery";

export class RecordConflict extends Error {}

// Open lazily so build/prerender never creates an experiment database.
export function withDatabase<T>(operation: (db: DatabaseSync) => T): T {
  const path = resolve(process.env.SQLITE_PATH || "private-data/feature-discovery.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS discovery_records (
        record_id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL CHECK(json_valid(record_json)),
        thumbnail BLOB
      ) STRICT;`);
    if (!db.prepare("PRAGMA table_info(discovery_records)").all().some((column) => column.name === "thumbnail")) {
      db.exec("ALTER TABLE discovery_records ADD COLUMN thumbnail BLOB");
    }
    const columns = db.prepare("PRAGMA table_info(discovery_records)").all().map((column) => column.name);
    for (const column of ["original_path", "analysis_path", "job_status", "job_error"]) {
      if (!columns.includes(column)) db.exec(`ALTER TABLE discovery_records ADD COLUMN ${column} TEXT`);
    }
    db.exec("CREATE TABLE IF NOT EXISTS deletion_cleanup (path TEXT PRIMARY KEY) STRICT");
    transaction(db, () => {
      for (const row of db.prepare("SELECT original_path, analysis_path FROM discovery_records").all()) {
        for (const key of ["original_path", "analysis_path"]) {
          const file = row[key];
          if (typeof file === "string" && !existsSync(file) && existsSync(file + ".pending-delete")) renameSync(file + ".pending-delete", file);
        }
      }
      for (const row of db.prepare("SELECT path FROM deletion_cleanup").all()) {
        try { rmSync(String(row.path), { force: true }); db.prepare("DELETE FROM deletion_cleanup WHERE path = ?").run(row.path); } catch { /* Retry private trash cleanup on next DB access. */ }
      }
    });
    return operation(db);
  } finally { db.close(); }
}

export function allRecords(db: DatabaseSync): DiscoveryRecord[] {
  return storedRecordsSchema.parse(db.prepare("SELECT record_json FROM discovery_records ORDER BY updated_at DESC, record_id").all()
    .map((row) => JSON.parse(String(row.record_json))));
}

export function findRecord(db: DatabaseSync, id: string): DiscoveryRecord | null {
  const row = db.prepare("SELECT record_json FROM discovery_records WHERE record_id = ?").get(id);
  return row ? discoveryRecordSchema.parse(JSON.parse(String(row.record_json))) : null;
}

export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listRecords(): DiscoveryRecord[] { return withDatabase(allRecords); }

export function listResults() {
  return withDatabase((db) => ({ records: allRecords(db), jobs: Object.fromEntries(db.prepare("SELECT record_id, job_status, job_error, original_path FROM discovery_records").all().map((row) => [String(row.record_id), { status: row.job_status ?? "legacy", error: row.job_error ?? null, hasOriginal: !!row.original_path }])), thumbnails: Object.fromEntries(
    db.prepare("SELECT record_id, thumbnail FROM discovery_records WHERE thumbnail IS NOT NULL").all()
      .map((row) => [String(row.record_id), `data:image/jpeg;base64,${Buffer.from(row.thumbnail as Uint8Array).toString("base64")}`]),
  ) }));
}

export function persistRecord(input: DiscoveryRecord, expectedUpdatedAt: string | null, thumbnail: Buffer | null = null): DiscoveryRecord[] {
  const record = discoveryRecordSchema.parse(input);
  return withDatabase((db) => transaction(db, () => {
    const job = db.prepare("SELECT job_status FROM discovery_records WHERE record_id = ?").get(record.recordId);
    if (job?.job_status === "queued" || job?.job_status === "analyzing") throw new RecordConflict("분석 완료 후 검토해 주세요.");
    const existing = findRecord(db, record.recordId);
    if ((existing?.updatedAt ?? null) !== expectedUpdatedAt) {
      throw new RecordConflict("다른 화면에서 기록이 변경되었거나 삭제되었습니다. 현재 내용을 JSON Export한 뒤 페이지를 새로고침해 주세요.");
    }
    if (existing && (existing.createdAt !== record.createdAt || !isDeepStrictEqual(existing.image, record.image)
      || (existing.analysis !== null && !isDeepStrictEqual(existing.analysis, record.analysis)))) {
      throw new RecordConflict("이미지 정보와 저장된 모델 원본은 변경할 수 없습니다. 재분석은 새 실험으로 진행해 주세요.");
    }
    const saved = { ...record, updatedAt: new Date(Math.max(Date.now(), Date.parse(existing?.updatedAt ?? record.updatedAt) + 1)).toISOString() };
    db.prepare(`INSERT INTO discovery_records (record_id, updated_at, record_json) VALUES (?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET updated_at = excluded.updated_at, record_json = excluded.record_json`)
      .run(saved.recordId, saved.updatedAt, JSON.stringify(saved));
    if (thumbnail) db.prepare("UPDATE discovery_records SET thumbnail = ? WHERE record_id = ? AND thumbnail IS NULL").run(thumbnail, saved.recordId);
    return allRecords(db);
  }));
}

export function removeRecord(id: string, expectedUpdatedAt: string): DiscoveryRecord[] {
  return withDatabase((db) => {
    const moved: { original: string; staged: string }[] = [];
    let remaining: DiscoveryRecord[];
    try {
      remaining = transaction(db, () => {
        const job = db.prepare("SELECT job_status FROM discovery_records WHERE record_id = ?").get(id);
        if (job?.job_status === "analyzing") throw new RecordConflict("분석 중인 기록은 완료 후 삭제해 주세요.");
        const existing = findRecord(db, id);
        if (!existing || existing.updatedAt !== expectedUpdatedAt) throw new RecordConflict("기록이 변경되었거나 삭제되었습니다. 페이지를 새로고침해 주세요.");
        const files = db.prepare("SELECT original_path, analysis_path FROM discovery_records WHERE record_id = ?").get(id);
        const paths = [files?.original_path, files?.analysis_path].filter((file): file is string => typeof file === "string" && existsSync(file));
        for (const file of paths) {
          if (!statSync(file).isFile() || existsSync(file + ".pending-delete")) throw new Error("Cannot stage file deletion");
        }
        for (const original of paths) {
          const staged = original + ".pending-delete";
          renameSync(original, staged); moved.push({ original, staged });
          db.prepare("INSERT INTO deletion_cleanup(path) VALUES (?)").run(staged);
        }
        db.prepare("DELETE FROM discovery_records WHERE record_id = ?").run(id);
        return allRecords(db);
      });
    } catch (error) {
      for (const file of moved.reverse()) if (existsSync(file.staged)) renameSync(file.staged, file.original);
      throw error;
    }
    for (const file of moved) {
      try { rmSync(file.staged, { force: true }); db.prepare("DELETE FROM deletion_cleanup WHERE path = ?").run(file.staged); } catch { /* Durable cleanup entries are retried on next access. */ }
    }
    return remaining;
  });
}

export function listSummaries() {
  return withDatabase((db) => allRecords(db).map((record) => {
    const row = db.prepare("SELECT job_status, job_error, original_path, thumbnail IS NOT NULL AS has_thumbnail FROM discovery_records WHERE record_id = ?").get(record.recordId)!;
    return { recordId: record.recordId, image: record.image, createdAt: record.createdAt, updatedAt: record.updatedAt,
      hasAnalysis: !!record.analysis, featureCount: record.humanReviews.length, reviewedCount: record.humanReviews.filter(isReviewWritten).length,
      reviewStatus: reviewStatus(record), featureTypes: [...new Set(record.humanReviews.map((item) => item.featureType).filter(Boolean))].slice(0, 4),
      model: record.analysis?.responseModel ?? null, job: { status: row.job_status ?? "legacy", error: row.job_error ?? null, hasOriginal: !!row.original_path }, hasThumbnail: !!row.has_thumbnail };
  }));
}

export function recordDetail(id: string) {
  return withDatabase((db) => {
    const record = findRecord(db, id);
    if (!record) return null;
    const row = db.prepare("SELECT job_status, job_error, original_path, thumbnail FROM discovery_records WHERE record_id = ?").get(id)!;
    const next = db.prepare("SELECT record_id FROM discovery_records WHERE record_id != ? AND json_type(record_json, '$.analysis') = 'object' AND json_extract(record_json, '$.reviewCompletedAt') IS NULL ORDER BY json_extract(record_json, '$.createdAt'), record_id LIMIT 1").get(id);
    return { record, job: { status: row.job_status ?? "legacy", error: row.job_error ?? null, hasOriginal: !!row.original_path },
      thumbnailDataUrl: row.thumbnail ? `data:image/jpeg;base64,${Buffer.from(row.thumbnail as Uint8Array).toString("base64")}` : null, nextId: next ? String(next.record_id) : null };
  });
}

export function storedThumbnail(id: string) {
  return withDatabase((db) => {
    const row = db.prepare("SELECT thumbnail FROM discovery_records WHERE record_id = ?").get(id);
    return row?.thumbnail ? Buffer.from(row.thumbnail as Uint8Array) : null;
  });
}

export function migrateRecords(input: DiscoveryRecord[]): DiscoveryRecord[] {
  const records = storedRecordsSchema.parse(input);
  return withDatabase((db) => transaction(db, () => {
    for (const record of records) {
      const existing = findRecord(db, record.recordId);
      if (existing) {
        // Allow retries, but never replace a DB review with an older browser copy.
        const withoutTime = (item: DiscoveryRecord) => ({ ...item, updatedAt: "" });
        if (!isDeepStrictEqual(withoutTime(existing), withoutTime(record))) {
          throw new RecordConflict("같은 ID의 다른 기록이 DB에 있습니다. 기존 브라우저 기록을 JSON Export해 별도로 보존해 주세요. 기록을 옮기지 않았습니다.");
        }
        continue;
      }
      db.prepare("INSERT INTO discovery_records (record_id, updated_at, record_json) VALUES (?, ?, ?)")
        .run(record.recordId, record.updatedAt, JSON.stringify(record));
    }
    return allRecords(db);
  }));
}
