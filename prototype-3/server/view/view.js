// 판단 기록 캔버스 (06 → 3차). 학생 입력은 고치지 않고 서버(app_* 도구)에 그대로 보낸다.
// 대화는 ChatGPT·Claude 본체가 맡고, 이 화면은 이미지·출처·판단·기준만 다룬다.
const root = document.getElementById("root");
const fileInput = document.getElementById("file");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABELS = { "선택": "다음 작업에 쓴다", "보류": "다시 볼 후보로 남긴다", "제외": "쓰지 않는다(연결은 남김)", "아직 모르겠어요": "아직 정하지 못했다" };
const CHANGES = ["구체화", "바뀜", "새 기준 추가", "순위 변경", "아직 구분하기 어려워요"];
const NODE_W = 180, NODE_H = 196, X_H = 96, COL = 250, ROW = 24, PAD = 40;

const params = new URLSearchParams(location.search);
const demo = params.has("demo");
let app = null, S = null, mode = "canvas", q6 = "";
let sel = null, scale = 1, sheet = null, toastTimer = null, hostMode = "inline", avail = [];

// ---------- 서버 호출 ----------
async function call(name, args = {}) {
  if (demo) return demoCall(name, args);
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content?.[0]?.text || "저장하지 못했어요");
  return r.structuredContent;
}
async function tellModel(text) {
  if (demo || !app) return;
  try { await app.updateModelContext({ content: [{ type: "text", text }] }); } catch { /* 지원하지 않는 호스트 */ }
}
async function say(text) { // 대화창에 학생 메시지로 보낸다(버튼에 무엇을 보내는지 적혀 있을 때만)
  if (demo) return toast(`대화창에 보냄: ${text}`);
  try { await app.sendMessage({ role: "user", content: [{ type: "text", text }] }); }
  catch { toast("대화창에 보내지 못했어요. 직접 입력해 주세요."); }
}
function toast(t) {
  document.querySelector(".toast")?.remove();
  const d = document.createElement("div"); d.className = "toast"; d.textContent = t; root.appendChild(d);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => d.remove(), 2600);
}
const nodeById = (id) => S?.nodes?.find((n) => n.id === id);
const tagOf = (n) => `${n.letter}${n.name ? " " + n.name : ""}`;

function summary() {
  const lines = [`[판단 기록 캔버스 — 학생이 직접 입력한 상태]`, `1순위 기준: ${S.current_criterion?.text ?? "없음"}`];
  for (const n of S.nodes) {
    const from = n.parents.map((p) => nodeById(p)?.letter).filter(Boolean).join("+");
    lines.push(`${tagOf(n)}${from ? ` (← ${from})` : ""}: ${n.judgment?.label ?? "판단 전"}${n.judgment ? (n.judgment.reason ? ` / 이유 "${n.judgment.reason}"` : " / 이유 미기록") : ""}`);
  }
  lines.push("판단·이유·기준은 학생이 정한 것입니다. 평가하거나 바꾸라고 권하지 마세요.");
  return lines.join("\n");
}

// ---------- 배치 ----------
function layout() {
  const depth = {}, out = {};
  const d = (n) => depth[n.id] ??= n.parents.length ? 1 + Math.max(...n.parents.map((p) => (nodeById(p) ? d(nodeById(p)) : -1))) : 0;
  S.nodes.forEach(d);
  const colY = {};
  for (const n of S.nodes) {
    const c = depth[n.id], x = PAD + c * COL, y = PAD + (colY[c] ?? 0);
    const h = n.judgment?.label === "제외" ? X_H : NODE_H;
    out[n.id] = { x, y, w: n.judgment?.label === "제외" ? 120 : NODE_W, h };
    colY[c] = (colY[c] ?? 0) + h + ROW;
  }
  const W = Math.max(...Object.values(out).map((p) => p.x + p.w), 400) + PAD;
  const H = Math.max(...Object.values(out).map((p) => p.y + p.h), 300) + PAD;
  return { pos: out, W, H };
}

