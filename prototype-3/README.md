# 3차 모델 연결 시제품

06 독립 모델(이미지 노드 캔버스 + 오른쪽 챗봇)을 ChatGPT·Claude 안으로 옮긴 것이다. **오른쪽 챗봇 자리는 ChatGPT·Claude 본체가 맡고**, 캔버스는 대화 안에 열리는 앱 화면(MCP App)이다. 서버와 화면은 하나이고 ChatGPT·Claude 모두에 같은 주소로 붙인다.

```
ChatGPT·Claude 대화창 (= 06의 챗봇)              서버 (server/)
┌──────────────────────────────────────┐
│ 학생 ↔ AI 대화, 이미지 생성              │ ── record_turn ─────▶ relayed_turns (AI 전달본)
│ ┌ 판단 기록 캔버스 (MCP App) ────────┐ │ ◀─ MCP /mcp/<코드> ─▶ nodes · node_judgments · criteria · events
│ │ 이미지 올리기·끌어다 놓기 → 출처 선택  │ │
│ │ 선택·보류·제외·아직 모르겠어요 + 이유 │ │
│ │ 1순위 기준 변화(정리 제안은 확인 전)  │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
(선택) 크롬 확장 프로그램 ──────────────────────▶ /ingest → raw (화면에서 직접 모은 원문·이미지)
```

## 무엇이 들어 있나

| 폴더 | 내용 |
|---|---|
| `server/` | Node 서버 하나. `/mcp/<코드>`(MCP 서버), `/join`(Google 로그인), `/ingest`(확장 프로그램 수신), `/admin/*`(연구자), `/view-preview`(화면 미리보기) |
| `server/view/` | 판단 기록 캔버스(MCP App). 탐색 시작 → 캔버스(노드·출처 연결·판단 패널·기준 기록·확대/축소·한눈에 보기) |
| `extension/` | (선택) 크롬 확장(MV3). 켜 둔 동안 ChatGPT·Claude 화면의 완료된 메시지와 이미지를 보냄 |

### MCP 도구

| 도구 | 누가 부르나 | 하는 일 |
|---|---|---|
| `open_canvas` | 대화 AI | 캔버스를 연다. 처음이면 학생이 기획 의도·1순위 기준을 직접 적는 화면부터 |
| `note_idea` | 대화 AI | 학생이 이미지 없이 말로 꺼낸 아이디어를 '메모 · 확인 전'으로 올린다. 학생이 고쳐서 남기거나 지운다. 옮겨 적은 말(`text_relayed`)과 학생 확정문(`text_final`)을 둘 다 저장. 남긴 메모는 다음 이미지의 출처가 될 수 있다 |
| `open_judgment` | 대화 AI | "이걸로 갈게"(반영)·"아까 A가 나았어"(되돌아감)·판단 요청 때 그 이미지의 판단 창을 연다. 호출마다 `review_triggers`에 이유·학생 말을 남김(감지율·오탐 측정용) |
| `end_session` | 대화 AI | "오늘은 여기까지" → 정리 화면(판단 전 이미지, 판단별 묶음, 남긴 메모, 기준 변화). 대신 정리하지 않음 |
| `note_summary` | 대화 AI | 학생이 "정리해 줘"라고 하거나 끝낼 때, 대화에서 나온 결론을 '정리 · 확인 전'으로 올린다(이미지·콘셉트에 연결). 학생이 고쳐 남기거나 지운다. AI 문장(`text_relayed`)과 학생 확정문(`text_final`)을 따로 저장, `ideas.kind='summary'` |
| `view_image` | 대화 AI | 캔버스 이미지(최대 4장)를 이미지 그대로 받아 본다. 학생이 A·B·C에 대해 말하면 답하기 전에 부르도록 지시. 이게 없으면 AI는 캔버스 이미지를 볼 수 없다 |
| `get_canvas_state` | 대화 AI | A, B, C… 이미지·출처·학생 판단·기준을 읽기만 한다 |
| `record_turn` | 대화 AI | **기본 꺼짐.** `RECORD_TURNS=1`일 때만 등록. 매 응답 끝에 학생 메시지와 자기 답을 그대로 넘긴다 → `relayed_turns`. AI 출력이 약 2배가 되므로 연구 세션에서만 켠다 |
| `open_criterion` | 대화 AI | 학생이 "기준 바꾸고 싶어"라고 직접 말하면 캔버스와 기준 기록 창을 함께 연다. 학생이 한 말을 창 위에 보여 주고, 변화 종류·새 기준은 학생이 적는다 |
| `propose_criterion` | 대화 AI | 기준이 바뀐 것처럼 들릴 때 '정리 제안'만 남긴다(`status=proposed`, `author=ai`). 학생이 확인해야 기준이 된다 |
| `app_*` | 화면만(`visibility: ["app"]`) | 올리기, 판단, 기준 기록, 초점 이동. 대화 AI는 부를 수 없다 |

