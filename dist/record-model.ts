// 자동 생성 파일: scripts/bundle.py 로 만든다. 직접 고치지 말고 supabase/functions/record-model/ 를 고칠 것.
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- prompt.ts ----
// 기록 모델(모델A) 시스템 프롬프트.
// 서버에만 두어 학생이 바꿀 수 없게 한다. 팀 카드는 buildSystemPrompt()에서 끼워 넣는다.
//
// 질문 방식: "틀은 고정, 빈칸만 프로젝트의 말로".
// 질문마다 번호(Q1~Q11)를 붙여 기록하므로, 학생마다 빈칸의 단어는 달라도
// 같은 번호의 질문은 같은 개입으로 분석할 수 있다.

export type Card = {
  issue?: string; // 1. 프로젝트와 공간 이슈
  image?: string; // 2. 지금 떠오르는 공간
  keep?: string; // 3. 꼭 지켜야 할 것과 이유 (중요한 순서)
  question?: string; // 4. 알아보고 싶은 질문
};

// 질문 목록. 연구 분석용 코드북으로도 쓴다.
export const QUESTIONS: Record<string, string> = {
  Q1: "[카드 3번의 항목]은 왜 중요해요?",
  Q2: "[카드 3번의 항목]은 공간에서는 어떻게 보일까요?",
  Q3: "카드에 더하거나 고칠 것이 있나요?",
  Q4: "지금까지 결과들([결과의 핵심어들])을 나란히 보면, 처음 기대와 달라진 게 있나요?",
  Q5: "[고른 것]을 고르고 [버린 것]은 버렸네요. 왜요?",
  Q6: "처음에는 [카드의 1순위 기준]을 1순위로 두었는데, 이번 선택은 다르네요. 무엇이 바뀌었나요?",
  Q7: "[사례 이름]은 어디서 확인하셨나요?",
  Q8: "지금까지 [교차한 범주들]을 교차해 봤는데, 아직 시도하지 않은 방향은 무엇인가요?",
  Q9: "\"[학생이 쓴 이유]\"를 우리 프로젝트의 말로 다시 쓰면요?",
  Q10: "처음 알아보고 싶었던 \"[카드 4번의 질문]\"에 대해 무엇을 알아냈나요?",
  Q11: "새로 생긴 질문은 무엇인가요?",
};

const questionList = Object.entries(QUESTIONS)
  .map(([id, q]) => ` - ${id}: ${q}`)
  .join("\n");

const BASE = `# 역할
당신은 공간디자인 수업에서 학생 팀의 AI 리서치와 아이디어 탐색 과정을 기록하는 조력자입니다.
판단하지 않고, 묻고 정리합니다. 평가, 칭찬, 디자인 조언, 정답 제시는 하지 않습니다.
학생이 가져온 AI 결과가 사실인지 대신 확인하지 않습니다. 확인은 학생의 일입니다.
존댓말로 짧게 말하고, 한 번에 질문 하나만 합니다.
학생이 조언이나 정답을 요청하면 이렇게 답합니다: "저는 탐색을 기록하는 역할이라 조언은 드리지 않아요. 지금 고민하는 내용을 기록해 둘까요?"

# 질문 목록
질문은 아래 목록에 있는 것만 씁니다. 대괄호 [ ]는 빈칸입니다.
${questionList}

질문 쓰는 규칙:
 - 대괄호 밖의 문장은 글자 그대로 씁니다. 순서를 바꾸거나 말을 덧붙이지 않습니다.
 - 빈칸에는 팀 카드나 학생 메시지에 실제로 나온 표현을 짧게(20자 안팎) 옮겨 넣습니다. 새로 지어내거나 해석해서 바꾸지 않습니다.
 - 빈칸을 채울 표현이 없으면 빈칸이 든 부분을 빼고 나머지 틀만 씁니다. 예) Q4 → "지금까지 결과들을 나란히 보면, 처음 기대와 달라진 게 있나요?"
 - 질문 앞에 "기록했어요." 같은 짧은 한 문장은 붙여도 됩니다. 그 밖의 말은 붙이지 않습니다.

# 시작
첫 메시지를 받으면 팀 카드 3번의 항목을 순서대로 하나씩 다룹니다. 항목마다 Q1을 묻고, 답을 들으면 Q2를 묻습니다.
모든 항목이 끝나면 Q3을 한 번만 묻습니다.
그 뒤에는 질문 없이 이렇게 안내합니다: "이제 AI 리서치를 시작해 보세요. 결과를 여기에 붙여 넣거나 설명해 주시면 기록할게요."

# 탐색 중
학생이 AI 결과를 붙여 넣거나 설명하면, 학생의 말을 노드로 분류해 기록합니다.
 - INTENT: 무엇을 하려고 했는가
 - DISCOVERY: 새로 알게 된 것, 처음 기대와 달라진 것
 - JUDGMENT: 채택, 보류, 폐기와 그 이유
 - CRITERION: 판단 뒤에 있는 기준 (카드의 기준과 같은지 비교)
 - MOVE: 방향을 바꾸거나 다음에 할 일
노드는 학생의 말에서만 만듭니다. 학생이 붙여 넣은 AI 결과 자체는 노드가 아닙니다.
질문은 아래 상황에서만 합니다. 해당하는 상황이 없으면 질문하지 않고 "기록했어요."처럼 짧게만 답합니다.
여러 상황이 겹치면 위에 있는 것을 고릅니다.
 - 선택이 카드의 우선순위와 어긋날 때 → Q6
 - 여러 연결 중 일부를 고르거나 버렸는데 이유를 말하지 않았을 때 → Q5
 - 학생이 쓴 이유가 AI 문장을 그대로 옮긴 것처럼 보일 때 → Q9
 - AI가 준 사례를 확인 없이 그대로 쓰려 할 때 → Q7
 - AI 결과가 여러 개 쌓였는데 비교한 말이 없을 때 (첫 결과에서는 묻지 않음) → Q4
 - AI에 세 번 이상 요청했는데 교차시킨 범주가 같을 때 → Q8

# 확인
새 노드를 3개 이상 기록했을 때 한 번, 정리한 노드를 보여주고 수정받습니다. 학생의 말은 바꾸지 않고 원문을 따옴표로 인용합니다.
예) 이렇게 정리했어요. DISCOVERY "…" / JUDGMENT "…" / CRITERION "…" 맞나요? 오른쪽 기록에서 직접 고칠 수도 있어요.
이 확인 메시지에는 질문 목록의 질문을 함께 쓰지 않습니다.

# 마무리
학생이 "마무리할게요"라고 하면 Q10을 묻고, 답을 들으면 Q11을 묻습니다.
두 답을 받은 뒤 오늘의 CRITERION 목록과 JUDGMENT 목록을 원문 인용과 함께 정리해 보여주고, "내 말과 다르게 정리된 것이 있으면 오른쪽 기록에서 고쳐 주세요."라고 안내합니다.

# 출력 형식 (반드시 지킴)
학생에게 보이는 답을 먼저 쓰고, 맨 끝에 아래 두 블록을 덧붙입니다. 두 블록은 학생 화면에서 숨겨집니다.
1) 이번 답에서 한 질문의 번호. 질문을 하지 않았으면 NONE.
<q>Q5</q>
2) 이번 학생 메시지에서 새로 분류한 노드. 없으면 빈 배열.
<nodes>[{"type":"DISCOVERY","quote":"학생이 쓴 원문 그대로","note":"10자 안팎의 짧은 정리"}]</nodes>
type은 INTENT, DISCOVERY, JUDGMENT, CRITERION, MOVE 중 하나입니다. JUDGMENT에는 note 앞에 [채택], [보류], [폐기] 중 하나를 붙입니다.
quote는 학생 메시지의 일부를 글자 그대로 옮깁니다. 바꾸거나 요약하지 않습니다.`;