// ---------- 화면 ----------
function render() {
  if (!S?.session) return renderStart();
  const { pos, W, H } = layout();
  const cur = S.current_criterion, prop = S.proposal, n = S.nodes.length;
  const focus = S.focus_node_id;
  root.innerHTML = `
  <div class="top">
    <div class="crit"><span class="k">1순위 기준</span><b>${esc(cur?.text ?? "-")}</b>
      <button class="sec" data-act="crit">기준 변화 기록</button>
      ${avail.includes("fullscreen") && hostMode !== "fullscreen" ? `<button class="sec" data-act="full">크게 보기</button>` : ""}</div>
    ${prop ? `<div class="prop"><span class="tag">정리 제안 · 확인 전</span><span class="t">${esc(prop.text)}</span>
      <button class="sec" data-act="prop-ok">확인하고 기록</button><button class="ghost" data-act="prop-no">넘기기</button></div>` : ""}
    <div class="tools"><span class="cnt">이미지 ${n}개</span>
      <span class="hint">AI로 만든 결과는 버튼으로 올리거나 캔버스에 끌어다 놓아요</span>
      <div class="zoom"><button data-act="zout" aria-label="축소">−</button><span>${Math.round(scale * 100)}%</span><button data-act="zin" aria-label="확대">+</button></div>
      <button class="sec" data-act="fit">한눈에 보기</button>
      <button class="primary" data-act="upload">이미지 올리기</button></div>
  </div>
  <div class="body">
    <div class="vp" id="vp">
      <div style="width:${W * scale}px;height:${H * scale}px;position:relative">
      <div class="stage" style="width:${W}px;height:${H}px;transform:scale(${scale})">
        <svg class="edges" width="${W}" height="${H}">${S.nodes.flatMap((c) => c.parents.filter((p) => pos[p]).map((p) => {
          const a = pos[p], b = pos[c.id], x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, m = (x1 + x2) / 2;
          return `<path class="${sel === c.id || sel === p ? "hot" : ""}" d="M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}"/>`;
        })).join("")}</svg>
        ${S.nodes.map((nd) => nodeHtml(nd, pos[nd.id], focus)).join("")}
      </div></div>
      ${n ? "" : `<div class="empty"><div><b style="color:#111">첫 이미지를 올려 주세요</b>AI로 만든 이미지를 저장해서 여기에 끌어다 놓거나, 위의 [이미지 올리기]를 눌러요.</div></div>`}
    </div>
    ${sel && nodeById(sel) ? panelHtml(nodeById(sel)) : ""}
  </div>`;
  bind();
}

function nodeHtml(nd, p, focus) {
  const lb = nd.judgment?.label;
  const x = lb === "제외";
  return `<button class="node ${x ? "x" : ""} ${sel === nd.id ? "sel" : ""} ${focus === nd.id && !x ? "focus" : ""}" data-node="${nd.id}"
    style="left:${p.x}px;top:${p.y}px" aria-label="${esc(tagOf(nd))}, ${esc(lb ?? "판단 전")}">
    ${nd.image_url ? `<img src="${esc(nd.image_url)}" alt="" draggable="false">` : ""}
    <span class="nm"><span class="lt">${esc(nd.letter)}</span>${x ? "" : esc(nd.name ?? "")}</span>
    <span class="lb ${lb ? esc(lb) : "none"}">${esc(lb ?? "판단 전")}</span></button>`;
}

function panelHtml(nd) {
  const lb = nd.judgment?.label;
  const from = nd.parents.map((p) => nodeById(p)).filter(Boolean);
  return `<aside class="panel" aria-label="${esc(tagOf(nd))}">
    <h2><span class="lt" style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:5px;background:#111;color:#fff;font-size:13px">${esc(nd.letter)}</span>${esc(nd.name ?? "이름 없음")}
      <button class="close" data-act="close" aria-label="닫기">×</button></h2>
    ${nd.image_url ? `<img class="big" src="${esc(nd.image_url)}" alt="">` : ""}
    <p class="mut">출처: ${from.length ? from.map((f) => esc(tagOf(f))).join(" + ") : "처음 시작"} · ${esc(nd.origin ?? "")}로 올림</p>
    <div class="row"><button class="sec" data-act="talk">대화창에 '${esc(nd.letter)}에 대해 이야기하기' 보내기</button>
      <button class="sec" data-act="child">여기서 이어서 올리기</button></div>
    <div><p style="font-weight:700;font-size:14px;margin-bottom:6px">판단 <span class="mut" style="font-weight:400">지금: ${esc(lb ?? "판단 전")}</span></p>
      <div class="labels" role="group" aria-label="판단">${Object.keys(LABELS).map((k) => `<button type="button" aria-pressed="false" data-label="${k}" title="${LABELS[k]}">${k}</button>`).join("")}</div>
      <p class="mut" id="lh" style="margin-top:6px">고르면 뜻이 여기 보여요.</p></div>
    <label class="f">이유 (적지 않아도 기록돼요)<textarea id="reason" rows="3" placeholder="내 말로 짧게"></textarea></label>
    <button class="primary" id="saveJ" disabled>판단 기록</button>
    ${nd.history.length ? `<div><p class="mut" style="font-weight:700;margin-bottom:4px">이 이미지의 판단 이력</p><ul class="hist">${nd.history.slice().reverse().map((h) =>
      `<li>${esc(h.created_at.slice(5, 16).replace("T", " "))} · <b style="color:#111">${esc(h.label)}</b> · ${h.reason ? esc(h.reason) : "이유 미기록"}</li>`).join("")}</ul></div>` : ""}
  </aside>`;
}

