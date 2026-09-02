import crypto from 'node:crypto';
import express from 'express';
import type { Repository } from '../db/repository.js';
import type { Worker, StrategyConfig } from '../engine/worker.js';
import type { StateMachine } from '../state/machine.js';
import type { LeetCodeClient } from '../leetcode/client.js';
import type { AiClient } from '../ai/client.js';
import type { BudgetManager } from '../budget.js';
import { LIMITS_DEFAULTS, maskSecret, decryptSecret, encryptSecret, type LimitsConfig } from '../config.js';
import { eventsSince, log } from '../events.js';
import { requireBearer, resolveAdminToken } from './auth.js';

/**
 * REST API（docs/10 §1 契约 + 凭据/配置端点扩展）。
 * 全部 /api/* 经 Bearer 鉴权；静态面板托管于 /。
 */

export interface Ctx {
  repo: Repository;
  worker: Worker;
  machine: StateMachine;
  lc: LeetCodeClient;
  ai: AiClient;
  budget: BudgetManager;
  limits: () => LimitsConfig;
  setLimits: (patch: Partial<LimitsConfig>) => void;
  syncProblems: () => Promise<void>;
}

export function buildApp(ctx: Ctx): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const token = resolveAdminToken(
    (k, f) => ctx.repo.getMeta(k, f),
    (k, v) => ctx.repo.setMeta(k, v)
  );
  const auth = requireBearer(token);

  app.use('/api', auth);

  /* ---------- 状态 ---------- */

  app.get('/api/status', (_req, res) => {
    const acct = ctx.repo.getAccount();
    const probe = acct.lastProbeStatus
      ? { status: acct.lastProbeStatus, at: acct.lastProbeAt, configured: Boolean(acct.cookieEnc && acct.csrfEnc) }
      : { status: null, at: null, configured: Boolean(acct.cookieEnc && acct.csrfEnc) };
    const llm = ctx.repo.getMeta<{ baseUrlEnc?: string; apiKeyEnc?: string; baseUrl?: string; model?: string; protocol?: string } | null>('config:llm', null);
    const counts = ctx.repo.counts();
    res.json({
      state: ctx.machine.state,
      blockedReason: ctx.machine.blockedReason,
      currentSlug: ctx.machine.currentSlug,
      lastStateChangeReason: ctx.machine.snapshot().lastStateChangeReason,
      cooldownRemainingMs: ctx.machine.cooldownRemainingMs(),
      locked: ctx.machine.isLocked(),
      cookie: probe,
      llm: {
        configured: Boolean(llm?.baseUrl && llm?.model && llm?.apiKeyEnc),
        baseUrl: llm?.baseUrl ?? null,
        model: llm?.model ?? null,
        apiKeyMasked: llm?.apiKeyEnc ? maskSecret(safeDecrypt(llm.apiKeyEnc)) : null,
      },
      counts,
      submitToday: ctx.repo.submitCountToday(),
      budget: ctx.budget.snapshot(),
      strategy: ctx.worker.getStrategy(),
      limits: ctx.limits(),
    });
  });

  /* ---------- 凭据与配置 ---------- */

  app.post('/api/auth/cookie', async (req, res) => {
    let { session, csrftoken, cookieHeader } = req.body as { session?: string; csrftoken?: string; cookieHeader?: string };
    // 支持直接粘贴整个 Cookie 请求头，服务端解析
    if ((!session || !csrftoken) && cookieHeader) {
      const pick = (name: string): string => {
        const m = cookieHeader!.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        return m?.[1]?.trim() ?? '';
      };
      session = session || pick('LEETCODE_SESSION');
      csrftoken = csrftoken || pick('csrftoken');
    }
    if (!session || !csrftoken) return res.status(400).json({ error: '需要 session（LEETCODE_SESSION）与 csrftoken，或包含两者的 cookieHeader' });
    ctx.repo.setCredentials(session.trim(), csrftoken.trim());
    // 立即探针给出反馈；成功即视为人工确认（解除 BLOCKED 的唯一途径）
    try {
      const status = await ctx.lc.probe();
      ctx.repo.setProbe(status);
      if (status === 'Authenticated') {
        if (ctx.machine.state === 'BLOCKED') ctx.machine.unblock();
        return res.json({ ok: true, probe: status, unblocked: true });
      }
      return res.json({ ok: false, probe: status, hint: 'Cookie 已保存但探针未通过' });
    } catch (e) {
      return res.json({ ok: false, probe: 'error', hint: (e as Error).message });
    }
  });

  app.post('/api/auth/probe', async (_req, res) => {
    try {
      const status = await ctx.lc.probe();
      ctx.repo.setProbe(status);
      res.json({ ok: status === 'Authenticated', probe: status });
    } catch (e) {
      res.json({ ok: false, probe: 'error', hint: (e as Error).message });
    }
  });

  app.get('/api/config/llm', (_req, res) => {
    const llm = ctx.repo.getMeta<{ baseUrlEnc?: string; apiKeyEnc?: string; baseUrl?: string; model?: string; protocol?: string } | null>('config:llm', null);
    res.json({
      configured: Boolean(llm?.baseUrl && llm?.model && llm?.apiKeyEnc),
      baseUrl: llm?.baseUrl ?? '',
      model: llm?.model ?? '',
      protocol: llm?.protocol ?? 'openai',
      apiKeyMasked: llm?.apiKeyEnc ? maskSecret(safeDecrypt(llm.apiKeyEnc)) : '',
    });
  });

  app.post('/api/config/llm', (req, res) => {
    const { baseUrl, apiKey, model, protocol } = req.body as { baseUrl?: string; apiKey?: string; model?: string; protocol?: string };
    if (!baseUrl || !model) return res.status(400).json({ error: '需要 baseUrl 与 model' });
    const prev = ctx.repo.getMeta<{ apiKeyEnc?: string } | null>('config:llm', null);
    const apiKeyEnc = apiKey?.trim() ? encryptSecret(apiKey.trim()) : prev?.apiKeyEnc;
    if (!apiKeyEnc) return res.status(400).json({ error: '首次配置必须提供 apiKey' });
    ctx.repo.setMeta('config:llm', {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKeyEnc,
      protocol: protocol === 'anthropic' ? 'anthropic' : 'openai',
    });
    log('LLM 配置已更新');
    res.json({ ok: true });
  });

  app.post('/api/config/limits', (req, res) => {
    ctx.setLimits(req.body as Partial<LimitsConfig>);
    res.json({ ok: true, limits: ctx.limits() });
  });

  /* ---------- 控制 ---------- */

  app.post('/api/control/pause', (_req, res) => {
    const r = ctx.machine.requestPause('api');
    res.json({ ok: r !== 'noop', result: r });
  });

  app.post('/api/control/resume', async (_req, res) => {
    if (ctx.machine.state === 'BLOCKED') return res.status(409).json({ error: 'BLOCKED 状态需先更新凭据并确认' });
    const ok = ctx.machine.resume();
    if (ok) void ctx.worker.kickLoop();
    res.json({ ok, state: ctx.machine.state });
  });

  app.post('/api/control/halt', (_req, res) => {
    const r = ctx.machine.requestHalt('api');
    res.json({ ok: r !== 'noop', result: r, state: ctx.machine.state });
  });

  app.post('/api/control/trigger-once', async (req, res) => {
    const { slug } = (req.body ?? {}) as { slug?: string };
    const r = await ctx.worker.triggerOnce(slug);
    if (!r.started) return res.status(409).json({ error: r.reason });
    res.json({ ok: true });
  });

  app.post('/api/control/strategy', (req, res) => {
    const s = req.body as Partial<StrategyConfig>;
    if (s.mode && !['sequential', 'random', 'tag'].includes(s.mode)) {
      return res.status(400).json({ error: 'mode 必须是 sequential | random | tag' });
    }
    res.json({ ok: true, strategy: ctx.worker.setStrategy(s) });
  });

  /* ---------- 数据 ---------- */

  app.get('/api/problems', (req, res) => {
    const lifecycle = (req.query.lifecycle as string) || undefined;
    const page = Number(req.query.page ?? 1) || 1;
    // lifecycle=accepted 是别名：按 ac_status=1 全库过滤（避免只在当前页内过滤）
    const isAcceptedQuery = lifecycle === 'accepted';
    const { items, total } = ctx.repo.listProblems({
      lifecycle: isAcceptedQuery ? undefined : lifecycle,
      ac_status: isAcceptedQuery ? 1 : undefined,
      page,
    });
    res.json({ items, total, page });
  });

  app.get('/api/problems/:slug/attempts', (req, res) => {
    const p = ctx.repo.getProblemBySlug(req.params.slug);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ items: ctx.repo.listAttempts(p.problem_id) });
  });

  app.get('/api/solutions', (_req, res) => {
    res.json({ items: ctx.repo.listSolutions() });
  });

  app.get('/api/solutions/:problemId', (req, res) => {
    const s = ctx.repo.getSolution(req.params.problemId);
    if (!s) return res.status(404).json({ error: 'not found' });
    // codes: JSON 字符串（langLabel → code），前端 markdown 渲染器将其转为多语言页签
    res.json({ ...s, codesParsed: s.codes ? (JSON.parse(s.codes) as Record<string, string>) : null });
  });

  app.get('/api/logs', (req, res) => {
    const since = Number(req.query.since_seq ?? 0) || 0;
    res.json(eventsSince(since));
  });

  /* ---------- 运维 ---------- */

  app.post('/api/admin/sync-problems', async (_req, res) => {
    res.json({ ok: true, hint: '同步已在后台执行' });
    void ctx.syncProblems().catch((e) => log(`题库同步失败：${(e as Error).message}`, 'error'));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // 统一错误处理
  app.use('/api', (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log(`API 错误：${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  });

  return app;
}

function safeDecrypt(enc: string): string {
  try {
    return decryptSecret(enc);
  } catch {
    return '';
  }
}

export function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export { LIMITS_DEFAULTS };
