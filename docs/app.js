/* 탐색 기록 모델 — 프론트엔드 (빌드 없이 GitHub Pages에서 그대로 동작) */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const MOCK = CFG.MOCK === true || new URLSearchParams(location.search).has("mock");
  const STORE_KEY = "judgment-recorder:v1";
  const TYPES = ["INTENT", "DISCOVERY", "JUDGMENT", "CRITERION", "MOVE"];
  const TYPE_LABEL = {
    INTENT: "의도", DISCOVERY: "발견", JUDGMENT: "판단", CRITERION: "기준", MOVE: "다음 행동",
  };

  const $ = (id) => document.getElementById(id);

  let state = blankState();

  function blankState() {
    return {
      screen: "login",
      classCode: "",
      team: "",
      sessionId: newId(),
      collect: false,
      consent: false,
      card: { issue: "", image: "", keep: "", question: "" },
      messages: [],
      nodes: [],
      startedAt: new Date().toISOString(),
    };
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ---------- 브라우저 저장 (새로고침 대비, 이 기기에만 남음) ----------
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* 저장 불가 환경 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) state = Object.assign(blankState(), JSON.parse(raw));
    } catch (_) { /* 무시 */ }
  }
  function clearStore() {
    try { localStorage.removeItem(STORE_KEY); } catch (_) { /* 무시 */ }
  }

  // ---------- 서버 호출 ----------
  async function api(body) {
    if (MOCK) return mockApi(body);
    if (!CFG.FUNCTION_URL) throw new Error("config.js에 FUNCTION_URL이 비어 있습니다.");
    const headers = { "Content-Type": "application/json" };
    if (CFG.SUPABASE_ANON_KEY) {
      headers.Authorization = "Bearer " + CFG.SUPABASE_ANON_KEY;
      headers.apikey = CFG.SUPABASE_ANON_KEY;
    }
    const res = await fetch(CFG.FUNCTION_URL, { method: "POST", headers, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (_) { /* 빈 응답 */ }
    if (!res.ok) throw new Error(data.error || "서버 오류 (" + res.status + ")");
    return data;
  }

  function base() {
    return {
      classCode: state.classCode,
      session: { id: state.sessionId, team: state.team, consent: state.consent },
      card: state.card,
    };
  }

  // 서버 없이 화면 흐름을 확인하기 위한 가짜 응답
  let mockTurn = 0;
  function mockApi(body) {
    return new Promise((resolve) => setTimeout(() => {
      if (body.action === "login") return resolve({ ok: true, collect: false });
      if (body.action === "summary") return resolve({ ok: true, stored: false });
      const last = (body.messages || []).slice(-1)[0];
      const text = last ? last.content : "";
      const card = body.card || {};
      const keep = (card.keep || "").split(/[.\n]/)[0].trim().slice(0, 24) || "카드 3번의 항목";
      const said = text.trim().slice(0, 20);
      mockTurn += 1;
      if (mockTurn === 1) return resolve({ reply: "[목업] ‘" + keep + "’은 왜 중요해요?", nodes: [], questionId: "Q1" });
      if (/마무리/.test(text)) {
        return resolve({ reply: "[목업] 처음 알아보고 싶었던 “" + (card.question || "").slice(0, 30) + "”에 대해 무엇을 알아냈나요?", nodes: [], questionId: "Q10" });
      }
      const qs = [
        ["Q2", "‘" + keep + "’은 공간에서는 어떻게 보일까요?"],
        ["NONE", "기록했어요."],
        ["Q4", "지금까지 결과들을 나란히 보면, 처음 기대와 달라진 게 있나요?"],
        ["Q5", "‘" + said + "’을 고르고 나머지는 버렸네요. 왜요?"],
        ["Q6", "처음에는 ‘" + keep + "’을 1순위로 두었는데, 이번 선택은 다르네요. 무엇이 바뀌었나요?"],
      ];
      const [qid, q] = qs[(mockTurn - 2) % qs.length];
      const t = TYPES[mockTurn % TYPES.length];
      resolve({
        reply: "[목업] " + q,
        nodes: text ? [{ type: t, quote: text.slice(0, 60), note: "목업 정리" }] : [],
        questionId: qid,
      });
    }, 400));
  }

  // ---------- 화면 ----------
  function show(screen) {
    state.screen = screen;
    ["Login", "Consent", "Card", "Work"].forEach((s) => {
      $("screen" + s).hidden = s.toLowerCase() !== screen;
    });
    $("topbarRight").hidden = screen !== "work";
    $("teamChip").textContent = state.team;
    if (screen === "work") { renderMessages(); renderNodes(); }
    save();
  }

  function renderMessages() {
    const box = $("messages");
    box.textContent = "";
    state.messages.forEach((m, i) => {
      if (i === 0 && m.role === "user" && m.hidden) return;
      const div = document.createElement("div");
      div.className = "msg " + m.role;
      div.textContent = m.content;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function addPending() {
    const div = document.createElement("div");
    div.className = "msg assistant pending";
    div.id = "pending";
    div.textContent = "기록 모델이 읽고 있어요…";
    $("messages").appendChild(div);
    $("messages").scrollTop = $("messages").scrollHeight;
  }

  function renderNodes() {
    const list = $("nodeList");
    list.textContent = "";
    if (!state.nodes.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "아직 기록된 내용이 없습니다.";
      list.appendChild(p);
      return;
    }
    state.nodes.forEach((n) => list.appendChild(nodeEl(n)));
  }

  function nodeEl(n) {
    const wrap = document.createElement("div");
    wrap.className = "node" + (n.confirmed ? " confirmed" : "");

    const top = document.createElement("div");
    top.className = "node-top";
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "노드 종류");
    TYPES.forEach((t) => {
      const o = document.createElement("option");
      o.value = t; o.textContent = TYPE_LABEL[t] + " · " + t;
      if (t === n.type) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { n.type = sel.value; n.edited = true; nodesChanged(); });
    const spacer = document.createElement("span"); spacer.className = "spacer";
    const del = document.createElement("button");
    del.type = "button"; del.className = "btn ghost small"; del.textContent = "지우기";
    del.addEventListener("click", () => {
      state.nodes = state.nodes.filter((x) => x.id !== n.id);
      nodesChanged(); renderNodes();
    });
    top.append(sel, spacer, del);

    const quote = document.createElement("textarea");
    quote.rows = 2; quote.value = n.quote; quote.setAttribute("aria-label", "원문");
    quote.addEventListener("input", () => { n.quote = quote.value; n.edited = true; nodesChanged(); });

    const note = document.createElement("input");
    note.type = "text"; note.value = n.note || ""; note.placeholder = "짧은 정리";
    note.setAttribute("aria-label", "짧은 정리");
    note.addEventListener("input", () => { n.note = note.value; n.edited = true; nodesChanged(); });

    const check = document.createElement("label");
    check.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!n.confirmed;
    cb.addEventListener("change", () => {
      n.confirmed = cb.checked;
      wrap.classList.toggle("confirmed", cb.checked);
      nodesChanged();
    });
    check.append(cb, document.createTextNode("내 말과 맞아요"));

    wrap.append(top, quote, note, check);
    return wrap;
  }

  function setBusy(b) {
    $("btnSend").disabled = b;
    $("btnFinish").disabled = b;
    $("inMsg").disabled = b;
  }

  // ---------- 노드 수정 자동 저장 (저장이 켜져 있고 동의한 경우에만) ----------
  let syncTimer = null;
  function nodesChanged() {
    save();
    if (!(state.collect && state.consent) || MOCK) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      api(Object.assign(base(), { action: "summary", trigger: "auto", nodes: state.nodes })).catch(() => { /* 다음 수정 때 다시 보냄 */ });
    }, 4000);
  }

  // ---------- 대화 ----------
  async function send(text, opts) {
    const content = (text || "").trim();
    if (!content) return;
    state.messages.push({ role: "user", content, hidden: !!(opts && opts.hidden) });
    save();
    renderMessages();
    addPending();
    setBusy(true);
    try {
      const msgs = state.messages.map((m) => ({ role: m.role, content: m.content }));
      const data = await api(Object.assign(base(), { action: "chat", messages: msgs }));
      state.messages.push({ role: "assistant", content: data.reply || "(빈 응답)", questionId: data.questionId || "" });
      const turn = state.messages.length;
      const fresh = opts && opts.hidden ? [] : (data.nodes || []); // 자동으로 보낸 첫 메시지는 기록하지 않음
      fresh.forEach((n) => {
        state.nodes.push({ id: newId(), type: n.type, quote: n.quote || "", note: n.note || "", confirmed: false, turn });
      });
    } catch (e) {
      state.messages.pop(); // 실패한 메시지는 되돌려 다시 보낼 수 있게
      if (!(opts && opts.hidden)) $("inMsg").value = content;
      state.messages.push({ role: "assistant", content: "오류 · " + e.message, error: true });
      renderMessages();
      state.messages.pop();
      setBusy(false);
      save();
      return;
    }
    save();
    renderMessages();
    renderNodes();
    setBusy(false);
    $("inMsg").focus();
  }

  // ---------- 내보내기 ----------
  function toMarkdown() {
    const c = state.card;
    const date = new Date().toLocaleString("ko-KR");
    const lines = [
      "# 탐색 기록 · " + state.team,
      "",
      "- 기록 시각: " + date,
      "- 세션 번호: " + state.sessionId,
      "",
      "## 기준·의도 카드",
      "1. 프로젝트와 공간 이슈: " + (c.issue || ""),
      "2. 지금 떠오르는 공간: " + (c.image || ""),
      "3. 꼭 지켜야 할 것과 이유: " + (c.keep || ""),
      "4. 알아보고 싶은 질문: " + (c.question || ""),
      "",
      "## 기록",
    ];
    TYPES.forEach((t) => {
      const ns = state.nodes.filter((n) => n.type === t);
      if (!ns.length) return;
      lines.push("", "### " + TYPE_LABEL[t] + " (" + t + ")");
      ns.forEach((n) => {
        lines.push("- “" + n.quote + "”" + (n.note ? " — " + n.note : "") + (n.confirmed ? " ✔" : ""));
      });
    });
    lines.push("", "## 대화 전체");
    state.messages.forEach((m, i) => {
      if (i === 0 && m.hidden) return;
      lines.push("", "**" + (m.role === "user" ? "팀" : "기록 모델") + "**", "", m.content);
    });
    return lines.join("\n");
  }

  async function exportRecord() {
    const blob = new Blob([toMarkdown()], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    a.href = URL.createObjectURL(blob);
    // 일부 브라우저가 한글 파일명을 무시해 영문으로 짓는다. 팀 이름은 파일 안에 있다.
    a.download = "exploration-record_" + stamp + "_" + state.sessionId.slice(0, 6) + ".md";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    if (state.collect && state.consent) {
      clearTimeout(syncTimer);
      try { await api(Object.assign(base(), { action: "summary", trigger: "export", nodes: state.nodes })); } catch (_) { /* 내려받기는 이미 됨 */ }
    }
  }

  function showCard() {
    const v = $("cardView");
    v.textContent = "";
    const dl = document.createElement("dl");
    [["1. 프로젝트와 공간 이슈", state.card.issue], ["2. 지금 떠오르는 공간", state.card.image],
      ["3. 꼭 지켜야 할 것과 이유", state.card.keep], ["4. 알아보고 싶은 질문", state.card.question]]
      .forEach(([k, val]) => {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = val || "(비어 있음)";
        dl.append(dt, dd);
      });
    v.appendChild(dl);
    $("cardDialog").showModal();
  }

  // ---------- 이벤트 ----------
  $("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").textContent = "";
    state.classCode = $("inCode").value.trim();
    state.team = $("inTeam").value.trim();
    try {
      const data = await api({ action: "login", classCode: state.classCode });
      state.collect = !!data.collect;
      show(state.collect ? "consent" : "card");
    } catch (err) {
      $("loginError").textContent = err.message;
    }
  });

  $("btnConsentYes").addEventListener("click", () => { state.consent = true; show("card"); });
  $("btnConsentNo").addEventListener("click", () => { state.consent = false; show("card"); });

  $("formCard").addEventListener("submit", (e) => {
    e.preventDefault();
    state.card = {
      issue: $("cIssue").value.trim(),
      image: $("cImage").value.trim(),
      keep: $("cKeep").value.trim(),
      question: $("cQuestion").value.trim(),
    };
    show("work");
    if (!state.messages.length) send("팀 카드를 입력했어요.", { hidden: true });
  });

  $("formSend").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("inMsg").value;
    $("inMsg").value = "";
    send(t);
  });
  $("inMsg").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      $("formSend").requestSubmit();
    }
  });
  $("btnFinish").addEventListener("click", () => send("마무리할게요."));

  $("btnAddNode").addEventListener("click", () => {
    state.nodes.push({ id: newId(), type: "DISCOVERY", quote: "", note: "", confirmed: false, manual: true, turn: state.messages.length });
    nodesChanged(); renderNodes();
  });
  $("btnExport").addEventListener("click", exportRecord);
  $("btnShowCard").addEventListener("click", showCard);
  $("btnReset").addEventListener("click", () => {
    if (!window.confirm("새로 시작하면 이 기기에 남은 기록이 지워집니다. 먼저 정리본을 내려받았나요?")) return;
    const keep = { classCode: state.classCode, team: state.team, collect: state.collect };
    clearStore();
    state = Object.assign(blankState(), keep);
    mockTurn = 0;
    ["cIssue", "cImage", "cKeep", "cQuestion"].forEach((id) => { $(id).value = ""; });
    show(state.collect ? "consent" : "card");
  });

  // ---------- 시작 ----------
  load();
  $("inTeam").value = state.team || "";
  ["issue", "image", "keep", "question"].forEach((k) => {
    const id = { issue: "cIssue", image: "cImage", keep: "cKeep", question: "cQuestion" }[k];
    $(id).value = state.card[k] || "";
  });
  if (MOCK) document.title = "[목업] " + document.title;
  show(state.screen && state.classCode ? state.screen : "login");
})();