function renderStart() {
  root.innerHTML = `<div class="start"><h1>탐색 시작</h1>
  <p class="mut">대화를 시작하기 전에 직접 적어 주세요. AI는 이 칸을 대신 채우지 않아요.</p>
  <label class="f">무엇을 디자인하려고 하나요? (기획 의도)<textarea id="intent" rows="3"></textarea></label>
  <label class="f">1순위 기준과 그 이유<textarea id="crit" rows="3" placeholder="예: 눈부시지 않을 것. 밤늦게 오래 쓰는 사람이니까"></textarea></label>
  <button class="primary" id="go" disabled>저장하고 캔버스 열기</button>
  <p class="note">여기에는 내가 올린 이미지와 내가 고른 출처·판단·기준만 저장돼요. 대화는 평소처럼 ChatGPT·Claude 창에서 해요.</p></div>`;
  const go = root.querySelector("#go"), i = root.querySelector("#intent"), c = root.querySelector("#crit");
  i.oninput = c.oninput = () => (go.disabled = !(i.value.trim() && c.value.trim()));
  go.onclick = async () => {
    go.disabled = true;
    try { S = await call("app_save_session", { intent: i.value, criterion: c.value }); }
    catch (e) { go.disabled = false; return toast(e.message); }
    await tellModel(`학생이 기획 의도와 1순위 기준을 직접 적었습니다. 1순위 기준: "${c.value}". 캔버스에 이미지를 올리면 알파벳(A, B…)이 붙습니다.`);
    render();
  };
}