화면에서 무언가 기록하면 `updateModelContext`로 대화 AI에게 학생이 정한 상태를 알리고 "평가하거나 바꾸라고 권하지 말 것"을 함께 보낸다.
`Q6_TEXT` 환경 변수가 있으면 판단을 기록할 때 대화창에 "C 벽 반사를 '선택'으로 기록했어요"를 학생 메시지로 보내고, AI에게 그 질문만 문장 그대로 하라고 지시한다. 비어 있으면 대화창에는 아무것도 보내지 않는다.

### 한꺼번에 올리기 = 생성 묶음(라운드)
- 여러 장을 끌어다 놓거나 고르면 미리보기(최대 8장, 체크를 풀어 빼기) → 묶음 하나(`rounds`)와 그 안의 이미지들이 생긴다. 한 장씩 순서대로 올리고, 실패한 장만 다시 시도.
- 출처는 **묶음 단위**. 화면이 미리 고른 출처(놓은 자리·마지막으로 이야기한 이미지)를 학생이 손대지 않으면 `parents_auto=1`(**자동 · 확인 전**, 점선)으로 저장. 학생이 출처를 누르거나 [출처 확인]을 하면 `parents_auto=0`, 변경 전후는 `events.type='group_parents'`.
- 분석에서는 학생이 고른 출처와 자동 출처를 나눠 쓴다. 판단은 여전히 이미지 한 장씩.

### 학생이 만든 묶음(클러스터)
- [묶기] → 이미지를 눌러 고르고(라운드를 가로질러도 됨) → "이 묶음을 한마디로 하면?"(선택) → 묶음. `rounds.kind='cluster'` + `cluster_members`(한 이미지가 여러 묶음에 들어갈 수 있음).
- 상자로 묶지 않고 카드에 이름표로 붙는다. 위쪽 "내 묶음"에서 이름을 누르면 그 묶음만 강조되고 나머지는 흐려진다.
- 묶음 창: 이름 고치기, 빼기, 더 넣기, 풀기(기록은 남고 화면에서만 빠짐), **이 이름을 판단 기준으로 기록하기**(학생이 누를 때만, 비어 있는 다음 순위·이름이 채워진 기준 기록 창).
- 만들기·이름 변경·구성 변경·풀기는 모두 `events`에 남는다. AI에게는 묶은 사실만 알리고 평가·기준 제안을 하지 말라고 전한다.

### 캔버스 배치
- 가로는 출처 깊이, 세로는 같은 열 안에서 **출처 이미지 가까이**(갈래끼리 모이게) 자동 배치.
- 학생이 끌어 옮긴 항목만 그 자리에 고정(`positions`, 옮길 때마다 `events.type='move'`). [자동 정렬]로 되돌리면 `positions`를 지운다.

