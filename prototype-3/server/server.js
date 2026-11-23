// 3차 모델 연결 시제품 — 하나의 서버가 세 일을 한다.
// 1) /ingest : 크롬 확장이 보내는 대화 원문(학생 발화·AI 응답·이미지)을 받는다.
// 2) /mcp/:code : Claude·ChatGPT가 붙는 MCP 서버. 검토 화면(MCP App)을 띄운다.
// 3) 두 쪽을 참여 코드로 묶어 한 저장소(SQLite)에 남긴다.
import express from "express";
import { DatabaseSync } from "node:sqlite"; // Node 22.13+ 내장 SQLite: 네이티브 빌드가 필요 없다
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(DIR, "data.sqlite3"));
db.exec("PRAGMA journal_mode = WAL");
db.exec(fs.readFileSync(path.join(DIR, "schema.sql"), "utf8"));

const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();
const okCode = (c) => typeof c === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(c) &&
  !!db.prepare("SELECT 1 FROM participants WHERE code=?").get(c);

// ---------- 상태 조회 ----------
function currentSession(code) {
  return db.prepare("SELECT * FROM sessions WHERE code=? ORDER BY created_at DESC LIMIT 1").get(code) || null;
}
function state(code, { rawLimit = 12 } = {}) {
  const session = currentSession(code);
  const sid = session?.id ?? "";
  const lastJudgment = db.prepare("SELECT created_at FROM judgments WHERE session_id=? ORDER BY created_at DESC LIMIT 1").get(sid);
  const raw = db.prepare(
    `SELECT id, host, role, text, images, created_at FROM raw WHERE code=? ORDER BY created_at DESC LIMIT ?`
  ).all(code, rawLimit).map((r) => ({ ...r, images: JSON.parse(r.images || "[]").map((i) => `${PUBLIC_URL}/img/${i}`),
    since_last_review: !lastJudgment || r.created_at > lastJudgment.created_at }));
  const criteria = db.prepare("SELECT * FROM criteria WHERE session_id=? ORDER BY created_at").all(sid);
  const judgments = db.prepare("SELECT * FROM judgments WHERE session_id=? ORDER BY created_at DESC").all(sid)
    .map((j) => ({ ...j, raw_ids: JSON.parse(j.raw_ids || "[]") }));
  return { session, raw: raw.reverse(), criteria, judgments, current_criterion: criteria.filter((c) => c.status === "confirmed").at(-1) || null };
}

// ---------- MCP 서버 (참여 코드별) ----------
const VIEW_URI = "ui://judgment/view.html";
function buildViewHtml() {
  const bundle = fs.readFileSync(path.join(DIR, "node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"), "utf8");
  const m = bundle.match(/export\{([^}]*)\};?\s*$/);
  const appName = m[1].split(",").map((s) => s.trim()).find((s) => / as App$/.test(s)).split(" as ")[0];
  const script = bundle.replace(/export\{[^}]*\};?\s*$/, `const App=${appName};`) + "\n(() => {\n" + fs.readFileSync(path.join(DIR, "view/view.js"), "utf8") + "\n})();";
  const html = fs.readFileSync(path.join(DIR, "view/view.html"), "utf8");
  return html.replace("/*VIEW_SCRIPT*/", () => script);
}

