// 기록 모델 서버 함수 (Supabase Edge Function, Deno)
// - 브라우저 대신 Claude API를 호출한다. API 키는 이 함수의 비밀값에만 있다.
// - 수업 코드(CLASS_CODE)를 아는 사람만 쓸 수 있다.
// - COLLECT_ENABLED=true 이고 학생이 동의한 경우에만 DB에 저장한다.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSystemPrompt, QUESTIONS, type Card } from "./prompt.ts";
import { runChecks, type Checks } from "./checks.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLASS_CODE = Deno.env.get("CLASS_CODE") ?? "";
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const COLLECT = Deno.env.get("COLLECT_ENABLED") === "true";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const ANTHROPIC_BASE_URL = Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com";

const NODE_TYPES = new Set(["INTENT", "DISCOVERY", "JUDGMENT", "CRITERION", "MOVE"]);
const MAX_MESSAGES = 80;
const MAX_CHARS = 6000;

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

type Msg = { role: "user" | "assistant"; content: string };
type Node = { type: string; quote: string; note: string; verbatim?: boolean };
type Session = { id: string; team: string; consent: boolean };

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(s: unknown, n = MAX_CHARS): string {
  return String(s ?? "").slice(0, n);
}

function cleanCard(c: unknown): Card {
  const o = (c ?? {}) as Record<string, unknown>;
  return {
    issue: clip(o.issue, 2000),
    image: clip(o.image, 2000),
    keep: clip(o.keep, 2000),
    question: clip(o.question, 2000),
  };
}

// Claude Messages API는 user로 시작해 user/assistant가 번갈아야 한다.
function normalize(messages: unknown): Msg[] {
  const out: Msg[] = [];
  if (!Array.isArray(messages)) return out;
  for (const m of messages.slice(-MAX_MESSAGES)) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const content = clip(m?.content).trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function splitNodes(text: string): { reply: string; nodes: Node[]; questionId: string } {
  // 질문 번호 블록: <q>Q5</q>. 목록에 없는 값은 UNKNOWN으로 남긴다.
  const qm = text.match(/<q>\s*([A-Z0-9]+)\s*<\/q>/);
  const rawQ = qm ? qm[1] : "";
  const questionId = rawQ === "NONE" || rawQ in QUESTIONS ? rawQ : rawQ ? "UNKNOWN" : "MISSING";
  text = text.replace(/<q>[\s\S]*?<\/q>/g, "");
  // 닫는 태그가 잘려도 학생 화면에 블록이 보이지 않게 끝까지 지운다.
  const m = text.match(/<nodes>([\s\S]*?)(?:<\/nodes>|$)/);
  const reply = text.replace(/<nodes>[\s\S]*?(?:<\/nodes>|$)/g, "").trim();
  let nodes: Node[] = [];
  if (m) {
    const parse = (s: string) => {
      try {
        return JSON.parse(s);
      } catch (_) {
        return JSON.parse(s.replace(/[\r\n]+/g, " ")); // 문자열 안의 줄바꿈 허용
      }
    };
    try {
      const arr = parse(m[1].trim());
      if (Array.isArray(arr)) {
        nodes = arr
          .filter((n) => n && NODE_TYPES.has(String(n.type)))
          .map((n) => ({ type: String(n.type), quote: clip(n.quote, 1000), note: clip(n.note, 300) }));
      }
    } catch (_) {
      nodes = [];
    }
  }
  return { reply, nodes, questionId };
}

async function callClaude(card: Card, messages: Msg[]): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: buildSystemPrompt(card),
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
}

function canStore(session: Session | undefined): session is Session {
  return COLLECT && !!session && session.consent === true && UUID.test(session.id);
}

async function storeTurn(
  session: Session,
  card: Card,
  userMsg: string,
  reply: string,
  nodes: Node[],
  questionId: string,
  checks: Checks,
  latencyMs: number,
) {
  const client = db();
  await client.from("sessions").upsert({
    id: session.id,
    team: clip(session.team, 50),
    consent: true,
    card,
    updated_at: new Date().toISOString(),
  });
  await client.from("turns").insert([
    { session_id: session.id, role: "user", content: userMsg, nodes: null, question_id: null, checks: null },
    {
      session_id: session.id,
      role: "assistant",
      content: reply,
      nodes,
      question_id: questionId,
      checks: { ...checks, latencyMs, model: MODEL },
    },
  ]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "요청 형식이 잘못되었습니다." }, 400);
  }

  if (!CLASS_CODE || body.classCode !== CLASS_CODE) {
    return json({ error: "수업 코드가 맞지 않습니다." }, 401);
  }

  const action = String(body.action ?? "");
  const session = body.session as Session | undefined;

  try {
    if (action === "login") {
      return json({ ok: true, collect: COLLECT });
    }

    if (action === "chat") {
      if (!ANTHROPIC_API_KEY) return json({ error: "서버에 API 키가 설정되지 않았습니다." }, 500);
      const card = cleanCard(body.card);
      const messages = normalize(body.messages);
      if (!messages.length || messages[messages.length - 1].role !== "user") {
        return json({ error: "보낼 메시지가 없습니다." }, 400);
      }
      const started = Date.now();
      const raw = await callClaude(card, messages);
      const latencyMs = Date.now() - started;
      const { reply, nodes, questionId } = splitNodes(raw);
      const userMsg = messages[messages.length - 1].content;
      const { checks, verbatim } = runChecks(questionId, reply, nodes, userMsg);
      nodes.forEach((n, i) => (n.verbatim = verbatim[i]));
      if (canStore(session)) {
        try {
          await storeTurn(session, card, userMsg, reply, nodes, questionId, checks, latencyMs);
        } catch (e) {
          console.error("store failed", e);
        }
      }
      return json({ reply, nodes, questionId, checks, latencyMs });
    }

    if (action === "summary") {
      // 학생이 고친 노드 목록. 고칠 때마다(auto)와 내려받을 때(export) 버전으로 쌓는다. 동의한 경우에만 저장한다.
      if (canStore(session)) {
        const nodes = Array.isArray(body.nodes) ? body.nodes.slice(0, 500) : [];
        const client = db();
        await client.from("sessions").upsert({
          id: session.id,
          team: clip(session.team, 50),
          consent: true,
          card: cleanCard(body.card),
          updated_at: new Date().toISOString(),
        });
        const trigger = body.trigger === "auto" ? "auto" : "export";
        await client.from("summaries").insert({ session_id: session.id, nodes, trigger });
        return json({ ok: true, stored: true });
      }
      return json({ ok: true, stored: false });
    }

    return json({ error: "알 수 없는 요청입니다." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "기록 모델 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
