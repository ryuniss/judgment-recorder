# Companion v2

첨부한 PRODUCT.md와 13개 화면 설계를 바탕으로 재구현한 실행 앱입니다.
이 저장소의 이전 Supabase/GitHub Pages 앱은 docs/와 supabase/에 보존했습니다.
현재 Render 배포본의 소스를 확보하지 못했기 때문에, v2는 기존 배포본을 수정한 마이그레이션이 아닌 별도 Python/SQLite 앱입니다. 기존 운영 DB와 자동으로 연결하거나 기존 기록을 변환하지 않습니다.

## 실행

Python 3.12 이상. 서버 런타임에는 외부 패키지가 필요 없습니다.

```sh
# 로컬 HTTP에서만 COOKIE_SECURE=0. 배포 HTTPS에서는 1.
export COOKIE_SECURE=0
export DATABASE_PATH="$PWD/companion/data/companion.sqlite3"
python3 -m companion.server --create-code
python3 -m companion.server
```

http://localhost:3000 에서 생성한 참여 코드로 들어갑니다. 코드는 비밀번호와 같은 접속 수단이며 서버에는 해시만 보관합니다. HTTP 전용 쿠키로 7일 세션을 유지합니다.
`HOST`, `PORT` 환경 변수로 바인딩을 변경할 수 있습니다.

## 연구자 화면

서버 환경에 24자 이상의 임의 `ADMIN_KEY`를 설정한 후 `/research.html`에서 입력합니다.
키는 브라우저 저장소에 보관하지 않습니다. 연구자는 참여 코드 발급, 연습을 포함한 원 기록 조회, 연습을 제외한 분석 내보내기를 할 수 있습니다.
참여 코드는 학생별로 하나씩 발급합니다. API도 제공됩니다.

- POST `/api/admin/participants`: 새 코드 발급
- GET `/api/admin/research`: 연습·제안·거절·원문 포함
- GET `/api/admin/export`: 연습 제외, 확정된 연구 기록
- 관리자 요청은 `Authorization: Bearer <ADMIN_KEY>` 필요

## AI 모드

기본 `AI_MODE=demo`는 실제 AI를 호출하지 않습니다. 화면에 테스트 모드를 표시하고 잠정 응답만 사용합니다. 판단이나 다음 행동을 임의로 생성하지 않습니다.
실제 AI를 사용하려면 `AI_MODE=openai`, `OPENAI_API_KEY`, 선택적으로 `OPENAI_MODEL`(기본 `gpt-4.1-mini`)을 설정합니다.
실제 API 호출/모델의 연구 규칙 준수는 이 작업 환경에서 검증하지 않았습니다. 파일럿에서 프롬프트 충실도를 별도로 확인해야 합니다.

진행 중에는 대화 응답만 표시합니다. 확인 화면 진입 때 분류하여 AI 판단 추정은 연구자용 `proposals`에만 남깁니다. 이유 칸은 AI 출력과 무관하게 결과에 붙여 보낸 학생 메시지 전체를 원문 순서대로 채웁니다. 다음 행동 제안은 실제 학생 발화의 연속된 원문에 해당할 때만 채웁니다.

## 저장 규칙

- 연습 라운드는 번호가 NULL이며, 실제 번호는 1부터 셉니다.
- 안내를 건너뛸 수 있지만 서버에서 연습 완료 전 실제 라운드 생성을 막습니다.
- 라운드, 이미지, 대화, 제안, 판단, 다음 행동, 연결에 `is_practice`를 저장합니다.
- `UNDECIDED`는 NULL과 별도 값입니다. 이야기한 결과는 판단이 있어야 확정 가능합니다.
- 이유 수정은 원문 버전을 보존한 `checkpoint_correction`, 나중 라운드의 판단 변경은 `judgment_revision`으로 추가합니다.
- 한 라운드의 기록은 트랜잭션으로 한 번만 저장하며 재요청은 중복을 만들지 않습니다.
- 대화는 AI 호출 전에 저장합니다. AI 실패 시 저장된 학생 말은 유지합니다.
- 학생 보기에는 실제 라운드의 `student_confirmed` 기록만 나타납니다.
- 작성 중인 말과 확인 화면 초안은 참여자/라운드별 브라우저 로컬 저장소에 보관합니다. 같은 기기를 여러 학생이 쓰면 브라우저 프로필을 분리하세요.
- 결과 카드를 눌러 보는 것과 대화에 붙이는 것은 별도 동작입니다. 대화에 붙이지 않은 메시지에는 결과를 임의로 배정하지 않습니다.

## 같은 Render 주소로 배포

새 서비스를 만드는 대신 **기존 companion-preview 서비스**의 저장소/브랜치와 실행 설정을 변경해야 같은 주소를 유지할 수 있습니다.

