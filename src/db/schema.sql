-- lc-agent 数据库 schema（docs/10 §3；SQLite 定案，字段类型保持 PG 兼容）
CREATE TABLE IF NOT EXISTS account_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site TEXT NOT NULL DEFAULT 'leetcode.cn',
  cookie_enc TEXT,
  csrf_enc TEXT,
  last_probe_status TEXT,
  last_probe_at INTEGER,
  last_active_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS problem_records (
  problem_id TEXT PRIMARY KEY,
  frontend_question_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT,
  title_cn TEXT,
  difficulty TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  paid_only INTEGER NOT NULL DEFAULT 0,
  ac_status INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'queued',
  skip_reason TEXT,
  retry_after INTEGER,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_problem_lifecycle ON problem_records (lifecycle, ac_status, retry_after);
CREATE INDEX IF NOT EXISTS idx_problem_slug_order ON problem_records (frontend_question_id);

CREATE TABLE IF NOT EXISTS test_cases_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id TEXT NOT NULL,
  input TEXT NOT NULL,
  expected TEXT,
  expected_predicted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_problem ON test_cases_store (problem_id);

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  kind TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'javascript',
  code_snapshot TEXT NOT NULL,
  verdict TEXT,
  error_digest TEXT,
  detail TEXT,
  token_in INTEGER NOT NULL DEFAULT 0,
  token_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_problem ON attempts (problem_id, created_at);

CREATE TABLE IF NOT EXISTS solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id TEXT NOT NULL UNIQUE,
  markdown TEXT NOT NULL,
  codes TEXT,
  runtime_ms INTEGER,
  runtime_percentile REAL,
  memory_percentile REAL,
  git_commit TEXT,
  push_status TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
