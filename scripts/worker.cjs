/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CommonJS worker entrypoint. */
// Local development worker. Compile server TS in memory without writing private data to build artifacts.
const fs = require("node:fs");
const path = require("node:path");
require("@next/env").loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
require("./register-server.cjs");
const dbPath = path.resolve(process.env.SQLITE_PATH || "private-data/feature-discovery.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const lockPath = dbPath + ".worker.lock";
function acquireLock() {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(fs.readFileSync(lockPath, "utf8"));
    let active = false;
    if (Number.isInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); active = true; } catch (failure) { if (failure.code !== "ESRCH") active = true; }
    }
    if (active) throw new Error("Worker already running");
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  }
}
try { acquireLock(); } catch { console.error("같은 DB의 작업 프로세스가 이미 실행 중이거나 잠금 파일을 만들 수 없습니다."); process.exit(1); }
process.on("exit", () => { try { if (fs.readFileSync(lockPath, "utf8") === String(process.pid)) fs.unlinkSync(lockPath); } catch {} });
const { processNextJob, recoverInterruptedJobs } = require(path.resolve("src/lib/server/jobs.ts"));
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function run() {
  recoverInterruptedJobs();
  while (!stopping) {
    try { if (await processNextJob()) continue; }
    catch { console.error("로컬 분석 작업을 처리할 수 없습니다. DB 설정을 확인해 주세요."); }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
run().catch(() => { console.error("로컬 분석 프로세스를 시작하지 못했습니다."); process.exitCode = 1; });
