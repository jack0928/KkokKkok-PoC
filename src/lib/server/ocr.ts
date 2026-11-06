import "server-only";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { ocrResultSchema, OcrResult } from "../ocr";
import { storedImage } from "./jobs";
import { findRecord, withDatabase, transaction, RecordConflict } from "./records";
import { InputError } from "./image";
import { discoveryRecordSchema } from "../discovery";
let busy = false;
export async function runOcr(bytes: Buffer, original?:Buffer): Promise<OcrResult> {
  bytes=await sharp(original??bytes,{limitInputPixels:40_000_000}).rotate().resize(3072,3072,{fit:"inside",withoutEnlargement:true}).flatten({background:"white"}).jpeg({quality:95}).toBuffer();
  if(bytes.length>10*1024*1024)throw new Error("OCR input too large");
  const cache = resolve(process.env.OCR_CACHE_PATH || "private-data/ocr-models"); mkdirSync(cache, {recursive: true});
  const python = process.env.OCR_PYTHON || resolve("private-data/ocr-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return new Promise((accept, reject) => {
    const child = spawn(python, ["-X", "utf8", resolve("scripts/ocr/extract.py")], {windowsHide: true,
      env: {...process.env, USERPROFILE: cache, HF_HOME: resolve(cache, "huggingface"), MODELSCOPE_CACHE: resolve(cache, "modelscope"), PADDLE_PDX_CACHE_HOME: cache, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True"}, stdio: ["pipe", "pipe", "pipe"]});
    let output = Buffer.alloc(0), settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(new Error("OCR failed")); } };
    const timer = setTimeout(fail, 900_000);
    child.on("error", fail); child.stdin.on("error", fail);
    child.stdout.on("data", (part: Buffer) => { output = Buffer.concat([output, part]); if (output.length > 8_000_000) fail(); });
    child.stderr.on("data", () => { /* Never log image/model output. */ });
    child.on("close", code => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) { fail(); return; }
      try { const result = ocrResultSchema.parse(JSON.parse(output.toString("utf8"))); settled = true; accept(result); } catch { fail(); }
    });
    child.stdin.end(bytes);
  });
}
export async function analyzeRecordOcr(id: string, expectedVersion: string) {
  if (busy) throw new InputError("다른 OCR 작업이 실행 중입니다. 완료 후 다시 시도해 주세요.", 409);
  const record = withDatabase(db => findRecord(db, id));
  if(record?.pipeline&&Object.values(record.pipeline).some(s=>typeof s==="object"&&"status" in s&&s.status==="running"))throw new RecordConflict("자동 분석이 진행 중입니다.");
  if (!record?.analysis) throw new InputError("GPT 분석이 완료된 기록이 필요합니다.", 409);
  if (record.updatedAt !== expectedVersion || record.ocr) throw new RecordConflict("기록이 변경되었거나 OCR 결과가 이미 있습니다. 새로고침해 주세요.");
  const bytes = storedImage(id, "analysis");
  if (!bytes) throw new InputError("분석본이 없습니다. 같은 원본을 먼저 연결해 주세요.", 404);
  busy = true;
  try {
    const ocr = await runOcr(bytes,storedImage(id,"original")??undefined);
    return withDatabase(db => transaction(db, () => {
      const current = findRecord(db, id);
      if (!current || current.updatedAt !== expectedVersion || current.ocr) throw new RecordConflict("OCR 실행 중 기록이 변경되었습니다. 새로고침 후 다시 실행해 주세요.");
      const next = discoveryRecordSchema.parse({...current, pipeline:current.pipeline?{...current.pipeline,ocr:{status:"completed",error:null}}:undefined, ocr, ocrReviews: ocr.lines.map(line => ({lineId: line.id, candidateIndex: null, status: "unreviewed"})),
        reviewCompletedAt: null, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt)+1)).toISOString()});
      db.prepare("UPDATE discovery_records SET record_json = ?, updated_at = ? WHERE record_id = ?").run(JSON.stringify(next), next.updatedAt, id);
      return next;
    }));
  } finally { busy = false; }
}


