/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free local Chrome smoke test. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
const hubMode = args.includes("--hub");
const diagnosticMode = args.includes("--diagnostic");
const reviewPageMode = args.includes("--review-page");
const report = path.resolve(args.find((arg) => !arg.startsWith("--")) ||
  (hubMode ? "private-data/pipeline/index.html" : "private-data/pipeline/latest-report.html"));
const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kkokkkok-viewer-"));
const child = spawn(chrome, ["--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
  "--disable-sync", "--metrics-recording-only", "about:blank"], { stdio: "ignore" });
let socket;
let startupError;
child.on("error", (error) => { startupError = error; });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (startupError) throw new Error("Chrome could not start; check CHROME_BIN and execution permissions");
    const value = await fn();
    if (value) return value;
    await pause(50);
  }
  throw new Error("Browser verification timed out");
}

async function run() {
  const portFile = path.join(profile, "DevToolsActivePort");
  await until(() => fs.existsSync(portFile));
  const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.type === "page");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  const requests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params);
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.reject(new Error("Chrome protocol command failed"));
    else call.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Chrome command timed out")); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, "Page evaluation failed");
    return result.result.value;
  };
  const act = (body) => evaluate(`(() => {const root=document.querySelector('.match-viewer[data-ready="true"]');const c=(name)=>root.querySelector('[data-control="'+name+'"]');const pair=JSON.parse(document.getElementById('match-data').textContent).pairs[Number(root.closest('article').dataset.pair)];${body}})()`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(report).href });
  if (reviewPageMode) {
    await until(()=>evaluate("document.querySelectorAll('.point-review-form').length === 20"));
    assert.equal(await evaluate("document.querySelectorAll('iframe').length"),1);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.point-review-form button')).every(button=>button.disabled)"),true);
    await evaluate("document.querySelector('.human-sample').open=true");
    assert(await evaluate("document.querySelector('.human-sample').textContent.includes('GPT 보조 의견')"));
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
    const capture=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(path.dirname(report),"review-page-mobile.png"),Buffer.from(capture.data,"base64"),{mode:0o600});
    assert.equal(exceptions.length,0);
    assert.equal(requests.filter(url=>/^https?:/.test(url)).length,0);
    console.log("PASS: independent diagnostic review page, separate model/human forms, static-file save disabled, mobile layout and no external requests");
    return;
  }
  if (diagnosticMode) {
    await until(() => evaluate("document.querySelectorAll('.match-viewer[data-ready=true]').length === 5"));
    assert.equal(await evaluate("document.querySelectorAll('.viewer-error:not([hidden])').length"), 0);
    const initial = await evaluate("document.querySelector('canvas.overview').toDataURL()");
    await act("c('detected').checked=true;c('detected').dispatchEvent(new Event('change'));return true;");
    assert.notEqual(await evaluate("document.querySelector('canvas.overview').toDataURL()"), initial);
    await act("c('geometry').value='fundamental';c('geometry').dispatchEvent(new Event('change'));return true;");
    assert(await act("return c('counts').textContent.includes('통과 '+pair.geometryMasks.fundamental.filter(Boolean).length+'개');"));
    assert(await evaluate("document.querySelectorAll('[data-control=geometry]')[2].querySelector('option[value=fundamental]').disabled"));
    assert(await evaluate("JSON.parse(document.getElementById('match-data').textContent).pairs[1].queryImage !== JSON.parse(document.getElementById('match-data').textContent).pairs[2].queryImage"));
    assert.equal(await evaluate("document.querySelectorAll('details[id^=sample-]').length"), 20);
    assert(await evaluate("document.body.textContent.includes('실제 GPT API 보조 검토 있음')"));
    await send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
    assert.equal(exceptions.length,0);
    assert.equal(requests.filter(url=>/^https?:/.test(url)).length,0);
    const capture=await send("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(path.dirname(report),"diagnostic-mobile.png"),Buffer.from(capture.data,"base64"),{mode:0o600});
    console.log("PASS: detected points, H/F switching on identical matches, unavailable F guard, independent crop image, GPT samples, mobile layout and no external requests");
    return;
  }
  if (hubMode) {
    await until(() => evaluate("document.querySelectorAll('.run-card').length >= 3"));
    assert.equal(await evaluate("document.querySelectorAll('[role=tab],iframe').length"), 0);
    assert(await evaluate("document.querySelector('a[href=\"review-2.html\"]') !== null"));
    await evaluate("document.querySelector('a[href=\"review-2.html\"]').click()");
    await until(() => evaluate("document.querySelector('.review-form[data-key=\"2\"]') !== null"));
    assert(await evaluate("location.pathname.endsWith('/review-2.html')"));
    assert.equal(await evaluate("document.querySelectorAll('iframe').length"), 1);
    assert(await evaluate("document.querySelector('iframe').getAttribute('src').includes('group-2-')"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
    await evaluate("document.querySelector('a[href=\"index.html\"]').click()");
    await until(() => evaluate("document.querySelectorAll('.run-card').length >= 3"));
    assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
    assert.equal(exceptions.length, 0, "Unexpected report page exceptions");
    assert.equal(requests.filter((url) => /^https?:/.test(url)).length, 0);
    console.log("PASS: independent run pages, list navigation, single report per page, mobile layout and no external requests");
    return;
  }
  await until(() => evaluate("document.querySelectorAll('article[data-pair]').length > 0 && document.querySelectorAll('.match-viewer[data-ready=\"true\"]').length === document.querySelectorAll('article[data-pair]').length"));
  assert.equal(await evaluate("document.querySelectorAll('.flow-step').length"), 4);
  assert.equal(await evaluate("document.querySelectorAll('.viewer-error:not([hidden])').length"), 0);

  const initial = await act("return {options:c('point').options.length,inliers:pair.totalInliers,text:c('counts').textContent};");
  assert.equal(initial.options, initial.inliers);
  assert(initial.text.includes(`${Math.min(5, initial.inliers)}개 표시`));
  await act("c('limit').value='30';c('limit').dispatchEvent(new Event('change'));return true;");
  assert((await act("return c('counts').textContent;")).includes(`${Math.min(30, initial.inliers)}개 표시`));
  await act("c('rejected').checked=true;c('passed').checked=false;c('passed').dispatchEvent(new Event('change'));return true;");
  assert(await act("return Array.from(c('point').options).every(option => !pair.inlierMask[Number(option.value)]) && c('selection').textContent.includes('기하 검증 탈락');"));
  const selected = await act("return c('point').value;");
  const nextSample = await act("const indices=pair.inlierMask.map((pass,index)=>pass?null:index).filter(index=>index!==null);const n=Math.min(30,indices.length);return indices.length<=30?indices[1]:indices[Math.round((indices.length-1)/(n-1))];");
  await act("c('next').click();return true;");
  assert.notEqual(await act("return c('point').value;"), selected);
  assert.equal(await act("return Number(c('point').value);"), nextSample);
  await act("c('radius').value='24';c('radius').dispatchEvent(new Event('input'));return true;");
  assert.equal(await act("return c('zoom-range').textContent;"), "한 변 48px");
  assert(await act("return c('zoom-query').getContext('2d').getImageData(160,160,1,1).data[3] === 255 && c('zoom-candidate').getContext('2d').getImageData(160,160,1,1).data[3] === 255;"));
  await act("c('rejected').checked=false;c('rejected').dispatchEvent(new Event('change'));return true;");
  assert(await act("return c('point').disabled && c('next').disabled && c('selection').textContent.includes('표시할 대응점이 없습니다');"));
  await act("c('passed').checked=true;c('rejected').checked=true;c('limit').value='all';c('limit').dispatchEvent(new Event('change'));return true;");
  assert(await act("return c('point').options.length === pair.totalMatches;"));

  await act("c('overview').scrollIntoView({block:'center'});return true;");
  const endpoint = await act("const index=(Number(c('point').value)+1)%pair.totalMatches;const rect=c('overview').getBoundingClientRect();return {index,x:rect.left+pair.queryPoints[index][0]*rect.width/c('overview').width,y:rect.top+pair.queryPoints[index][1]*rect.height/c('overview').height};");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: endpoint.x, y: endpoint.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: endpoint.x, y: endpoint.y, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(await act("return Number(c('point').value);"), endpoint.index);
  await act("c('overview').scrollIntoView({block:'center'});c('select-region').click();return true;");
  const drag = await act("const rect=c('overview').getBoundingClientRect();const point=pair.queryPoints[Number(c('point').value)];const scale=rect.width/c('overview').width;return {x0:rect.left+Math.max(0,point[0]-16)*scale,y0:rect.top+Math.max(0,point[1]-16)*scale,x1:rect.left+Math.min(pair.querySize[0],point[0]+16)*scale,y1:rect.top+Math.min(pair.querySize[1],point[1]+16)*scale};");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: drag.x0, y: drag.y0, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: drag.x1, y: drag.y1, buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: drag.x1, y: drag.y1, button: "left", buttons: 0, clickCount: 1 });
  assert(await act("return c('region-status').textContent.includes('새 사진') && c('point').options.length > 0 && c('point').options.length < pair.totalMatches;"));
  await act("c('reset-region').click();c('select-region').click();c('limit').value='10';c('limit').dispatchEvent(new Event('change'));return true;");
  assert(await act("return c('point').options.length === pair.totalMatches && c('region-status').textContent === '영역 제한 없음';"));
  await act("root.scrollIntoView({block:'start'});return true;");
  const screenshots = path.dirname(report);
  async function screenshot(name) {
    const capture = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(screenshots, name), Buffer.from(capture.data, "base64"), { mode: 0o600 });
  }
  await screenshot("viewer-desktop.png");
  await act("root.querySelector('.zoom-pair').scrollIntoView({block:'center'});return true;");
  await screenshot("viewer-zoom.png");
  await evaluate("window.scrollTo(0,0)");
  const step = await evaluate("(() => {const r=document.querySelector('.flow-step').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: step.x, y: step.y });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.step-tooltip')).visibility"), "visible");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.step-tooltip')).filter(tip=>getComputedStyle(tip).visibility==='visible').length"), 1);
  await screenshot("viewer-tooltip.png");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.step-tooltip')).visibility"), "hidden");
  await evaluate("document.querySelectorAll('.flow-step')[1].focus()");
  assert.equal(await evaluate("getComputedStyle(document.querySelectorAll('.step-tooltip')[1]).visibility"), "visible");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.step-tooltip')).filter(tip=>getComputedStyle(tip).visibility==='visible').length"), 1);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await evaluate("document.activeElement.blur()");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const touch = await evaluate("(() => {const r=document.querySelector('.flow-step').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{x: touch.x, y: touch.y}] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(() => evaluate("getComputedStyle(document.querySelector('.step-tooltip')).visibility === 'visible'"));
  assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.step-tooltip')).visibility"), "visible");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.step-tooltip')).filter(tip=>getComputedStyle(tip).visibility==='visible').length"), 1);
  await screenshot("viewer-mobile.png");
  assert.equal(exceptions.length, 0, "Unexpected browser exceptions");
  assert.equal(requests.filter((url) => /^https?:/.test(url)).length, 0, "Report attempted external network access");
  console.log("PASS: real report load, point filters/counts/navigation, paired zoom, empty state, region selection/reset, desktop hover, keyboard/Escape, mobile tooltip, CSP and no external requests");
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  child.kill("SIGTERM");
  for (let i = 0; i < 40 && child.exitCode === null; i++) await pause(50);
  if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(profile, { recursive: true, force: true });
});
