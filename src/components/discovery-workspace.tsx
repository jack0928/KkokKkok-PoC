"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, DiscoveryRecord, JobInfo } from "@/lib/discovery";
import { readResults } from "@/lib/storage";
import { UploadPreview } from "./upload-preview";

const labels: Record<JobInfo["status"], string> = { queued: "분석 대기", analyzing: "분석 중", completed: "분석 완료 · 검토 가능", failed: "분석 실패", legacy: "기존 기록" };

export function DiscoveryWorkspace() {
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const uploadIds = useRef(new WeakMap<File, string>());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await readResults();
        if (!cancelled) { setRecords(data.records); setJobs(data.jobs); }
      } catch { if (!cancelled) setError("진행 상태를 읽지 못했습니다. 서버와 DB 설정을 확인해 주세요."); }
      if (!cancelled) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  function select(input: FileList | null) {
    if (!input) return;
    const selected = Array.from(input);
    if (selected.length > 20) { setError("한 번에 최대 20장을 선택해 주세요."); return; }
    if (selected.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES)) {
      setError("각 이미지가 JPEG·PNG·WebP 형식이며 10 MB 이하인지 확인해 주세요."); return;
    }
    for (const file of selected) uploadIds.current.set(file, crypto.randomUUID());
    setFiles(selected); setFailedFiles([]); setConsent(false); setError(""); setNotice("");
  }

  async function submit() {
    if (!files.length || !consent || uploading) return;
    setUploading(true); setError(""); setNotice("");
    const failed: File[] = [];
    let registered = 0;
    for (const file of files) {
      try {
        const response = await fetch("/api/analysis-jobs", { method: "POST", headers: { "Content-Type": file.type, "X-Analysis-Consent": "true", "X-Upload-ID": uploadIds.current.get(file)! }, body: file });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "등록 실패");
        registered++;
      } catch { failed.push(file); }
    }
    setFiles(failed); setFailedFiles(failed); setUploading(false);
    setNotice(`${registered}장을 분석 대기에 등록했습니다. 등록된 이미지는 페이지를 닫아도 로컬 작업 프로세스가 순차 분석합니다.`);
    if (failed.length) setError(`${failed.length}장을 등록하지 못했습니다. 아래 파일을 확인하고 등록을 다시 시도해 주세요.`);
  }

  async function retry(id: string) {
    if (!window.confirm("분석을 다시 요청하면 API 비용이 발생할 수 있습니다. 재시도할까요?")) return;
    try {
      const response = await fetch(`/api/analysis-jobs?action=retry&record=${id}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice("재시도를 요청했습니다."); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "재시도에 실패했습니다."); }
  }

  return <>
    <div className="page-heading"><div><h1>Feature Discovery · 이미지 분석</h1><p>여러 장을 먼저 분석하고, 사람 검토 페이지에서 하나씩 피드백합니다.</p></div><Link className="button secondary" href="/results">결과·검토 목록</Link></div>
    <section className="discovery-guide"><h2>이 테스트의 목적</h2><p>AI의 후보와 사람의 검토를 비교해 유의미한 위치 단서와 판단 기준을 정리합니다. AI의 제안은 정답이 아니며 실제 촬영 위치는 추론하지 않습니다.</p></section>
    <section className="panel">
      <div className="panel-heading"><h2>분석할 이미지 선택</h2><span className="subtle">최대 20장 · 장당 10 MB</span></div>
      <label>JPEG·PNG·WebP 이미지<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { select(event.target.files); event.target.value = ""; }} /></label>
      <p className="caption">선택만으로는 저장하거나 분석하지 않습니다. 요청 시 원본과 메타데이터를 제거한 분석본을 비공개 로컬 폴더에 보관합니다. AI에는 분석본만 전송합니다.</p>
      {!!files.length && <ul className="upload-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><UploadPreview file={file} /><div>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB <button type="button" className="button ghost small" disabled={uploading} onClick={() => setFiles((current) => current.filter((_, position) => index !== position))}>선택 취소</button></div></li>)}</ul>}
      <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={uploading} onChange={(event) => setConsent(event.target.checked)} />사용 권한이 있는 이미지이며, 원본의 로컬 보관과 OpenAI 전송·API 비용 발생에 동의합니다.</label>
      <button type="button" className="button primary" disabled={uploading || !consent || !files.length} onClick={submit}>{uploading ? "이미지 등록 중…" : failedFiles.length ? "등록 실패 이미지 다시 요청" : `선택 이미지 ${files.length}장 분석 시작`}</button>
      <p className="caption">로컬 서버와 작업 프로세스가 켜져 있어야 합니다. 업로드가 끝날 때까지는 페이지를 열어두세요. 실패한 분석은 자동 재시도하지 않습니다.</p>
    </section>
    <div className="messages" aria-live="polite">{error && <p role="alert" className="message error">{error}</p>}{notice && <p className="message success">{notice}</p>}</div>
    <section className="saved-section"><div className="panel-heading"><h2>분석 진행 상황</h2></div><div className="saved-list">{records.map((record) => <article className="saved-record" key={record.recordId}><div><strong>이미지 {record.image.imageId.slice(0, 8)}</strong><p><span className={`status-badge status-${record.analysis ? "unreviewed" : jobs[record.recordId]?.status ?? "legacy"}`}>{record.analysis ? "분석 완료 · 검토 가능" : labels[jobs[record.recordId]?.status ?? "legacy"]}</span></p>{jobs[record.recordId]?.error && <p>{jobs[record.recordId].error}</p>}</div>{record.analysis ? <Link className="button secondary small" href={`/review/${record.recordId}`}>사람 검토</Link> : jobs[record.recordId]?.status === "failed" && jobs[record.recordId]?.hasOriginal ? <button className="button secondary small" onClick={() => retry(record.recordId)}>분석 재시도</button> : null}</article>)}</div>{!records.length && <p className="caption">등록된 분석이 없습니다.</p>}</section>
  </>;
}