1. GitHub의 이 변경 브랜치/커밋을 기존 서비스에 연결합니다.
2. Docker 런타임이면 루트 `Dockerfile`을 사용합니다. Python 런타임이면 Build Command `python -m compileall -q companion`, Start Command `python -m companion.server`를 사용합니다.
3. `COOKIE_SECURE=1`, `ADMIN_KEY`, `DATABASE_PATH`를 설정합니다. AI는 먼저 `AI_MODE=demo`로 검증합니다.
4. 실제 연구 기록은 영속 디스크 경로에 저장해야 합니다. 예: `/var/data/companion.sqlite3`. Render 무료 임시 파일시스템은 재시작/배포 시 자료가 사라질 수 있습니다. 디스크가 없는 상태에서는 테스트 자료만 사용합니다.
5. 헬스 체크 경로는 `/health`입니다.
6. 연구자 화면에서 새 코드를 발급하고 안내 → 연습 → 실제 라운드 → 확인 → 기록을 점검합니다.

`render.example.yaml`은 설정 참고용이며 자동 배포·유료 디스크 생성을 실행하지 않습니다. 기존 DB나 학생 자료의 삭제/이전은 수행하지 않았습니다. SQLite DB 파일과 업로드 이미지(동일 DB)를 영속 디스크 단위로 백업하세요. 단일 인스턴스용이며 다중 인스턴스 운영 시 공유 DB로 전환해야 합니다.

## 검증

```sh
npm ci
npm run build
npm test
deno test supabase/functions/record-model/checks_test.ts
```

Python 저장 규칙/API 테스트와 jsdom 기반 DOM 흐름 테스트를 포함합니다. DOM 테스트는 실제 서버와 임시 DB에 연결해 안내·연습·실제 라운드·실패 복구를 검증합니다.

실제 Chromium 회귀 검증은 별도로 실행합니다. Python용 Playwright와 Chromium이 필요합니다.

```sh
python3 -m pip install -r companion/tests/requirements-browser.txt
# 시스템 Chromium이 없으면 python3 -m playwright install chromium
QA_OUTPUT=work/browser-check python3 -m companion.tests.browser_check
```

시스템 Chromium은 자동 탐색하며, 다른 경로는 CHROMIUM_PATH로 지정합니다. 이 테스트는 임시 DB와 테스트 참여자를 만들어 실제 브라우저에서 빈 연습 → 이미지 업로드 → 두 결과의 판단 → 해볼 것 두 개와 연결 → 실패 복구 → 기록/이전 판단 연결을 확인합니다. 1440×1000과 390×844 화면 캡처, 안내 포커스/위치, 기존 결과 이름 누락도 검증합니다. 실제 모바일 기기와 실제 AI 응답은 검증 범위에 포함하지 않습니다.
Python/일반 JavaScript 구현이므로 새 앱에 별도 TypeScript 타입 검사는 없습니다. JavaScript 문법과 Python 컴파일을 검사하며 이전 TypeScript 테스트는 Deno로 검사합니다.

## 설계와 다른 점 / 남은 확인

- 원래 배포본을 확보하지 못해 Python/SQLite로 재구현했습니다. 기존 운영 구조를 보존하는 최소 변경이라고 볼 수 없습니다.
- 시안의 컵 아이콘 대신 요구사항대로 사진 3장을 포함했습니다. 출처는 `static/assets/CREDITS.md`입니다.
- 확인은 ① 결과마다 판단 → ② 다음에 해볼 것으로 나눕니다. ①은 한 번에 결과 하나를 보여주며 이미지와 선택지를 나란히, 작은 화면에서는 세로로 배치합니다. 진행 중 화면에는 진행률을 표시하지 않고, 확인 ①에서만 이야기한 결과의 선택 개수를 표시합니다.
- 결과 이름은 업로드 순서 A, B, C…로 통일합니다. 이름이 null인 기존 데이터와 확인 API의 미선택 판단값을 화면에서 결과 이름으로 사용하지 않습니다.
- 단계 이동은 화면 상태/초안만 바꾸며 기존 record API에 한 번에 기록합니다. API와 DB 구조는 변경하지 않았습니다.
- 실제 Chromium에서 데스크톱·모바일 너비의 화면 캡처와 스포트라이트 위치, 포커스 이동을 검증했습니다. 배포 후 검증 결과는 작업 보고에 별도로 기록합니다.
- 실제 AI 연결, Render 배포, 운영 DB 조회 결과는 별도 검증이 필요합니다.

## 탐색 지도 (2026-11-21)

상단 **탐색 지도**에서 기록한 라운드가 왼쪽에서 오른쪽으로 이어집니다. 결과·확정 판단·다음 시도 노드를 누르면 원문과 연결된 기록을 확인할 수 있습니다. 기록 목록과 JSON 내려받기도 유지합니다.

이전 라운드에 해볼 것이 있으면 새 결과 업로드 뒤 학생이 직접 연결을 선택하거나 건너뜁니다. 진행 중에는 **이전 시도 연결**에서 수정/해제할 수 있고, 기록 후에는 고정됩니다. 연습, 다른 학생, 미확정 시도, 같은/미래 라운드 및 맥락 캡처와의 연결은 서버가 거부합니다.

