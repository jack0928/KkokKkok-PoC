import "server-only";
import { InputError } from "./image";

export function checkRequest(request: Request) {
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

/** Internal authenticated analysis routes only; the experimental UI remains loopback-only. */
export function checkAnalysisRequest(request: Request) {
  try { checkRequest(request); return; } catch (error) {
    if (!(error instanceof InputError)) throw error;
  }
  const allowed = (process.env.ANALYSIS_API_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const host = request.headers.get("host")?.toLowerCase();
  if (!host || !allowed.includes(host) || request.headers.has("origin")
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "none")) {
    throw new InputError("허용된 내부 분석 서버에서만 접근할 수 있습니다.", 403);
  }
}
