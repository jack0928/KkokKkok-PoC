"use strict";
for (const form of document.querySelectorAll(".review-form")) {
  const status = form.querySelector(".save-status");
  const button = form.querySelector("button");
  if (location.protocol === "file:") {
    status.textContent = "저장은 로컬 보고서 서버에서 가능합니다.";
    button.disabled = true;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = "저장 중…";
    try {
      const response = await fetch("/api/review", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({key: form.dataset.key, name: form.elements.name.value, comment: form.elements.comment.value})});
      if (!response.ok) throw new Error("save");
      document.querySelector("[data-review-title]").textContent = form.elements.name.value.trim();
      document.title = `${form.elements.name.value.trim()} · 꼭꼭`;
      status.textContent = "저장됨";
    } catch { status.textContent = "저장 실패 · 입력 길이와 서버 상태를 확인하세요."; }
    finally { button.disabled = false; }
  });
}
for (const form of document.querySelectorAll(".point-review-form")) {
  const status = form.querySelector(".save-status");
  const button = form.querySelector("button");
  if (location.protocol === "file:") {button.disabled = true;status.textContent = "저장은 로컬 서버에서 가능합니다.";}
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); button.disabled = true;
    try {
      const response = await fetch("/api/point-review", {method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({key:form.dataset.key,sampleId:form.dataset.sample,verdict:form.elements.verdict.value||null,reason:form.elements.reason.value})});
      if (!response.ok) throw new Error("save");
      status.textContent = "사람 검토 저장됨 · 결과 표시는 새로고침 후 반영됩니다.";
    } catch {status.textContent = "저장 실패 · 서버와 입력을 확인하세요.";}
    finally {button.disabled = false;}
  });
}
