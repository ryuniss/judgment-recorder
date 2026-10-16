# 탐색 기록 모델

학생 팀이 AI로 리서치하고 아이디어를 탐색하는 동안, 판단하지 않고 **묻고 정리하는** 기록 모델입니다.
팀의 기준·의도 카드를 바탕으로 정해진 질문만 던지고, 학생의 말을 다섯 가지 노드로 정리합니다.

| 노드 | 뜻 |
|---|---|
| INTENT (의도) | 무엇을 하려고 했는가 |
| DISCOVERY (발견) | 새로 알게 된 것, 처음 기대와 달라진 것 |
| JUDGMENT (판단) | 채택·보류·폐기와 그 이유 |
| CRITERION (기준) | 판단 뒤에 있는 기준 |
| MOVE (다음 행동) | 방향을 바꾸거나 다음에 할 일 |

## 구조

```
docs/                       화면 (GitHub Pages로 공개)
  index.html, app.js, style.css
  config.js                 ← 배포 후 서버 주소를 적는 곳
supabase/
  functions/record-model/   서버 함수 (Claude API 호출, 수업 코드 확인, 선택적 저장)
    prompt.ts               ← 기록 모델의 시스템 프롬프트
  migrations/001_init.sql   저장용 테이블
```

GitHub Pages는 정적 호스팅이라 API 키를 숨길 수 없습니다. 그래서 Claude API 키는 Supabase 서버 함수의 비밀값에만 두고, 화면은 그 함수만 호출합니다.

## 설치

### 1. Supabase 프로젝트 만들기
[supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다 (무료 플랜으로 충분).

### 2. 테이블 만들기
Supabase 대시보드 › SQL Editor에 `supabase/migrations/001_init.sql` 내용을 붙여 넣고 실행합니다.

### 3. 서버 함수 배포
[Supabase CLI](https://supabase.com/docs/guides/cli)를 설치한 뒤, 이 저장소 폴더에서:

```bash
supabase login
supabase link --project-ref <프로젝트 ref>

supabase secrets set \
  ANTHROPIC_API_KEY=<Claude API 키> \
  CLASS_CODE=<학생에게 알려줄 수업 코드> \
  COLLECT_ENABLED=false \
  ALLOWED_ORIGIN=https://<GitHub 계정>.github.io

supabase functions deploy record-model --no-verify-jwt
```

| 비밀값 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 키. 이 값은 화면 코드나 저장소에 절대 넣지 않습니다 |
| `CLASS_CODE` | 수업 코드. 이 코드를 아는 사람만 기록 모델을 쓸 수 있습니다 |
| `COLLECT_ENABLED` | `true`면 동의한 학생의 기록을 DB에 저장합니다. 기본값 `false` |
| `ALLOWED_ORIGIN` | 화면 주소. 다른 사이트에서 함수를 호출하지 못하게 막습니다 |
| `CLAUDE_MODEL` | (선택) 쓸 모델. 기본값 `claude-sonnet-5-5` |

Anthropic Console에서 월 사용 한도를 걸어 두기를 권합니다.

### 4. 화면에 서버 주소 적기
`docs/config.js`를 열어 두 값을 채우고 커밋합니다.

```js
FUNCTION_URL: "https://<프로젝트 ref>.supabase.co/functions/v1/record-model",
SUPABASE_ANON_KEY: "<프로젝트 anon public 키>",
```

anon 키는 공개되어도 되는 값입니다. 테이블은 RLS로 막혀 있어 서버 함수만 읽고 쓸 수 있습니다.

### 5. GitHub Pages 켜기
저장소 › Settings › Pages › Build and deployment에서 **Deploy from a branch**, 브랜치 `main`, 폴더 `/docs`를 고릅니다.
몇 분 뒤 `https://<GitHub 계정>.github.io/<저장소 이름>/`에서 열립니다.

### 서버 없이 화면만 보기
주소 끝에 `?mock=1`을 붙이면 가짜 응답으로 흐름만 확인할 수 있습니다. 수업 코드는 아무 값이나 넣으면 됩니다.

## 연구 자료 수집

기본값은 **저장하지 않음**입니다. 학생 기록은 학생 브라우저에만 남고, 학생이 "정리본 내려받기"로 직접 받습니다.

생명윤리 심의 승인을 받은 뒤에만 켜 주세요.

```bash
supabase secrets set COLLECT_ENABLED=true
```

켜면 입장할 때 연구 참여 안내가 나오고, **동의한 학생의 기록만** 저장됩니다.

- `sessions`: 팀 이름, 카드, 동의 여부 (세션 id는 임의 UUID, 이름은 받지 않음)
- `turns`: 학생 메시지, 모델 응답, 그 응답이 만든 노드
- `summaries`: 학생이 직접 고친 최종 노드 목록 (정리본을 내려받을 때 저장)

데이터는 Supabase 대시보드 › Table Editor에서 보거나 CSV로 내려받을 수 있습니다.

## 프롬프트 고치기

질문 문구나 노드 규칙은 `supabase/functions/record-model/prompt.ts`에 있습니다. 고친 뒤 다시 배포하세요.

```bash
supabase functions deploy record-model --no-verify-jwt
```

## 로컬에서 함수 돌려 보기

```bash
cd supabase/functions/record-model
CLASS_CODE=test ANTHROPIC_API_KEY=<키> deno run --allow-net --allow-env --allow-read index.ts
```
