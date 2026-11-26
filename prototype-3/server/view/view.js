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
let showMore = false, sel = null, scale = 1, toastTimer = null, hostMode = "inline", avail = [], judgeCtx = null;

// ---------- 서버 호출 ----------
// 서버 오류를 학생용 문구로 바꾼다. 연결·형식 문제는 학생 잘못이 아니므로 화면에 안내를 고정하고 AI에게도 알린다.
const RESTART = "새 대화에서 '판단 기록으로 탐색을 시작할게요'를 보내 다시 시작해 주세요.";
let broken = false;
function markBroken(detail) {
  if (broken) return; broken = true;
  const d = document.createElement("div"); d.className = "broken"; d.setAttribute("role", "alert");
  d.innerHTML = `<b>이 캔버스는 저장할 수 없는 상태예요.</b> 지금까지 저장된 기록은 그대로 있어요. ${esc(RESTART)}`;
  document.body.prepend(d);
  tellModel(`[판단 기록 캔버스 오류] 화면이 서버에 저장하지 못했습니다(${detail}). 이것은 연결·버전 문제이며 학생이 입력을 잘못한 것이 아닙니다. 원인을 추측하지 말고 학생에게 "${RESTART}"라고만 안내하세요.`);
}
async function call(name, args = {}) {
  if (demo) return demoCall(name, args);
  let r;
  try { r = await app.callServerTool({ name, arguments: args }); }
  catch (e) { markBroken(String(e?.message || e).slice(0, 120)); throw new Error("저장하지 못했어요. " + RESTART); }
  if (r.isError) {
    const msg = r.content?.[0]?.text || "";
    // 서버가 학생용으로 쓴 한국어 문구는 그대로, 개발용 오류(형식·연결)는 안내로 바꾼다
    if (!msg || /MCP error|-32602|validation|Invalid|unknown participant|invalid_token|Unauthorized/i.test(msg)) { markBroken(msg.slice(0, 120)); throw new Error("저장하지 못했어요. " + RESTART); }
    throw new Error(msg);
  }
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
  const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => d.remove(), 2600);
}
// 캔버스 항목 = 이미지 노드 + (지우지 않은) 아이디어 메모
const ideaItems = () => (S?.ideas || []).filter((i) => i.status !== "dismissed")
  .map((i) => ({ ...i, kind: "idea", memo: i.kind === "summary" ? "summary" : "idea", letter: i.label, parents: i.related, text: i.text_final ?? i.text_relayed }));
const items = () => [...(S?.nodes || []), ...ideaItems()];
const groupItems = () => (S?.groups || []).map((g) => ({ ...g, kind: "group", letter: g.label }));
const nodeById = (id) => items().find((n) => n.id === id) || groupItems().find((g) => g.id === id);
const curCrit = () => S?.current_criteria?.length ? S.current_criteria : (S?.current_criterion ? [{ ...S.current_criterion, rank: 1 }] : []);
const tagOf = (n) => n.kind === "idea" || n.kind === "group" ? n.letter : `${n.letter}${n.name ? " " + n.name : ""}`;
// 출처로 고를 수 있는 것: 이미지, 남긴 메모·정리, 묶음
const sourceChoices = (exclude = new Set()) => [...S.nodes, ...ideaItems().filter((i) => i.status === "kept"), ...groupItems()].filter((x) => !exclude.has(x.id));

function summary() {
  const lines = [`[판단 기록 캔버스 — 학생이 직접 입력한 상태]`, `디자인 콘셉트: ${S.concept ?? S.session?.intent ?? "-"}`,
    ...curCrit().map((c) => `${c.rank ?? 1}순위 기준: ${c.text}`)];
  for (const n of S.nodes) {
    const from = n.parents.map((p) => nodeById(p)?.letter).filter(Boolean).join("+");
    lines.push(`${tagOf(n)}${from ? ` (← ${from})` : ""}: ${n.judgment?.label ?? "판단 전"}${n.judgment ? (n.judgment.reason ? ` / 이유 "${n.judgment.reason}"` : " / 이유 미기록") : ""}`);
  }
  for (const g of groupItems()) {
    const from = g.parents.map((p) => nodeById(p)?.letter).filter(Boolean).join("+");
    lines.push(`[${g.letter}] ${g.members.map((m) => nodeById(m)?.letter).join(" ")}${from ? ` (← ${from}${g.parents_auto ? ", 자동·확인 전" : ""})` : ""}`);
  }
  for (const i of ideaItems()) lines.push(`${i.letter}: "${i.text}" (${i.status === "kept" ? "학생이 남김" : "확인 전"})`);
  lines.push("판단·이유·기준은 학생이 정한 것입니다. 평가하거나 바꾸라고 권하지 마세요.");
  return lines.join("\n");
}

// ---------- 배치 ----------
// 가로: 출처 깊이(열). 세로: 같은 열 안에서 출처 가까이(갈래끼리 모이게). 생성 묶음은 한 상자로, 안의 이미지는 격자로.
// 학생이 옮긴 항목(이미지·메모·묶음)은 그 자리에 고정.
const MW = 120, MH = 148, GAP = 8, GP = 10, HEAD = 34, COLGAP = 70;
function gsize(g) { const k = Math.max(1, g.members.length), cols = Math.min(4, k), rows = Math.ceil(k / cols);
  return { w: GP * 2 + cols * MW + (cols - 1) * GAP, h: HEAD + rows * MH + (rows - 1) * GAP + GP }; }
function layout() {
  const groupOf = {}; for (const g of groupItems()) for (const m of g.members) groupOf[m] = g.id;
  const res = (id) => groupOf[id] ?? id;
  const L = [...items().filter((n) => !groupOf[n.id]), ...groupItems()];
  const byId = Object.fromEntries(L.map((n) => [n.id, n]));
  const depth = {}, out = {}, visiting = new Set();
  const d = (n) => {
    if (depth[n.id] != null) return depth[n.id];
    if (visiting.has(n.id)) return 0; visiting.add(n.id);
    const ps = n.parents.map(res).filter((p) => byId[p] && p !== n.id);
    return (depth[n.id] = ps.length ? 1 + Math.max(...ps.map((p) => d(byId[p]))) : 0);
  };
  const all = L.sort((a, b) => a.created_at.localeCompare(b.created_at));
  all.forEach(d);
  const size = (n) => { if (n.kind === "group") return gsize(n); const small = n.judgment?.label === "제외"; return { w: small ? 120 : NODE_W, h: n.kind === "idea" ? 112 : small ? X_H : NODE_H }; };
  const cols = Math.max(0, ...all.map((n) => depth[n.id]));
  const colX = [PAD];
  for (let c = 0; c <= cols; c++) colX[c + 1] = colX[c] + Math.max(NODE_W, ...all.filter((n) => depth[n.id] === c).map((n) => size(n).w)) + COLGAP;
  for (let c = 0; c <= cols; c++) {
    const col = all.filter((n) => depth[n.id] === c).map((n) => {
      const ps = n.parents.map((p) => out[p] ?? out[res(p)]).filter(Boolean);
      return { n, want: ps.length ? ps.reduce((a, p) => a + p.y + p.h / 2, 0) / ps.length : null };
    });
    col.sort((a, b) => (a.want ?? 1e9) - (b.want ?? 1e9) || a.n.created_at.localeCompare(b.n.created_at));
    let next = PAD;
    for (const { n, want } of col) {
      const { w, h } = size(n);
      const y = Math.max(next, want != null ? want - h / 2 : next);
      out[n.id] = { x: colX[c], y, w, h };
      next = y + h + ROW;
      if (n.kind === "group") placeMembers(n, out);
    }
  }
  for (const n of all) { const p = S.positions?.[n.id]; if (p && out[n.id]) { Object.assign(out[n.id], { x: p.x, y: p.y, pinned: true }); if (n.kind === "group") placeMembers(n, out); } }
  const W = Math.max(...Object.values(out).map((p) => p.x + p.w), 400) + PAD;
  const H = Math.max(...Object.values(out).map((p) => p.y + p.h), 300) + PAD;
  return { pos: out, W, H, layoutItems: all };
}
function placeMembers(g, out) {
  const r = out[g.id], cols = Math.min(4, Math.max(1, g.members.length));
  g.members.forEach((m, i) => { out[m] = { x: r.x + GP + (i % cols) * (MW + GAP), y: r.y + HEAD + Math.floor(i / cols) * (MH + GAP), w: MW, h: MH, member: true }; });
}

