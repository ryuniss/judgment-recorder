PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS participants (
 id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
 intro_seen INTEGER NOT NULL DEFAULT 0, checkpoint_seen INTEGER NOT NULL DEFAULT 0,
 practice_completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
 id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), number INTEGER,
 is_practice INTEGER NOT NULL CHECK(is_practice IN (0,1)), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','checkpoint','recorded')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, recorded_at TEXT,
 CHECK((is_practice=1 AND number IS NULL) OR (is_practice=0 AND number>=1)), UNIQUE(participant_id,number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_round ON rounds(participant_id) WHERE status != 'recorded';
CREATE TABLE IF NOT EXISTS results (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), label TEXT NOT NULL,
 image TEXT NOT NULL, is_context INTEGER NOT NULL DEFAULT 0, is_practice INTEGER NOT NULL,
 request_id TEXT NOT NULL, UNIQUE(round_id,request_id)
);
CREATE TABLE IF NOT EXISTS turns (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), result_id TEXT REFERENCES results(id),
 role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, is_practice INTEGER NOT NULL,
 request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(round_id,request_id,role)
);
CREATE TABLE IF NOT EXISTS proposals (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), result_id TEXT REFERENCES results(id),
 kind TEXT NOT NULL, content TEXT NOT NULL, inferred_label TEXT,
 status TEXT NOT NULL DEFAULT 'model_proposed', is_practice INTEGER NOT NULL, raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), result_id TEXT NOT NULL REFERENCES results(id),
 label TEXT NOT NULL CHECK(label IN ('SELECT','HOLD','EXCLUDE','UNDECIDED')),
 reason TEXT NOT NULL, original_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'student_confirmed',
 version_reason TEXT NOT NULL CHECK(version_reason IN ('initial','checkpoint_correction','judgment_revision')),
 previous_id TEXT REFERENCES decisions(id), is_practice INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS moves (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), content TEXT NOT NULL,
 original_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'student_confirmed', is_practice INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS move_decision_links (
 move_id TEXT NOT NULL REFERENCES moves(id), decision_id TEXT NOT NULL REFERENCES decisions(id),
 is_practice INTEGER NOT NULL, PRIMARY KEY(move_id,decision_id)
);
-- Student-selected lineage from a confirmed earlier move to a later result.
-- Additive migration: existing records remain unconnected until the student chooses.
CREATE TABLE IF NOT EXISTS result_move_links (
 result_id TEXT NOT NULL REFERENCES results(id),
 move_id TEXT NOT NULL REFERENCES moves(id),
 is_practice INTEGER NOT NULL DEFAULT 0 CHECK(is_practice=0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(result_id,move_id)
);