`result_move_links` 테이블은 서버 시작 시 기존 SQLite DB에 추가됩니다. 기존 레코드나 테이블을 지우지 않으며 이전 데이터에 연결을 추측해서 채우지 않습니다. `/api/history` 및 연구자 내보내기에 새 연결 배열이 포함됩니다. 기존 소비자는 이 추가 필드를 무시할 수 있습니다.

흰색 배경과 6–8px 모서리를 사용하고, 이미지 작업대와 대화 영역은 제목·색·테두리로 구별합니다.

브라우저 회귀 검사:

```sh
QA_OUTPUT=work/browser-check python3 -m companion.tests.map_check
```

라운드 세 개, 두 원인 시도에서 한 결과로 이어지는 연결, 저장 실패 후 재시도, 새로고침, 연결 건너뛰기, 지도 원문 조회와 모바일 가로 스크롤을 검증합니다.

### Q6와 1순위 기준

상단 ‘1순위 기준’에 학생이 입력한 기준을 저장하면 실제 대화에서 Q6를 사용할 수 있습니다. 기본 demo 모드에서는 Q6가 나오지 않습니다. AI_MODE=live와 OPENAI_API_KEY 설정이 필요합니다. 기존 전체 Q 체계가 아닌 Q6만 이식한 버전입니다. 연구자 ‘원 기록’ JSON의 criterion_cards와 question_events에서 기준 버전, 질문 당시 대화, 질문 ID·문구 검사 결과를 확인할 수 있습니다.

이식 범위, 추가 보호 조건, 실제 모델 검증 방법은 [Q6 이식 기록](../docs/q6-port.md)을 참조하세요.


### HTML 시안의 이미지 작업 캔버스

실제 라운드에서는 06 시안의 캔버스와 선택 이미지의 대화를 사용합니다. 01 기준·의도 카드(4단계), 03 결과별 정리본, 모바일 탭을 함께 연결했습니다. 선택한 이미지마다 대화·입력 초안을 분리하고 이전 라운드 이미지에도 이어서 말할 수 있습니다.

`result_source_links`는 이미지 출처 다중 연결이며, `result_move_links`의 이전 시도 연결과 별개입니다. 먼저 올린 본인 실제 이미지에만 연결할 수 있어 순환·연습·타 참여자 연결을 막습니다. `lineage_events`는 출처 변경 이력입니다. 판단 칩은 기존 `decisions` 버전 체계로 즉시 저장하며 중복 요청은 `judgment_requests`로 방지합니다. DB 초기화 시 새 테이블과 카드 필드를 추가하며 기존 행을 지우지 않습니다.

`QA_OUTPUT=work/browser-check python -m companion.tests.canvas_browser`로 실제 브라우저에서 다중 출처·저장 재시도·판단 변경·이미지별 대화·모바일 탭·기록 완료를 검증합니다. 시안의 예시 내용은 테스트용으로만 입력하고 앱에 기본 참여자 기록으로 넣지 않습니다.

### 기준 정리 확인과 변화 타임라인

최신 기준 디자인 원본은 `design/redesign-reference.html`입니다. 상단 ‘기준 이력’ 또는 정리본에서 처음 카드, 확인한 변경, 점선의 확인 전 제안을 볼 수 있습니다. 발언의 ‘기준으로 남기기’로 학생이 직접 제안하고, 실제 모델 모드에서는 원문 인용을 검증한 AI 제안도 같은 확인 과정을 거칩니다. 유형 다섯 개는 기본 선택이 없고, 확인 전 제안은 현재 기준과 Q6에 반영되지 않습니다.

DB는 criterion_changes(제안·원문·학생 유형·확인), turn_context(학생이 직접 연결한 질문 응답), criterion_codings(독립 연구자 코딩), 카드의 extra_criteria(추가 기준)를 추가합니다. 기존 데이터는 보존합니다. 연구자 원 기록 JSON에 전체 기준 이력과 코딩을 포함합니다. 연구자 인증 후 POST `/api/admin/criteria/coding`에 criterion_id/code/note를 보내면 코딩을 새 행으로 남깁니다. 학생 화면에는 연구자 코딩을 표시하지 않습니다.

`python -m companion.tests.criteria_browser`는 첨부 HTML의 06을 그대로 렌더링한 reference-06.png와 실제 앱의 latest-06/03 및 모바일 캡처를 만듭니다. 조명 이미지와 대화는 격리된 테스트 DB에만 넣는 예시이며, 실제 모델 의미 판단 검증은 아닙니다.

탐색 상단의 **목록·기록 보기 / 캔버스 보기**로 02와 06 구성을 전환합니다. 모바일 기록 탭은 정리본이 아니라 같은 기록 패널을 엽니다. 학생이 직접 남긴 발견·의도·다음 행동은 `exploration_notes`에 수정/삭제 버전을 추가하며 원문을 보존합니다. Q6의 명시적 건너뛰기는 `question_skips`에 저장하며 판단을 변경하지 않습니다. 07 안내는 연구 데이터에 쓰지 않는 컵 예시이고, 이어지는 연습 수행은 기존 분리된 연습 라운드를 사용합니다.