// ---------- 이벤트 ----------
function bind() {
  root.querySelectorAll("[data-node]").forEach((b) => (b.onclick = () => { sel = b.dataset.node; render(); }));
  const act = (k, f) => root.querySelectorAll(`[data-act="${k}"]`).forEach((b) => (b.onclick = f));
  act("close", () => { sel = null; render(); });
  act("upload", () => pickFile(S.focus_node_id ? [S.focus_node_id] : []));
  act("child", () => pickFile([sel]));
  act("zin", () => setScale(scale + 0.1));
  act("zout", () => setScale(scale - 0.1));
  act("fit", () => { fit(); call("app_event", { type: "zoom_fit" }).catch(() => {}); });
  act("full", async () => { try { const r = await app.requestDisplayMode({ mode: "fullscreen" }); hostMode = r?.mode || hostMode; render(); } catch {} });
  act("crit", () => openCriterion());
  act("prop-ok", () => openCriterion(S.proposal));
  act("prop-no", async () => { S = await call("app_save_criterion", { proposal_id: S.proposal.id, dismiss: true }); toast("정리 제안을 넘겼어요"); render(); });
  act("talk", async () => {
    const nd = nodeById(sel);
    S = await call("app_event", { type: "focus", node_id: nd.id }).then(() => call("app_get_state"));
    await tellModel(`${summary()}\n학생이 ${tagOf(nd)}에 대해 이야기하려고 합니다.`);
    render(); await say(`${tagOf(nd)}에 대해 이야기해 볼게요.`);
  });
  const panel = root.querySelector(".panel");
  if (panel) {
    let label = null;
    const save = panel.querySelector("#saveJ");
    panel.querySelectorAll("[data-label]").forEach((b) => (b.onclick = () => {
      label = b.dataset.label;
      panel.querySelectorAll("[data-label]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      panel.querySelector("#lh").textContent = `${label}: ${LABELS[label]}`; save.disabled = false;
    }));
    save.onclick = async () => {
      save.disabled = true;
      const nd = nodeById(sel), reason = panel.querySelector("#reason").value;
      try { S = await call("app_set_judgment", { node_id: nd.id, label, reason }); } catch (e) { save.disabled = false; return toast(e.message); }
      const msg = `${tagOf(nd)}: 학생이 '${label}'(으)로 기록. ${reason.trim() ? `학생이 적은 이유: "${reason.trim()}"` : "이유는 적지 않음."}`;
      if (q6) {
        await tellModel(`${summary()}\n${msg}\n이 판단을 평가하지 말고, 다음 질문만 이 문장 그대로 하세요: "${q6}"`);
        await say(`${tagOf(nd)}을(를) '${label}'(으)로 기록했어요.`);
      } else {
        await tellModel(`${summary()}\n${msg}`);
        toast(`${nd.letter} → ${label} 기록했어요`);
      }
      render();
    };
  }
  bindDrop();
  const vp = root.querySelector("#vp");
  if (vp) vp.onclick = (e) => { if (e.target === vp || e.target.classList.contains("stage")) { if (sel) { sel = null; render(); } } };
}

function setScale(v) { scale = Math.min(1.6, Math.max(0.3, Math.round(v * 100) / 100)); render(); }
function fit() {
  const vp = root.querySelector("#vp"); if (!vp || !S.nodes.length) return;
  const { W, H } = layout();
  setScale(Math.min(1, (vp.clientWidth - 16) / W, (vp.clientHeight - 16) / H));
}

// ---------- 올리기 ----------
let pendingParents = [];
function pickFile(parents) { pendingParents = parents.filter(Boolean); fileInput.value = ""; fileInput.click(); }
fileInput.onchange = () => { const f = fileInput.files?.[0]; if (f) openSource(f, pendingParents, "버튼"); };

function bindDrop() {
  const vp = root.querySelector("#vp"); if (!vp) return;
  let target = null;
  const over = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault(); vp.classList.add("drag");
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".node");
    const t = el?.dataset.node || null;
    if (t !== target) {
      vp.querySelectorAll(".droptarget").forEach((x) => x.classList.remove("droptarget"));
      target = t; if (el) el.classList.add("droptarget");
      let m = vp.querySelector(".dropmsg"); if (!m) { m = document.createElement("div"); m.className = "dropmsg"; vp.appendChild(m); }
      m.textContent = t ? `${nodeById(t).letter}에서 이어서 놓기` : "놓으면 새 이미지로 올려요";
    }
  };
  const clear = () => { vp.classList.remove("drag"); vp.querySelector(".dropmsg")?.remove(); vp.querySelectorAll(".droptarget").forEach((x) => x.classList.remove("droptarget")); };
  vp.addEventListener("dragenter", over); vp.addEventListener("dragover", over);
  vp.addEventListener("dragleave", (e) => { if (!vp.contains(e.relatedTarget)) { clear(); target = null; } });
  vp.addEventListener("drop", (e) => {
    e.preventDefault(); clear();
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
    const on = !!target, parents = target ? [target] : (S.focus_node_id ? [S.focus_node_id] : []);
    target = null;
    if (!f) return toast("이미지 파일을 끌어다 놓아 주세요. 웹 페이지의 이미지는 먼저 저장해요.");
    openSource(f, parents, "끌어다 놓기", on);
  });
}

