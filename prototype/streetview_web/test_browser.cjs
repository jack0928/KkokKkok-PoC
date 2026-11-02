/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local Chrome smoke test. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const base = process.argv[2] || "http://127.0.0.1:8766";
const chrome = process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kkokkkok-streetview-"));
const child = spawn(chrome, ["--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], {stdio:"ignore"});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
async function until(fn) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await pause(80);
  }
  throw new Error("Browser verification timed out");
}
async function run() {
  const file = path.join(profile, "DevToolsActivePort");
  await until(() => fs.existsSync(file));
  const port = fs.readFileSync(file,"utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {socket.onopen=resolve;socket.onerror=reject;});
  let sequence=0;
  const pending=new Map();
  const exceptions=[];
  const requests=[];
  const submissions=[];
  const send=(method,params={}) => new Promise((resolve,reject) => {
    const id=++sequence;
    pending.set(id,{resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async (expression) => {
    const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw new Error("Page script failed");
    return result.result.value;
  };
  const pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  const pair=(heading) => ({heading,similarity:.8,matches:0,inliers:0,inlierRatio:0,queryCoverage:0,candidateCoverage:0,
    status:"insufficient-evidence",queryPoints:[],candidatePoints:[],querySize:[100,100],candidateSize:[100,100]});
  const result={queries:[{number:1,image:pixel,candidates:[0,90,180,270].map(pair)}],
    references:[0,90,180,270].map((heading)=>({heading,image:pixel})),
    metadata:{date:"합성 UI 테스트",copyright:"synthetic"},seconds:1};
  socket.onmessage=async (event) => {
    const message=JSON.parse(event.data);
    if(message.method==="Runtime.exceptionThrown") exceptions.push(message.params);
    if(message.method==="Network.requestWillBeSent") requests.push(message.params.request.url);
    if(message.method==="Fetch.requestPaused") {
      const url=new URL(message.params.request.url);
      let value;
      if(url.pathname==="/api/config") value={token:"mock-ui-token",googleConfigured:true};
      else if(url.pathname==="/api/compare") {
        submissions.push(JSON.parse(message.params.request.postData));
        value={jobId:"a".repeat(32)};
      }
      else value={status:"completed",result};
      await send("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:200,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(value)).toString("base64")});
    }
    const call=pending.get(message.id);
    if(call) {pending.delete(message.id);if(message.error) call.reject(new Error("CDP error"));else call.resolve(message.result);}
  };
  await send("Runtime.enable");await send("Network.enable");await send("Page.enable");
  await send("Page.navigate",{url:base});
  await until(()=>evaluate("document.getElementById('configuration')?.textContent.includes('설정되지')"));
  assert.equal(await evaluate("document.getElementById('submit').disabled"),true);
  await send("Fetch.enable",{patterns:[{urlPattern:base+"/api/*",requestStage:"Request"}]});
  await send("Page.navigate",{url:base});
  await until(()=>evaluate("document.getElementById('submit')?.disabled === false"));
  await evaluate(`(async()=>{
    const bytes=Uint8Array.from(atob(${JSON.stringify(pixel.split(',')[1])}),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:'image/png'});
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));
    const photos=document.getElementById('photos');photos.files=transfer.files;photos.dispatchEvent(new Event('change'));
    document.getElementById('address').value='합성 테스트 주소';document.getElementById('consent').checked=true;
    document.getElementById('submit').click();
  })()`);
  await until(()=>evaluate("document.getElementById('status').textContent.includes('완료됐')"));
  assert.equal(await evaluate("document.querySelectorAll('.candidate').length"),4);
  assert.equal(await evaluate("document.querySelectorAll('canvas').length"),4);
  assert.equal(await evaluate("document.querySelectorAll('#previews img').length"),1);
  assert.equal(submissions[0].mode,"address");
  assert.equal(submissions[0].source,"default");
  await evaluate(`(()=>{
    const mode=document.getElementById('reference-mode');mode.value='panorama';mode.dispatchEvent(new Event('change'));
    document.getElementById('campus-example').click();
  })()`);
  assert.equal(await evaluate("document.getElementById('address').disabled"),true);
  assert.equal(await evaluate("document.getElementById('panorama').required"),true);
  assert.equal(await evaluate("document.getElementById('panorama').value"),"CIHM0ogKEICAgIDq3c3y1gE");
  await evaluate("document.getElementById('submit').click()");
  await until(()=>evaluate("document.getElementById('status').textContent.includes('완료됐')"));
  assert.equal(submissions.length,2);
  assert.equal(submissions[1].mode,"panorama");
  assert.equal(submissions[1].panorama,"CIHM0ogKEICAgIDq3c3y1gE");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),true);
  assert.equal(exceptions.length,0);
  assert.equal(requests.some((url)=>/^https?:/.test(url)&&!url.startsWith(base)),false);
  const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  const output=path.resolve("private-data/streetview-web/ui-test.png");
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,Buffer.from(screenshot.data,"base64"));
  console.log("PASS: no-key state, address including indoor, exact indoor panorama selection, mocked results, four canvases, mobile layout, no external requests; Google not called");
}
run().catch((error)=>{console.error(error.message);process.exitCode=1;}).finally(()=>{
  if(socket) socket.close();child.kill();
  // Keep the isolated temporary Chrome profile for OS cleanup; never touch user profiles.
});
