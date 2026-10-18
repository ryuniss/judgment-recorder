// deno test supabase/functions/record-model/checks_test.ts
import { checkTemplate, checkVerbatim } from "./checks.ts";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

Deno.test("Q6 with slot filled", () => {
  eq(
    checkTemplate(
      "Q6",
      "기록했어요. 처음에는 ‘들어오자마자 내부가 다 보이지 않을 것’을 1순위로 두었는데, 이번 선택은 다르네요. 무엇이 바뀌었나요?",
    ),
    true,
    "Q6 ok",
  );
});

Deno.test("Q1 particle varies", () => {
  eq(checkTemplate("Q1", "‘앉을 자리가 여러 높이일 것’은 왜 중요해요?"), true, "은");
  eq(checkTemplate("Q1", "‘숨을 곳’이 왜 중요해요?"), true, "이");
});

Deno.test("Q4 with slot omitted", () => {
  eq(checkTemplate("Q4", "지금까지 결과들을 나란히 보면, 처음 기대와 달라진 게 있나요?"), true, "omit");
  eq(
    checkTemplate("Q4", "지금까지 결과들(서가, 객석)을 나란히 보면, 처음 기대와 달라진 게 있나요?"),
    true,
    "filled",
  );
});

Deno.test("paraphrase fails", () => {
  eq(checkTemplate("Q5", "왜 그것을 고르셨는지 궁금해요."), false, "paraphrase");
  eq(checkTemplate("Q6", "카드의 기준과 다른 선택이네요. 어떻게 생각하세요?"), false, "paraphrase6");
});

Deno.test("NONE is not checked", () => {
  eq(checkTemplate("NONE", "기록했어요."), null, "none");
});

Deno.test("verbatim", () => {
  const msg = "처음 온 사람이 바로 시선을 받으면\n다시 안 올 것 같아서요";
  eq(checkVerbatim("처음 온 사람이 바로 시선을 받으면 다시 안 올 것", msg), true, "spaces ignored");
  eq(checkVerbatim("처음 온 사람은 시선이 부담스럽다", msg), false, "summarized");
});
