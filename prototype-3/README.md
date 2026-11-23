# 3차 모델 연결 시제품

학생은 평소처럼 ChatGPT·Claude 웹에서 대화하고, 판단은 대화 안(또는 옆 패널)에 열리는 검토 화면에서 직접 고른다.
대화 원문은 크롬 확장 프로그램이 따로 모은다. 두 쪽은 **참여 코드** 하나로 같은 저장소에 묶인다.

```
학생 브라우저                          서버 (server/)
┌ ChatGPT·Claude 웹 ─────────┐
│ 대화·이미지 생성              │ ── 확장 프로그램 ──▶ POST /ingest   (원문: 학생 말·AI 응답·이미지)
│ ┌ 검토 화면 (MCP App) ─────┐ │
│ │ 관련 원문 체크, 유지·수정·  │ │ ◀─ MCP ─────────▶ /mcp/<참여코드> (검토 화면, 판단·기준 저장)
│ │ 기각·보류, 이유, 기준 변화  │ │
│ └─────────────────────────┘ │                     SQLite: raw · sessions · criteria · judgments · review_triggers
└────────────────────────────┘
```

## 무엇이 들어 있나

| 폴더 | 내용 |
|---|---|
| `server/` | Node 서버 하나. `/ingest`(확장 프로그램 수신), `/mcp/<코드>`(MCP 서버), `/admin/*`(연구자), `/view-preview`(화면 미리보기) |
| `server/view/` | 검토 화면(MCP App). 탐색 시작 · 반영 전 검토 · 정리 세 화면 |
| `extension/` | 크롬 확장(MV3). 켜 둔 동안 ChatGPT·Claude의 완료된 메시지와 이미지를 보냄 |

### MCP 도구

| 도구 | 누가 부르나 | 하는 일 |
|---|---|---|
| `start_exploration` | 대화 AI | 기획 의도·1순위 기준을 학생이 직접 적는 화면을 연다 |
| `open_review(what)` | 대화 AI | 학생이 결과를 반영하려 할 때 검토 화면을 연다. 호출 시각과 `what`을 `review_triggers`에 남긴다(감지 정확도 점검용) |
| `open_summary` | 대화 AI | 판단과 기준 변화를 보여준다 |
| `app_save_session`, `app_save_judgment`, `app_get_state` | 화면만(`visibility: ["app"]`) | 학생 입력을 고치지 않고 저장. 대화 AI는 부를 수 없다 |

판단을 저장하면 화면이 `updateModelContext`로 대화 AI에게 "학생이 '유지'를 골랐다, 이유는 …, 평가하거나 바꾸자고 제안하지 말 것"을 알린다.

### 저장 원칙
- **원문은 확장 프로그램만 쓴다.** MCP 쪽 AI가 요약해 넘긴 글은 원문 칸에 들어가지 않는다.
- **판단·이유·기준은 학생 입력 그대로.** `author = student`.
- **관련 원문은 학생이 체크한다.** 지난 검토 이후 들어온 원문이 미리 체크돼 있고, 학생이 빼거나 더한다. 시간으로 자동 연결하지 않는다.
- **기준은 지우지 않고 이어 붙인다.** `criteria.prev_id`, `change_type`(처음·구체화·바뀜·새 기준 추가·순위 변경).
- **확장 프로그램은 켠 뒤의 대화만 보낸다.** 켜기 전 화면에 있던 메시지는 보내지 않는다.

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

- **Render:** 이 브랜치의 루트에 `render.yaml`이 있다. Render에서 New → Blueprint → 저장소·브랜치(`prototype-3`) 선택. 또는 아래처럼 Web Service를 직접 만든다.
- **Docker가 되는 곳(Railway, Fly.io, 사내 서버 등):** `server/Dockerfile` 사용. 데이터는 `/data`에 쌓이므로 그 경로에 볼륨을 연결한다.
  ```sh
  cd server && docker build -t jr3 . && docker run -p 8787:8787 -v jr3data:/data -e PUBLIC_URL=https://… -e ADMIN_KEY=… -e SESSION_SECRET=… jr3
  ```
- **일반 Node 서버:** `cd server && npm ci && npm start`

### Render 예시

Claude·ChatGPT가 MCP 서버에 붙으려면 **HTTPS 공개 주소**가 필요하다.

1. 새 Web Service, 루트 `server/`, Build `npm install`, Start `npm start`
2. 환경 변수: `PUBLIC_URL=https://<서비스>.onrender.com`, `ADMIN_KEY=<24자 이상 임의 문자열>`, `DATABASE_PATH=/var/data/p3.sqlite3`
3. Persistent Disk를 `/var/data`에 연결 (없으면 재시작마다 기록이 사라짐)
4. 참여 코드 발급: `curl -X POST -H "Authorization: Bearer $ADMIN_KEY" https://…/admin/participants` → `{ code, mcp_url }`
5. 전체 내보내기: `curl -H "Authorization: Bearer $ADMIN_KEY" https://…/admin/export`

