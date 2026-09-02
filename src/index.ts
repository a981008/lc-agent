import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadEnv, env, ensureDirs, decryptSecret, LIMITS_DEFAULTS, type LimitsConfig } from './config.js';
import { initRepo, getRepo } from './db/repository.js';
import { initEvents, log, eventsSince } from './events.js';
import { LeetCodeClient, LcChallengeError } from './leetcode/client.js';
import { BudgetManager } from './budget.js';
import { AiClient } from './ai/client.js';
import { SandboxRunner, ensureSandboxImage } from './sandbox/runner.js';
import { StateMachine } from './state/machine.js';
import { Worker } from './engine/worker.js';
import { buildApp, type Ctx } from './server/http.js';
import { attachWs } from './server/ws.js';
import { resolveAdminToken } from './server/auth.js';

/**
 * 引导程序：装配三层（docs/02）——Control Server（状态机/调度/REST/WS）+ Worker Engine 同进程，
 * Repository 为唯一写入点；对外请求收敛于 LeetCodeClient 的限速队列。
 */

loadEnv();
ensureDirs();
const repo = initRepo();
initEvents(
  (seq) => repo.setMeta('events:lastSeq', seq),
  repo.getMeta<number>('events:lastSeq', 0)
);

/* ---------- limits：默认值 + runtime_state 覆盖 ---------- */

const loadLimits = (): LimitsConfig => ({
  ...LIMITS_DEFAULTS,
  dryRun: process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true',
  ...repo.getMeta<Partial<LimitsConfig>>('config:limits', {}),
});
const setLimits = (patch: Partial<LimitsConfig>): void => {
  const merged = { ...loadLimits(), ...patch };
  repo.setMeta('config:limits', merged);
};

/* ---------- 组件装配 ---------- */

const machine = new StateMachine(
  (k, f) => repo.getMeta(k, f),
  (k, v) => repo.setMeta(k, v),
  () => loadLimits().cooldown
);
machine.restoreAfterBoot();

const lc = new LeetCodeClient(
  () => repo.getCredentials(),
  { getMinIntervalMs: () => loadLimits().minRequestIntervalMs }
);

const budget = new BudgetManager(
  (k, f) => repo.getMeta(k, f),
  (k, v) => repo.setMeta(k, v),
  () => loadLimits().llmDailyTokenLimit
);

const ai = new AiClient(() => {
  const cfg = repo.getMeta<{ baseUrl?: string; model?: string; apiKeyEnc?: string; protocol?: 'openai' | 'anthropic' } | null>('config:llm', null);
  if (!cfg?.baseUrl || !cfg?.model || !cfg?.apiKeyEnc) return null;
  try {
    return { baseUrl: cfg.baseUrl, model: cfg.model, apiKey: decryptSecret(cfg.apiKeyEnc), protocol: cfg.protocol };
  } catch {
    return null;
  }
}, budget);

const sandbox = new SandboxRunner();
const worker = new Worker(repo, lc, ai, sandbox, machine, budget, loadLimits);

/* ---------- 题库同步（公开接口，首次启动与每日增量） ---------- */

let syncing = false;
let lastSyncDay = '';
async function syncProblems(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    log('开始同步题库（仅元数据，免费题）…');
    let n = 0;
    await lc.listAllProblems((synced, total) => {
      n = synced;
      if (synced % 500 === 0) log(`题库同步进度 ${synced}/${total}`);
    });
    log(`题库同步完成：共 ${n} 题（本进程内去重后落库）`);
    lastSyncDay = new Date().toISOString().slice(0, 10);
  } finally {
    syncing = false;
  }
}
// listAllProblems 直接返回数据，需要在此处统一落库
const origListAll = lc.listAllProblems.bind(lc);
lc.listAllProblems = async (onPage) => {
  const rows = await origListAll(onPage);
  repo.upsertProblems(
    rows.map((r) => ({
      problem_id: r.frontendQuestionId,
      frontend_question_id: r.frontendQuestionId,
      slug: r.slug,
      title: r.title,
      title_cn: r.titleCn,
      difficulty: r.difficulty,
      tags: JSON.stringify(r.tags),
      paid_only: r.paidOnly ? 1 : 0,
    }))
  );
  return rows;
};

