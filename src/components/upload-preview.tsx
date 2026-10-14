"use client";

import { useEffect, useState } from "react";

export function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // The URL is owned by this effect and released when a file is removed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="upload-preview" src={url} alt="선택한 이미지 미리보기" /> : null;
}
