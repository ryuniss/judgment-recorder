// 검토 화면. 학생 입력은 고치지 않고 서버(app_* 도구)에 그대로 보낸다.
const root = document.getElementById("root");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABELS = { "유지": "그대로 쓴다", "수정": "고쳐서 쓴다", "기각": "쓰지 않는다", "보류": "다시 볼 후보로 남긴다" };
const CHANGES = ["그대로", "구체화", "바뀜", "새 기준 추가", "순위 변경", "아직 구분하기 어려워요"];
let S = null, mode = "summary", what = "", app = null, demo = new URLSearchParams(location.search).has("demo");

async function call(name, args = {}) {
  if (demo) return demoCall(name, args);
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content?.[0]?.text || "저장하지 못했어요");
  return r.structuredContent;
}

function header(title) {
  const c = S?.current_criterion;
  return `<div class="bar"><h1>${esc(title)}</h1>${app && !demo ? `<button class="ghost" data-act="inline">대화로 돌아가기</button>` : ""}</div>
  ${c ? `<div class="crit"><span class="mut">지금 1순위 기준</span><b>${esc(c.text)}</b></div>` : ""}`;
}

function renderStart() {
  root.innerHTML = `${header("탐색 시작")}
  <p class="mut">대화를 시작하기 전에 직접 적어 주세요. AI는 이 칸을 대신 채우지 않아요.</p>
  <label class="f">무엇을 디자인하려고 하나요? (기획 의도)<textarea id="intent" rows="3"></textarea></label>
  <label class="f">1순위 기준과 그 이유<textarea id="crit" rows="3" placeholder="예: 눈부시지 않을 것. 밤늦게 오래 쓰는 사람이니까"></textarea></label>
  <button class="primary" id="go" disabled>저장하고 대화로 돌아가기</button>
  <p class="note">대화 원문은 확장 프로그램이 따로 모아요. 여기에는 내가 적은 것만 저장돼요.</p>`;
  const go = root.querySelector("#go"), i = root.querySelector("#intent"), c = root.querySelector("#crit");
  const upd = () => (go.disabled = !(i.value.trim() && c.value.trim()));
  i.oninput = c.oninput = upd;
  go.onclick = async () => {
    go.disabled = true;
    S = await call("app_save_session", { intent: i.value, criterion: c.value });
    await tellModel(`학생이 기획 의도와 1순위 기준을 직접 적었습니다. 1순위 기준: "${c.value}"`);
    mode = "saved"; render();
  };
}

function renderReview() {
  if (!S?.session) { mode = "start"; return renderStart(); }
  const raw = S.raw || [];
  root.innerHTML = `${header("반영 전 검토")}
  ${what ? `<p><span class="mut">반영하려는 것</span><br>${esc(what)}</p>` : ""}
  <h2>관련된 대화를 골라 주세요</h2>
  <div class="raw">${raw.length ? raw.map((r) => `
    <label class="msg ${r.role}"><input type="checkbox" value="${r.id}" ${r.since_last_review ? "checked" : ""}>
      <span class="body"><span class="who">${r.role === "user" ? "내가 한 말" : "AI 응답"} · ${esc(r.host)}</span>
      ${r.text ? `<span class="txt">${esc(r.text)}</span>` : ""}
      ${r.images?.length ? `<span class="imgs">${r.images.map((u) => `<img src="${esc(u)}" alt="생성 이미지">`).join("")}</span>` : ""}</span>
    </label>`).join("") : `<p class="note">아직 모인 대화가 없어요. 확장 프로그램이 켜져 있는지 확인해 주세요.</p>`}</div>
  <h2>어떻게 할까요?</h2>
  <div class="labels" role="group" aria-label="판단">${Object.keys(LABELS).map((k) => `<button type="button" aria-pressed="false" data-label="${k}" title="${LABELS[k]}">${k}</button>`).join("")}</div>
  <p class="mut" id="labelHint">하나를 고르면 뜻이 여기 보여요.</p>
  <label class="f">그렇게 판단한 이유 (내 말로)<textarea id="reason" rows="3"></textarea></label>
  <h2>이번 판단에서 1순위 기준은 어떻게 됐나요?</h2>
  <div class="chips" role="group" aria-label="기준 변화">${CHANGES.map((c, n) => `<button type="button" aria-pressed="${n === 0}" data-change="${c}">${c}</button>`).join("")}</div>
  <label class="f" id="critWrap" hidden>바뀐 기준을 적어 주세요 (이전 기준은 지워지지 않아요)<textarea id="critText" rows="2"></textarea></label>
  <button class="primary" id="save" disabled>기록하고 대화로 돌아가기</button>`;
  let label = null, change = "그대로";
  const save = root.querySelector("#save"), critWrap = root.querySelector("#critWrap"), critText = root.querySelector("#critText");
  const upd = () => (save.disabled = !label || (change !== "그대로" && change !== "아직 구분하기 어려워요" && !critText.value.trim()));
  root.querySelectorAll("[data-label]").forEach((b) => (b.onclick = () => {
    label = b.dataset.label;
    root.querySelectorAll("[data-label]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    root.querySelector("#labelHint").textContent = `${label}: ${LABELS[label]}`; upd();
  }));
  root.querySelectorAll("[data-change]").forEach((b) => (b.onclick = () => {
    change = b.dataset.change;
    root.querySelectorAll("[data-change]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    critWrap.hidden = change === "그대로" || change === "아직 구분하기 어려워요"; upd();
  }));
  critText.oninput = upd;
  save.onclick = async () => {
    save.disabled = true;
    const ids = [...root.querySelectorAll(".raw input:checked")].map((x) => x.value);
    const reason = root.querySelector("#reason").value;
    S = await call("app_save_judgment", { label, raw_ids: ids, reason, what, criterion_text: critText.value || undefined, criterion_change: change });
    await tellModel(`학생이 반영 전 검토에서 '${label}'을 골랐습니다.${reason ? ` 학생이 적은 이유: "${reason}"` : " 이유는 적지 않았습니다."}${change !== "그대로" ? ` 1순위 기준 변화: ${change}` : ""} 이 판단을 평가하거나 바꾸자고 제안하지 마세요.`);
    mode = "saved"; render();
  };
}

function renderSummary() {
  const crit = S?.criteria || [], js = S?.judgments || [];
  root.innerHTML = `${header("정리")}
  ${S?.session ? `<p><span class="mut">기획 의도</span><br>${esc(S.session.intent)}</p>` : ""}
  <h2>1순위 기준의 변화</h2>
  ${crit.length ? `<ol class="tl">${crit.map((c) => `<li><span class="tag">${esc(c.change_type)}</span><span class="mut">${esc(c.created_at.slice(5, 16).replace("T", " "))}</span><p>${esc(c.text)}</p></li>`).join("")}</ol>` : `<p class="mut">아직 기준이 없어요.</p>`}
  <h2>판단 ${js.length}개</h2>
  ${js.map((j) => `<div class="j"><p><span class="tag">${esc(j.label)}</span>${esc(j.what || "")}</p><p class="mut">${j.reason ? "이유 " + esc(j.reason) : "이유 미기록"} · 관련 대화 ${j.raw_ids.length}개</p></div>`).join("") || `<p class="mut">아직 판단이 없어요.</p>`}`;
}

function renderSaved() {
  root.innerHTML = `${header("기록했어요")}<p class="ok">대화로 돌아가서 이어서 작업하면 돼요.</p>
  <button class="ghost" data-act="summary">지금까지 정리 보기</button>`;
}

function render() {
  ({ start: renderStart, review: renderReview, summary: renderSummary, saved: renderSaved }[mode] || renderSummary)();
  root.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.act === "inline") await app.requestDisplayMode({ mode: "inline" });
    if (b.dataset.act === "summary") { S = await call("app_get_state"); mode = "summary"; render(); }
  }));
}