function groupHtml(g, p) {
  const from = g.parents.map((x) => nodeById(x)).filter(Boolean).map(tagOf).join(" + ");
  return `<div class="group ${g.parents_auto ? "auto" : ""}" data-drag="${g.id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">
    <div class="gh"><b>${esc(g.letter)}</b><span class="mut">${from ? `${esc(from)}에서` : "처음 시작"}${g.parents_auto ? " · 자동 · 확인 전" : ""}</span>
      <button class="ghost gbtn" data-gedit="${g.id}">${g.parents_auto ? "출처 확인" : "고치기"}</button></div></div>`;
}

// ---------- 화면 ----------
function render() {
  if (!S?.session || mode === "start") return renderStart();
  if (mode === "wrap") return renderWrap();
  const { pos, W, H, layoutItems } = layout();
  const cur = S.current_criterion, prop = S.proposal, n = S.nodes.length, nm = ideaItems().length;
  const focus = S.focus_node_id;
  root.innerHTML = `
  <div class="top">
    <p class="concept"><span class="k">콘셉트</span> ${esc(S.concept ?? S.session.intent ?? "")}</p>
    <div class="crit"><span class="k">1순위 기준</span><b>${esc(cur?.text ?? "-")}</b>
      ${curCrit().length > 1 ? `<button class="ghost" data-act="more">${showMore ? "접기" : `기준 ${curCrit().length - 1}개 더`}</button>` : ""}
      <button class="sec" data-act="crit">기준 변화 기록</button>
      <button class="ghost" data-act="wrap">오늘 정리</button>
      <button class="ghost" data-act="new">새 탐색 시작</button>
      ${avail.includes("fullscreen") && hostMode !== "fullscreen" ? `<button class="sec" data-act="full">크게 보기</button>` : ""}</div>
    ${showMore ? `<div class="more">${curCrit().filter((c) => (c.rank ?? 1) > 1).map((c) => `<p><span class="k">${c.rank}순위</span> ${esc(c.text)}</p>`).join("")}</div>` : ""}
    ${prop ? `<div class="prop"><span class="tag">정리 제안 · 확인 전</span><span class="t">${esc(prop.text)}</span>
      <button class="sec" data-act="prop-ok">확인하고 기록</button><button class="ghost" data-act="prop-no">넘기기</button></div>` : ""}
    <div class="tools"><span class="cnt">이미지 ${n}개${nm ? ` · 메모·정리 ${nm}개` : ""}</span>
      <span class="hint">AI로 만든 결과는 버튼으로 올리거나 캔버스에 끌어다 놓아요</span>
      <div class="zoom"><button data-act="zout" aria-label="축소">−</button><span>${Math.round(scale * 100)}%</span><button data-act="zin" aria-label="확대">+</button></div>
      <button class="sec" data-act="fit">한눈에 보기</button>
      ${Object.keys(S.positions || {}).length ? `<button class="ghost" data-act="relayout">자동 정렬</button>` : ""}
      <button class="primary" data-act="upload">이미지 올리기</button></div>
  </div>
  <div class="body">
    <div class="vp" id="vp">
      <div style="width:${W * scale}px;height:${H * scale}px;position:relative">
      <div class="stage" style="width:${W}px;height:${H}px;transform:scale(${scale})">
        <svg class="edges" width="${W}" height="${H}">${layoutItems.flatMap((c) => c.parents.filter((p) => pos[p] && pos[c.id]).map((p) => {
          const a = pos[p], b = pos[c.id], x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + Math.min(b.h / 2, 60), m = (x1 + x2) / 2;
          return `<path class="${sel === c.id || sel === p ? "hot" : ""} ${c.kind === "group" && c.parents_auto ? "auto" : ""}" d="M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}"/>`;
        })).join("")}</svg>
        ${groupItems().map((g) => groupHtml(g, pos[g.id])).join("")}
        ${items().map((nd) => nodeHtml(nd, pos[nd.id], focus)).join("")}
      </div></div>
      ${n || nm ? "" : `<div class="empty"><div><b style="color:#111">첫 이미지를 올려 주세요</b>AI로 만든 이미지를 저장해서 여기에 끌어다 놓거나, 위의 [이미지 올리기]를 눌러요.</div></div>`}
    </div>
    ${sel && nodeById(sel) ? (nodeById(sel).kind === "idea" ? ideaPanelHtml(nodeById(sel)) : panelHtml(nodeById(sel))) : ""}
  </div>`;
  bind();
}

function nodeHtml(nd, p, focus) {
  if (nd.kind === "idea") return `<button class="node idea ${nd.memo} ${nd.status === "proposed" ? "pending" : ""} ${sel === nd.id ? "sel" : ""}" data-node="${nd.id}"
    style="left:${p.x}px;top:${p.y}px" aria-label="${esc(nd.letter)}, ${nd.status === "kept" ? "남김" : "확인 전"}">
    <span class="nm"><span class="lt">${esc(nd.letter)}</span></span><span class="it">${esc(nd.text)}</span>
    <span class="lb ${nd.status === "kept" ? "" : "none"}">${nd.status === "kept" ? "남김" : "확인 전"}</span></button>`;
  const lb = nd.judgment?.label;
  const x = lb === "제외";
  return `<button class="node ${p.member ? "mini" : ""} ${x ? "x" : ""} ${sel === nd.id ? "sel" : ""} ${focus === nd.id && !x ? "focus" : ""}" data-node="${nd.id}"
    style="left:${p.x}px;top:${p.y}px" aria-label="${esc(tagOf(nd))}, ${esc(lb ?? "판단 전")}">
    ${nd.image_url ? `<img src="${esc(nd.image_url)}" alt="" draggable="false">` : ""}
    <span class="nm"><span class="lt">${esc(nd.letter)}</span>${x ? "" : esc(nd.name ?? "")}</span>
    <span class="lb ${lb ? esc(lb) : "none"}">${esc(lb ?? "판단 전")}</span></button>`;
}