### 저장 원칙
- **판단·이유·출처·기준은 학생이 캔버스에서 한 그대로.** `author = student`. 판단을 바꿔도 이전 행은 지우지 않는다(`node_judgments` 이력).
- **판단 단어는 06과 같다:** 선택·보류·제외·아직 모르겠어요. 아무것도 고르지 않은 상태는 '판단 전'이며 고를 수 있는 값이 아니다. 이유를 비우면 '이유 미기록'.
- **출처는 학생이 고른다.** 마지막으로 이야기한 이미지(또는 놓은 자리의 이미지)가 미리 골라져 있고 학생이 바꾼다.
- **기준은 이어 붙인다.** `criteria.prev_id`, `change_type`(처음·구체화·바뀜·새 기준 추가·순위 변경·아직 구분하기 어려워요). AI 정리 제안은 `proposed` → 학생이 확인하면 `accepted` + 새 `confirmed` 행(`author = student(제안 확인)`), 넘기면 `dismissed`.
- **비교 요청("B랑 C 뭐가 나아?")에는 화면 반응이 없다.** 서버 지시문으로 우열 판정을 금지하고 지금 기준을 짚은 뒤 학생 생각을 먼저 묻게 한다.
- **대화는 두 갈래로 구분한다.** `relayed_turns` = AI가 옮겨 적은 것(빠지거나 다듬어질 수 있음). `raw` = 확장 프로그램이 화면에서 직접 모은 원문. 둘을 섞지 않는다.

### 사용량(크레딧)을 아끼는 장치
- 대화 AI에게 가는 규칙·도구 설명을 짧게 유지(규칙 약 500자, 도구 설명 합계 약 2,500자)하고 중복을 없앴다.
- 화면을 여는 도구는 AI 쪽 결과에 모드만 담는다(약 200자). 전체 상태는 화면이 앱 전용 도구로 따로 받아 오므로 AI 맥락에 쌓이지 않는다.
- `view_image`는 올릴 때 함께 만든 768px 축소본을 보낸다(원본의 약 1/3). 학생이 이미지 내용을 물을 때만, 같은 이미지는 한 대화에 한 번 부르도록 지시.
- `record_turn`은 기본 꺼짐. 대화 원문이 필요하면 확장 프로그램(`raw`)이나 대화 내보내기를 쓴다.
- 화면의 10초 상태 확인은 서버만 오가며 AI 사용량을 쓰지 않는다.

## 로컬에서 돌려 보기

```sh
cd server && npm install
node server.js --create-code          # 참여 코드와 MCP 주소 출력
npm start                              # http://localhost:8787
open http://localhost:8787/view-preview?demo=1&mode=review   # 가짜 데이터로 화면 보기 (start, summary도 가능)
```

확장 프로그램: 크롬 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `extension/` 폴더. 팝업에 서버 주소와 참여 코드를 넣고 "수집 시작".

## 배포

서버는 `server/` 폴더 하나다. Node 22.13 이상이 돌아가는 곳이면 어디든 올릴 수 있다. 필요한 환경 변수는 같다.

| 변수 | 내용 |
|---|---|
| `PUBLIC_URL` | 공개 https 주소, 끝에 `/` 없이 |
| `ADMIN_KEY` | 연구자 키, 24자 이상 |
| `SESSION_SECRET` | 로그인 쿠키 서명용, 32자 이상 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google 로그인 (아래 설정 참고) |
| `DATABASE_PATH` | SQLite 파일 위치. **재시작해도 지워지지 않는 디스크**에 둘 것 |

- **Render:** 이 브랜치의 루트에 `render.yaml`이 있다(무료 플랜, Node 22.13 고정). Render에서 New → Blueprint → 저장소·브랜치(`prototype-3`) 선택. 또는 아래처럼 Web Service를 직접 만든다.
- **Docker가 되는 곳(Railway, Fly.io, 사내 서버 등):** `server/Dockerfile` 사용. 데이터는 `/data`에 쌓이므로 그 경로에 볼륨을 연결한다.
  ```sh
  cd server && docker build -t jr3 . && docker run -p 8787:8787 -v jr3data:/data -e PUBLIC_URL=https://… -e ADMIN_KEY=… -e SESSION_SECRET=… jr3
  ```
- **일반 Node 서버:** `cd server && npm ci && npm start`

### Render 예시

Claude·ChatGPT가 MCP 서버에 붙으려면 **HTTPS 공개 주소**가 필요하다.

1. 새 Web Service, Root Directory `prototype-3/server`, Build `npm install`, Start `npm start`
2. 환경 변수: `PUBLIC_URL=https://<서비스>.onrender.com`, `ADMIN_KEY=<24자 이상 임의 문자열>`, `DATABASE_PATH=/var/data/p3.sqlite3`
3. Persistent Disk를 `/var/data`에 연결 (없으면 재시작마다 기록이 사라짐)
4. 참여 코드 발급: `curl -X POST -H "Authorization: Bearer $ADMIN_KEY" https://…/admin/participants` → `{ code, mcp_url }`
5. 전체 내보내기: `curl -H "Authorization: Bearer $ADMIN_KEY" https://…/admin/export`

