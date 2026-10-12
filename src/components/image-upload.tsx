"use client";

import { useRef } from "react";

type Props = {
  preview: string | null;
  disabled: boolean;
  attachedRecord: boolean;
  dimensions?: string;
  onSelect: (file: File) => void;
};

export function ImageUpload({ preview, disabled, attachedRecord, dimensions, onSelect }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={input} id="image-upload" className="visually-hidden" type="file" tabIndex={-1} accept="image/jpeg,image/png,image/webp" disabled={disabled}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onSelect(file); }} />
      {preview ? (
        <div className="preview-area">
          {/* Data URL stays in browser memory. No remote image optimization or persistence. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="분석에 사용되는 업로드 이미지" />
          <span className="preview-caption">분석 이미지 · {dimensions}</span>
        </div>
      ) : (
        <button type="button" className="upload-zone" disabled={disabled} onClick={() => input.current?.click()}>
          <strong>{attachedRecord ? "같은 이미지 다시 연결" : "테스트 이미지 선택"}</strong>
          <span>{attachedRecord ? "저장된 원본 hash와 비교합니다" : "JPEG, PNG, WebP · 최대 10 MB"}</span>
          <span className="upload-label">파일 찾아보기</span>
        </button>
      )}
      <p className="caption">원본·분석본은 저장하지 않습니다. 방향·크기를 정리하고 메타데이터를 제거한 Preview를 VLM에 전달합니다.</p>
    </div>
  );
}
