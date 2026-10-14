/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CommonJS process supervisor. */
const { spawn } = require("node:child_process");
const path = require("node:path");
const mode = process.argv[2];
const children = [
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, "--hostname", "127.0.0.1", ...process.argv.slice(3)], { stdio: "inherit" }),
  spawn(process.execPath, ["--conditions=react-server", path.join(__dirname, "worker.cjs")], { stdio: "inherit", env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production" } }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => { if (!stopping) { process.exitCode = code || 0; stop(); } });