function mcpFor(code) {
  const server = new McpServer({ name: "judgment-recorder-3", version: "0.1.0" });
  const ui = { resourceUri: VIEW_URI };
  const result = (mode, extra = {}) => {
    const s = state(code);
    return {
      content: [{ type: "text", text: mode === "review"
        ? "검토 화면을 열었습니다. 학생이 화면에서 직접 고르고 적을 때까지 판단이나 기준을 대신 정하거나 제안하지 마세요."
        : "화면을 열었습니다. 학생의 입력을 기다리세요." }],
      structuredContent: { mode, code_tail: code.slice(-4), ...s, ...extra },
    };
  };

  registerAppResource(server, "검토 화면", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: buildViewHtml(),
      _meta: { ui: { preferredDisplayMode: "fullscreen", prefersBorder: false,
        csp: { resourceDomains: [PUBLIC_URL], connectDomains: [] } } } }],
  }));

  registerAppTool(server, "start_exploration", {
    title: "탐색 시작",
    description: "학생이 새 아이데이션을 시작할 때 한 번 부른다. 학생이 기획 의도와 1순위 기준을 직접 적는 화면을 연다. 의도나 기준을 대신 적지 않는다.",
    inputSchema: {},
    _meta: { ui },
  }, async () => result("start"));

  registerAppTool(server, "open_review", {
    title: "반영 전 검토",
    description: "학생이 AI가 만든 결과(이미지·문장·안)를 다음 작업에 쓰려고 할 때, 그 직전에 부른다. 학생이 '이걸로 갈게', '이걸 바탕으로 다시', '이거 써도 돼?'처럼 결과를 반영하려는 말을 했을 때, 또는 학생이 검토를 요청했을 때 부른다. what에는 반영하려는 결과가 무엇인지 학생 말 그대로 짧게 적는다. 판단과 기준은 학생이 화면에서 직접 입력하므로, 호출 전후로 판단을 제안하거나 평가하지 않는다.",
    inputSchema: { what: z.string().max(300).describe("반영하려는 결과, 학생 말 그대로") },
    _meta: { ui },
  }, async ({ what }) => {
    db.prepare("INSERT INTO review_triggers(id,code,session_id,what,created_at) VALUES(?,?,?,?,?)")
      .run(id(), code, currentSession(code)?.id ?? null, what, now());
    return result("review", { what });
  });

  registerAppTool(server, "open_summary", {
    title: "정리 보기",
    description: "학생이 지금까지의 판단과 기준 변화를 보고 싶다고 할 때 부른다.",
    inputSchema: {},
    _meta: { ui },
  }, async () => result("summary"));

  // 아래는 화면(app)만 부를 수 있는 도구 — 학생 입력을 고치지 않고 그대로 저장한다.
  const appOnly = { ui: { resourceUri: VIEW_URI, visibility: ["app"] } };
  registerAppTool(server, "app_get_state", { description: "화면 갱신용", inputSchema: {}, _meta: appOnly },
    async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: state(code) }));

  registerAppTool(server, "app_save_session", {
    description: "학생이 적은 기획 의도와 1순위 기준 저장",
    inputSchema: { intent: z.string().max(2000), criterion: z.string().max(1000) },
    _meta: appOnly,
  }, async ({ intent, criterion }) => {
    const sid = id(), t = now();
    db.prepare("INSERT INTO sessions(id,code,intent,created_at) VALUES(?,?,?,?)").run(sid, code, intent, t);
    db.prepare("INSERT INTO criteria(id,session_id,text,change_type,prev_id,status,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), sid, criterion, "처음", null, "confirmed", "student", t);
    return { content: [{ type: "text", text: "저장했습니다." }], structuredContent: state(code) };
  });

  registerAppTool(server, "app_save_judgment", {
    description: "학생이 검토 화면에서 고른 판단 저장",
    inputSchema: {
      label: z.enum(["유지", "수정", "기각", "보류"]),
      raw_ids: z.array(z.string()).max(30),
      reason: z.string().max(2000),
      what: z.string().max(300).optional(),
      criterion_text: z.string().max(1000).optional(),
      criterion_change: z.enum(["그대로", "구체화", "바뀜", "새 기준 추가", "순위 변경", "아직 구분하기 어려워요"]).optional(),
    },
    _meta: appOnly,
  }, async (a) => {
    const s = currentSession(code);
    if (!s) return { isError: true, content: [{ type: "text", text: "먼저 탐색 시작에서 의도와 기준을 적어야 합니다." }] };
    const t = now();
    db.prepare("INSERT INTO judgments(id,session_id,label,raw_ids,reason,what,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), s.id, a.label, JSON.stringify(a.raw_ids), a.reason, a.what ?? null, "student", t);
    if (a.criterion_text && a.criterion_change && a.criterion_change !== "그대로") {
      const prev = db.prepare("SELECT id FROM criteria WHERE session_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1").get(s.id);
      db.prepare("INSERT INTO criteria(id,session_id,text,change_type,prev_id,status,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id(), s.id, a.criterion_text, a.criterion_change, prev?.id ?? null, "confirmed", "student", t);
    }
    return { content: [{ type: "text", text: `학생이 '${a.label}'로 기록했습니다.` }], structuredContent: state(code) };
  });
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => { // 확장 프로그램용 CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, authorization");
  res.set("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_q, r) => r.json({ ok: true }));
// 화면 미리보기(가짜 데이터): /view-preview?demo=1&mode=review|start|summary
app.get("/view-preview", (_q, r) => r.type("html").send(buildViewHtml()));

app.post("/ingest", (req, res) => {
  const { code, host, url, role, text, images = [], client_id } = req.body || {};
  if (!okCode(code)) return res.status(401).json({ error: "참여 코드를 확인해 주세요." });
  if (!["user", "assistant"].includes(role) || typeof text !== "string") return res.status(400).json({ error: "형식 오류" });
  const dedupe = crypto.createHash("sha256").update(`${code}|${url}|${role}|${text}|${images.length}`).digest("hex");
  if (db.prepare("SELECT 1 FROM raw WHERE dedupe=?").get(dedupe)) return res.json({ ok: true, duplicate: true });
  const imgIds = [];
  for (const d of images.slice(0, 8)) {
    const m = typeof d === "string" && d.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/);
    if (!m) continue;
    const iid = id();
    db.prepare("INSERT INTO images(id,code,mime,data,created_at) VALUES(?,?,?,?,?)").run(iid, code, m[1], Buffer.from(m[3], "base64"), now());
    imgIds.push(iid);
  }
  db.prepare("INSERT INTO raw(id,code,host,url,role,text,images,client_id,dedupe,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id(), code, String(host || "").slice(0, 40), String(url || "").slice(0, 500), role, text.slice(0, 20000), JSON.stringify(imgIds), client_id ?? null, dedupe, now());
  res.json({ ok: true, images: imgIds.length });
});

// 학생 개인 링크: 열면 확장 프로그램이 서버 주소와 코드를 자동으로 저장하고, 커넥터 주소를 복사할 수 있다.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PAGE_CSS = `body{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#111;margin:0;word-break:keep-all}
main{max-width:560px;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;gap:20px}h1{font-size:22px;margin:0}
ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:14px;line-height:1.6}.box{display:flex;gap:8px}p{line-height:1.6;margin:0}
input{flex:1;font:inherit;font-size:13px;padding:10px;border:1px solid #c9c9c9;border-radius:6px;min-width:0}
button,a.btn{font:inherit;font-weight:700;border:0;border-radius:6px;background:#111;color:#fff;padding:0 16px;min-height:44px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.st{border-radius:8px;padding:12px 14px;background:#f3f3f3;font-size:14px}.st.ok{background:#111;color:#fff}.mut{color:#5f5f5f;font-size:13px}`;

// ---- Google 로그인 (아무 Google 계정) → 계정마다 참여 코드 자동 발급 ----
const G = {
  id: process.env.GOOGLE_CLIENT_ID || "", secret: process.env.GOOGLE_CLIENT_SECRET || "",
  auth: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
};
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sign = (v) => `${v}.${crypto.createHmac("sha256", SECRET).update(v).digest("base64url")}`;
const unsign = (sv) => { const i = (sv || "").lastIndexOf("."); if (i < 1) return null; const v = sv.slice(0, i); return sign(v) === sv ? v : null; };
const cookie = (req, name) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
const secure = PUBLIC_URL.startsWith("https") ? "; Secure" : "";

app.get("/join", (req, res) => {
  const code = unsign(decodeURIComponent(cookie(req, "jr_sess") || ""));
  if (code && okCode(code)) return res.redirect("/join/me");
  res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>판단 기록 시작</title><style>${PAGE_CSS}</style></head>
<body><main><h1>판단 기록 시작하기</h1>
<p>Google 계정으로 로그인하면 나만의 연결 정보가 만들어져요. 같은 계정으로 다시 로그인하면 같은 기록으로 이어져요.</p>
<p class="mut">연구를 위해 이메일과 이름을 받아요. 이 정보는 연구자만 볼 수 있는 곳에 따로 보관하고, 분석 자료에는 익명 번호만 남아요.</p>
${G.id ? `<a class="btn" href="/auth/google">Google로 로그인</a>` : `<p class="st">로그인이 아직 설정되지 않았어요. 연구자에게 문의해 주세요.</p>`}
</main></body></html>`);
});

app.get("/auth/google", (_req, res) => {
  if (!G.id) return res.redirect("/join");
  const state = crypto.randomBytes(16).toString("hex");
  res.set("Set-Cookie", `jr_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);
  const q = new URLSearchParams({ client_id: G.id, redirect_uri: `${PUBLIC_URL}/auth/google/callback`, response_type: "code",
    scope: "openid email profile", state, prompt: "select_account" });
  res.redirect(`${G.auth}?${q}`);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!req.query.state || req.query.state !== cookie(req, "jr_state")) throw new Error("state");
    const r = await fetch(G.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(req.query.code || ""), client_id: G.id, client_secret: G.secret,
        redirect_uri: `${PUBLIC_URL}/auth/google/callback`, grant_type: "authorization_code" }) });
    const t = await r.json();
    if (!r.ok || !t.id_token) throw new Error("token");
    // id_token은 Google 토큰 엔드포인트에서 서버가 직접(TLS) 받은 값이라 서명 검증 없이 내용만 읽는다.
    const claims = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString());
    if (claims.aud !== G.id || !claims.sub) throw new Error("claims");
    let row = db.prepare("SELECT code FROM identities WHERE provider='google' AND subject=?").get(claims.sub);
    if (!row) {
      const code = crypto.randomBytes(12).toString("base64url"), t0 = now();
      db.prepare("INSERT INTO participants(code,created_at) VALUES(?,?)").run(code, t0);
      db.prepare("INSERT INTO identities(provider,subject,email,name,code,created_at) VALUES('google',?,?,?,?,?)")
        .run(claims.sub, claims.email ?? null, claims.name ?? null, code, t0);
      row = { code };
    }
    res.set("Set-Cookie", [`jr_sess=${encodeURIComponent(sign(row.code))}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`,
      `jr_state=; Path=/; Max-Age=0`]);
    res.redirect("/join/me");
  } catch (e) {
    res.status(400).type("html").send(`<p>로그인하지 못했어요. <a href="/join">다시 시도</a></p>`);
  }
});