## 학생 쪽 연결 (커넥터 안에서 Google 로그인)

학생 전원이 **같은 주소 하나** `https://<서비스>.onrender.com/mcp` 를 커넥터에 넣는다. 참여 코드를 주고받을 일이 없다.
1. Claude: 설정 → 커넥터 → 추가 → 커스텀 커넥터 추가 → 이름 "판단 기록", 주소 `…/mcp` → 추가한 뒤 **연결** → 동의 화면 → Google로 로그인(한 번)
   ChatGPT: 개발자 모드 → 앱 만들기 → 주소 `…/mcp`, 인증 OAuth → 연결 (**미확인**)
2. 이후에는 다시 로그인하지 않는다. 토큰은 하루마다 Claude가 자동으로 갱신하고, 갱신 토큰은 180일 유효.
3. 새 대화에서 "판단 기록"을 켜고 **"판단 기록으로 탐색을 시작할게요"**. Claude는 커넥터 도구를 필요할 때 검색해 불러오므로, 첫 마디에 "판단 기록"이 들어가야 캔버스가 뜬다(2026-11-25 Free 계정 시험).
4. (선택) 확장 프로그램을 쓰는 학생만 `/join`에서 같은 Google 계정으로 로그인 → 확장 프로그램 자동 설정.

같은 Google 계정이면 커넥터 로그인과 `/join` 로그인이 같은 참여 코드로 이어진다. 예전 개인 주소(`/mcp/<코드>`, 로그인 없음)도 예비로 그대로 동작한다.

### 커넥터 로그인 구현 (MCP 인증 규격)
- `/.well-known/oauth-protected-resource(/mcp)` → 인가 서버 = 이 서버. `/mcp`는 토큰이 없으면 401 + `WWW-Authenticate: Bearer resource_metadata=…`
- `/.well-known/oauth-authorization-server`: 동적 등록(`/oauth/register`)과 Client ID Metadata Document 둘 다 지원, PKCE(S256) 필수, 공개 클라이언트
- `/oauth/authorize` → 동의 화면 → 기존 Google 로그인(`/auth/google`, Google 쪽 설정 변경 없음) → 인가 코드 → `/oauth/token`(코드 재사용 거부, 갱신 토큰)
- 허용 redirect: claude.ai, claude.com, chatgpt.com, chat.openai.com, localhost
- 클라이언트 등록·코드·토큰은 `SESSION_SECRET`으로 서명한 값(DB에 저장하지 않음). 무료 플랜에서 DB가 초기화돼도 연결은 유지된다. **`SESSION_SECRET`을 바꾸면 모든 학생이 다시 연결해야 한다.**

### 개인정보 분리
- 이메일·이름은 `identities` 표에만 있다. 연구 데이터 내보내기(`/admin/export`)에는 **들어가지 않는다.**
- 대응표가 필요할 때만 `/admin/identities`로 따로 받는다(연구자 키 필요).
- 받는 정보는 Google의 `openid email profile`(이메일·이름)뿐이다.
- 2차 DBR 동의서에 "Google 계정 로그인, 이메일 수집"이 없다면 IRB 변경·동의서 수정이 필요한지 확인할 것.

