// 3차 모델 연결 시제품 — 하나의 서버가 세 일을 한다.
// 1) /ingest : 크롬 확장이 보내는 대화 원문(학생 발화·AI 응답·이미지)을 받는다.
// 2) /mcp/:code : Claude·ChatGPT가 붙는 MCP 서버. 판단 기록 캔버스(MCP App)를 띄운다.
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
const DB_PATH = process.env.DATABASE_PATH || path.join(DIR, "data.sqlite3");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); // 폴더가 없으면 만든다(권한이 없으면 여기서 분명한 오류로 멈춤)
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(fs.readFileSync(path.join(DIR, "schema.sql"), "utf8"));

const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();
const okCode = (c) => typeof c === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(c) &&
  !!db.prepare("SELECT 1 FROM participants WHERE code=?").get(c);

// ---------- 상태 조회 ----------
// 2차 DBR 원래 Q6 문장. 문장이 정해지면 환경 변수 Q6_TEXT에 그대로 넣는다(비우면 질문 지시 없이 판단만 알린다).
const Q6_TEXT = (process.env.Q6_TEXT || "").trim();
const LABELS = ["선택", "보류", "제외", "아직 모르겠어요"];
const CHANGES = ["구체화", "바뀜", "새 기준 추가", "순위 변경", "아직 구분하기 어려워요"];

function currentSession(code) {
  return db.prepare("SELECT * FROM sessions WHERE code=? ORDER BY created_at DESC LIMIT 1").get(code) || null;
}
const letterFor = (n) => { let s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function state(code, { rawLimit = 12 } = {}) {
  const session = currentSession(code);
  const sid = session?.id ?? "";
  const criteria = db.prepare("SELECT * FROM criteria WHERE session_id=? ORDER BY created_at").all(sid);
  const history = db.prepare("SELECT * FROM node_judgments WHERE session_id=? ORDER BY created_at").all(sid);
  const nodes = db.prepare("SELECT * FROM nodes WHERE session_id=? ORDER BY created_at").all(sid).map((n) => {
    const h = history.filter((j) => j.node_id === n.id);
    return { id: n.id, letter: n.letter, name: n.name, origin: n.origin, created_at: n.created_at,
      image_url: n.image_id ? `${PUBLIC_URL}/img/${n.image_id}` : null, parents: JSON.parse(n.parents || "[]"),
      judgment: h.at(-1) || null, history: h };
  });
  const focus = db.prepare("SELECT payload FROM events WHERE session_id=? AND type='focus' ORDER BY created_at DESC LIMIT 1").get(sid);
  const raw = db.prepare("SELECT id, host, role, text, images, created_at FROM raw WHERE code=? ORDER BY created_at DESC LIMIT ?")
    .all(code, rawLimit).map((r) => ({ ...r, images: JSON.parse(r.images || "[]").map((i) => `${PUBLIC_URL}/img/${i}`) }));
  return { session, criteria, nodes, raw: raw.reverse(),
    current_criterion: criteria.filter((c) => c.status === "confirmed").at(-1) || null,
    proposal: criteria.filter((c) => c.status === "proposed").at(-1) || null,
    focus_node_id: focus ? JSON.parse(focus.payload).node_id : null };
}

// 대화 AI에게 넘기는 짧은 요약(학생이 화면에서 한 것만, 평가 없이)
function summaryText(s) {
  if (!s.session) return "아직 탐색이 시작되지 않았습니다. 학생이 캔버스에서 기획 의도와 1순위 기준을 직접 적을 때까지 기다리세요.";
  const lines = [`1순위 기준(학생 작성): ${s.current_criterion?.text ?? "없음"}`];
  for (const n of s.nodes) {
    const from = n.parents.map((p) => s.nodes.find((x) => x.id === p)?.letter).filter(Boolean).join("+");
    lines.push(`${n.letter}${n.name ? " " + n.name : ""}${from ? ` (← ${from})` : ""}: ${n.judgment ? n.judgment.label : "판단 전"}${n.judgment ? (n.judgment.reason ? ` / 이유 "${n.judgment.reason}"` : " / 이유 미기록") : ""}`);
  }
  if (s.focus_node_id) lines.push(`지금 이야기 중인 이미지: ${s.nodes.find((n) => n.id === s.focus_node_id)?.letter ?? "-"}`);
  if (s.proposal) lines.push(`확인 전 정리 제안(AI 작성, 아직 기준 아님): ${s.proposal.text}`);
  return lines.join("\n");
}

// 아직 기준이 없으면 대화 AI에게 매번 되돌려 알린다
const NO_SESSION = (code) => (currentSession(code) ? "" :
  "\n[주의] 아직 1순위 기준이 없습니다. 다음 응답에서 이미지나 아이디어를 만들지 말고 open_canvas를 불러 학생이 기준부터 적게 하세요.");
const logEvent = (code, sid, type, payload) =>
  db.prepare("INSERT INTO events(id,code,session_id,type,payload,created_at) VALUES(?,?,?,?,?,?)").run(id(), code, sid ?? null, type, JSON.stringify(payload ?? {}), now());

// ---------- MCP 서버 (참여 코드별) ----------
const VIEW_URI = "ui://judgment/canvas-v2.html";
function buildViewHtml() {
  const bundle = fs.readFileSync(path.join(DIR, "node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"), "utf8");
  const m = bundle.match(/export\{([^}]*)\};?\s*$/);
  const appName = m[1].split(",").map((s) => s.trim()).find((s) => / as App$/.test(s)).split(" as ")[0];
  const script = bundle.replace(/export\{[^}]*\};?\s*$/, `const App=${appName};`) + "\n(() => {\n" + fs.readFileSync(path.join(DIR, "view/view.js"), "utf8") + "\n})();";
  const html = fs.readFileSync(path.join(DIR, "view/view.html"), "utf8");
  return html.replace("/*VIEW_SCRIPT*/", () => script);
}