app.get("/join/me", (req, res) => {
  const code = unsign(decodeURIComponent(cookie(req, "jr_sess") || ""));
  if (!code || !okCode(code)) return res.redirect("/join");
  const who = db.prepare("SELECT email FROM identities WHERE code=?").get(code);
  joinPage(res, code, who?.email);
});

// 연구자가 직접 발급한 코드용 개인 링크(로그인 없이)
app.get("/join/:code", (req, res) => {
  const code = req.params.code;
  if (!okCode(code)) return res.status(404).type("html").send("<p>링크를 다시 확인해 주세요.</p>");
  joinPage(res, code);
});

function joinPage(res, code, email) {
  const mcp = `${PUBLIC_URL}/mcp/${code}`;
  const e = esc;
  res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="jr-server" content="${e(PUBLIC_URL)}"><meta name="jr-code" content="${e(code)}"><title>판단 기록 연결</title>
<style>${PAGE_CSS}</style></head>
<body><main><h1>판단 기록 연결</h1>${email ? `<p class="mut">${e(email)}(으)로 로그인했어요</p>` : ""}
<p id="ext" class="st">확장 프로그램을 확인하는 중… 설치하지 않았다면 먼저 설치한 뒤 이 페이지를 새로고침해 주세요.</p>
<ol>
<li><b>커넥터 주소 복사</b><div class="box"><input id="u" readonly value="${e(mcp)}"><button id="c">복사</button></div></li>
<li><b>Claude</b>: Customize → Connectors → + Add → Add custom connector → 이름 "판단 기록", 주소 붙여넣기, 인증은 No sign in</li>
<li>새 대화에서 + → Connectors → "판단 기록" 켜기 → "탐색을 시작할게요"라고 보내기</li>
</ol>
<p class="mut">커넥터 주소는 나만 쓰는 주소예요. 다른 사람과 나누지 마세요.</p></main>
<script>document.getElementById("c").onclick=async()=>{const u=document.getElementById("u");u.select();try{await navigator.clipboard.writeText(u.value)}catch{document.execCommand("copy")}document.getElementById("c").textContent="복사됨"};</script>
</body></html>`);
}

app.get("/img/:id", (req, res) => {
  const row = db.prepare("SELECT mime, data FROM images WHERE id=?").get(req.params.id);
  if (!row) return res.sendStatus(404);
  res.set("Content-Type", row.mime).set("Cache-Control", "private, max-age=86400").send(Buffer.from(row.data));
});

app.all("/mcp/:code", async (req, res) => {
  if (!okCode(req.params.code)) return res.status(401).json({ error: "unknown participant" });
  const server = mcpFor(req.params.code);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// 연구자: 참여 코드 발급, 전체 내보내기
const admin = (req, res, next) => (ADMIN_KEY.length >= 24 && req.get("authorization") === `Bearer ${ADMIN_KEY}` ? next() : res.sendStatus(401));
app.post("/admin/participants", admin, (_q, res) => {
  const code = crypto.randomBytes(12).toString("base64url");
  db.prepare("INSERT INTO participants(code,created_at) VALUES(?,?)").run(code, now());
  res.json({ code, join_url: `${PUBLIC_URL}/join/${code}`, mcp_url: `${PUBLIC_URL}/mcp/${code}` });
});
app.get("/admin/identities", admin, (_q, res) => res.json(db.prepare("SELECT provider,email,name,code,created_at FROM identities").all()));
app.get("/admin/export", admin, (_q, res) => {
  const t = (n) => db.prepare(`SELECT * FROM ${n}`).all();
  res.json({ exported_at: now(), participants: t("participants"), sessions: t("sessions"), raw: t("raw"),
    criteria: t("criteria"), judgments: t("judgments"), review_triggers: t("review_triggers") });
});

if (process.argv.includes("--create-code")) {
  const code = crypto.randomBytes(12).toString("base64url");
  db.prepare("INSERT INTO participants(code,created_at) VALUES(?,?)").run(code, now());
  console.log(code); console.log(`개인 링크: ${PUBLIC_URL}/join/${code}`); console.log(`MCP URL: ${PUBLIC_URL}/mcp/${code}`); process.exit(0);
}
app.listen(PORT, () => console.log(`listening on ${PORT} (${PUBLIC_URL})`));
