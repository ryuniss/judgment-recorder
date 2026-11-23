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
