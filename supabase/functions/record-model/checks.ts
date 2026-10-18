// 충실도 자동 검사.
// 모델이 설계대로 개입했는지를 응답마다 기계적으로 확인해 기록한다.
//  - templateOk: 질문 번호의 틀에서 빈칸을 뺀 고정 부분이 응답에 순서대로 들어 있는가
//  - verbatim:   노드의 인용(quote)이 학생 메시지에 글자 그대로 들어 있는가
// 공백, 따옴표, 괄호는 비교에서 무시한다. 빈칸 바로 뒤의 조사(은/는/이/가/을/를/와/과)는
// 빈칸에 들어간 말에 따라 바뀌므로 비교에서 뺀다.

import { QUESTIONS } from "./prompt.ts";

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