function panelHtml(nd) {
  const lb = nd.judgment?.label;
  const grp = groupItems().find((g) => g.members.includes(nd.id));
  const from = (grp ? grp.parents : nd.parents).map((p) => nodeById(p)).filter(Boolean);
  return `<aside class="panel" aria-label="${esc(tagOf(nd))}">
    <h2><span class="lt" style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:5px;background:#111;color:#fff;font-size:13px">${esc(nd.letter)}</span>${esc(nd.name ?? "이름 없음")}
      <button class="close" data-act="close" aria-label="닫기">×</button></h2>
    ${judgeCtx && judgeCtx.target === nd.id ? `<p class="note">대화에서${judgeCtx.why ? ` (${esc(judgeCtx.why)})` : ""}${judgeCtx.words ? `: "${esc(judgeCtx.words)}"` : ""} — 판단을 직접 골라 주세요.</p>` : ""}
    ${nd.image_url ? `<img class="big" src="${esc(nd.image_url)}" alt="">` : ""}
    <p class="mut">${grp ? `${esc(grp.letter)} · ` : ""}출처: ${from.length ? from.map((f) => esc(tagOf(f))).join(" + ") : "처음 시작"}${grp?.parents_auto ? " (자동 · 확인 전)" : ""} · ${esc(nd.origin ?? "")}로 올림</p>
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

function ideaPanelHtml(i) {
  const pending = i.status === "proposed", sum = i.memo === "summary";
  const rel = new Set(i.related); if (i.about === "concept") rel.add("concept");
  return `<aside class="panel" aria-label="${esc(i.letter)}">
    <h2><span class="lt" style="display:inline-flex;align-items:center;justify-content:center;padding:0 6px;height:24px;border-radius:5px;background:#111;color:#fff;font-size:12px">${esc(i.letter)}</span>${sum ? "대화 정리" : "아이디어 메모"}
      <button class="close" data-act="close" aria-label="닫기">×</button></h2>
    ${pending ? `<p class="note">${sum ? "대화에서 AI가 정리한 내용이에요. 내 생각과 맞게 고쳐서 남기거나, 아니면 지워 주세요." : "대화에서 AI가 옮겨 적은 말이에요. 내 생각과 맞게 고쳐서 남기거나, 아니면 지워 주세요."}</p>
      <label class="f">${sum ? "정리" : "메모"}<textarea id="itext" rows="4">${esc(i.text_relayed)}</textarea></label>
      <div><p style="font-weight:700;font-size:14px;margin-bottom:6px">${sum ? "무엇에 관한 정리인가요?" : "어떤 이미지에서 나온 생각인가요?"} <span class="mut" style="font-weight:400">없으면 비워 둬요</span></p>
        <div class="srcs"><button type="button" class="src" data-rel="concept" aria-pressed="${rel.has("concept")}">콘셉트</button>${S.nodes.map((n) => `<button type="button" class="src" data-rel="${n.id}" aria-pressed="${rel.has(n.id)}">${n.image_url ? `<img src="${esc(n.image_url)}" alt="">` : ""}${esc(tagOf(n))}</button>`).join("") || `<span class="mut">아직 이미지가 없어요.</span>`}</div></div>
      <div class="row"><button class="primary" id="keep">남기기</button><button class="sec" id="drop">지우기</button></div>`
    : `<p style="font-size:15px;line-height:1.6">${esc(i.text_final ?? i.text_relayed)}</p>
      ${i.text_final && i.text_final !== i.text_relayed ? `<p class="mut">${sum ? "AI가 처음 정리한 문장" : "처음 옮겨진 말"}: "${esc(i.text_relayed)}"</p>` : ""}
      ${i.text_final && i.text_final !== i.text_relayed ? "" : `<p class="mut">${sum ? "AI가 정리한 문장 그대로 남겼어요." : ""}</p>`}
      <p class="mut">관련: ${[i.about === "concept" ? "콘셉트" : null, ...i.related.map((r) => nodeById(r)?.letter)].filter(Boolean).join(" + ") || "없음"}</p>
      <button class="sec" data-act="child">여기서 이어서 이미지 올리기</button>`}
  </aside>`;
}

// 메모·정리를 관련 대상(콘셉트, 이미지별, 연결 없음)으로 묶어 보여 준다
function groups(memos) {
  const line = (i) => `<li><button class="ghost" data-go="${i.id}">${esc(i.letter)}</button> ${esc(i.text)}${i.status === "proposed"
    ? ` <span class="mut">(확인 전)</span> <button class="sec mini" data-keep="${i.id}">남기기</button> <button class="ghost" data-drop="${i.id}">지우기</button>` : ""}</li>`;
  const sec = (title, arr) => arr.length ? `<p class="mut" style="font-weight:700;margin-top:8px">${title}</p><ul class="hist" style="font-size:14px;color:#111">${arr.map(line).join("")}</ul>` : "";
  return sec("콘셉트", memos.filter((i) => i.about === "concept"))
    + S.nodes.map((n) => sec(esc(tagOf(n)), memos.filter((i) => i.related.includes(n.id)))).join("")
    + sec("연결 없음", memos.filter((i) => i.about !== "concept" && !i.related.some((r) => S.nodes.some((n) => n.id === r))));
}

function renderWrap() {
  const by = (lb) => S.nodes.filter((n) => (n.judgment?.label ?? null) === lb);
  const kept = ideaItems().filter((i) => i.status === "kept"), pend = ideaItems().filter((i) => i.status === "proposed");
  const list = (arr) => arr.length ? `<div class="srcs">${arr.map((n) => `<button type="button" class="src" data-go="${n.id}">${n.image_url ? `<img src="${esc(n.image_url)}" alt="">` : ""}${esc(tagOf(n))}</button>`).join("")}</div>` : `<p class="mut">없음</p>`;
  const crit = S.criteria.filter((c) => c.status === "confirmed").sort((a, b) => (a.rank ?? 1) - (b.rank ?? 1) || a.created_at.localeCompare(b.created_at));
  root.innerHTML = `<div class="start" style="max-width:760px"><h1>오늘 정리</h1>
    <p><span class="mut">콘셉트</span><br>${esc(S.concept ?? S.session.intent ?? "")}</p>
    ${S.concepts?.length ? `<p class="mut">처음 콘셉트: ${esc(S.session.intent ?? "")} → ${S.concepts.length}번 고침</p>` : ""}
    <div><h2 style="font-size:14px;margin:0 0 8px">판단 기준의 변화 ${crit.some((c) => c.change_type !== "처음") ? `(${crit.filter((c) => c.change_type !== "처음").length}번 바뀜)` : "(처음 그대로)"}</h2>
      <ol class="tl">${crit.map((c) => `<li><span class="tg">${c.rank ?? 1}순위 · ${esc(c.change_type)}</span><span class="mut">${esc(c.created_at.slice(5, 16).replace("T", " "))}</span><p>${esc(c.text)}</p></li>`).join("")}</ol></div>
    <div><h2 style="font-size:14px;margin:0 0 8px">판단 전 ${by(null).length}개 <span class="mut" style="font-weight:400">눌러서 지금 판단하거나, 그대로 두어도 돼요</span></h2>${list(by(null))}</div>
    ${["선택", "보류", "아직 모르겠어요", "제외"].map((lb) => `<div><h2 style="font-size:14px;margin:0 0 8px">${lb} ${by(lb).length}개</h2>${list(by(lb))}</div>`).join("")}
    <div><h2 style="font-size:14px;margin:0 0 8px">메모·대화 정리 ${kept.length}개 남김${pend.length ? ` · 확인 전 ${pend.length}개` : ""}</h2>
      ${kept.length || pend.length ? groups([...kept, ...pend]) : `<p class="mut">없음</p>`}</div>
    <button class="primary" data-act="back">캔버스로 돌아가기</button></div>`;
  root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { sel = b.dataset.go; mode = "canvas"; render(); }));
  // 확인 전 메모·정리를 여기서 한 번에 처리(문장을 고치려면 이름을 눌러 캔버스에서)
  const resolve = (id, keep) => async () => {
    const i = ideaItems().find((x) => x.id === id);
    try { S = await call("app_resolve_idea", { idea_id: id, keep, related: i.related, concept: i.about === "concept" }); } catch (e) { return toast(e.message); }
    await tellModel(`${summary()}\n학생이 ${i.letter}를 ${keep ? "남겼습니다" : "지웠습니다"}.`);
    renderWrap();
  };
  root.querySelectorAll("[data-keep]").forEach((b) => (b.onclick = resolve(b.dataset.keep, true)));
  root.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = resolve(b.dataset.drop, false)));
  root.querySelector('[data-act="back"]').onclick = () => { mode = "canvas"; render(); };
}

function renderStart() {
  const crit = (r, req) => `<div class="cr"><label class="f"><span>${r}순위${req ? "" : ' <span class="mut" style="font-weight:400">· 선택</span>'}</span><textarea id="c${r}" rows="2"></textarea></label>
    ${r === 1 ? `<label class="f sub"><span>이 기준은 콘셉트의 어느 부분에서 나왔나요? <span class="mut">· 선택</span></span><textarea id="b1" rows="2"></textarea></label>` : ""}</div>`;
  root.innerHTML = `<div class="start"><h1>탐색 시작</h1>
  <p class="mut">대화를 시작하기 전에 직접 적어 주세요.</p>
  <label class="f">디자인 콘셉트<span class="q">누구를 위한, 무엇을, 어떤 경험으로 만들려고 하나요?</span><textarea id="intent" rows="3"></textarea></label>
  <div class="cblock"><p class="f" style="margin:0">판단 기준<span class="q">결과를 고를 때 무엇을 먼저 볼 건가요?</span></p>
    <p class="mut">지금 가장 먼저 볼 것을 적어 주세요. 확실하지 않아도 괜찮아요. 바뀌면 언제든 고쳐 적을 수 있어요.</p>
    ${crit(1, true)}${crit(2)}${crit(3)}</div>
  <button class="primary" id="go" disabled>저장하고 캔버스 열기</button>
  ${S?.session ? `<p class="mut">지금 탐색(콘셉트: ${esc(S.session.intent ?? "-")})은 지워지지 않고 그대로 남아요. <button class="ghost" id="back">지난 탐색 이어가기</button></p>` : ""}
  <p class="note">여기에는 내가 올린 이미지와 내가 고른 출처·판단·기준만 저장돼요. 대화는 평소처럼 ChatGPT·Claude 창에서 해요.</p></div>`;
  const $ = (q) => root.querySelector(q);
  const go = $("#go"), i = $("#intent"), c1 = $("#c1");
  i.oninput = c1.oninput = () => (go.disabled = !(i.value.trim() && c1.value.trim()));
  const back = $("#back"); if (back) back.onclick = () => { mode = "canvas"; render(); };
  go.onclick = async () => {
    go.disabled = true;
    const criteria = [1, 2, 3].map((r) => ({ rank: r, text: $(`#c${r}`).value, basis: r === 1 ? $("#b1").value : undefined })).filter((c) => c.text.trim());
    try { S = await call("app_save_session", { intent: i.value, criteria }); mode = "canvas"; sel = null; }
    catch (e) { go.disabled = false; return toast(e.message); }
    await tellModel(`학생이 디자인 콘셉트와 판단 기준을 직접 적었습니다.\n콘셉트: "${i.value.trim()}"\n${criteria.map((c) => `${c.rank}순위 기준: "${c.text.trim()}"`).join("\n")}\n캔버스에 이미지를 올리면 알파벳(A, B…)이 붙습니다.`);
    render();
  };
}

