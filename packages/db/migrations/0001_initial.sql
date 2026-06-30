-- G's版MVPアイマニ 初期スキーマ
-- AI run lifecycle / SSE / Better Auth / report fields

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS consultations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'tutor', 'mentor', 'public')),
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  personal_report TEXT,
  shared_report   TEXT,
  shared_with     TEXT CHECK (shared_with IS NULL OR shared_with IN ('tutor', 'mentor')),
  shared_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  consultation_id   TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  message_number    INTEGER NOT NULL,
  author_type       TEXT NOT NULL CHECK (author_type IN ('student', 'tutor', 'mentor', 'ai')),
  author_id         TEXT,
  body              TEXT NOT NULL,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (consultation_id, message_number)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'tutor', 'mentor')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id                    TEXT PRIMARY KEY,
  consultation_id       TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  source_message_id     TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idempotency_key       TEXT NOT NULL UNIQUE,
  stage                 TEXT NOT NULL CHECK(stage IN ('initial', 'deep_dive')),
  status                TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
    'queued', 'admitted', 'generating', 'repairing', 'completed', 'failed'
  )),
  model                 TEXT NOT NULL,
  prompt_version        TEXT NOT NULL,
  flue_run_id           TEXT UNIQUE,
  provider_request_id   TEXT,
  attempt_count         INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  input_tokens          INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens         INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  cache_read_tokens     INTEGER CHECK(cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cache_write_tokens    INTEGER CHECK(cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  estimated_cost_micros INTEGER CHECK(estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
  result_hash           TEXT,
  error_code            TEXT,
  error_message         TEXT CHECK(error_message IS NULL OR length(error_message) <= 500),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  admitted_at           TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_run_events (
  id          TEXT PRIMARY KEY,
  ai_run_id   TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL CHECK(sequence >= 1),
  event_type  TEXT NOT NULL CHECK(event_type IN ('status', 'completed', 'failed')),
  data_json   TEXT NOT NULL CHECK(json_valid(data_json)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(ai_run_id, sequence)
);

-- Better Auth tables (SQLite/D1)
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consultations_user_created ON consultations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_visibility_created ON consultations(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_shared_with ON consultations(shared_with, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_consultation_number ON messages(consultation_id, message_number);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_consultation_created ON ai_runs(consultation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_source ON ai_runs(source_message_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_status_updated ON ai_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_run_events_stream ON ai_run_events(ai_run_id, sequence);
