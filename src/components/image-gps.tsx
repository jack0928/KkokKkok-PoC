"use client";

import { useState } from "react";
import { ImageGps as Gps, imageGpsSchema, streetViewUrl } from "@/lib/image-gps";

export function ImageGps({ recordId, initialGps }: { recordId: string; initialGps?: Gps }) {
  const [gps, setGps] = useState<Gps | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = gps ?? initialGps;

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/discovery-gps/${recordId}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "GPS 조회 실패");
      setGps(imageGpsSchema.parse(body.gps));
    } catch (error) { setError(error instanceof Error ? error.message : "GPS 조회 실패"); }
    finally { setLoading(false); }
  }

  return <div className="image-gps">
    <strong>원본 EXIF GPS</strong>
    {!current && <p><button className="button secondary small" type="button" disabled={loading} onClick={load}>{loading ? "GPS 읽는 중…" : "GPS 확인"}</button></p>}
    {current?.status === "found" && <>
      <label>위도, 경도<input readOnly aria-label="EXIF 위도, 경도" value={`${current.latitude},${current.longitude}`} onFocus={(event) => event.currentTarget.select()} /></label>
      <a className="button secondary small" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" href={streetViewUrl(current)}>Google Street View 열기</a>
      <p className="caption">버튼을 누르면 좌표가 Google에 전달됩니다. 주변 파노라마가 열리며, 해당 위치에 Street View가 없을 수 있습니다.</p>
    </>}
    {current?.status === "missing" && <p className="caption">GPS 정보 없음 · 위치 태그가 포함된 원본 사진이 필요합니다. 메신저나 편집 과정에서 GPS가 제거되었을 수 있습니다.</p>}
    {current?.status === "invalid" && <p className="caption">GPS 정보를 사용할 수 없습니다. 좌표가 손상되었거나 지원하지 않는 형식·좌표계입니다.</p>}
    {error && <p role="alert">{error}</p>}
    <p className="caption">사진 파일에 기록된 값이며 실제 촬영 위치를 검증한 결과가 아닙니다. GPT 입력·Feature 위험도 평가에는 사용하지 않습니다.</p>
  </div>;
}