// ---------- 이벤트 ----------
function bind() {
  root.querySelectorAll("[data-node]").forEach((b) => {
    b.onclick = () => { if (dragged) { dragged = false; return; } sel = b.dataset.node; render(); };
    if (!b.classList.contains("mini")) b.onpointerdown = (e) => startDrag(e, b, b.dataset.node);
  });
  const act = (k, f) => root.querySelectorAll(`[data-act="${k}"]`).forEach((b) => (b.onclick = f));
  act("close", () => { sel = null; render(); });
  root.querySelectorAll("[data-drag]").forEach((g) => (g.onpointerdown = (e) => { if (e.target.closest("button")) return; startDrag(e, g, g.dataset.drag); }));
  root.querySelectorAll("[data-gedit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openGroup(groupItems().find((g) => g.id === b.dataset.gedit)); }));
  act("upload", () => pickFile(S.focus_node_id ? [S.focus_node_id] : []));
  act("child", () => pickFile([sel]));
  act("zin", () => setScale(scale + 0.1));
  act("zout", () => setScale(scale - 0.1));
  act("fit", () => { fit(); call("app_event", { type: "zoom_fit" }).catch(() => {}); });
  act("full", async () => { try { const r = await app.requestDisplayMode({ mode: "fullscreen" }); hostMode = r?.mode || hostMode; render(); } catch {} });
  act("crit", () => openCriterion());
  act("new", () => { mode = "start"; render(); });
  act("relayout", async () => { try { S = await call("app_reset_positions"); } catch (e) { return toast(e.message); } render(); });
  act("more", () => { showMore = !showMore; render(); });
  act("wrap", () => { mode = "wrap"; render(); call("app_event", { type: "wrap_view" }).catch(() => {}); });
  act("prop-ok", () => openCriterion(S.proposal));
  act("prop-no", async () => { S = await call("app_save_criterion", { proposal_id: S.proposal.id, dismiss: true }); toast("정리 제안을 넘겼어요"); render(); });
  act("talk", async () => {
    const nd = nodeById(sel);
    S = await call("app_event", { type: "focus", node_id: nd.id }).then(() => call("app_get_state"));
    await tellModel(`${summary()}\n학생이 ${tagOf(nd)}에 대해 이야기하려고 합니다. 이미지가 필요하면 view_image로 볼 수 있습니다.`);
    render(); await say(`${tagOf(nd)}에 대해 이야기해 볼게요.`);
  });
  const ip = root.querySelector(".panel #keep")?.closest(".panel");
  if (ip) {
    const i = nodeById(sel), rel = new Set(i.related);
    ip.querySelectorAll("[data-rel]").forEach((b) => (b.onclick = () => { const k = b.dataset.rel; rel.has(k) ? rel.delete(k) : rel.add(k); b.setAttribute("aria-pressed", rel.has(k)); }));
    const done = async (keep) => {
      const text = ip.querySelector("#itext").value;
      try { S = await call("app_resolve_idea", { idea_id: i.id, keep, text, related: [...rel].filter((r) => r !== "concept"), concept: rel.has("concept") }); } catch (e) { return toast(e.message); }
      if (!keep) sel = null;
      await tellModel(`${summary()}\n학생이 ${i.letter}를 ${keep ? `남겼습니다: "${text.trim()}"` : "지웠습니다"}.`);
      toast(keep ? `${i.letter}를 남겼어요` : `${i.letter}를 지웠어요`); render();
    };
    ip.querySelector("#keep").onclick = () => done(true);
    ip.querySelector("#drop").onclick = () => done(false);
  }
  const panel = root.querySelector(".panel #saveJ")?.closest(".panel");
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
      judgeCtx = null;
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

// 끌어 옮기기: 4px 이상 움직이면 옮기기로 보고, 놓을 때 위치를 저장한다(클릭은 그대로 선택)
let dragged = false;
function startDrag(e, el, id) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY, left0 = el.offsetLeft, top0 = el.offsetTop;
  let moving = false;
  const move = (ev) => {
    const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
    if (!moving && Math.hypot(dx, dy) * scale < 4) return;
    moving = true; el.classList.add("dragging");
    el.style.left = Math.max(0, left0 + dx) + "px"; el.style.top = Math.max(0, top0 + dy) + "px";
  };
  const up = async () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    if (!moving) return;
    dragged = true; setTimeout(() => (dragged = false), 0); el.classList.remove("dragging");
    const x = el.offsetLeft, y = el.offsetTop;
    S.positions = { ...(S.positions || {}), [id]: { x, y } };
    render();
    try { await call("app_set_position", { item_id: id, x, y }); } catch (err) { toast(err.message); }
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
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
fileInput.multiple = true;
fileInput.onchange = () => {
  const fs = [...(fileInput.files || [])].filter((f) => f.type.startsWith("image/"));
  if (fs.length > 1) openBatch(fs, pendingParents, "한꺼번에"); else if (fs[0]) openSource(fs[0], pendingParents, "버튼");
};

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
    const fs = [...(e.dataTransfer?.files || [])].filter((x) => x.type.startsWith("image/"));
    const on = !!target, parents = target ? [target] : (S.focus_node_id ? [S.focus_node_id] : []);
    target = null;
    if (!fs.length) return toast("이미지 파일을 끌어다 놓아 주세요. 웹 페이지의 이미지는 먼저 저장해요.");
    if (fs.length > 1) openBatch(fs, parents, "한꺼번에", on); else openSource(fs[0], parents, "끌어다 놓기", on);
  });
}

