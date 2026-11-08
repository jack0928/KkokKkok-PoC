/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the real route with the local server loader. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
require("../scripts/register-server.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kkokkkok-analysis-api-"));
process.env.SQLITE_PATH = path.join(root, "test.sqlite");
process.env.IMAGE_STORAGE_PATH = path.join(root, "images");
process.env.ANALYSIS_API_KEY = "synthetic-analysis-key";

const discovery = require("../src/lib/discovery.ts");
const analyzerPath = require.resolve("../src/lib/server/analyze.ts");
require.cache[analyzerPath] = { exports: { analyzeImage: async ({ image }) => {
  const output = { candidates: [{ featureType: "간판", observedCue: "합성 상호 글자", regionDescription: "사진 위쪽", modelRisk: "medium", modelReason: "합성 테스트 근거" }], limitations: [] };
  return discovery.analysisSchema.parse({ requestedModel: "synthetic-model", responseModel: "synthetic-model", responseId: "synthetic-response",
    analyzedAt: new Date().toISOString(), promptVersion: discovery.PROMPT_VERSION, analysisSha256: image.analysisSha256,
    usage: { inputTokens: 1, outputTokens: 1 }, modelOutput: output,
    visionStages: { pipelineVersion: "local-vision-stages-v1", image: { width: 80, height: 60, coordinateSpace: "analysis-normalized-tlbr" },
      ocr: { model: "PaddleOCR", status: "completed", items: [{ text: "PINE CAFE", confidence: 0.97, bbox: [0.1, 0.2, 0.5, 0.3] }] },
      objectDetection: { model: "Grounding DINO test", threshold: 0.25, status: "completed", items: [{ label: "store sign", confidence: 0.91, bbox: [0.08, 0.1, 0.55, 0.35] }] } },
    rawOutputText: JSON.stringify(output) });
} } };

const jobs = require("../src/lib/server/jobs.ts");
const submitRoute = require("../src/app/api/inspections/route.ts");
const resultRoute = require("../src/app/api/inspections/[id]/route.ts");

function requestHeaders(idempotencyKey) {
  return { host: "127.0.0.1:3000", "x-analysis-api-key": process.env.ANALYSIS_API_KEY,
    "x-analysis-consent": "true", "idempotency-key": idempotencyKey };
}

function uploadRequest(bytes, idempotencyKey, headers = requestHeaders(idempotencyKey)) {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "synthetic.jpg");
  return new Request("http://127.0.0.1:3000/api/inspections", { method: "POST", headers, body: form });
}

async function run() {
  try {
    const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();
    const requestId = randomUUID();
    const denied = await submitRoute.POST(uploadRequest(image, requestId, { host: "127.0.0.1:3000", "idempotency-key": requestId }));
    assert.equal(denied.status, 401);

    const notConsented = await submitRoute.POST(uploadRequest(image, randomUUID(), {
      host: "127.0.0.1:3000", "x-analysis-api-key": process.env.ANALYSIS_API_KEY, "idempotency-key": randomUUID(),
    }));
    assert.equal(notConsented.status, 400);

    const accepted = await submitRoute.POST(uploadRequest(image, requestId));
    assert.equal(accepted.status, 202);
    const queued = await accepted.json();
    assert.equal(queued.inspectionId, requestId);
    assert.equal(queued.status, "queued");
    assert.equal(queued.mock, false);
    assert.equal(queued.riskSummary.score, null);

    const repeated = await submitRoute.POST(uploadRequest(image, requestId));
    assert.equal(repeated.status, 202);
    assert.equal((await repeated.json()).inspectionId, requestId);
    const differentImage = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer();
    const conflict = await submitRoute.POST(uploadRequest(differentImage, requestId));
    assert.equal(conflict.status, 409);

    assert(await jobs.processNextJob());
    const completed = await resultRoute.GET(new Request(`http://127.0.0.1:3000/api/inspections/${requestId}`, { headers: requestHeaders(requestId) }), { params: Promise.resolve({ id: requestId }) });
    assert.equal(completed.status, 200);
    const result = await completed.json();
    assert.equal(result.status, "completed");
    assert.equal(result.mock, false);
    assert.equal(result.riskSummary.score, null);
    assert.equal(result.riskFactors.length, 1);
    assert.equal(result.riskFactors[0].modelRisk, "medium");
    assert.equal(result.riskFactors[0].humanRisk, null);
    assert.equal(result.riskFactors[0].bbox, null);
    assert.deepEqual(result.pipelineStages, { visualObservation: "completed", ocr: "completed", objectDetection: "completed" });
    assert.equal(result.visualObservations.length, 3);
    assert.equal(result.visualObservations[1].name, "PINE CAFE");
    assert.deepEqual(result.visualObservations[1].bbox, [0.1, 0.2, 0.5, 0.3]);
    assert.equal(result.visualObservations[2].source, "grounding-dino");
    assert.equal(JSON.stringify(result).includes("rawOutputText"), false);
    console.log("Analysis API synthetic workflow passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