const RULES = `판단 기록 캔버스 규칙:
- 대화가 시작되면 다른 도움보다 먼저 open_canvas를 부른다. 학생이 새 주제로 시작한다고 하면 new_exploration=true로 부른다.
- 학생이 캔버스 시작 화면에서 기획 의도와 1순위 기준을 직접 적기 전에는 이미지를 만들거나 아이디어를 제안하지 않는다. 기준을 대신 적어 주거나 예시 기준을 제시하지도 않는다. "캔버스에서 기준부터 적어 주세요"라고만 안내한다.
- 이미지의 판단(선택·보류·제외·아직 모르겠어요), 이유, 1순위 기준은 학생이 캔버스에서 직접 정한다. 대신 정하거나, 어느 쪽이 낫다고 평가하거나, 판단을 바꾸라고 권하지 않는다.
- 학생이 이미지에 대해 말하면 알파벳(A, B, C…)으로 가리킨다.
- 학생이 기준을 바꾸고 싶다고 직접 말하면 open_criterion을 부른다.
- 학생이 그렇게 말하지 않았는데 기준이 구체화되거나 바뀐 것처럼 들려도 단정하지 않는다. 필요하면 propose_criterion으로 '정리 제안'만 남기고, 학생이 캔버스에서 확인하게 한다.
- 매 응답을 다 쓴 뒤 마지막에 record_turn을 한 번 부른다. 학생 메시지와 방금 쓴 답을 줄이거나 고치지 말고 그대로 넣는다.`;