function shrink(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("파일을 읽지 못했어요"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("이미지를 열지 못했어요"));
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.86));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function openSource(file, preset, origin, dropOn = false) {
  let data;
  try { data = await shrink(file); } catch (e) { return toast(e.message); }
  const chosen = new Set(preset.filter((p) => nodeById(p)));
  const auto = preset.length > 0;
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-label="이미지 올리기">
    <h2>새 이미지 ${esc(nextLetter())}</h2><img class="prev" src="${data}" alt="">
    <label class="f">이름 (선택)<input type="text" id="nm" maxlength="40" placeholder="예: 벽 반사"></label>
    <div><p style="font-weight:700;font-size:14px">어디서 이어졌나요? <span class="mut" style="font-weight:400">여러 개 고를 수 있어요</span></p>
      ${auto ? `<p class="mut">${dropOn ? "놓은 이미지" : "마지막으로 이야기한 이미지"}를 미리 골라 두었어요. 맞지 않으면 바꿔 주세요.</p>` : ""}
      <div class="srcs" style="margin-top:8px">${S.nodes.map((n) => `<button type="button" class="src" data-src="${n.id}" aria-pressed="${chosen.has(n.id)}">
        ${n.image_url ? `<img src="${esc(n.image_url)}" alt="">` : ""}${esc(tagOf(n))}</button>`).join("") || `<span class="mut">아직 이미지가 없어요. 처음 시작으로 올라가요.</span>`}</div>
      <p class="mut" style="margin-top:6px" id="srcHint"></p></div>
    <div class="row"><button class="primary" id="ok">올리기</button><button class="sec" id="cancel">취소</button></div></div>`;
  root.appendChild(scrim);
  const hint = () => (scrim.querySelector("#srcHint").textContent = chosen.size ? `출처: ${[...chosen].map((c) => nodeById(c).letter).join(" + ")}` : "아무것도 고르지 않으면 처음 시작(새 갈래)으로 올라가요.");
  hint();
  scrim.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.src; chosen.has(k) ? chosen.delete(k) : chosen.add(k); b.setAttribute("aria-pressed", chosen.has(k)); hint();
  }));
  scrim.querySelector("#cancel").onclick = () => { scrim.remove(); call("app_event", { type: "upload_cancel" }).catch(() => {}); };
  scrim.querySelector("#ok").onclick = async (e) => {
    e.target.disabled = true;
    try { S = await call("app_add_node", { image: data, name: scrim.querySelector("#nm").value, parents: [...chosen], origin }); }
    catch (err) { e.target.disabled = false; return toast(err.message); }
    scrim.remove();
    const nd = S.nodes.at(-1); sel = nd.id;
    await tellModel(`${summary()}\n학생이 ${tagOf(nd)}를 올렸습니다${nd.parents.length ? ` (출처: ${nd.parents.map((p) => nodeById(p)?.letter).join("+")})` : ""}.`);
    render();
    requestAnimationFrame(() => root.querySelector(`[data-node="${nd.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
}
const nextLetter = () => { let n = S.nodes.length, s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------- 기준 ----------
function openCriterion(proposal) {
  let change = null;
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-label="기준 변화 기록">
    <h2>1순위 기준 기록</h2>
    <ol class="tl">${S.criteria.filter((c) => c.status !== "proposed" && c.status !== "superseded").map((c) =>
      `<li><span class="tg">${esc(c.status === "dismissed" ? "넘긴 제안" : c.change_type)}</span><span class="mut">${esc(c.created_at.slice(5, 16).replace("T", " "))}</span><p>${esc(c.text)}</p></li>`).join("")}</ol>
    ${proposal ? `<p class="note">정리 제안(AI 작성, 확인 전): ${esc(proposal.text)}<br>그대로 쓰거나 내 말로 고쳐서 기록하세요.</p>` : ""}
    <div><p style="font-weight:700;font-size:14px;margin-bottom:6px">어떤 변화인가요?</p>
      <div class="chips" role="group" aria-label="변화 종류">${CHANGES.map((c) => `<button type="button" aria-pressed="false" data-ch="${c}">${c}</button>`).join("")}</div></div>
    <label class="f">지금의 1순위 기준<textarea id="ct" rows="3">${esc(proposal?.text ?? S.current_criterion?.text ?? "")}</textarea></label>
    <p class="mut">이전 기준은 지워지지 않고 위 기록에 남아요.</p>
    <div class="row"><button class="primary" id="ok" disabled>기록</button><button class="sec" id="cancel">닫기</button></div></div>`;
  root.appendChild(scrim);
  const ok = scrim.querySelector("#ok"), ct = scrim.querySelector("#ct");
  const upd = () => (ok.disabled = !(change && ct.value.trim()));
  scrim.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => {
    change = b.dataset.ch; scrim.querySelectorAll("[data-ch]").forEach((x) => x.setAttribute("aria-pressed", x === b)); upd();
  }));
  ct.oninput = upd;
  scrim.querySelector("#cancel").onclick = () => scrim.remove();
  ok.onclick = async () => {
    ok.disabled = true;
    try { S = await call("app_save_criterion", { change_type: change, text: ct.value, proposal_id: proposal?.id }); }
    catch (e) { ok.disabled = false; return toast(e.message); }
    scrim.remove();
    await tellModel(`${summary()}\n학생이 1순위 기준 변화를 '${change}'(으)로 기록했습니다.`);
    toast("기준을 기록했어요"); render();
  };
}

// ---------- 시작 ----------
async function refresh() {
  if (demo || !app || !S?.session || document.visibilityState !== "visible" || root.querySelector(".scrim")) return;
  try { const n = await call("app_get_state"); const before = JSON.stringify([S.proposal?.id, S.nodes.length, S.focus_node_id]);
    S = n; if (before !== JSON.stringify([S.proposal?.id, S.nodes.length, S.focus_node_id])) render(); } catch {}
}

if (demo) {
  S = DEMO(); q6 = params.get("q6") || "";
  if (params.get("mode") === "start") S.session = null;
  if (params.get("sel")) sel = S.nodes.find((n) => n.letter === params.get("sel"))?.id ?? null;
  render();
} else {
  app = new App({ name: "판단 기록", version: "0.2.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
  app.ontoolresult = (p) => { const sc = p?.structuredContent; if (sc && "nodes" in sc) { S = sc; render(); } };
  app.onhostcontextchanged = (ctx) => { if (ctx?.displayMode) hostMode = ctx.displayMode; if (ctx?.availableDisplayModes) avail = ctx.availableDisplayModes; if (S) render(); };
  app.connect().then(async () => {
    const ctx = app.getHostContext?.(); hostMode = ctx?.displayMode || hostMode; avail = ctx?.availableDisplayModes || [];
    try { q6 = (await call("app_config")).q6 || ""; } catch {}
    if (!S) { try { S = await call("app_get_state"); render(); } catch { root.innerHTML = `<p class="mut" style="padding:16px">불러오는 중…</p>`; } }
    setInterval(refresh, 10000);
  }).catch((e) => { root.innerHTML = `<p class="note" style="margin:16px">화면을 연결하지 못했어요: ${esc(e.message)}</p>`; });
}

// ---------- 데모 ----------
function svgImg(label, a, b) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="220" fill="url(#g)"/><text x="16" y="200" font-family="sans-serif" font-size="18" fill="#fff">${label}</text></svg>`);
}
function DEMO() {
  const t = "2026-11-23T05:";
  return {
    session: { intent: "밤늦게 오래 작업하는 사람을 위한 책상 조명" },
    current_criterion: { text: "눈부시지 않을 것. 밤늦게 오래 쓰니까" },
    criteria: [{ id: "c1", change_type: "처음", status: "confirmed", text: "눈부시지 않을 것. 밤늦게 오래 쓰니까", created_at: t + "00:00" }],
    proposal: { id: "p1", text: "광원이 직접 보이지 않을 것", status: "proposed" },
    focus_node_id: "n3",
    nodes: [
      { id: "n1", letter: "A", name: "깊은 갓", parents: [], origin: "버튼", image_url: svgImg("A 깊은 갓", "#3a3a3a", "#9a9a9a"), created_at: t + "05", judgment: { label: "제외", reason: "답답해 보임", created_at: t + "20" }, history: [{ label: "제외", reason: "답답해 보임", created_at: t + "20" }] },
      { id: "n2", letter: "B", name: "확산 패널", parents: [], origin: "버튼", image_url: svgImg("B 확산 패널", "#555", "#ccc"), created_at: t + "06", judgment: { label: "보류", reason: null, created_at: t + "21" }, history: [{ label: "보류", reason: null, created_at: t + "21" }] },
      { id: "n3", letter: "C", name: "벽 반사", parents: ["n1", "n2"], origin: "끌어다 놓기", image_url: svgImg("C 벽 반사", "#222", "#777"), created_at: t + "12", judgment: null, history: [] },
    ],
  };
}
function demoCall(name, a) {
  const T = new Date().toISOString();
  if (name === "app_save_session") { S = DEMO(); S.nodes = []; S.proposal = null; S.session = { intent: a.intent }; S.criteria = [{ id: "c1", change_type: "처음", status: "confirmed", text: a.criterion, created_at: T }]; S.current_criterion = { text: a.criterion }; }
  if (name === "app_add_node") { const id = "n" + (S.nodes.length + 1); S.nodes.push({ id, letter: nextLetter(), name: a.name || null, parents: a.parents, origin: a.origin, image_url: a.image, created_at: T, judgment: null, history: [] }); S.focus_node_id = id; }
  if (name === "app_set_judgment") { const n = nodeById(a.node_id), j = { label: a.label, reason: a.reason?.trim() || null, created_at: T }; n.judgment = j; n.history.push(j); }
  if (name === "app_save_criterion") {
    if (a.proposal_id) S.proposal = null;
    if (!a.dismiss) { S.criteria.push({ id: "c" + T, change_type: a.change_type, status: "confirmed", text: a.text, created_at: T }); S.current_criterion = { text: a.text }; }
  }
  if (name === "app_event" && a.type === "focus") S.focus_node_id = a.node_id;
  if (name === "app_config") return { q6 };
  return S;
}
