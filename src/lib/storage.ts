import { DiscoveryRecord, discoveryRecordSchema, STORAGE_KEY, storedRecordsSchema } from "./discovery";

export function readRecords(): DiscoveryRecord[] {
  const text = localStorage.getItem(STORAGE_KEY);
  if (text === null) return [];
  const parsed = storedRecordsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("저장 기록 형식이 올바르지 않습니다. 기존 데이터를 덮어쓰지 않았습니다.");
  return parsed.data;
}

export function saveRecord(record: DiscoveryRecord): DiscoveryRecord[] {
  const valid = discoveryRecordSchema.parse(record);
  const records = readRecords();
  const next = storedRecordsSchema.parse([valid, ...records.filter((r) => r.recordId !== valid.recordId)]);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteRecord(recordId: string): DiscoveryRecord[] {
  const records = readRecords().filter((r) => r.recordId !== recordId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return records;
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