function shrink(file, max = 1400, q = 0.86) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("파일을 읽지 못했어요"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("이미지를 열지 못했어요"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function openSource(file, preset, origin, dropOn = false) {
  let data, thumb;
  try { data = await shrink(file); thumb = await shrink(file, 768, 0.8); } catch (e) { return toast(e.message); }
  const chosen = new Set(preset.filter((p) => nodeById(p)));
  const auto = preset.length > 0;
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-label="이미지 올리기">
    <h2>새 이미지 ${esc(nextLetter())}</h2><img class="prev" src="${data}" alt="">
    <label class="f">이름 (선택)<input type="text" id="nm" maxlength="40" placeholder="예: 벽 반사"></label>
    <div><p style="font-weight:700;font-size:14px">어디서 이어졌나요? <span class="mut" style="font-weight:400">여러 개 고를 수 있어요</span></p>
      ${auto ? `<p class="mut">${dropOn ? "놓은 이미지" : "마지막으로 이야기한 이미지"}를 미리 골라 두었어요. 맞지 않으면 바꿔 주세요.</p>` : ""}
      <div class="srcs" style="margin-top:8px">${sourceChoices().map((n) => `<button type="button" class="src" data-src="${n.id}" aria-pressed="${chosen.has(n.id)}">
        ${n.image_url ? `<img src="${esc(n.image_url)}" alt="">` : ""}${esc(tagOf(n))}</button>`).join("") || `<span class="mut">아직 이미지가 없어요. 처음 시작으로 올라가요.</span>`}</div>
      <p class="mut" style="margin-top:6px" id="srcHint"></p></div>
    <div class="row"><button class="primary" id="ok">올리기</button><button class="sec" id="cancel">취소</button></div></div>`;
  document.body.appendChild(scrim); // root 밖에 붙여야 화면을 다시 그려도 창이 닫히지 않는다
  const hint = () => (scrim.querySelector("#srcHint").textContent = chosen.size ? `출처: ${[...chosen].map((c) => nodeById(c).letter).join(" + ")}` : "아무것도 고르지 않으면 처음 시작(새 갈래)으로 올라가요.");
  hint();
  scrim.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.src; chosen.has(k) ? chosen.delete(k) : chosen.add(k); b.setAttribute("aria-pressed", chosen.has(k)); hint();
  }));
  scrim.querySelector("#cancel").onclick = () => { scrim.remove(); call("app_event", { type: "upload_cancel" }).catch(() => {}); };
  scrim.querySelector("#ok").onclick = async (e) => {
    e.target.disabled = true;
    try { S = await call("app_add_node", { image: data, thumb, name: scrim.querySelector("#nm").value, parents: [...chosen], origin }); }
    catch (err) { e.target.disabled = false; return toast(err.message); }
    scrim.remove();
    const nd = S.nodes.at(-1); sel = nd.id;
    await tellModel(`${summary()}\n학생이 ${tagOf(nd)}를 올렸습니다${nd.parents.length ? ` (출처: ${nd.parents.map((p) => nodeById(p)?.letter).join("+")})` : ""}.`);
    render();
    requestAnimationFrame(() => root.querySelector(`[data-node="${nd.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
}
// ---------- 한꺼번에 올리기 = 생성 묶음(라운드) ----------
// 출처는 묶음 단위. 미리 고른 출처를 학생이 손대지 않으면 '자동 · 확인 전'으로 저장해 학생이 고른 출처와 섞이지 않게 한다.
const BATCH_MAX = 8;
async function openBatch(files, preset, origin, dropOn = false) {
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet"><h2>한꺼번에 올리기</h2><p class="mut" id="prep">이미지 준비 중… 0/${files.length}</p></div>`;
  document.body.appendChild(scrim);
  const list = [];
  for (const [k, f] of files.entries()) {
    try { list.push({ data: await shrink(f), thumb: await shrink(f, 768, 0.8), on: list.length < BATCH_MAX }); } catch { /* 못 읽은 파일은 뺀다 */ }
    scrim.querySelector("#prep").textContent = `이미지 준비 중… ${k + 1}/${files.length}`;
  }
  if (!list.length) { scrim.remove(); return toast("이미지를 읽지 못했어요."); }
  const chosen = new Set(preset.filter((p) => nodeById(p)));
  let touched = false, gid = null, name = "";
  const base = S.nodes.length;
  const letterAt = (n) => { let s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const lettersOf = (set) => [...set].map((c) => nodeById(c)?.letter).filter(Boolean).join(" + ");
  const draw = () => {
    let k = 0;
    const n = list.filter((x) => x.on).length;
    scrim.querySelector(".sheet").innerHTML = `<h2>한꺼번에 올리기 · ${(S.groups?.length ?? 0) + 1}라운드</h2>
      <p class="mut">한 번에 ${BATCH_MAX}장까지 올려요. 빼고 싶은 이미지는 눌러서 체크를 풀어요.${files.length > list.length ? ` 읽지 못한 파일 ${files.length - list.length}개는 뺐어요.` : ""}</p>
      <div class="bgrid">${list.map((it, i) => `<button type="button" class="bimg" aria-pressed="${it.on}" data-bi="${i}"><img src="${it.data}" alt=""><span>${it.on ? letterAt(base + k++) : "빠짐"}</span></button>`).join("")}</div>
      <label class="f"><span>묶음 이름 <span class="mut" style="font-weight:400">· 선택</span></span><input type="text" id="gn" maxlength="40" value="${esc(name)}"></label>
      <div><p style="font-weight:700;font-size:14px">어디서 이어졌나요? <span class="mut" style="font-weight:400">묶음 전체에 붙어요</span></p>
        <div class="srcs" style="margin-top:8px">${sourceChoices().map((s) => `<button type="button" class="src" data-src="${s.id}" aria-pressed="${chosen.has(s.id)}">${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : ""}${esc(tagOf(s))}</button>`).join("") || `<span class="mut">아직 이미지가 없어요. 처음 시작으로 올라가요.</span>`}</div>
        <p class="mut" style="margin-top:6px">${chosen.size && !touched
          ? `${dropOn ? "놓은 이미지" : "마지막으로 이야기한 이미지"}(${lettersOf(chosen)})를 미리 골라 두었어요. 그대로 두면 '자동 · 확인 전'으로 저장돼요. 누르면 내가 고른 출처가 돼요.`
          : chosen.size ? `출처: ${lettersOf(chosen)}` : "아무것도 고르지 않으면 처음 시작(새 갈래)으로 올라가요."}</p></div>
      <div class="row"><button class="primary" id="ok" ${n ? "" : "disabled"}>${n}장 올리기</button><button class="sec" id="cancel">취소</button></div>
      <p class="mut" id="prog" role="status"></p>`;
    scrim.querySelector("#gn").oninput = (e) => (name = e.target.value);
    scrim.querySelectorAll("[data-bi]").forEach((b) => (b.onclick = () => {
      const it = list[+b.dataset.bi];
      if (!it.on && list.filter((x) => x.on).length >= BATCH_MAX) return toast(`한 번에 ${BATCH_MAX}장까지예요.`);
      it.on = !it.on; draw();
    }));
    scrim.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => { const id = b.dataset.src; touched = true; chosen.has(id) ? chosen.delete(id) : chosen.add(id); draw(); }));
    scrim.querySelector("#cancel").onclick = () => { scrim.remove(); call("app_event", { type: "upload_cancel" }).catch(() => {}); };
    scrim.querySelector("#ok").onclick = () => upload(list.filter((x) => x.on));
  };
  const upload = async (todo) => {
    const ok = scrim.querySelector("#ok"), prog = scrim.querySelector("#prog");
    if (ok) ok.disabled = true;
    try {
      if (!gid) { const r = await call("app_add_group", { name, parents: [...chosen], parents_auto: !touched }); gid = r.created_group; S = r; }
    } catch (e) { if (ok) ok.disabled = false; return toast(e.message); }
    const failed = [];
    for (const [k, it] of todo.entries()) {
      prog.textContent = `올리는 중… ${k + 1}/${todo.length}`;
      try { S = await call("app_add_node", { image: it.data, thumb: it.thumb, parents: [], origin, group_id: gid }); }
      catch { failed.push(it); }
    }
    if (failed.length) {
      prog.innerHTML = `${failed.length}장을 올리지 못했어요. <button class="sec mini" id="retry">다시 시도</button> <button class="ghost" id="skip">그만두기</button>`;
      prog.querySelector("#retry").onclick = () => upload(failed);
      prog.querySelector("#skip").onclick = finish;
      return;
    }
    finish();
  };
  const finish = async () => {
    scrim.remove();
    const g = groupItems().find((x) => x.id === gid);
    if (g) await tellModel(`${summary()}\n학생이 ${g.letter}로 이미지 ${g.members.length}장(${g.members.map((m) => nodeById(m)?.letter).join(", ")})을 한꺼번에 올렸습니다.`);
    render();
  };
  draw();
}

function openGroup(g) {
  if (!g) return;
  const members = new Set(g.members), chosen = new Set(g.parents);
  let name = g.name ?? "";
  const scrim = document.createElement("div"); scrim.className = "scrim";
  const draw = () => {
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(g.letter)}"><h2>${esc(g.letter)}</h2>
      <label class="f"><span>묶음 이름 <span class="mut" style="font-weight:400">· 선택</span></span><input type="text" id="gn" maxlength="40" value="${esc(name)}"></label>
      <div><p style="font-weight:700;font-size:14px">어디서 이어졌나요?</p>
        ${g.parents_auto ? `<p class="mut">지금 출처는 화면이 미리 고른 것이에요(자동 · 확인 전). 맞으면 그대로, 아니면 고쳐서 확인을 눌러 주세요.</p>` : ""}
        <div class="srcs" style="margin-top:8px">${sourceChoices(new Set([g.id, ...members])).map((s) => `<button type="button" class="src" data-src="${s.id}" aria-pressed="${chosen.has(s.id)}">${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : ""}${esc(tagOf(s))}</button>`).join("")}</div></div>
      <div class="row"><button class="primary" id="ok">확인</button><button class="sec" id="cancel">닫기</button></div></div>`;
    scrim.querySelector("#gn").oninput = (e) => (name = e.target.value);
    scrim.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => { const id = b.dataset.src; chosen.has(id) ? chosen.delete(id) : chosen.add(id); draw(); }));
    scrim.querySelector("#cancel").onclick = () => scrim.remove();
    scrim.querySelector("#ok").onclick = async () => {
      try { S = await call("app_set_group", { group_id: g.id, parents: [...chosen], name }); } catch (e) { return toast(e.message); }
      scrim.remove(); await tellModel(`${summary()}\n학생이 ${g.letter}의 출처를 확인했습니다.`); render();
    };
  };
  document.body.appendChild(scrim); draw();
}

const nextLetter = () => { let n = S.nodes.length, s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------- 기준 ----------
function openCriterion(proposal, words) {
  let change = null, rank = proposal?.rank ?? 1;
  const textFor = (r) => proposal?.text ?? curCrit().find((c) => (c.rank ?? 1) === r)?.text ?? "";
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-label="기준 변화 기록">
    <h2>판단 기준 기록</h2>
    <ol class="tl">${S.criteria.filter((c) => c.status !== "proposed" && c.status !== "superseded").map((c) =>
      `<li><span class="tg">${c.rank ?? 1}순위 · ${esc(c.status === "dismissed" ? "넘긴 제안" : c.change_type)}</span><span class="mut">${esc(c.created_at.slice(5, 16).replace("T", " "))}</span><p>${esc(c.text)}</p></li>`).join("")}</ol>
    ${proposal ? "" : `<div><p style="font-weight:700;font-size:14px;margin-bottom:6px">어느 기준인가요?</p>
      <div class="chips" role="group" aria-label="기준 순위">${[1, 2, 3].map((r) => `<button type="button" aria-pressed="${r === rank}" data-rk="${r}">${r}순위${curCrit().some((c) => (c.rank ?? 1) === r) ? "" : " (새로)"}</button>`).join("")}</div></div>`}
    ${words ? `<p class="note">대화에서 내가 한 말: "${esc(words)}"</p>` : ""}
    ${proposal ? `<p class="note">정리 제안(AI 작성, 확인 전): ${esc(proposal.text)}<br>그대로 쓰거나 내 말로 고쳐서 기록하세요.</p>` : ""}
    <div><p style="font-weight:700;font-size:14px;margin-bottom:6px">어떤 변화인가요?</p>
      <div class="chips" role="group" aria-label="변화 종류">${CHANGES.map((c) => `<button type="button" aria-pressed="false" data-ch="${c}">${c}</button>`).join("")}</div></div>
    <label class="f"><span id="ctl">지금의 ${rank}순위 기준</span><textarea id="ct" rows="3">${esc(textFor(rank))}</textarea></label>
    <details id="cdet"><summary style="font-size:14px;font-weight:700;cursor:pointer">디자인 콘셉트도 바뀌었나요?</summary>
      <label class="f" style="margin-top:8px">지금의 디자인 콘셉트<textarea id="cc" rows="3">${esc(S.concept ?? S.session.intent ?? "")}</textarea></label></details>
    <p class="mut">이전 기준과 콘셉트는 지워지지 않고 기록에 남아요. 기준만, 콘셉트만 기록해도 돼요.</p>
    <div class="row"><button class="primary" id="ok" disabled>기록</button><button class="sec" id="cancel">닫기</button></div></div>`;
  document.body.appendChild(scrim); // root 밖에 붙여야 화면을 다시 그려도 창이 닫히지 않는다
  const ok = scrim.querySelector("#ok"), ct = scrim.querySelector("#ct"), cc = scrim.querySelector("#cc");
  const concept0 = cc.value.trim(), conceptChanged = () => cc.value.trim() && cc.value.trim() !== concept0;
  const upd = () => (ok.disabled = !((change && ct.value.trim()) || conceptChanged()));
  cc.oninput = upd;
  scrim.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => {
    change = b.dataset.ch; scrim.querySelectorAll("[data-ch]").forEach((x) => x.setAttribute("aria-pressed", x === b)); upd();
  }));
  ct.oninput = upd;
  scrim.querySelectorAll("[data-rk]").forEach((b) => (b.onclick = () => {
    rank = +b.dataset.rk; scrim.querySelectorAll("[data-rk]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    scrim.querySelector("#ctl").textContent = `지금의 ${rank}순위 기준`; ct.value = textFor(rank); upd();
  }));
  scrim.querySelector("#cancel").onclick = () => scrim.remove();
  ok.onclick = async () => {
    ok.disabled = true;
    const done = [];
    try {
      if (conceptChanged()) { S = await call("app_save_concept", { text: cc.value }); done.push("디자인 콘셉트를 고쳤습니다"); }
      if (change && ct.value.trim()) { S = await call("app_save_criterion", { change_type: change, text: ct.value, rank, proposal_id: proposal?.id }); done.push(`${rank}순위 기준 변화를 '${change}'(으)로 기록했습니다`); }
    } catch (e) { ok.disabled = false; return toast(e.message); }
    scrim.remove();
    await tellModel(`${summary()}\n학생이 ${done.join(", ")}.`);
    toast(done.length > 1 ? "콘셉트와 기준을 기록했어요" : conceptChanged() ? "콘셉트를 기록했어요" : "기준을 기록했어요"); render();
  };
}

// ---------- 시작 ----------
async function refresh() {
  if (demo || !app || !S?.session || mode === "start" || root.querySelector(".panel textarea:focus") || document.visibilityState !== "visible" || document.querySelector(".scrim")) return;
  try { const n = await call("app_get_state"); const sig = (x) => JSON.stringify([x.proposal?.id, x.nodes.length, x.focus_node_id, (x.ideas || []).map((i) => i.status)]);
    const changed = sig(S) !== sig(n); S = n; if (changed && mode !== "wrap") render(); } catch {}
}

if (demo) {
  if (params.get("broken")) setTimeout(() => markBroken("demo"), 50);
  S = DEMO(); q6 = params.get("q6") || "";
  if (params.get("mode") === "start") S.session = null;
  if (params.get("mode") === "new") mode = "start";
  if (params.get("mode") === "criterion") setTimeout(() => openCriterion(null, params.get("words") || "광원이 보이는 게 문제가 아니라 책상 전체가 고르게 밝은 게 더 중요한 것 같아"));
  if (params.get("sel")) sel = items().find((n) => n.letter === params.get("sel"))?.id ?? null;
  if (params.get("mode") === "judge") { sel = "n1"; judgeCtx = { target: "n1", why: "되돌아감", words: "아까 A가 오히려 나았던 것 같아" }; }
  if (params.get("mode") === "wrap") mode = "wrap";
  render();
} else {
  app = new App({ name: "판단 기록", version: "0.2.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
  let gotResult = false;
  app.ontoolresult = async (p) => {
    const sc = p?.structuredContent; if (!sc || !sc.mode) return;
    gotResult = true;
    // AI 쪽 결과에는 모드만 담고(사용량 절약), 전체 상태는 화면이 따로 받아 온다
    try { S = await call("app_get_state"); } catch { return; }
    mode = sc.mode === "start" ? "start" : sc.mode === "wrap" ? "wrap" : "canvas";
    if (sc.mode === "judge" && sc.target) { sel = sc.target; judgeCtx = { target: sc.target, why: sc.why, words: sc.student_words }; }
    render();
    if (sc.mode === "criterion") openCriterion(null, sc.student_words);
  };
  app.onhostcontextchanged = (ctx) => { if (ctx?.displayMode) hostMode = ctx.displayMode; if (ctx?.availableDisplayModes) avail = ctx.availableDisplayModes; if (S) render(); };
  app.connect().then(async () => {
    const ctx = app.getHostContext?.(); hostMode = ctx?.displayMode || hostMode; avail = ctx?.availableDisplayModes || [];
    try { q6 = (await call("app_config")).q6 || ""; } catch {}
    if (!S && !gotResult) { try { S = await call("app_get_state"); if (!gotResult) render(); } catch { root.innerHTML = `<p class="mut" style="padding:16px">불러오는 중…</p>`; } }
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
    session: { intent: "밤늦게 오래 작업하는 사람이 눈이 편한 상태로 집중할 수 있는 책상 조명" },
    current_criterion: { text: "눈부시지 않을 것", rank: 1 },
    current_criteria: [{ text: "눈부시지 않을 것", rank: 1 }, { text: "책상 위가 고르게 밝을 것", rank: 2 }],
    criteria: [{ id: "c1", rank: 1, change_type: "처음", status: "confirmed", text: "눈부시지 않을 것", basis: "눈이 편한 상태로", created_at: t + "00:00" },
      { id: "c2", rank: 2, change_type: "처음", status: "confirmed", text: "책상 위가 고르게 밝을 것", created_at: t + "00:00" }],
    proposal: { id: "p1", text: "광원이 직접 보이지 않을 것", status: "proposed" },
    focus_node_id: "n3",
    positions: {},
    groups: [{ id: "g1", num: 1, kind: "round", name: null, label: "1라운드", parents: ["n3"], parents_auto: true, created_at: t + "18", members: ["n4", "n5", "n6"] }],
    ideas: [
      { id: "s1", num: 1, label: "정리1", kind: "summary", about: null, text_relayed: "벽 반사는 광원이 안 보이지만, 벽 색에 따라 밝기가 크게 달라진다", text_final: null, related: ["n3"], status: "proposed", created_at: t + "16" },
      { id: "i1", num: 1, label: "메모1", text_relayed: "빛이 벽을 타고 내려오면 책상 전체가 은은해질 것 같아", text_final: null, related: ["n3"], status: "proposed", created_at: t + "14" },
      { id: "i2", num: 2, label: "메모2", text_relayed: "갓 안쪽을 천으로 감싸면?", text_final: "갓 안쪽을 천으로 감싸 빛을 한 번 거르기", related: ["n2"], status: "kept", created_at: t + "08" },
    ],
    nodes: [
      { id: "n1", letter: "A", name: "깊은 갓", parents: [], origin: "버튼", image_url: svgImg("A 깊은 갓", "#3a3a3a", "#9a9a9a"), created_at: t + "05", judgment: { label: "제외", reason: "답답해 보임", created_at: t + "20" }, history: [{ label: "제외", reason: "답답해 보임", created_at: t + "20" }] },
      { id: "n2", letter: "B", name: "확산 패널", parents: [], origin: "버튼", image_url: svgImg("B 확산 패널", "#555", "#ccc"), created_at: t + "06", judgment: { label: "보류", reason: null, created_at: t + "21" }, history: [{ label: "보류", reason: null, created_at: t + "21" }] },
      { id: "n3", letter: "C", name: "벽 반사", parents: ["n1", "n2"], origin: "끌어다 놓기", image_url: svgImg("C 벽 반사", "#222", "#777"), created_at: t + "12", judgment: null, history: [] },
      ...["D", "E", "F"].map((l, k) => ({ id: "n" + (4 + k), letter: l, name: null, parents: [], group_id: "g1", origin: "한꺼번에", image_url: svgImg(l, "#333", ["#888", "#aaa", "#666"][k]), created_at: t + "18", judgment: k === 1 ? { label: "보류", reason: null, created_at: t + "20" } : null, history: [] })),
    ],
  };
}
function demoCall(name, a) {
  const T = new Date().toISOString();
  if (name === "app_save_session") { S = DEMO(); S.focus_node_id = null; S.nodes = []; S.ideas = []; S.proposal = null; S.session = { intent: a.intent };
    S.criteria = a.criteria.map((c, k) => ({ id: "c" + k, rank: c.rank, change_type: "처음", status: "confirmed", text: c.text, basis: c.basis, created_at: T }));
    S.current_criteria = S.criteria.map((c) => ({ text: c.text, rank: c.rank })); S.current_criterion = S.current_criteria[0]; }
  if (name === "app_add_node") { const id = "n" + (S.nodes.length + 1); S.nodes.push({ id, letter: nextLetter(), name: a.name || null, parents: a.group_id ? [] : a.parents, group_id: a.group_id ?? null, origin: a.origin, image_url: a.image, created_at: T, judgment: null, history: [] }); if (a.group_id) S.groups.find((g) => g.id === a.group_id).members.push(id); S.focus_node_id = id; }
  if (name === "app_set_judgment") { const n = nodeById(a.node_id), j = { label: a.label, reason: a.reason?.trim() || null, created_at: T }; n.judgment = j; n.history.push(j); }
  if (name === "app_save_criterion") {
    if (a.proposal_id) S.proposal = null;
    if (!a.dismiss) { const r = a.rank ?? 1; S.criteria.push({ id: "c" + T, rank: r, change_type: a.change_type, status: "confirmed", text: a.text, created_at: T });
      S.current_criteria = [...S.current_criteria.filter((c) => c.rank !== r), { text: a.text, rank: r }].sort((x, y) => x.rank - y.rank); S.current_criterion = S.current_criteria.find((c) => c.rank === 1); }
  }
  if (name === "app_resolve_idea") { const i = S.ideas.find((x) => x.id === a.idea_id); i.status = a.keep ? "kept" : "dismissed"; i.text_final = a.keep ? (a.text?.trim() || i.text_relayed) : null; if (a.related) i.related = a.related; i.about = a.concept ? "concept" : null; }
  if (name === "app_add_group") { const id = "g" + (S.groups.length + 1); S.groups.push({ id, num: S.groups.length + 1, kind: "round", name: a.name || null, label: a.name || `${S.groups.length + 1}라운드`, parents: a.parents, parents_auto: a.parents_auto && a.parents.length > 0, created_at: T, members: [] }); return { ...S, created_group: id }; }
  if (name === "app_set_group") { const g = S.groups.find((x) => x.id === a.group_id); g.parents = a.parents; g.parents_auto = false; g.name = a.name || null; g.label = g.name || `${g.num}라운드`; }
  if (name === "app_save_concept") { S.concepts = [...(S.concepts || []), { text: a.text, created_at: T }]; S.concept = a.text; }
  if (name === "app_set_position") S.positions[a.item_id] = { x: a.x, y: a.y };
  if (name === "app_reset_positions") S.positions = {};
  if (name === "app_event" && a.type === "focus") S.focus_node_id = a.node_id;
  if (name === "app_config") return { q6 };
  return S;
}