### Google 로그인 설정 (연구자, 한 번)
1. [Google Cloud Console](https://console.cloud.google.com/) → 새 프로젝트
2. Google Auth Platform(OAuth 동의 화면) → 앱 이름 "판단 기록", 지원 이메일, 대상 **외부(External)**, 범위는 기본(openid·email·profile)만
3. 테스트 상태면 테스트 사용자로 등록한 계정만 로그인된다. 학생 전체가 쓰려면 앱을 **게시(프로덕션)**로 바꾼다. 기본 범위만 쓰면 별도 심사 부담이 작다(게시 시 안내에 따름).
4. 클라이언트 만들기 → 유형 **웹 애플리케이션** → 승인된 리디렉션 URI: `https://<서비스>.onrender.com/auth/google/callback`
5. 클라이언트 ID·비밀값을 Render 환경 변수에 넣는다:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET` (32자 이상 임의 문자열. 비우면 서버가 재시작될 때마다 학생이 다시 로그인해야 함)

## 확인된 것과 아닌 것 (2026-11-23 기준)

| 항목 | 상태 |
|---|---|
| MCP 도구 목록·서버 지시문·화면 리소스(CSP 포함), 세션·노드·판단 이력·정리 제안→확인·대화 전달본 저장 | MCP 클라이언트로 로컬 시험 통과 |
| 캔버스: 노드 배치·출처 연결선·판단 패널·올리기(출처 미리 선택)·기준 기록·좁은 화면 | 가짜 데이터로 브라우저 시험 통과 |
| 끌어다 놓기 | 코드만 있음. 실제 끌어다 놓기는 미확인 |
| Render 배포, Google 로그인 설정 | 배포됨. 실제 Google 로그인은 테스트 사용자 등록 후 확인 |
| 실제 Claude·ChatGPT 안에서 캔버스가 뜨는지, 크기(전체 화면·옆 패널) | **미확인** |
| 대화 AI가 `record_turn`을 매번 빠짐없이·그대로 부르는지 | **미확인** — 확장 프로그램 원문(`raw`)과 비교해 측정 |
| `sendMessage`(판단 후 대화창에 메시지 보내기)가 두 호스트에서 되는지 | **미확인** |
| 학생 무료·학교 계정에서 커스텀 커넥터·앱 추가 가능 여부 | **미확인** |
| 확장 프로그램: 켜기 전 메시지 제외, 켠 뒤 원문·이미지 전송 | 가짜 ChatGPT 페이지에서만 통과 |

## 12/10 점검 순서

1. `/join` 로그인 → 커넥터 주소 복사 → Claude·ChatGPT 각각에 추가
2. "탐색을 시작할게요" → 시작 화면 → 캔버스가 뜨는지, 전체 화면이 되는지
3. 이미지 3장 올리기(버튼·끌어다 놓기) → 출처 연결이 맞는지, AI가 "C"를 알아듣는지
4. 판단 기록 → AI가 평가하지 않는지, `Q6_TEXT`를 넣었으면 문장 그대로 묻는지
5. 10턴 대화 → `relayed_turns` 수 / 10 = 전달률, 확장 프로그램을 켰다면 `raw`와 글자 단위로 비교
6. 기준을 바꾸는 말 → `propose_criterion`이 정리 제안으로만 뜨는지

## 알아 둘 한계
- 커넥터 로그인은 아무 Google 계정이나 받는다(테스트 상태에서는 Google 테스트 사용자만). 학교 계정만 받으려면 `hd` 도메인 확인을 추가한다.
- 예비 개인 주소(`/mcp/<코드>`)는 주소 자체가 열쇠다. 새면 다른 사람이 그 학생 이름으로 기록할 수 있다.
- 본 연구 전 **학교 계정 로그인**으로 바꾼다. 필요한 것: (1) MCP 서버에 OAuth 2.1 로그인 추가(Claude 커넥터의 "Sign in" 방식), (2) 학교 계정 제공자(Google Workspace 또는 Microsoft 365)로 위임 로그인, 학교 도메인만 허용, (3) 확장 프로그램도 같은 로그인을 쓰도록 변경, (4) 로그인 계정 ↔ 연구 참여 ID 대응표는 연구자만 보관(익명화).
- 대화 AI는 학생이 쓰는 ChatGPT·Claude 그대로라서, 의견을 주거나 이유를 대신 쓰는 것을 막을 수 없다. 서버 지시문·도구 설명·`updateModelContext`로 요청만 할 수 있다. 지켰는지는 대화 기록으로 점검한다.
- ChatGPT·미드저니에서 만든 이미지는 캔버스로 자동으로 오지 않는다. 학생이 저장해서 올리거나 끌어다 놓는다.
- 캔버스는 AI가 `propose_criterion`을 부른 것을 10초마다 확인해 반영한다.