## 학생 쪽 연결 (Google 로그인)

학생에게는 **공용 링크 하나**(`https://…/join`)만 준다. 아무 Google 계정으로 로그인하면 계정마다 참여 코드가 자동으로 만들어진다.
1. 확장 프로그램 설치
2. `…/join` 열기 → **Google로 로그인** → 내 연결 페이지(`/join/me`)로 이동. 이때 확장 프로그램이 서버 주소와 코드를 자동 저장한다(수집은 켜지 않음).
3. 같은 페이지의 [복사]로 커넥터 주소를 복사해 Claude에 추가: Customize → Connectors → + Add → Add custom connector → 이름 "판단 기록", 주소 붙여넣기, 인증 No sign in
4. 새 대화에서 + → Connectors → "판단 기록" 켜기 → "탐색을 시작할게요"
5. 다른 기기나 브라우저에서도 같은 계정으로 로그인하면 **같은 코드**가 나온다. 코드를 외우거나 입력할 일이 없다.

로그인 없이 쓰려면 연구자가 발급한 개인 링크(`/join/<코드>`)도 그대로 쓸 수 있다.

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
| `/ingest` 수신, 중복 제거, 잘못된 코드 거부, 이미지 저장·제공 | 로컬 시험 통과 |
| MCP 도구 목록, 화면 리소스, 세션·판단·기준 저장, 지난 검토 이후 원문 표시 | MCP 클라이언트로 로컬 시험 통과 |
| 검토 화면 세 가지 렌더링, 입력 → 저장 → 정리 흐름 | 가짜 데이터로 브라우저 시험 통과 |
| 확장 프로그램: 켜기 전 메시지 제외, 켠 뒤 학생 말·AI 응답·이미지 전송 | **ChatGPT 화면 구조를 흉내 낸 가짜 페이지**에서 시험 통과 |
| 실제 Claude·ChatGPT에서 검토 화면이 뜨는지, 옆 패널로 가는지 | **미확인** (공개 주소 배포 후 점검) |
| 대화 AI가 반영 직전에 `open_review`를 부르는 비율·정확도 | **미확인** — `review_triggers`로 측정 |
| 실제 chatgpt.com·claude.ai의 메시지 선택자, 생성 이미지 수집 | **미확인** — 사이트 구조가 바뀌면 `extension/content.js`의 `SELECTORS`만 고치면 됨 |
| 학생 계정에서 커스텀 커넥터·앱 추가 가능 여부 | **미확인** (Claude 무료 플랜은 커스텀 커넥터 1개까지 가능하다고 안내됨) |
| 개인 링크 → 확장 프로그램 자동 설정 | 로컬 시험 통과 |
| Google 로그인 → 계정별 코드 자동 발급, 재로그인 시 같은 코드, 위조 쿠키 거부, 내보내기에서 이메일 제외 | **가짜 Google 서버**로 로컬 시험 통과. 실제 Google 연동은 미확인 |

## 12/10 점검 순서

1. Render 배포 → Google 로그인 설정 → 내 계정으로 `/join` 로그인해 연결 페이지가 뜨는지
2. 연구자 계정으로 커넥터 추가 → "탐색을 시작할게요"라고 말해 `start_exploration` 화면이 뜨는지, 옆 패널로 가는지
3. 확장 프로그램 켜고 이미지 3장 생성 → `/admin/export`의 `raw`에 학생 말·AI 응답·이미지가 들어왔는지
4. "이걸로 갈게"처럼 반영하는 말을 10번 섞어 대화 → `review_triggers` 수 / 10 = 감지율, 반영이 아닌데 열린 횟수 = 오탐
5. 검토 화면에서 판단 저장 → `judgments.raw_ids`가 맞는 원문을 가리키는지
6. 학생 무료·학교 계정으로 커넥터 추가가 되는지

## 알아 둘 한계
- 참여 코드가 MCP 주소에 들어가는 방식은 시제품용 인증이다. 코드가 새면 다른 사람이 그 학생 이름으로 기록할 수 있다.
- 본 연구 전 **학교 계정 로그인**으로 바꾼다. 필요한 것: (1) MCP 서버에 OAuth 2.1 로그인 추가(Claude 커넥터의 "Sign in" 방식), (2) 학교 계정 제공자(Google Workspace 또는 Microsoft 365)로 위임 로그인, 학교 도메인만 허용, (3) 확장 프로그램도 같은 로그인을 쓰도록 변경, (4) 로그인 계정 ↔ 연구 참여 ID 대응표는 연구자만 보관(익명화).
- 대화 AI는 학생이 쓰는 ChatGPT·Claude 그대로라서, 의견을 주거나 이유를 대신 쓰는 것을 막을 수 없다. 도구 설명과 `updateModelContext`로 요청만 할 수 있다. 어떤 서비스·모델을 썼는지는 `raw.host`로 남는다.
