import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env, encryptSecret, decryptSecret } from '../config.js';

/**
 * 单一写入者（docs/02 §2）：全系统唯一的落库出口。
 * Worker 不直接持库，经事件回调由此层写入。
 */

export interface ProblemRow {
  problem_id: string;
  frontend_question_id: string | null;
  slug: string;
  title: string | null;
  title_cn: string | null;
  difficulty: string | null;
  tags: string;
  paid_only: number;
  ac_status: number;
  lifecycle: string;
  skip_reason: string | null;
  retry_after: number | null;
  attempts_count: number;
}

export interface TestCaseRow {
  id: number;
  problem_id: string;
  input: string;
  expected: string | null;
  expected_predicted: number;
  source: string;
  truncated: number;
}

export interface AttemptRow {
  attempt_id: number;
  problem_id: string;
  round: number;
  kind: string;
  code_snapshot: string;
  verdict: string | null;
  error_digest: string | null;
  detail: string | null;
  token_in: number;
  token_out: number;
  created_at: number;
}

const now = () => Date.now();

export class Repository {
  private db: Database.Database;

  constructor(dbFile?: string) {
    const file = dbFile ?? path.join(env.dataDir, 'lc-agent.db');
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    this.db.exec(schema);
    this.migrate();
  }

  /** 存量库列迁移（ALTER ADD COLUMN 对新列幂等） */
  private migrate(): void {
    const has = (table: string, col: string): boolean =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
    if (!has('attempts', 'lang')) this.db.exec("ALTER TABLE attempts ADD COLUMN lang TEXT NOT NULL DEFAULT 'javascript'");
    if (!has('solutions', 'codes')) this.db.exec('ALTER TABLE solutions ADD COLUMN codes TEXT');
  }

  /* ---------- runtime_state（KV，含配置/状态机快照/预算计数） ---------- */

