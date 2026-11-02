/* eslint-disable @typescript-eslint/no-require-imports -- Use the local worker module loader. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
require("../scripts/register-server.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kkokkkok-gps-"));
process.env.SQLITE_PATH = path.join(root, "test.sqlite");
process.env.IMAGE_STORAGE_PATH = path.join(root, "images");
const { extractImageGps, parseExifGps } = require("../src/lib/server/image-gps.ts");
const { streetViewUrl } = require("../src/lib/image-gps.ts");
const upload = require("../src/app/api/analysis-jobs/route.ts");
const lookup = require("../src/app/api/discovery-gps/[id]/route.ts");
const jobs = require("../src/lib/server/jobs.ts");
const records = require("../src/lib/server/records.ts");
const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "x-analysis-consent": "true" };

async function image(gps, format = "jpeg") {
  let pipeline = sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } })[format]();
  if (gps) pipeline = pipeline.withExif({ IFD3: gps });
  return pipeline.toBuffer();
}
const tags = { GPSLatitudeRef: "N", GPSLatitude: "37/1 30/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "127/1 15/1 0/1" };

async function run() {
  for (const format of ["jpeg", "png", "webp"]) {
    assert.deepEqual(await extractImageGps(await image(tags, format)), { status: "found", latitude: 37.5, longitude: 127.25 });
    assert.deepEqual(await extractImageGps(await image(null, format)), { status: "missing" });
  }
  assert.deepEqual(await extractImageGps(await image({ ...tags, GPSLatitudeRef: "S", GPSLongitudeRef: "W" })), { status: "found", latitude: -37.5, longitude: -127.25 });
  assert.deepEqual(await extractImageGps(await image({ ...tags, GPSLatitude: "0/1 0/1 0/1", GPSLongitude: "0/1 0/1 0/1" })), { status: "found", latitude: 0, longitude: 0 });
  for (const invalid of [
    { GPSLatitude: "91/1 0/1 0/1" }, { GPSLongitude: "181/1 0/1 0/1" },
    { GPSLatitude: "37/1 60/1 0/1" }, { GPSLongitude: "127/1 0/1 60/1" },
    { GPSLatitude: "37/0 0/1 0/1" }, { GPSLatitudeRef: "X" },
    { GPSMapDatum: "TOKYO" }, { GPSStatus: "V" },
  ]) assert.deepEqual(await extractImageGps(await image({ ...tags, ...invalid })), { status: "invalid" });
  const partial = { ...tags }; delete partial.GPSLongitude;
  assert.deepEqual(await extractImageGps(await image(partial)), { status: "invalid" });
  assert.deepEqual(parseExifGps(Buffer.from("broken EXIF")), { status: "invalid" });
  const bytes = await image(tags);
  const response = await upload.POST(new Request("http://127.0.0.1:3000/api/analysis-jobs", { method: "POST", headers, body: bytes }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.gps, { status: "found", latitude: 37.5, longitude: 127.25 });
  assert(!JSON.stringify(body.record).includes("latitude"));
  assert(!JSON.stringify(records.listResults()).includes("latitude"));
  const stripped = jobs.storedImage(body.record.recordId, "analysis");
  assert.equal((await sharp(stripped).metadata()).exif, undefined);
  assert.deepEqual(await extractImageGps(stripped), { status: "missing" });
  const context = { params: Promise.resolve({ id: body.record.recordId }) };
  const request = new Request("http://127.0.0.1:3000/api/discovery-gps", { headers });
  const found = await lookup.GET(request, context);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("cache-control"), "no-store");
  assert.deepEqual((await found.json()).gps, body.gps);
  const external = new Request(request.url, { headers: { ...headers, origin: "https://example.com" } });
  assert.equal((await lookup.GET(external, context)).status, 403);
  assert.equal((await lookup.GET(request, { params: Promise.resolve({ id: "bad" }) })).status, 400);
  assert.equal((await lookup.GET(request, { params: Promise.resolve({ id: crypto.randomUUID() }) })).status, 404);
  const url = new URL(streetViewUrl(body.gps));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("map_action"), "pano");
  assert.equal(url.searchParams.get("viewpoint"), "37.5,127.25");
  records.removeRecord(body.record.recordId, body.record.updatedAt);
  assert.equal((await lookup.GET(request, context)).status, 404);
  console.log("PASS: synthetic EXIF GPS in JPEG/PNG/WebP, hemisphere/zero/invalid/missing data, upload and existing-original lookup, local access, deletion, Street View URL and separation from DB/model image. No external APIs called.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
