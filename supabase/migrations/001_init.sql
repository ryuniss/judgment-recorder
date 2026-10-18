-- 기록 모델 저장 테이블
-- 서버 함수(service role)만 읽고 쓴다. RLS를 켜고 공개 정책은 두지 않는다.
-- 이름 등 개인 식별 정보는 받지 않는다. 세션 id는 브라우저가 만든 임의 UUID다.

create table if not exists public.sessions (
  id uuid primary key,
  team text,
  consent boolean not null default false,
  card jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.turns (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  nodes jsonb,
  question_id text, -- 모델이 한 질문의 번호 (Q1~Q11, NONE, UNKNOWN, MISSING). prompt.ts의 QUESTIONS 참조
  checks jsonb,     -- 충실도 자동 검사: templateOk, nodes, verbatimNodes, latencyMs, model
  created_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  nodes jsonb not null,
  trigger text,     -- auto(고칠 때 자동 저장) 또는 export(내려받을 때)
  created_at timestamptz not null default now()
);

create index if not exists turns_session_idx on public.turns(session_id, created_at);
create index if not exists summaries_session_idx on public.summaries(session_id, created_at);

alter table public.sessions enable row level security;
alter table public.turns enable row level security;
alter table public.summaries enable row level security;