  getMeta<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM runtime_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), now());
  }

  /* ---------- account_session ---------- */

  getAccount(): { cookieEnc: string | null; csrfEnc: string | null; lastProbeStatus: string | null; lastProbeAt: number | null } {
    const row = this.db.prepare('SELECT * FROM account_session WHERE id = 1').get() as
      | { cookie_enc: string | null; csrf_enc: string | null; last_probe_status: string | null; last_probe_at: number | null }
      | undefined;
    return {
      cookieEnc: row?.cookie_enc ?? null,
      csrfEnc: row?.csrf_enc ?? null,
      lastProbeStatus: row?.last_probe_status ?? null,
      lastProbeAt: row?.last_probe_at ?? null,
    };
  }

  setCredentials(session: string, csrftoken: string): void {
    this.db
      .prepare(
        `INSERT INTO account_session (id, site, cookie_enc, csrf_enc, updated_at) VALUES (1, 'leetcode.cn', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cookie_enc = excluded.cookie_enc, csrf_enc = excluded.csrf_enc, updated_at = excluded.updated_at`
      )
      .run(encryptSecret(session), encryptSecret(csrftoken), now());
  }

  hasCredentials(): boolean {
    const row = this.getAccount();
    return Boolean(row.cookieEnc && row.csrfEnc);
  }

  getCredentials(): { session: string; csrftoken: string } | null {
    const row = this.getAccount();
    if (!row.cookieEnc || !row.csrfEnc) return null;
    try {
      return { session: decryptSecret(row.cookieEnc), csrftoken: decryptSecret(row.csrfEnc) };
    } catch {
      return null;
    }
  }

  setProbe(status: string): void {
    this.db
      .prepare(
        `INSERT INTO account_session (id, last_probe_status, last_probe_at, last_active_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_probe_status = excluded.last_probe_status, last_probe_at = excluded.last_probe_at, last_active_at = excluded.last_active_at`
      )
      .run(status, now(), now());
  }

  /* ---------- problem_records ---------- */

  upsertProblems(rows: Array<Omit<ProblemRow, 'attempts_count' | 'ac_status' | 'lifecycle' | 'retry_after' | 'skip_reason'>>): void {
    const stmt = this.db.prepare(
      `INSERT INTO problem_records (problem_id, frontend_question_id, slug, title, title_cn, difficulty, tags, paid_only, lifecycle, created_at, updated_at)
       VALUES (@problem_id, @frontend_question_id, @slug, @title, @title_cn, @difficulty, @tags, @paid_only, 'queued', @ts, @ts)
       ON CONFLICT(problem_id) DO UPDATE SET
         frontend_question_id = excluded.frontend_question_id, slug = excluded.slug, title = excluded.title,
         title_cn = excluded.title_cn, difficulty = excluded.difficulty, tags = excluded.tags,
         paid_only = excluded.paid_only, updated_at = excluded.updated_at`
    );
    const tx = this.db.transaction((items: typeof rows) => {
      for (const r of items) stmt.run({ ...r, ts: now() });
    });
    tx(rows);
  }

  getProblemBySlug(slug: string): ProblemRow | undefined {
    return this.db.prepare('SELECT * FROM problem_records WHERE slug = ?').get(slug) as ProblemRow | undefined;
  }

  listProblems(opts: { lifecycle?: string; ac_status?: number; page?: number; pageSize?: number }): { items: ProblemRow[]; total: number } {
    const pageSize = Math.min(opts.pageSize ?? 50, 200);
    const page = Math.max(opts.page ?? 1, 1);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (opts.lifecycle) {
      conds.push('lifecycle = ?');
      params.push(opts.lifecycle);
    }
    if (opts.ac_status !== undefined) {
      conds.push('ac_status = ?');
      params.push(opts.ac_status);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM problem_records ${where}`).get(...params) as { c: number }).c;
    const items = this.db
      .prepare(
        `SELECT * FROM problem_records ${where}
         ORDER BY CAST(COALESCE(frontend_question_id, '999999') AS INTEGER) ASC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as ProblemRow[];
    return { items, total };
  }

  /** 调度器取题：按队列优先级（interrupted 重试 → skipped 冷却期满 → 新题），具体模式在引擎里过滤。 */
  pickProblems(mode: 'random' | 'sequential' | 'tag', filter: { difficulty?: string[]; tag?: string; limit?: number }): ProblemRow[] {
    const limit = Math.min(filter.limit ?? 5, 50);
    const base = `FROM problem_records
      WHERE lifecycle = 'queued' AND ac_status = 0 AND paid_only = 0 AND retry_after IS NULL`;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter.difficulty?.length) {
      conds.push(`difficulty IN (${filter.difficulty.map(() => '?').join(',')})`);
      params.push(...filter.difficulty);
    }
    if (filter.tag) {
      conds.push(`tags LIKE ?`);
      params.push(`%"${filter.tag}"%`);
    }
    const where = `${base} ${conds.length ? 'AND ' + conds.join(' AND ') : ''}`;
    if (mode === 'random') {
      return this.db.prepare(`SELECT * ${where} ORDER BY RANDOM() LIMIT ?`).all(...params, limit) as ProblemRow[];
    }
    return this.db
      .prepare(`SELECT * ${where} ORDER BY CAST(COALESCE(frontend_question_id, '999999') AS INTEGER) ASC LIMIT ?`)
      .all(...params, limit) as ProblemRow[];
  }

  pickRetryDue(limit = 5): ProblemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM problem_records
         WHERE lifecycle = 'skipped' AND retry_after IS NOT NULL AND retry_after <= ?
         ORDER BY retry_after ASC LIMIT ?`
      )
      .all(now(), limit) as ProblemRow[];
  }

  updateProblemLifecycle(
    slug: string,
    patch: { lifecycle?: string; skip_reason?: string | null; retry_after?: number | null; ac_status?: number; attempts_count?: number }
  ): void {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now()];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(slug);
    this.db.prepare(`UPDATE problem_records SET ${sets.join(', ')} WHERE slug = ?`).run(...params);
  }

  counts(): { total: number; accepted: number; skipped: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ac_status = 1 THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN lifecycle = 'skipped' THEN 1 ELSE 0 END) AS skipped
         FROM problem_records`
      )
      .get() as { total: number; accepted: number | null; skipped: number | null };
    return { total: row.total, accepted: row.accepted ?? 0, skipped: row.skipped ?? 0 };
  }

  /* ---------- test_cases_store ---------- */

  addTestCase(problemId: string, input: string, expected: string | null, source: string, predicted: boolean, truncated: boolean): void {
    const dup = this.db
      .prepare('SELECT id FROM test_cases_store WHERE problem_id = ? AND input = ?')
      .get(problemId, input);
    if (dup) {
      // 只允许把"预测期望"升级为"权威期望"，不允许互相覆盖
      if (expected !== null && !predicted) {
        this.db
          .prepare('UPDATE test_cases_store SET expected = ?, expected_predicted = 0, source = ? WHERE problem_id = ? AND input = ?')
          .run(expected, source, problemId, input);
      }
      return;
    }
    this.db
      .prepare(
        'INSERT INTO test_cases_store (problem_id, input, expected, expected_predicted, source, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(problemId, input, expected, predicted ? 1 : 0, source, truncated ? 1 : 0, now());
  }

  getTestCases(problemId: string): TestCaseRow[] {
    return this.db
      .prepare('SELECT * FROM test_cases_store WHERE problem_id = ? ORDER BY id ASC')
      .all(problemId) as TestCaseRow[];
  }

  /* ---------- attempts ---------- */

  addAttempt(a: {
    problem_id: string;
    round: number;
    kind: 'local' | 'submit';
    lang?: string;
    code_snapshot: string;
    verdict?: string | null;
    error_digest?: string | null;
    detail?: unknown;
    token_in?: number;
    token_out?: number;
  }): number {
    const info = this.db
      .prepare(
        'INSERT INTO attempts (problem_id, round, kind, lang, code_snapshot, verdict, error_digest, detail, token_in, token_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        a.problem_id,
        a.round,
        a.kind,
        a.lang ?? 'javascript',
        a.code_snapshot,
        a.verdict ?? null,
        a.error_digest ?? null,
        a.detail ? JSON.stringify(a.detail) : null,
        a.token_in ?? 0,
        a.token_out ?? 0,
        now()
      );
    this.db
      .prepare('UPDATE problem_records SET attempts_count = attempts_count + 1, updated_at = ? WHERE slug = ?')
      .run(now(), a.problem_id);
    return Number(info.lastInsertRowid);
  }

  listAttempts(problemId: string, limit = 50): AttemptRow[] {
    return this.db
      .prepare('SELECT * FROM attempts WHERE problem_id = ? ORDER BY attempt_id DESC LIMIT ?')
      .all(problemId, limit) as AttemptRow[];
  }

  submitCountToday(): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM attempts WHERE kind = 'submit' AND created_at >= ?")
      .get(start.getTime()) as { c: number };
    return row.c;
  }

  /* ---------- solutions ---------- */

  saveSolution(s: {
    problem_id: string;
    markdown: string;
    codes?: string | null;
    runtime_ms?: number | null;
    runtime_percentile?: number | null;
    memory_percentile?: number | null;
    git_commit?: string | null;
  }): number {
    this.db
      .prepare(
        `INSERT INTO solutions (problem_id, markdown, codes, runtime_ms, runtime_percentile, memory_percentile, git_commit, push_status, created_at)
         VALUES (@problem_id, @markdown, @codes, @runtime_ms, @runtime_percentile, @memory_percentile, @git_commit, 'local', @ts)
         ON CONFLICT(problem_id) DO UPDATE SET markdown = excluded.markdown, codes = excluded.codes, runtime_ms = excluded.runtime_ms,
           runtime_percentile = excluded.runtime_percentile, memory_percentile = excluded.memory_percentile, git_commit = excluded.git_commit`
      )
      .run({ ...s, codes: s.codes ?? null, runtime_ms: s.runtime_ms ?? null, runtime_percentile: s.runtime_percentile ?? null, memory_percentile: s.memory_percentile ?? null, git_commit: s.git_commit ?? null, ts: now() });
    return 0;
  }

  getSolution(problemId: string): { id: number; markdown: string; codes: string | null; runtime_ms: number | null; runtime_percentile: number | null; memory_percentile: number | null; git_commit: string | null } | undefined {
    return this.db.prepare('SELECT id, markdown, codes, runtime_ms, runtime_percentile, memory_percentile, git_commit FROM solutions WHERE problem_id = ?').get(problemId) as never;
  }

  listSolutions(limit = 100): Array<{ id: number; problem_id: string; slug: string; title: string | null; difficulty: string | null; created_at: number }> {
    return this.db
      .prepare(
        `SELECT s.id, s.problem_id, p.slug, COALESCE(p.title_cn, p.title) AS title, p.difficulty, s.created_at
         FROM solutions s JOIN problem_records p ON p.problem_id = s.problem_id
         ORDER BY s.created_at DESC LIMIT ?`
      )
      .all(limit) as never;
  }

  close(): void {
    this.db.close();
  }
}

let repo: Repository | null = null;

export function initRepo(dbFile?: string): Repository {
  repo = new Repository(dbFile);
  return repo;
}

export function getRepo(): Repository {
  if (!repo) throw new Error('Repository 未初始化');
  return repo;
}
