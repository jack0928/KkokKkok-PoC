import { DiscoveryRecord, discoveryRecordSchema, STORAGE_KEY, storedRecordsSchema, resultsSchema } from "./discovery";

async function recordsRequest(method: string, body?: unknown): Promise<DiscoveryRecord[]> {
  const response = await fetch("/api/discovery-records", {
    method, cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "로컬 DB 요청에 실패했습니다.");
  return storedRecordsSchema.parse(json.records);
}

export function readRecords(): Promise<DiscoveryRecord[]> { return recordsRequest("GET"); }

export function saveRecord(record: DiscoveryRecord, expectedUpdatedAt: string | null, thumbnailDataUrl: string | null): Promise<DiscoveryRecord[]> {
  return recordsRequest("POST", { action: "save", record: discoveryRecordSchema.parse(record), expectedUpdatedAt, thumbnailDataUrl });
}

export async function readResults() {
  const response = await fetch("/api/discovery-records?thumbnails=1", { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error("저장된 결과를 읽지 못했습니다.");
  return resultsSchema.parse(json);
}

export function deleteRecord(recordId: string, expectedUpdatedAt: string): Promise<DiscoveryRecord[]> {
  return recordsRequest("DELETE", { recordId, expectedUpdatedAt });
}

// Legacy storage is read only; transfer never deletes or overwrites browser copies.
export function readBrowserRecords(): DiscoveryRecord[] {
  const text = localStorage.getItem(STORAGE_KEY);
  if (text === null) return [];
  const parsed = storedRecordsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("기존 브라우저 기록 형식이 올바르지 않습니다. 원본 기록은 유지했습니다.");
  return parsed.data;
}

export function migrateBrowserRecords(records: DiscoveryRecord[]): Promise<DiscoveryRecord[]> {
  return recordsRequest("POST", { action: "migrate", records: storedRecordsSchema.parse(records) });
}

export function exportRecords(records: DiscoveryRecord[]): void {
  const validated = storedRecordsSchema.parse(records);
  const payload = { schemaVersion: 1, experiment: "feature-discovery", exportedAt: new Date().toISOString(), records: validated };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `feature-discovery-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
