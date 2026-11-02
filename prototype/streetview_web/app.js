"use strict";
const form = document.getElementById("compare-form");
const photos = document.getElementById("photos");
const button = document.getElementById("submit");
const statusBox = document.getElementById("status");
let token = "";
let configured = false;
let previewUrls = [];
const referenceMode = document.getElementById("reference-mode");
function updateReferenceMode() {
  const specific = referenceMode.value === "panorama";
  document.getElementById("address-fields").hidden = specific;
  document.getElementById("panorama-fields").hidden = !specific;
  document.getElementById("address").required = !specific;
  document.getElementById("address").disabled = specific;
  document.getElementById("panorama").required = specific;
  document.getElementById("panorama").disabled = !specific;
}
referenceMode.addEventListener("change", updateReferenceMode);
document.getElementById("campus-example").addEventListener("click", () => {
  document.getElementById("panorama").value = "CIHM0ogKEICAgIDq3c3y1gE";
});

function message(text, error = false) {
  statusBox.textContent = text;
  statusBox.classList.toggle("error", error);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
photos.addEventListener("change", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  const previews = document.getElementById("previews");
  previews.replaceChildren();
  for (const file of Array.from(photos.files).slice(0, 5)) {
    const image = element("img");
    image.alt = "선택한 사진 미리보기";
    image.src = URL.createObjectURL(file);
    previewUrls.push(image.src);
    previews.append(image);
  }
});

async function drawPair(canvas, querySource, referenceSource, pair) {
  const load = (source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
  const [query, reference] = await Promise.all([load(querySource), load(referenceSource)]);
  const leftWidth = pair.querySize[0];
  const rightWidth = pair.candidateSize[0];
  canvas.width = leftWidth + rightWidth;
  canvas.height = Math.max(pair.querySize[1], pair.candidateSize[1]);
  const context = canvas.getContext("2d");
  context.drawImage(query, 0, 0, ...pair.querySize);
  context.drawImage(reference, leftWidth, 0, ...pair.candidateSize);
  context.strokeStyle = "#70efb7";
  context.fillStyle = "#70efb7";
  context.lineWidth = 1;
  pair.queryPoints.forEach((point, index) => {
    const target = pair.candidatePoints[index];
    context.beginPath(); context.moveTo(...point);
    context.lineTo(leftWidth + target[0], target[1]); context.stroke();
    for (const [x, y] of [point, [leftWidth + target[0], target[1]]]) {
      context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill();
    }
  });
}

async function render(result) {
  const container = document.getElementById("result-list");
  container.replaceChildren();
  document.getElementById("results").hidden = false;
  document.getElementById("result-summary").textContent = `${result.queries.length}장 × 네 방향 비교 · ${result.seconds}초 · CPU · 거리뷰 촬영 시점 ${result.metadata.date || "정보 없음"}. 검색 유사도순으로 표시하며 네 방향 모두 부분 매칭했습니다. 파노라마 ID: ${result.metadata.panoramaId || "정보 없음"}`;
  for (const query of result.queries) {
    container.append(element("h3", `업로드 사진 ${query.number}`, "query-title"));
    for (const pair of query.candidates) {
      const card = element("article", undefined, "candidate");
      const head = element("div", undefined, "candidate-head");
      head.append(element("h3", `거리뷰 ${pair.heading}°`));
      const ok = pair.status === "visual-correspondence";
      head.append(element("span", ok ? "시각적 대응 근거 있음" : "판단 보류 · 근거 부족", `badge${ok ? " ok" : ""}`));
      const metrics = element("div", undefined, "metrics");
      const values = [["검색 유사도", pair.similarity.toFixed(3)], ["대응점", pair.matches],
        ["기하 통과", pair.inliers], ["통과 비율", `${(pair.inlierRatio * 100).toFixed(1)}%`],
        ["분포 면적 · 내 사진 / 거리뷰", `${(pair.queryCoverage * 100).toFixed(1)}% / ${(pair.candidateCoverage * 100).toFixed(1)}%`]];
      for (const [label, value] of values) {
        const metric = element("span", `${label} `);
        metric.append(element("b", String(value)));
        metrics.append(metric);
      }
      const canvas = element("canvas", undefined, "comparison");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `왼쪽 업로드 사진 ${query.number}, 오른쪽 ${pair.heading}도 거리뷰와 기하 통과점`);
      card.append(head, metrics, canvas, element("p", `왼쪽: 내 사진 / 오른쪽: Google Maps · ${result.metadata.copyright} · 초록 선: 통과점 최대 60개`, "attribution"));
      container.append(card);
      const reference = result.references.find((item) => item.heading === pair.heading);
      await drawPair(canvas, query.image, reference.image, pair);
    }
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = Array.from(photos.files);
  if (!files.length || files.length > 5 || files.some((file) => !file.size || file.size > 10 * 1024 * 1024)) {
    return message("장당 10MB 이하 사진을 1~5장 선택하세요.", true);
  }
  button.disabled = true;
  document.body.classList.add("busy");
  document.getElementById("results").hidden = true;
  try {
    message("사진을 로컬 서버에 전송하고 있습니다.");
    const images = await Promise.all(files.map(readFile));
    const response = await fetch("/api/compare", {method: "POST", headers: {"Content-Type": "application/json", "X-Local-Token": token},
      body: JSON.stringify({images, mode: referenceMode.value, address: document.getElementById("address").value,
        source: document.getElementById("source").value, panorama: document.getElementById("panorama").value,
        consent: document.getElementById("consent").checked})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "분석을 시작하지 못했습니다.");
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const poll = await fetch(`/api/jobs/${data.jobId}`, {headers: {"X-Local-Token": token}});
      const state = await poll.json();
      if (!poll.ok) throw new Error(state.error || "진행 상태를 확인할 수 없습니다.");
      if (state.status === "failed") throw new Error(state.message);
      if (state.status === "completed") {
        await render(state.result);
        message("분석이 완료됐습니다. 아래에서 네 방향의 근거를 비교하세요.");
        break;
      }
      message(state.message);
    }
  } catch (error) {
    message(error.message || "서버 연결이 끊겼습니다. 서버 상태를 확인하세요. 자동 재요청하지 않습니다.", true);
  } finally {
    document.body.classList.remove("busy");
    button.disabled = !configured;
  }
});

fetch("/api/config").then((response) => response.json()).then((config) => {
  token = config.token;
  configured = config.googleConfigured;
  button.disabled = !configured;
  document.getElementById("configuration").textContent = configured ? "Google 서버 키 준비 완료 · 이미지 4회 요청 후 로컬 분석" : "Google API 키가 설정되지 않았습니다. 서버 환경변수 GOOGLE_MAPS_API_KEY를 설정한 후 재시작하세요.";
}).catch(() => message("로컬 서버에 연결할 수 없습니다.", true));