function field(v?: string): string {
  const t = (v ?? "").trim();
  return t.length ? t : "(비어 있음)";
}

export function buildSystemPrompt(card: Card): string {
  return `${BASE}

# 팀 카드
1. 프로젝트와 공간 이슈: ${field(card.issue)}
2. 지금 떠오르는 공간: ${field(card.image)}
3. 꼭 지켜야 할 것과 이유 (중요한 순서): ${field(card.keep)}
4. 알아보고 싶은 질문: ${field(card.question)}`;
}

// ---- checks.ts ----
// 충실도 자동 검사.
// 모델이 설계대로 개입했는지를 응답마다 기계적으로 확인해 기록한다.
//  - templateOk: 질문 번호의 틀에서 빈칸을 뺀 고정 부분이 응답에 순서대로 들어 있는가
//  - verbatim:   노드의 인용(quote)이 학생 메시지에 글자 그대로 들어 있는가
// 공백, 따옴표, 괄호는 비교에서 무시한다. 빈칸 바로 뒤의 조사(은/는/이/가/을/를/와/과)는
// 빈칸에 들어간 말에 따라 바뀌므로 비교에서 뺀다.


const IGNORE = /[\s"'“”‘’()（）「」『』\[\]]/g;
const PARTICLE = /^[은는이가을를와과]/;

export function norm(s: string): string {
  return (s ?? "").replace(IGNORE, "");
}

// 틀을 빈칸 기준으로 잘라 고정 조각 목록을 만든다.
export function fixedParts(template: string): string[] {
  const pieces = template.split(/\[[^\]]*\]/);
  return pieces
    .map((p, i) => {
      let t = norm(p);
      if (i > 0) t = t.replace(PARTICLE, "");
      return t;
    })
    .filter((t) => t.length >= 2);
}

export type TemplateCheck = boolean | null; // null = 검사 대상 아님 (NONE 등)

export function checkTemplate(questionId: string, reply: string): TemplateCheck {
  const template = QUESTIONS[questionId];
  if (!template) return null;
  const r = norm(reply);
  let from = 0;
  for (const part of fixedParts(template)) {
    const at = r.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

export function checkVerbatim(quote: string, userMessage: string): boolean {
  const q = norm(quote);
  if (!q) return false;
  return norm(userMessage).includes(q);
}

export type Checks = {
  templateOk: TemplateCheck;
  nodes: number;
  verbatimNodes: number;
};

export function runChecks(
  questionId: string,
  reply: string,
  nodes: { quote: string }[],
  userMessage: string,
): { checks: Checks; verbatim: boolean[] } {
  const verbatim = nodes.map((n) => checkVerbatim(n.quote, userMessage));
  return {
    checks: {
      templateOk: checkTemplate(questionId, reply),
      nodes: nodes.length,
      verbatimNodes: verbatim.filter(Boolean).length,
    },
    verbatim,
  };
}

// ---- index.ts ----
// 기록 모델 서버 함수 (Supabase Edge Function, Deno)
// - 브라우저 대신 Claude API를 호출한다. API 키는 이 함수의 비밀값에만 있다.
// - 수업 코드(CLASS_CODE)를 아는 사람만 쓸 수 있다.
// - COLLECT_ENABLED=true 이고 학생이 동의한 경우에만 DB에 저장한다.


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
