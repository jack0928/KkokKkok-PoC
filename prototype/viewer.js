/* Offline report viewer. Images and coordinates stay inside the generated HTML. */
"use strict";

(() => {
  const steps = Array.from(document.querySelectorAll(".flow-step"));
  const showOnly = (step) => {
    for (const other of steps) {
      if (other !== step) {
        other.dataset.open = "false";
        other.dataset.dismissed = "true";
      }
    }
    step.dataset.dismissed = "false";
  };
  for (const step of steps) {
    step.addEventListener("click", () => {
      const open = step.dataset.open !== "true";
      showOnly(step);
      step.dataset.dismissed = String(!open);
      step.dataset.open = String(open);
    });
    for (const event of ["pointerenter", "focus"]) {
      step.addEventListener(event, () => { showOnly(step); });
    }
    step.addEventListener("blur", () => { step.dataset.open = "false"; });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      for (const step of steps) {
        step.dataset.open = "false";
        step.dataset.dismissed = "true";
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".flow-step")) {
      for (const step of steps) {
        step.dataset.open = "false";
        step.dataset.dismissed = "true";
      }
    }
  });

  const payload = document.getElementById("match-data");
  if (!payload) return;
  const data = JSON.parse(payload.textContent);
  const image = (source) => new Promise((resolve, reject) => {
    const loaded = new Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = reject;
    loaded.src = source;
  });
  const queryImage = image(data.queryImage);
  const color = (pass) => pass ? "#59f2ad" : "#ffbf69";

  async function initialize(article, pair) {
    const root = article.querySelector(".match-viewer");
    const [left, right] = await Promise.all([pair.queryImage ? image(pair.queryImage) : queryImage, image(pair.image)]);
    const points0 = pair.queryPoints;
    const points1 = pair.candidatePoints;
    let mask = pair.inlierMask;
    if (points0.length !== points1.length || mask.length !== points0.length) throw new Error("Invalid point arrays");
    const field = (name) => root.querySelector(`[data-control="${name}"]`);
    if (pair.geometryMasks) {
      field("geometry-label").hidden = pair.geometryMode === "homography-only";
      for (const option of field("geometry").options) {
        if (pair.geometryAvailable?.[option.value] === false) {
          option.disabled = true;
          option.textContent += " · 추정 불가";
        }
      }
      field("geometry").addEventListener("change", () => {
        mask = pair.geometryMasks[field("geometry").value];
        pair.totalInliers = mask.filter(Boolean).length;
        refresh();
      });
    }
    if (pair.queryDetectedPoints) {
      field("detected-label").hidden = false;
      field("detected").addEventListener("change", paint);
    }
    const canvas = field("overview");
    canvas.width = left.naturalWidth + right.naturalWidth;
    canvas.height = Math.max(left.naturalHeight, right.naturalHeight);
    const ctx = canvas.getContext("2d");
    let selected = null;
    let eligible = [];
    let displayed = [];
    let region = null;
    let drag = null;
    let selectingRegion = false;

    // Pure filtering; viewing options never change matching or geometry results.
    function refresh() {
      eligible = points0.map((_, index) => index).filter((index) => {
        if (mask[index] ? !field("passed").checked : !field("rejected").checked) return false;
        if (!region) return true;
        const [x, y] = region.side === "query" ? points0[index] : points1[index];
        return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
      });
      if (!eligible.includes(selected)) selected = eligible[0] ?? null;
      const limit = field("limit").value === "all" ? eligible.length : Number(field("limit").value);
      displayed = eligible.length <= limit ? eligible.slice() : Array.from({length: limit}, (_, index) =>
        eligible[Math.round(index * (eligible.length - 1) / (limit - 1))]);
      if (selected !== null && !displayed.includes(selected)) displayed[displayed.length - 1] = selected;
      field("point").replaceChildren();
      if (!eligible.length) {
        const option = new Option("조건에 맞는 대응점 없음", "");
        field("point").append(option);
      } else {
        for (const index of eligible) field("point").append(new Option(
          `#${index + 1} · ${mask[index] ? "기하 검증 통과" : "기하 검증 탈락"}`, String(index)));
        field("point").value = String(selected);
      }
      field("point").disabled = !eligible.length;
      field("previous").disabled = displayed.length < 2;
      field("next").disabled = displayed.length < 2;
      field("counts").textContent = `조건에 맞는 ${eligible.length}개 중 ${displayed.length}개 표시 · 전체 통과 ${pair.totalInliers}개 / 탈락 ${pair.totalMatches - pair.totalInliers}개`;
      field("region-status").textContent = region ?
        `${region.side === "query" ? "새 사진" : "과거 사진"}의 선택 영역으로 필터링 중` : "영역 제한 없음";
      paint();
      zoom();
    }

    function paintRegion(box) {
      if (!box) return;
      const offset = box.side === "candidate" ? left.naturalWidth : 0;
      ctx.fillStyle = "rgba(140,188,255,.12)";
      ctx.fillRect(offset + box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.strokeStyle = "#8cbcff";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(offset + box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.setLineDash([]);
    }

    function paint() {
      ctx.fillStyle = "#0c1321";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(left, 0, 0);
      ctx.drawImage(right, left.naturalWidth, 0);
      if (pair.queryDetectedPoints && field("detected").checked) {
        ctx.fillStyle = "#70d9ff";
        for (const [points, offset] of [[pair.queryDetectedPoints, 0], [pair.candidateDetectedPoints, left.naturalWidth]]) {
          for (const [x, y] of points) { ctx.beginPath(); ctx.arc(x + offset, y, 2, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      const ordered = displayed.filter((index) => index !== selected);
      if (selected !== null) ordered.push(selected);
      for (const index of ordered) {
        const [x, y] = points0[index];
        const [u, v] = points1[index];
        const chosen = index === selected;
        ctx.strokeStyle = color(mask[index]);
        ctx.fillStyle = color(mask[index]);
        ctx.globalAlpha = chosen ? 1 : 0.72;
        ctx.lineWidth = chosen ? 3 : 1.5;
        if (field("lines").checked) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(u + left.naturalWidth, v); ctx.stroke();
        }
        for (const [a, b] of [[x, y], [u + left.naturalWidth, v]]) {
          ctx.fillStyle = color(mask[index]);
          ctx.strokeStyle = color(mask[index]);
          ctx.beginPath(); ctx.arc(a, b, chosen ? 7 : 4, 0, Math.PI * 2); ctx.fill();
          if (chosen) {
            ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = "#0c1321"; ctx.fillRect(a + 10, b - 19, 66, 22);
            ctx.font = "16px system-ui"; ctx.fillStyle = "white"; ctx.fillText(`#${index + 1}`, a + 13, b - 3);
          }
        }
        ctx.globalAlpha = 1;
      }
      paintRegion(drag ? rectangle(drag) : region);
    }

    function crop(target, source, point) {
      const context = target.getContext("2d");
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#0c1321"; context.fillRect(0, 0, target.width, target.height);
      if (!point) return;
      const radius = Number(field("radius").value);
      const scale = target.width / (radius * 2);
      context.imageSmoothingEnabled = false;
      context.setTransform(scale, 0, 0, scale, target.width / 2 - scale * point[0], target.height / 2 - scale * point[1]);
      context.drawImage(source, 0, 0);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const x = target.width / 2, y = target.height / 2;
      context.lineWidth = 3; context.strokeStyle = "#0c1321";
      const crosshair = () => {
        context.beginPath(); context.moveTo(x - 14, y); context.lineTo(x + 14, y);
        context.moveTo(x, y - 14); context.lineTo(x, y + 14); context.stroke();
      };
      crosshair(); context.lineWidth = 1.5; context.strokeStyle = "white"; crosshair();
    }

    function zoom() {
      crop(field("zoom-query"), left, selected === null ? null : points0[selected]);
      crop(field("zoom-candidate"), right, selected === null ? null : points1[selected]);
      field("zoom-range").textContent = `한 변 ${Number(field("radius").value) * 2}px`;
      if (selected === null) {
        field("selection").textContent = "표시할 대응점이 없습니다. 필터나 선택 영역을 바꿔주세요.";
      } else {
        const coordinate = (point) => point.map((value) => value.toFixed(1)).join(", ");
        field("selection").textContent = `선택 #${selected + 1} · ${mask[selected] ? "기하 검증 통과" : "기하 검증 탈락"} · 새 사진 (${coordinate(points0[selected])}) ↔ 과거 사진 (${coordinate(points1[selected])})`;
      }
    }

    for (const name of ["passed", "rejected", "limit", "lines"]) field(name).addEventListener("change", refresh);
    field("point").addEventListener("change", () => { selected = Number(field("point").value); refresh(); });
    for (const [name, direction] of [["previous", -1], ["next", 1]]) field(name).addEventListener("click", () => {
      if (!displayed.length) return;
      selected = displayed[(displayed.indexOf(selected) + direction + displayed.length) % displayed.length];
      refresh();
    });
    field("radius").addEventListener("input", zoom);
    field("select-region").addEventListener("click", () => {
      selectingRegion = !selectingRegion;
      field("select-region").setAttribute("aria-pressed", String(selectingRegion));
      canvas.classList.toggle("selecting-region", selectingRegion);
    });
    field("reset-region").addEventListener("click", () => { region = null; drag = null; refresh(); });

    function position(event) {
      const bounds = canvas.getBoundingClientRect();
      return [(event.clientX - bounds.left) * canvas.width / bounds.width,
        (event.clientY - bounds.top) * canvas.height / bounds.height];
    }
    function rectangle(value) {
      return {side: value.side, x0: Math.min(value.x, value.u), x1: Math.max(value.x, value.u),
        y0: Math.min(value.y, value.v), y1: Math.max(value.y, value.v)};
    }
    function moveDrag(event) {
      const [x, y] = position(event);
      const offset = drag.side === "candidate" ? left.naturalWidth : 0;
      const source = drag.side === "candidate" ? right : left;
      drag.u = Math.max(0, Math.min(source.naturalWidth, x - offset));
      drag.v = Math.max(0, Math.min(source.naturalHeight, y));
    }
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const [x, y] = position(event);
      if (selectingRegion) {
        const side = x < left.naturalWidth ? "query" : "candidate";
        const offset = side === "candidate" ? left.naturalWidth : 0;
        if (y > (side === "query" ? left.naturalHeight : right.naturalHeight)) return;
        drag = {side, x: x - offset, y, u: x - offset, v: y};
        canvas.setPointerCapture(event.pointerId);
        paint();
      } else {
        let closest = null;
        let distance = 15 * canvas.width / canvas.getBoundingClientRect().width;
        for (const index of displayed) {
          const [a, b] = points0[index], [c, d] = points1[index];
          const next = Math.min(Math.hypot(x-a, y-b), Math.hypot(x-c-left.naturalWidth, y-d));
          if (next < distance) { distance = next; closest = index; }
        }
        if (closest !== null) { selected = closest; refresh(); }
      }
    });
    canvas.addEventListener("pointermove", (event) => { if (drag) { moveDrag(event); paint(); } });
    canvas.addEventListener("pointerup", (event) => {
      if (!drag) return;
      moveDrag(event);
      const next = rectangle(drag);
      if (next.x1 - next.x0 >= 4 && next.y1 - next.y0 >= 4) region = next;
      drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      refresh();
    });
    canvas.addEventListener("pointercancel", () => { drag = null; paint(); });
    if (!pair.complete) {
      field("rejected").checked = false;
      field("rejected").disabled = true;
      field("legacy").hidden = false;
    }
    root.hidden = false;
    const preview = article.querySelector(".static-comparison");
    if (preview) preview.hidden = true;
    refresh();
    root.dataset.ready = "true";
  }
  for (const article of document.querySelectorAll("article[data-pair]")) {
    initialize(article, data.pairs[Number(article.dataset.pair)]).catch(() => {
      article.querySelector(".viewer-error").hidden = false;
    });
  }
})();