async function tellModel(text) {
  if (demo || !app) return;
  try { await app.updateModelContext({ content: [{ type: "text", text }] }); } catch { /* 호스트가 지원하지 않으면 무시 */ }
}

// ---- 시작 ----
if (demo) {
  S = DEMO(); mode = new URLSearchParams(location.search).get("mode") || "review"; what = "벽 반사 시안으로 가기"; render();
} else {
  app = new App({ name: "판단 기록", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
  app.ontoolinput = (p) => { what = p?.arguments?.what || what; };
  app.ontoolresult = (p) => { const sc = p?.structuredContent || {}; S = sc; mode = sc.mode || "summary"; what = sc.what || what; render(); };
  app.connect().then(() => { if (!S) root.innerHTML = `<p class="mut">불러오는 중…</p>`; })
    .catch((e) => { root.innerHTML = `<p class="note">화면을 연결하지 못했어요: ${esc(e.message)}</p>`; });
}

function DEMO() {
  const t = "2026-11-23T05:1";
  return {
    session: { intent: "밤늦게 오래 작업하는 사람을 위한 책상 조명" },
    current_criterion: { text: "눈부시지 않을 것. 밤늦게 오래 쓰니까" },
    criteria: [{ change_type: "처음", text: "눈부시지 않을 것. 밤늦게 오래 쓰니까", created_at: t + "0:00" }],
    judgments: [],
    raw: [
      { id: "r1", role: "user", host: "chatgpt", text: "갓을 깊게 해서 전구가 안 보이게, 3가지 버전으로 그려 줘", images: [], since_last_review: true },
      { id: "r2", role: "assistant", host: "chatgpt", text: "깊은 갓, 벽 반사, 확산 패널 세 가지로 만들어 봤어요.", images: [], since_last_review: true },
      { id: "r3", role: "user", host: "chatgpt", text: "벽 반사가 광원은 안 보이는데 책상 전체가 밝네. 이걸로 갈래", images: [], since_last_review: true },
    ],
  };
}
function demoCall(name, a) {
  if (name === "app_save_judgment") { S.judgments.unshift({ label: a.label, what: a.what, reason: a.reason, raw_ids: a.raw_ids }); if (a.criterion_change !== "그대로" && a.criterion_text) { S.criteria.push({ change_type: a.criterion_change, text: a.criterion_text, created_at: "2026-11-23T05:30" }); S.current_criterion = { text: a.criterion_text }; } }
  if (name === "app_save_session") { S.session = { intent: a.intent }; S.criteria = [{ change_type: "처음", text: a.criterion, created_at: "2026-11-23T05:00" }]; S.current_criterion = { text: a.criterion }; }
  return S;
}