/* ---------- 探针（docs/04 §1：30min ± 5min 抖动） ---------- */

async function runProbe(): Promise<void> {
  if (!repo.hasCredentials()) return;
  try {
    const status = await lc.probe();
    repo.setProbe(status);
    if (status === 'Authenticated') {
      if (machine.state === 'BLOCKED' && !machine.isLocked()) {
        log('探针恢复 Authenticated；等待人工在面板确认解除 BLOCKED', 'warn');
      }
      return;
    }
    // Session Expired / Challenged → 熔断
    if (machine.state !== 'BLOCKED') {
      const r = machine.circuitBreak(`探针结果：${status}`, { captcha: status === 'Challenged' });
      log(`熔断级别 ${r.level}${r.lockUntil ? `，锁定至 ${new Date(r.lockUntil).toISOString()}` : ''}`, 'error');
    }
  } catch (e) {
    if (e instanceof LcChallengeError || /403|CAPTCHA/.test((e as Error).message)) {
      if (machine.state !== 'BLOCKED') machine.circuitBreak(`探针异常：${(e as Error).message}`, { captcha: true });
    } else {
      log(`探针失败（网络/其他，不熔断）：${(e as Error).message}`, 'warn');
    }
  }
}

function scheduleProbe(): void {
  const jitter = (25 + Math.random() * 10) * 60_000; // 25~35 min
  setTimeout(async () => {
    await runProbe();
    scheduleProbe();
  }, jitter).unref();
}

/* ---------- HTTP + WS ---------- */

const ctx: Ctx = {
  repo,
  worker,
  machine,
  lc,
  ai,
  budget,
  limits: loadLimits,
  setLimits,
  syncProblems,
};
const app = buildApp(ctx);
// 前端：标准 Vue 项目（web/），服务其构建产物 web/dist（构建方式见 README）
const webDist = path.resolve('web/dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
} else {
  app.get('/', (_req, res) => {
    res.status(503).send('前端未构建：请执行 npm run web:build（或开发模式 npm run web:dev）');
  });
}
const server = http.createServer(app);
attachWs(server, repo);

server.listen(env.port, env.bind, () => {
  const token = resolveAdminToken(
    (k, f) => repo.getMeta(k, f),
    (k, v) => repo.setMeta(k, v)
  );
  try {
    fs.writeFileSync(path.join(env.dataDir, 'dashboard-token.txt'), token, { mode: 0o600 });
  } catch {
    /* ignore */
  }
  log(`lc-agent 已启动：http://${env.bind}:${env.port}（面板 /，API /api/*，WS /ws?token=）`);
  log(`Dashboard Token: ${token}`);

  // 崩溃恢复后若曾有凭据，立即探针确认
  void (async () => {
    if (repo.hasCredentials()) {
      await runProbe();
      if (machine.state === 'IDLE' && process.env.AUTOSTART === '1') {
        machine.resume();
        void worker.kickLoop();
      }
    }
    // 题库为空或跨天 → 后台同步
    const { total } = repo.counts();
    if (total === 0 || lastSyncDay !== new Date().toISOString().slice(0, 10)) {
      void syncProblems().catch((e) => log(`题库同步失败：${(e as Error).message}`, 'error'));
    }
    void ensureSandboxImage();
    scheduleProbe();
  })();
});

/* ---------- 优雅停机（docs/02 §3） ---------- */

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`收到 ${signal}，开始优雅停机（软暂停语义：等待当前题结束，最长 120s）…`);
  machine.requestHalt('sigterm');
  const deadline = Date.now() + 120_000;
  while (machine.state === 'IN_PROGRESS' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.close(() => log('HTTP 服务已关闭'));
  try {
    eventsSince(0); // 触发一次 seq 持久化
  } catch {
    /* ignore */
  }
  repo.close();
  log('已退出');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (e) => log(`未处理的 Promise 异常：${(e as Error)?.message ?? e}`, 'error'));
process.on('uncaughtException', (e) => {
  log(`未捕获异常：${e.message}\n${e.stack?.slice(0, 1000)}`, 'error');
});