function mcpFor(code) {
  const server = new McpServer({ name: "judgment-recorder-3", version: "0.2.0" }, { instructions: RULES });
  const appOnly = { ui: { resourceUri: VIEW_URI, visibility: ["app"] } };
  const ok = (text) => ({ content: [{ type: "text", text }], structuredContent: state(code) });
  const err = (text) => ({ isError: true, content: [{ type: "text", text }] });

  registerAppResource(server, "판단 기록 캔버스", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: buildViewHtml(),
      _meta: { ui: { preferredDisplayMode: "fullscreen", prefersBorder: false,
          csp: { resourceDomains: [PUBLIC_URL], connectDomains: [] } },
        // ChatGPT 이전 방식 호환(무시돼도 무해)
        "openai/widgetCSP": { resource_domains: [PUBLIC_URL], connect_domains: [] },
        "openai/widgetPrefersBorder": false,
        "openai/widgetDescription": "학생이 이미지를 올리고 출처·판단·기준을 직접 기록하는 캔버스" } }],
  }));

  registerAppTool(server, "open_canvas", {
    title: "판단 기록 캔버스 열기",
    description: `학생이 아이데이션을 시작하거나 이어갈 때, 또는 캔버스·지금까지의 이미지를 보고 싶다고 할 때 부른다. 처음이면 학생이 기획 의도와 1순위 기준을 직접 적는 화면이 먼저 열린다.\n${RULES}`,
    inputSchema: { new_exploration: z.boolean().optional().describe("학생이 새 주제·새 과제로 처음부터 시작한다고 말했을 때만 true") },
    _meta: { ui: { resourceUri: VIEW_URI }, "openai/outputTemplate": VIEW_URI },
  }, async ({ new_exploration } = {}) => {
    const s = state(code);
    const start = !s.session || !!new_exploration;
    logEvent(code, s.session?.id, "open_canvas", { new_exploration: !!new_exploration });
    const text = start
      ? "캔버스 시작 화면을 열었습니다. 학생이 기획 의도와 1순위 기준을 직접 적을 때까지 이미지 생성이나 아이디어 제안을 하지 말고 기다리세요. 기준 예시도 주지 마세요."
      : `캔버스를 열었습니다(지난 탐색을 이어서).\n${summaryText(s)}`;
    return { content: [{ type: "text", text }], structuredContent: { ...s, mode: start ? "start" : "canvas" } };
  });

  registerAppTool(server, "open_criterion", {
    title: "기준 기록 열기",
    description: "학생이 1순위 기준을 바꾸고 싶다, 고치고 싶다, 다시 정하고 싶다고 직접 말했을 때 부른다. 캔버스와 함께 기준 기록 창이 열리고, 학생이 변화 종류와 새 기준을 직접 적는다. student_words에는 학생이 한 말을 그대로 넣는다. 새 기준 문장을 대신 써 주거나 변화 종류를 정하지 않는다. (학생이 바꾸겠다고 하지 않았는데 기준이 달라진 것 같다고 AI가 느낄 때는 이 도구가 아니라 propose_criterion을 쓴다.)",
    inputSchema: { student_words: z.string().max(2000).optional().describe("학생이 기준을 바꾸고 싶다며 한 말, 그대로") },
    _meta: { ui: { resourceUri: VIEW_URI }, "openai/outputTemplate": VIEW_URI },
  }, async ({ student_words } = {}) => {
    const s = state(code);
    logEvent(code, s.session?.id, "open_criterion", { student_words: student_words ?? null });
    if (!s.session) return { content: [{ type: "text", text: "아직 처음 기준이 없어 시작 화면을 열었습니다. 학생이 직접 적을 때까지 기다리세요." }], structuredContent: { ...s, mode: "start" } };
    return { content: [{ type: "text", text: "기준 기록 창을 열었습니다. 학생이 변화 종류와 새 기준을 직접 적을 때까지 기준을 대신 정하거나 제안하지 마세요." }],
      structuredContent: { ...s, mode: "criterion", student_words: student_words ?? null } };
  });

  server.registerTool("get_canvas_state", {
    title: "캔버스 상태 보기",
    description: "학생이 캔버스에 올린 이미지(A, B, C…), 출처 연결, 학생이 정한 판단과 1순위 기준을 읽는다. 학생이 이미지를 알파벳으로 말할 때 무엇인지 확인하려고 쓴다. 읽기만 한다.",
    inputSchema: {},
  }, async () => ({ content: [{ type: "text", text: summaryText(state(code)) + NO_SESSION(code) }] }));

  server.registerTool("record_turn", {
    title: "대화 기록",
    description: "매 응답을 다 쓴 뒤 마지막에 한 번 부른다. user_text에는 이번 학생 메시지를, assistant_text에는 방금 쓴 답을 줄이거나 고치지 말고 그대로 넣는다. focus에는 이번에 주로 이야기한 이미지 알파벳(없으면 비움).",
    inputSchema: { user_text: z.string().max(20000), assistant_text: z.string().max(40000), focus: z.string().max(4).optional() },
  }, async ({ user_text, assistant_text, focus }) => {
    const s = currentSession(code);
    db.prepare("INSERT INTO relayed_turns(id,code,session_id,user_text,assistant_text,focus_node,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), code, s?.id ?? null, user_text, assistant_text, focus ?? null, now());
    return { content: [{ type: "text", text: "기록했습니다. 학생에게 따로 알리지 않아도 됩니다." + NO_SESSION(code) }] };
  });

  server.registerTool("propose_criterion", {
    title: "기준 정리 제안",
    description: "학생의 말에서 1순위 기준이 더 구체적이 되었거나 달라진 것처럼 들릴 때만 부른다. text는 학생 말을 바탕으로 한 기준 문장, basis는 근거가 된 학생 말 그대로. 이것은 '정리 제안'일 뿐이며 학생이 캔버스에서 확인하기 전까지 기준이 아니다. 변화의 종류(구체화·바뀜 등)는 학생이 고르므로 정하지 않는다.",
    inputSchema: { text: z.string().max(1000), basis: z.string().max(2000) },
  }, async ({ text, basis }) => {
    const s = currentSession(code);
    if (!s) return err("탐색이 아직 시작되지 않았습니다.");
    db.prepare("UPDATE criteria SET status='superseded' WHERE session_id=? AND status='proposed'").run(s.id);
    const cur = db.prepare("SELECT id FROM criteria WHERE session_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1").get(s.id);
    db.prepare("INSERT INTO criteria(id,session_id,text,change_type,prev_id,status,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), s.id, text, "정리 제안", cur?.id ?? null, "proposed", "ai", now());
    logEvent(code, s.id, "proposal_basis", { basis });
    return { content: [{ type: "text", text: "정리 제안을 캔버스에 올렸습니다. 학생이 확인하기 전까지 기준으로 다루지 마세요." }] };
  });

  // ----- 화면(app)만 부르는 도구: 학생 입력을 고치지 않고 저장 -----
  registerAppTool(server, "app_get_state", { description: "화면 갱신용", inputSchema: {}, _meta: appOnly },
    async () => ok("ok"));

  registerAppTool(server, "app_save_session", {
    description: "학생이 적은 기획 의도와 1순위 기준 저장",
    inputSchema: { intent: z.string().max(2000), criterion: z.string().max(1000) },
    _meta: appOnly,
  }, async ({ intent, criterion }) => {
    const sid = id(), t = now();
    db.prepare("INSERT INTO sessions(id,code,intent,created_at) VALUES(?,?,?,?)").run(sid, code, intent, t);
    db.prepare("INSERT INTO criteria(id,session_id,text,change_type,prev_id,status,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), sid, criterion, "처음", null, "confirmed", "student", t);
    return ok("저장했습니다.");
  });

  registerAppTool(server, "app_add_node", {
    description: "학생이 올린 이미지와 학생이 고른 출처 저장",
    inputSchema: { image: z.string().max(8_000_000), name: z.string().max(60).optional(),
      parents: z.array(z.string()).max(12), origin: z.enum(["버튼", "끌어다 놓기"]) },
    _meta: appOnly,
  }, async ({ image, name, parents, origin }) => {
    const s = currentSession(code);
    if (!s) return err("먼저 기획 의도와 기준을 적어 주세요.");
    const m = image.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/);
    if (!m) return err("이미지 형식을 읽지 못했어요.");
    const known = new Set(db.prepare("SELECT id FROM nodes WHERE session_id=?").all(s.id).map((r) => r.id));
    const iid = id(), t = now(), count = known.size;
    db.prepare("INSERT INTO images(id,code,mime,data,created_at) VALUES(?,?,?,?,?)").run(iid, code, m[1], Buffer.from(m[3], "base64"), t);
    const nid = id();
    db.prepare("INSERT INTO nodes(id,session_id,letter,name,image_id,parents,origin,author,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(nid, s.id, letterFor(count), (name || "").trim() || null, iid, JSON.stringify(parents.filter((p) => known.has(p))), origin, "student", t);
    logEvent(code, s.id, "focus", { node_id: nid });
    return ok(`${letterFor(count)}를 올렸습니다.`);
  });

  registerAppTool(server, "app_set_judgment", {
    description: "학생이 고른 이미지 판단 저장(이력으로 쌓임)",
    inputSchema: { node_id: z.string(), label: z.enum(LABELS), reason: z.string().max(2000).optional() },
    _meta: appOnly,
  }, async ({ node_id, label, reason }) => {
    const s = currentSession(code);
    if (!s || !db.prepare("SELECT 1 FROM nodes WHERE id=? AND session_id=?").get(node_id, s.id)) return err("이미지를 찾지 못했어요.");
    db.prepare("INSERT INTO node_judgments(id,node_id,session_id,label,reason,author,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), node_id, s.id, label, (reason || "").trim() || null, "student", now());
    return ok("기록했습니다.");
  });

  registerAppTool(server, "app_save_criterion", {
    description: "학생이 확인한 기준 변화 저장. 정리 제안을 넘기면 dismiss",
    inputSchema: { change_type: z.enum(CHANGES).optional(), text: z.string().max(1000).optional(),
      proposal_id: z.string().optional(), dismiss: z.boolean().optional() },
    _meta: appOnly,
  }, async ({ change_type, text, proposal_id, dismiss }) => {
    const s = currentSession(code);
    if (!s) return err("탐색이 아직 시작되지 않았습니다.");
    const t = now();
    if (proposal_id) db.prepare("UPDATE criteria SET status=? WHERE id=? AND session_id=? AND status='proposed'")
      .run(dismiss ? "dismissed" : "accepted", proposal_id, s.id);
    if (dismiss) return ok("넘겼습니다.");
    if (!change_type || !(text || "").trim()) return err("변화 종류와 기준 문장이 필요해요.");
    const cur = db.prepare("SELECT id FROM criteria WHERE session_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1").get(s.id);
    db.prepare("INSERT INTO criteria(id,session_id,text,change_type,prev_id,status,author,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), s.id, text.trim(), change_type, cur?.id ?? null, "confirmed", proposal_id ? "student(제안 확인)" : "student", t);
    return ok("기준을 기록했습니다.");
  });

  registerAppTool(server, "app_event", {
    description: "화면 조작 기록(초점 이동 등)",
    inputSchema: { type: z.enum(["focus", "upload_cancel", "zoom_fit"]), node_id: z.string().optional() },
    _meta: appOnly,
  }, async ({ type, node_id }) => {
    logEvent(code, currentSession(code)?.id, type, node_id ? { node_id } : {});
    return { content: [{ type: "text", text: "ok" }], structuredContent: { q6: Q6_TEXT } };
  });

  registerAppTool(server, "app_config", { description: "화면 설정", inputSchema: {}, _meta: appOnly },
    async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { q6: Q6_TEXT } }));
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
<li><b>ChatGPT</b>: 설정 → 앱(Apps) → 고급 설정에서 개발자 모드 켜기 → 앱 만들기 → 이름 "판단 기록", 주소 붙여넣기, 인증 없음</li>
<li>새 대화에서 "판단 기록"을 켜고 "탐색을 시작할게요"라고 보내기</li>
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
    criteria: t("criteria"), nodes: t("nodes"), node_judgments: t("node_judgments"), relayed_turns: t("relayed_turns"),
    events: t("events"), judgments: t("judgments"), review_triggers: t("review_triggers") });
});

if (process.argv.includes("--create-code")) {
  const code = crypto.randomBytes(12).toString("base64url");
  db.prepare("INSERT INTO participants(code,created_at) VALUES(?,?)").run(code, now());
  console.log(code); console.log(`개인 링크: ${PUBLIC_URL}/join/${code}`); console.log(`MCP URL: ${PUBLIC_URL}/mcp/${code}`); process.exit(0);
}
app.listen(PORT, () => console.log(`listening on ${PORT} (${PUBLIC_URL})`));
