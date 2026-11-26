CREATE TABLE IF NOT EXISTS participants (code TEXT PRIMARY KEY, created_at TEXT NOT NULL);
-- 확장 프로그램이 모은 원문. 수정하지 않는다.
CREATE TABLE IF NOT EXISTS raw (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, host TEXT, url TEXT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL,
  images TEXT, client_id TEXT, dedupe TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, code TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
-- 기획 의도. 처음 기준은 criteria에 '처음'으로 들어간다.
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, code TEXT NOT NULL, intent TEXT, created_at TEXT NOT NULL);
-- 기준 이력: 이전 기준(prev_id)을 지우지 않고 이어 붙인다.
CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL,
  change_type TEXT NOT NULL, prev_id TEXT, status TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
-- 판단: 학생이 화면에서 고른 값 그대로. raw_ids는 학생이 체크한 관련 원문.
CREATE TABLE IF NOT EXISTS judgments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, label TEXT NOT NULL CHECK(label IN ('유지','수정','기각','보류')),
  raw_ids TEXT, reason TEXT, what TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL);
-- 대화 쪽 AI가 검토 화면을 연 시점과 이유(반영 시점 감지 정확도 점검용)
CREATE TABLE IF NOT EXISTS review_triggers (id TEXT PRIMARY KEY, code TEXT NOT NULL, session_id TEXT, what TEXT, created_at TEXT NOT NULL);
-- 로그인 계정 ↔ 참여 코드 대응표. 연구 데이터 내보내기(/admin/export)에는 포함하지 않는다.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, email TEXT, name TEXT, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject));
-- ===== 캔버스(06) =====
-- 이미지 노드. parents는 학생이 고른 출처 노드(JSON 배열). 지우지 않는다.
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, letter TEXT NOT NULL, name TEXT, image_id TEXT,
  parents TEXT NOT NULL DEFAULT '[]', origin TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL);
-- 노드 판단 이력. 바꿔도 이전 기록은 남는다. 최신 행이 현재 판단.
CREATE TABLE IF NOT EXISTS node_judgments (
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL, session_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(label IN ('선택','보류','제외','아직 모르겠어요')),
  reason TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL);
-- 대화 AI가 record_turn으로 넘긴 대화(AI 전달본). 확장 프로그램 원문(raw)과 구분한다.
CREATE TABLE IF NOT EXISTS relayed_turns (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, session_id TEXT, user_text TEXT, assistant_text TEXT,
  focus_node TEXT, created_at TEXT NOT NULL);
-- 화면 조작 기록(초점 이동, 올리기 취소 등). 분석용.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, session_id TEXT, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL);
-- 아이디어 메모: 대화 AI가 학생 말을 옮겨 올린 것(text_relayed)과 학생이 확정한 문장(text_final)을 둘 다 남긴다.
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, num INTEGER NOT NULL, text_relayed TEXT NOT NULL, text_final TEXT,
  related TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('proposed','kept','dismissed')),
  created_at TEXT NOT NULL, resolved_at TEXT);
-- 학생이 캔버스에서 직접 옮긴 위치(옮긴 항목만). 자동 정렬로 되돌리면 지운다.
CREATE TABLE IF NOT EXISTS positions (item_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, updated_at TEXT NOT NULL);
-- 디자인 콘셉트 변경 이력(학생 작성). 처음 콘셉트는 sessions.intent.
CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
-- 생성 묶음(라운드): 한꺼번에 올린 이미지들. 출처는 묶음 단위. parents_auto=1이면 화면이 미리 고른 출처를 학생이 손대지 않은 것(확인 전).
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, num INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'round', name TEXT,
  parents TEXT NOT NULL DEFAULT '[]', parents_auto INTEGER NOT NULL DEFAULT 0, author TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT);
