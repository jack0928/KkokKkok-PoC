"use client";

import { useEffect, useState } from "react";
import { DiscoveryRecord } from "@/lib/discovery";
import { exportRecords, migrateBrowserRecords, readBrowserRecords } from "@/lib/storage";

export function LegacyRecords({ onMigrated }: { onMigrated: () => Promise<void> }) {
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Legacy storage can only be read in the browser after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setRecords(readBrowserRecords()); } catch { setError("기존 브라우저 기록을 읽지 못했습니다. 기존 데이터는 유지했습니다."); }
  }, []);
  if (!records.length && !error) return null;
  return <section className="panel legacy-records"><h2>기존 브라우저 기록 {records.length}개</h2><p className="caption">로컬 DB로 옮겨 별도 검토 페이지에서 확인할 수 있습니다. 브라우저 원본은 그대로 남습니다.</p>{error && <p role="alert">{error}</p>}<div className="record-actions"><button className="button secondary" disabled={busy || !records.length} onClick={() => exportRecords(records)}>기존 기록 JSON Export</button><button className="button secondary" disabled={busy || !records.length} onClick={async () => {
    setBusy(true);
    try { await migrateBrowserRecords(records); setRecords([]); setError(""); await onMigrated(); }
    catch (error) { setError(error instanceof Error ? error.message : "기록을 옮기지 못했습니다."); }
    finally { setBusy(false); }
  }}>로컬 DB로 옮기기</button></div></section>;
}
