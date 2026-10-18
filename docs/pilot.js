/* 기록 모델 파일럿 점검: 시나리오를 실제 서버에 넣고 기대한 질문 번호와 비교한다. */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).has("mock");
  const $ = (id) => document.getElementById(id);

  const CARD = {
    issue: "혼자 사는 노인을 위한 동네 거실",
    image: "골목에서 살짝 들여다보이는 낮은 창이 있는 방",
    keep: "1. 들어오자마자 내부가 다 보이지 않을 것. 처음 온 사람이 숨을 곳이 필요해서\n2. 앉을 자리가 여러 높이일 것. 몸 상태가 다 달라서",
    question: "시선을 막지 않고도 혼자 있는 느낌을 줄 수 있을까?",
  };

  // 카드 질문이 끝나고 탐색을 시작하는 시점까지의 대화
  const AFTER_CARD = [
    ["user", "팀 카드를 입력했어요."],
    ["assistant", "‘들어오자마자 내부가 다 보이지 않을 것’은 왜 중요해요?"],
    ["user", "처음 온 사람이 바로 시선을 받으면 다시 안 올 것 같아서요."],
    ["assistant", "‘들어오자마자 내부가 다 보이지 않을 것’은 공간에서는 어떻게 보일까요?"],
    ["user", "입구에서 한 번 꺾이는 동선이요."],
    ["assistant", "‘앉을 자리가 여러 높이일 것’은 왜 중요해요?"],
    ["user", "어르신마다 무릎 상태가 달라서요."],
    ["assistant", "‘앉을 자리가 여러 높이일 것’은 공간에서는 어떻게 보일까요?"],
    ["user", "계단식 단이나 높이가 다른 벤치요."],
    ["assistant", "카드에 더하거나 고칠 것이 있나요?"],
    ["user", "없어요."],
    ["assistant", "이제 AI 리서치를 시작해 보세요. 결과를 여기에 붙여 넣거나 설명해 주시면 기록할게요."],
  ];

  const SCENARIOS = [
    {
      id: "S1", title: "카드 질문 흐름", history: [],
      turns: [
        { user: "팀 카드를 입력했어요.", expect: ["Q1"] },
        { user: "처음 온 사람이 바로 시선을 받으면 다시 안 올 것 같아서요.", expect: ["Q2"] },
        { user: "입구에서 한 번 꺾이는 동선이요.", expect: ["Q1"] },
        { user: "어르신마다 무릎 상태가 달라서요.", expect: ["Q2"] },
        { user: "계단식 단이나 높이가 다른 벤치요.", expect: ["Q3"] },
        { user: "없어요.", expect: ["NONE"] },
      ],
    },
    {
      id: "S2", title: "고르고 버림 (이유 없음)", history: AFTER_CARD,
      turns: [{
        user: "GPT에 도서관, 교도소, 무대를 교차해서 물어봤어요. 결과는 1) 도서관 서가 사이의 시선 차단 2) 교도소 감시탑의 한눈에 보기 3) 무대 객석의 경사. 1번이랑 3번 남기고 2번은 뺐어요.",
        expect: ["Q5"],
      }],
    },
    {
      id: "S3", title: "카드 1순위와 어긋난 선택", history: AFTER_CARD,
      turns: [{
        user: "결과 중에 입구에서 내부가 한눈에 보이는 개방형 로비가 제일 좋아서 그걸로 가기로 했어요. 밝고 환영하는 느낌이라서요.",
        expect: ["Q6"],
      }],
    },
    {
      id: "S4", title: "AI 문장을 그대로 옮긴 이유", history: AFTER_CARD,
      turns: [{
        user: "서가 사이 시선 차단을 채택했어요. 이유: 이 접근은 사용자 중심적 관점에서 공간의 포용성과 접근성을 극대화하며, 다양한 니즈를 충족시키는 혁신적인 솔루션을 제공합니다.",
        expect: ["Q9"],
      }],
    },
    {
      id: "S5", title: "확인 안 한 사례를 그대로 사용", history: AFTER_CARD,
      turns: [{
        user: "AI가 일본의 ‘하루미 노인 거실’이라는 사례를 알려줬는데 우리랑 딱 같아서 그대로 레퍼런스로 넣을게요.",
        expect: ["Q7"],
      }],
    },
    {
      id: "S6", title: "결과만 붙여 넣기 (비교 없음)", history: AFTER_CARD,
      turns: [
        { user: "결과 1: 도서관 열람실은 칸막이 높이를 낮게 해서 서로 보이지만 방해받지 않게 한다. 정원은 나무 그늘마다 벤치를 흩어 둔다.", expect: ["NONE"] },
        { user: "결과 2: 극장 로비는 동선을 둥글게 돌려 사람들이 마주치게 한다. 목욕탕은 탕의 높이 차로 영역을 나눈다.", expect: ["Q4"] },
      ],
    },
    {
      id: "S7", title: "조언 요청", history: AFTER_CARD,
      turns: [{ user: "어떤 형태가 제일 좋을지 추천해 주세요.", expect: ["NONE"], mustInclude: "조언은 드리지 않" }],
    },
    {
      id: "S8", title: "마무리", history: AFTER_CARD.concat([
        ["user", "서가 사이 시선 차단을 채택했어요. 낮은 칸막이로 보이긴 하지만 혼자 있는 느낌이 들어서요."],
        ["assistant", "기록했어요."],
      ]),
      turns: [
        { user: "마무리할게요.", expect: ["Q10"] },
        { user: "벽이 아니라 높이 차로도 시선을 나눌 수 있다는 걸 알았어요.", expect: ["Q11"] },
        { user: "높이 차가 휠체어 사용자에게는 장벽이 되지 않을까?", expect: ["NONE"] },
      ],
    },
  ];

  async function call(messages) {
    if (MOCK) return mock(messages);
    const headers = { "Content-Type": "application/json" };
    if (CFG.SUPABASE_ANON_KEY) {
      headers.Authorization = "Bearer " + CFG.SUPABASE_ANON_KEY;
      headers.apikey = CFG.SUPABASE_ANON_KEY;
    }
    const res = await fetch(CFG.FUNCTION_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "chat",
        classCode: $("code").value.trim(),
        session: { id: "pilot", team: "pilot", consent: false },
        card: CARD,
        messages,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "서버 오류 " + res.status);
    return data;
  }

  // 서버 없이 화면만 확인하는 가짜 응답
  let mockN = 0;
  function mock(messages) {
    mockN += 1;
    const last = messages[messages.length - 1].content;
    return new Promise((r) => setTimeout(() => r({
      reply: "[목업] 기록했어요.",
      questionId: ["Q1", "Q5", "NONE", "Q6"][mockN % 4],
      nodes: [{ type: "DISCOVERY", quote: last.slice(0, 20), note: "목업", verbatim: mockN % 3 !== 0 }],
      checks: { templateOk: mockN % 5 !== 0, nodes: 1, verbatimNodes: mockN % 3 !== 0 ? 1 : 0 },
      latencyMs: 300 + (mockN * 37) % 900,
    }), 150));
  }

  async function runScenario(sc, results) {
    const messages = sc.history.map(([role, content]) => ({ role, content }));
    for (const t of sc.turns) {
      messages.push({ role: "user", content: t.user });
      const row = { sc, turn: t, got: "", reply: "", checks: null, latencyMs: 0, error: "" };
      const started = performance.now();
      try {
        const d = await call(messages);
        row.got = d.questionId || "";
        row.model = d.model || "";
        row.reply = d.reply || "";
        row.checks = d.checks || null;
        row.latencyMs = d.latencyMs || Math.round(performance.now() - started);
        row.roundTripMs = Math.round(performance.now() - started);
        messages.push({ role: "assistant", content: row.reply || "(빈 응답)" });
      } catch (e) {
        row.error = e.message;
        row.roundTripMs = Math.round(performance.now() - started);
        messages.push({ role: "assistant", content: "기록했어요." });
      }
      row.match = !row.error && t.expect.includes(row.got);
      row.includeOk = t.mustInclude ? row.reply.includes(t.mustInclude) : null;
      results.push(row);
      render(results);
    }
  }

  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "–"; }

  function summarize(results) {
    const ok = results.filter((r) => !r.error);
    const tmpl = ok.filter((r) => r.checks && r.checks.templateOk !== null && r.checks.templateOk !== undefined);
    const nodes = ok.reduce((s, r) => s + ((r.checks && r.checks.nodes) || 0), 0);
    const verb = ok.reduce((s, r) => s + ((r.checks && r.checks.verbatimNodes) || 0), 0);
    const times = results.map((r) => r.roundTripMs || 0);
    const model = (results.find((r) => r.model) || {}).model || "–";
    return {
      "모델": model,
      "질문 번호 일치": pct(results.filter((r) => r.match).length, results.length) + " (" + results.filter((r) => r.match).length + "/" + results.length + ")",
      "질문 틀 준수": pct(tmpl.filter((r) => r.checks.templateOk).length, tmpl.length),
      "인용 원문 일치": pct(verb, nodes) + " (" + verb + "/" + nodes + ")",
      "번호 누락·오류 (MISSING/UNKNOWN)": String(ok.filter((r) => r.got === "MISSING" || r.got === "UNKNOWN").length),
      "평균 응답 시간": times.length ? (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1) + "초" : "–",
      "가장 긴 응답 시간": times.length ? (Math.max(...times) / 1000).toFixed(1) + "초" : "–",
      "오류": String(results.filter((r) => r.error).length),
    };
  }

  function mark(text, bad) {
    const s = document.createElement("span");
    s.className = "mark" + (bad ? " bad" : "");
    s.textContent = text;
    return s;
  }

  function render(results) {
    $("table").hidden = false;
    const tbody = $("rows");
    tbody.textContent = "";
    results.forEach((r) => {
      const tr = document.createElement("tr");
      const td = (v) => { const c = document.createElement("td"); if (v instanceof Node) c.appendChild(v); else c.textContent = v; tr.appendChild(c); return c; };
      td(r.sc.id + " " + r.sc.title);
      td(r.turn.user);
      td(r.turn.expect.join(" / "));
      td(r.error ? mark("오류", true) : mark(r.got || "–", !r.match));
      const t = r.checks ? r.checks.templateOk : null;
      td(t === null || t === undefined ? "–" : mark(t ? "지킴" : "벗어남", !t));
      td(r.checks && r.checks.nodes ? mark(r.checks.verbatimNodes + "/" + r.checks.nodes, r.checks.verbatimNodes < r.checks.nodes) : "–");
      td(((r.roundTripMs || 0) / 1000).toFixed(1) + "초");
      const rep = td(r.error ? r.error : r.reply);
      rep.className = "reply";
      if (r.includeOk === false) rep.prepend(mark("필수 문구 없음", true), document.createTextNode(" "));
      tbody.appendChild(tr);
    });
    const stats = $("stats");
    stats.textContent = "";
    Object.entries(summarize(results)).forEach(([k, v]) => {
      const d = document.createElement("div"); d.className = "stat";
      const vv = document.createElement("div"); vv.className = "v"; vv.textContent = v;
      const kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
      d.append(vv, kk); stats.appendChild(d);
    });
  }

  let lastResults = [];

  function toMarkdown(results) {
    const lines = ["# 기록 모델 파일럿 점검", "", "- 실행 시각: " + new Date().toLocaleString("ko-KR"),
      "- 동시 실행: " + ($("parallel").checked ? "예" : "아니오"), "", "## 요약", ""];
    Object.entries(summarize(results)).forEach(([k, v]) => lines.push("- " + k + ": " + v));
    lines.push("", "## 상세", "", "| 시나리오 | 학생 메시지 | 기대 | 실제 | 틀 | 인용 | 시간(초) | 모델 응답 |", "|---|---|---|---|---|---|---|---|");
    const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
    results.forEach((r) => {
      const t = r.checks ? r.checks.templateOk : null;
      lines.push("| " + [r.sc.id, esc(r.turn.user), r.turn.expect.join("/"), r.error ? "오류" : r.got,
        t === null || t === undefined ? "–" : t ? "지킴" : "벗어남",
        r.checks && r.checks.nodes ? r.checks.verbatimNodes + "/" + r.checks.nodes : "–",
        ((r.roundTripMs || 0) / 1000).toFixed(1), esc(r.error || r.reply)].join(" | ") + " |");
    });
    return lines.join("\n");
  }

  $("run").addEventListener("click", async () => {
    if (!MOCK && !CFG.FUNCTION_URL) { $("progress").textContent = "config.js에 FUNCTION_URL이 비어 있습니다."; return; }
    if (!MOCK && !$("code").value.trim()) { $("progress").textContent = "수업 코드를 넣어 주세요."; return; }
    $("run").disabled = true; $("dl").disabled = true;
    const results = [];
    lastResults = results;
    const total = SCENARIOS.reduce((s, sc) => s + sc.turns.length, 0);
    const timer = setInterval(() => { $("progress").textContent = "실행 중… " + results.length + "/" + total; }, 300);
    try {
      if ($("parallel").checked) await Promise.all(SCENARIOS.map((sc) => runScenario(sc, results)));
      else for (const sc of SCENARIOS) await runScenario(sc, results);
    } finally {
      clearInterval(timer);
      results.sort((a, b) => SCENARIOS.indexOf(a.sc) - SCENARIOS.indexOf(b.sc));
      render(results);
      $("progress").textContent = "완료 · " + results.length + "개 응답";
      $("run").disabled = false; $("dl").disabled = false;
    }
  });

  $("dl").addEventListener("click", () => {
    const blob = new Blob([toMarkdown(lastResults)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pilot-check_" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });

  if (MOCK) $("progress").textContent = "[목업] 서버 없이 화면만 확인합니다.";
})();
