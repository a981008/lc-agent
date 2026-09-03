import { emit, log } from '../events.js';
import type { Repository, ProblemRow } from '../db/repository.js';
import type { LeetCodeClient, LcVerdict } from '../leetcode/client.js';
import { htmlToText } from '../leetcode/client.js';
import type { AiClient, ProblemCtx } from '../ai/client.js';
import { AiNotConfiguredError, logAiError } from '../ai/client.js';
import type { BudgetManager } from '../budget.js';
import { BudgetExceededError } from '../budget.js';
import { SandboxRunner } from '../sandbox/runner.js';
import { prepareRun, type DriverCase, type ParsedMeta } from '../sandbox/driver.js';
import type { StateMachine } from '../state/machine.js';
import { Archiver, langLabel } from './archiver.js';
import type { LimitsConfig } from '../config.js';

/**
 * 刷题执行引擎（docs/06 闭环 + docs/03 单题生命周期）。
 * queued → fetching → generating → local_testing → submitting → accepted / skipped
 */

export interface StrategyConfig {
  mode: 'sequential' | 'random' | 'tag';
  difficulty?: string[];
  tag?: string; // LC 知识点 slug（array/hash-table/linked-list…）
}

const STRATEGY_DEFAULT: StrategyConfig = { mode: 'sequential' };

type VerdictKind = 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' | 'MLE' | 'OTHER';

function mapVerdict(statusCode: number | null, msg: string | null): VerdictKind {
  switch (statusCode) {
    case 10: return 'AC';
    case 11: return 'WA';
    case 13: return 'MLE';
    case 14: return 'TLE';
    case 15: return 'RE';
    case 20: return 'CE';
    default: return (msg as VerdictKind) || 'OTHER';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isChallengeError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  return name === 'LcChallengeError' || /CAPTCHA|HTTP 403/.test((e as Error)?.message ?? '');
}

/** dry-run 模拟判题：首次提交 WA（带失败用例），第二次 AC——用于无凭据全链路自测 */
class DrySubmitter {
  private counts = new Map<string, number>();
  async awaitVerdict(slug: string, sampleInput: string | null) {
    const n = (this.counts.get(slug) ?? 0) + 1;
    this.counts.set(slug, n);
    await sleep(200);
    if (n === 1) {
      return {
        state: 'FINISHED', statusCode: 11, statusMsg: 'Wrong Answer',
        runtimeMs: 60, memoryKb: 42000, runtimePercentile: 90, memoryPercentile: 50,
        totalCorrect: 30, totalTestcases: 58,
        failingInput: sampleInput ?? '[1,2]\n3',
        expectedOutput: '[0,1]', codeOutput: '[1,0]',
        raw: { dry: true },
      };
    }
    return {
      state: 'FINISHED', statusCode: 10, statusMsg: 'Accepted',
      runtimeMs: 64, memoryKb: 43000, runtimePercentile: 88, memoryPercentile: 55,
      totalCorrect: 58, totalTestcases: 58,
      failingInput: null, expectedOutput: null, codeOutput: null,
      raw: { dry: true },
    };
  }
}

interface LcDetail {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  translatedTitle: string | null;
  content: string | null;
  translatedContent: string | null;
  difficulty: string;
  metaData: string;
  exampleTestcases: string;
  sampleTestCase: string;
  codeSnippets: Array<{ lang: string; langSlug: string; code: string }>;
}

/** 解析翻译目标语言：'all' = 站点提供的全部语言（除主提交语言）；显式列表取交集；旧 'go' 归一化为 'golang' */
export function resolveTranslateTargets(
  translateLangs: string[],
  q: { codeSnippets?: Array<{ langSlug: string }> },
  submitLang: string
): string[] {
  const available = (q.codeSnippets ?? []).map((s) => s.langSlug).filter(Boolean);
  const wanted = translateLangs
    .map((l) => (l === 'go' ? 'golang' : l))
    .filter((l) => l && l !== submitLang);
  if (wanted.includes('all')) {
    const seen = new Set<string>([submitLang]);
    return available.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  }
  const set = new Set<string>();
  for (const l of wanted) if (available.includes(l)) set.add(l);
  return available.filter((l) => set.has(l));
}

export class Worker {
  private archiver: Archiver;
  private dry = new DrySubmitter();
  private loopGuard = false;

  constructor(
    private repo: Repository,
    private lc: LeetCodeClient,
    private ai: AiClient,
    private sandbox: SandboxRunner,
    private machine: StateMachine,
    private budget: BudgetManager,
    private limits: () => LimitsConfig
  ) {
    this.archiver = new Archiver(repo, ai);
  }

  /* ============ 策略 ============ */

  private llmConfigured(): boolean {
    // AiClient 未配置时抛 AiNotConfiguredError；这里用一次轻量探测
    return this.repo.getMeta<{ baseUrl?: string; model?: string; apiKeyEnc?: string } | null>('config:llm', null) !== null &&
      Boolean(this.repo.getMeta<{ apiKeyEnc?: string } | null>('config:llm', null)?.apiKeyEnc);
  }

  getStrategy(): StrategyConfig {
    return { ...STRATEGY_DEFAULT, ...this.repo.getMeta<Partial<StrategyConfig>>('strategy', {}) };
  }

  /** 每日提交配额是否已用尽（dailySubmitLimit=0 视为无限制） */
  private quotaReached(): boolean {
    const lim = this.limits();
    return lim.dailySubmitLimit > 0 && this.repo.submitCountToday() >= lim.dailySubmitLimit;
  }

  setStrategy(s: Partial<StrategyConfig>): StrategyConfig {
    const next = { ...this.getStrategy(), ...s } as StrategyConfig;
    delete (next as { manualSlug?: string }).manualSlug; // 旧字段清理
    this.repo.setMeta('strategy', next);
    log(`策略已更新（下一题生效）：${JSON.stringify(next)}`);
    return next;
  }

  /* ============ 对外控制 ============ */

  /** 恢复 RUNNING 循环（状态机 resume 后 / boot 后调用；单飞守卫） */
  async kickLoop(): Promise<void> {
    if (this.loopGuard) return;
    this.loopGuard = true;
    try {
      await this.schedulerLoop();
    } catch (e) {
      log(`调度循环异常退出：${(e as Error).message}`, 'error');
    } finally {
      this.loopGuard = false;
    }
  }

  /** Trigger Once：仅 IDLE / PAUSED；执行单题后归位（docs/03 §3） */
  async triggerOnce(manualSlug?: string): Promise<{ started: boolean; reason?: string }> {
    const st = this.machine.state;
    if (st !== 'IDLE' && st !== 'PAUSED') {
      return { started: false, reason: `当前状态 ${st} 不允许 Trigger Once（仅 IDLE/PAUSED）` };
    }
    const returnTo: 'IDLE' | 'PAUSED' = st === 'PAUSED' ? 'PAUSED' : 'IDLE';
    const base = this.getStrategy();
    // 跑单题：指定 slug 直跑；未指定 → 随机一题（仍受难度/知识点过滤约束）
    const strategy: StrategyConfig = manualSlug
      ? { ...base, mode: 'random', tag: undefined }
      : { ...base, mode: 'random' };
    const pick = manualSlug
      ? this.repo.getProblemBySlug(manualSlug) ??
        (await this.fetchAndStoreProblem(manualSlug))
      : await this.pickProblem(strategy, true);
    if (pick && (pick.paid_only || pick.ac_status)) {
      return { started: false, reason: `${pick.slug} 已解答或为付费题，不可跑` };
    }
    if (!pick) return { started: false, reason: '没有可运行的题目（题库未同步或策略过滤过严）' };
    if (this.quotaReached()) {
      return { started: false, reason: '已达每日提交配额' };
    }
    this.machine.toInProgressManual(pick.slug);
    void this.runOne(pick, returnTo).catch((e) => log(`trigger-once 异常：${(e as Error).message}`, 'error'));
    return { started: true };
  }

  /* ============ 调度循环 ============ */

  private async schedulerLoop(): Promise<void> {
    while (true) {
      const st = this.machine.state;
      if (st !== 'RUNNING' && st !== 'COOLING') return;
      const lim = this.limits();

      // 运行时间窗（docs/04 §4）
      if (lim.runWindow.enabled && this.outsideWindow(lim.runWindow.start, lim.runWindow.end)) {
        this.machine.requestPause('run_window');
        return;
      }

      // 冷却锚定（docs/04 §3）
      const remain = this.machine.cooldownRemainingMs();
      if (remain > 0) {
        this.machine.toCooling('cooldown_anchored');
        log(`冷却中，剩余 ${Math.ceil(remain / 1000)}s`);
        await sleep(Math.min(remain, 30_000));
        continue;
      }
      this.machine.toRunning('cooldown_done');

      // 每日提交配额（docs/01 §3）
      if (this.quotaReached()) {
        log('已达每日提交配额，转 PAUSED 等待人工', 'warn');
        this.machine.requestPause('daily_quota');
        return;
      }

      // 取题
      let pick: ProblemRow | null = null;
      try {
        pick = await this.pickProblem(this.getStrategy(), false);
      } catch (e) {
        if (isChallengeError(e)) {
          this.onChallenge(`取题阶段：${(e as Error).message}`);
          return;
        }
        log(`取题异常：${(e as Error).message}`, 'error');
        await sleep(30_000);
        continue;
      }
      if (!pick) {
        log('队列为空（无可用题目），转 PAUSED', 'warn');
        this.machine.requestPause('queue_empty');
        return;
      }

      this.machine.toInProgress(pick.slug, 'start_problem');
      try {
        await this.runPipeline(pick);
      } catch (e) {
        if (isChallengeError(e)) {
          this.onChallenge(`执行阶段：${(e as Error).message}`);
          return;
        }
        log(`单题流程异常（${pick.slug}）：${(e as Error).message}`, 'error');
      }
      const after = this.machine.notifyProblemFinished('accepted');
      if (after === 'PAUSED' || after === 'IDLE') return;
    }
  }

  private onChallenge(message: string): void {
    log(`触发风控信号，执行熔断：${message}`, 'error');
    const r = this.machine.circuitBreak(message.slice(0, 200), { captcha: true });
    if (r.level === 'L4') log('单日 CAPTCHA ≥ 2 次：L4 停机，锁定 24 小时', 'error');
    else log('L3 熔断：已停止一切对 LC 请求，等待人工更新凭据', 'error');
  }

  private outsideWindow(start: string, end: string): boolean {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const toMin = (s: string) => {
      const [h, m] = s.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const s = toMin(start);
    const e = toMin(end) === 0 ? 24 * 60 : toMin(end);
    return s <= e ? nowMin < s || nowMin >= e : nowMin < s && nowMin >= e;
  }

  /** 按 slug 在线拉取题目元数据并入库（题目列表点选「跑这题」时题目可能尚未同步） */
  private async fetchAndStoreProblem(slug: string): Promise<ProblemRow | null> {
    const q = await this.lc.getQuestion(slug);
    this.repo.upsertProblems([
      {
        problem_id: q.questionFrontendId,
        frontend_question_id: q.questionFrontendId,
        slug: q.titleSlug,
        title: q.title,
        title_cn: q.translatedTitle,
        difficulty: q.difficulty,
        tags: JSON.stringify((q.topicTags ?? []).flatMap((t) => (t?.slug ? [t.slug] : []))),
        paid_only: q.paidOnly ? 1 : 0,
      },
    ]);
    return this.repo.getProblemBySlug(slug) ?? null;
  }

  private async pickProblem(strategy: StrategyConfig, forTrigger: boolean): Promise<ProblemRow | null> {
    // 优先级 1：interrupted（崩溃恢复，docs/02 §3）
    const interrupted = this.repo.getMeta<{ slug: string } | null>('current', null);
    if (interrupted?.slug) {
      this.repo.setMeta('current', null);
      const row = this.repo.getProblemBySlug(interrupted.slug);
      if (row && row.lifecycle === 'queued' && !row.ac_status) {
        log(`恢复中断题：${interrupted.slug}`);
        return row;
      }
    }
    // 优先级 2：skipped 冷却期满的回炉题
    if (!forTrigger) {
      const due = this.repo.pickRetryDue(1);
      const dueRow = due[0];
      if (dueRow) {
        this.repo.updateProblemLifecycle(dueRow.slug, { lifecycle: 'queued', retry_after: null, skip_reason: null });
        log(`回炉重试题：${dueRow.slug}`);
        return dueRow;
      }
    }
    // 优先级 3：按模式取题
    const rows = this.repo.pickProblems(strategy.mode === 'tag' ? 'tag' : strategy.mode, {
      difficulty: strategy.difficulty,
      tag: strategy.tag,
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /* ============ 单题管线 ============ */

  private emitStep(slug: string, stage: 'fetch' | 'generate' | 'local_test' | 'submit' | 'translate' | 'archive', status: 'start' | 'done' | 'fail' | 'delta', detail?: string | null): void {
    emit('pipeline_step', { problem_id: slug, slug, stage, status, detail: detail ?? null });
  }

  private async runOne(problem: ProblemRow, returnTo: 'IDLE' | 'PAUSED'): Promise<void> {
    try {
      await this.runPipeline(problem);
    } catch (e) {
      log(`trigger-once 管线异常：${(e as Error).message}`, 'error');
    }
    this.machine.notifyTriggerDone(returnTo);
    await this.kickLoop();
  }

  private async runPipeline(problem: ProblemRow): Promise<void> {
    const slug = problem.slug;
    const lim = this.limits();
    let submitsUsed = 0;
    let debugRounds = 0;
    let llmCalls = 0;
    const summaryParts: string[] = [];

    /* ---- fetch ---- */
    this.emitStep(slug, 'fetch', 'start');
    let q: LcDetail;
    try {
      q = (await this.lc.getQuestion(slug)) as LcDetail;
    } catch (e) {
      this.emitStep(slug, 'fetch', 'fail', (e as Error).message);
      throw e;
    }
    const statement = htmlToText(q.translatedContent || q.content);
    const jsTemplate = q.codeSnippets?.find((s) => s.langSlug === 'javascript')?.code ?? '';
    const ctx: ProblemCtx = {
      frontendId: q.questionFrontendId,
      title: q.translatedTitle || q.title,
      difficulty: q.difficulty,
      statement,
      jsTemplate,
      sampleInputs: [],
    };
    this.emitStep(slug, 'fetch', 'done', `${q.questionFrontendId}. ${ctx.title}（${q.difficulty}）`);

    // 结构支持性预检（docs/06 §3：不可识别类型 → unsupported）
    let parsed: ParsedMeta;
    try {
      const pre = prepareRun(q.metaData, jsTemplate, '/* placeholder */', []);
      if (pre.unsupportedReason) {
        log(`题目 ${slug} 结构不支持：${pre.unsupportedReason}`, 'warn');
        this.repo.updateProblemLifecycle(slug, { lifecycle: 'unsupported', skip_reason: pre.unsupportedReason });
        return;
      }
      parsed = pre.parsed!;
    } catch (e) {
      this.repo.updateProblemLifecycle(slug, { lifecycle: 'unsupported', skip_reason: (e as Error).message.slice(0, 200) });
      return;
    }

    // 样例入库（source=sample，期望待 AI 预测回填）
    const paramCount = parsed.params.length;
    const sampleBlocks = this.parseSampleBlocks(q.exampleTestcases, q.sampleTestCase, paramCount);
    const sampleCases: DriverCase[] = [];
    for (const block of sampleBlocks) {
      const lines = block.split('\n');
      if (lines.length !== paramCount) {
        log(`样例行数 ${lines.length} ≠ 参数数 ${paramCount}（${slug}），跳过该样例`, 'warn');
        continue;
      }
      sampleCases.push({ input: lines, expected: null });
      this.repo.addTestCase(q.questionFrontendId, block, null, 'sample', false, false);
    }
    ctx.sampleInputs = sampleCases.map((c) => c.input);

    /* ---- generate ---- */
    this.emitStep(slug, 'generate', 'start');
    let code: string | null = null;
    // dry-run 且 LLM 未配置：使用内置占位解法（two-sum 正确解 + 预测输出），用于无凭据全链路自测
    if (lim.dryRun && !this.llmConfigured()) {
      code = 'var twoSum = function(nums, target) { const m=new Map(); for(let i=0;i<nums.length;i++){ const c=target-nums[i]; if(m.has(c)) return [m.get(c), i]; m.set(nums[i], i);} return []; };';
      const preds = ['[0,1]', '[1,2]', '[0,1]'];
      sampleCases.forEach((c, i) => {
        this.repo.addTestCase(q.questionFrontendId, c.input.join('\n'), preds[i] ?? '[0,1]', 'sample', true, false);
      });
      log('dry-run：使用内置占位解法（未配置 LLM）');
    }
    try {
      if (!code) {
        // AI 解题过程实时外显：流式增量 → pipeline_step(delta) → 前端「AI 解题过程」面板
        let deltaBuf = '';
        let lastFlush = 0;
        const flushDelta = (force = false) => {
          if (!deltaBuf) return;
          const now = Date.now();
          if (!force && now - lastFlush < 400) return;
          this.emitStep(slug, 'generate', 'delta', deltaBuf);
          deltaBuf = '';
          lastFlush = now;
        };
        const onDelta = (d: string) => {
          deltaBuf += d;
          if (deltaBuf.length >= 800) flushDelta(true);
          else flushDelta();
        };
        const gen = await this.ai.generateSolution(ctx, onDelta);
        flushDelta(true);
        llmCalls++;
        code = gen.code;
        gen.predicted.forEach((pred, i) => {
          if (pred != null && sampleCases[i]) {
            this.repo.addTestCase(q.questionFrontendId, sampleCases[i].input.join('\n'), String(pred), 'sample', true, false);
          }
        });
        this.repo.addAttempt({
          problem_id: q.questionFrontendId,
          round: 0,
          kind: 'local',
          code_snapshot: code,
          verdict: 'generated',
          token_in: (gen.usage as { prompt_tokens?: number } | null)?.prompt_tokens ?? 0,
          token_out: (gen.usage as { completion_tokens?: number } | null)?.completion_tokens ?? 0,
        });
      } else {
        this.repo.addAttempt({ problem_id: q.questionFrontendId, round: 0, kind: 'local', code_snapshot: code, verdict: 'generated_dry' });
      }
    } catch (e) {
      if (e instanceof AiNotConfiguredError || e instanceof BudgetExceededError) throw e;
      logAiError('generate', e);
    }
    if (!code) {
      this.emitStep(slug, 'generate', 'fail', 'AI 未产出代码');
      this.repo.updateProblemLifecycle(slug, {
        lifecycle: 'skipped',
        skip_reason: 'generate_failed',
        retry_after: Date.now() + lim.skipRetryDays * 86_400_000,
      });
      return;
    }
    this.emitStep(slug, 'generate', 'done', `${code.length} 字符`);

    /* ---- local_test + self-debug 闭环 ---- */
    const rounds = () => ({ debugRounds, llmCalls });
    const setRounds = (r: number, l: number) => {
      debugRounds = r;
      llmCalls = l;
    };
    const local = await this.localTestLoop(q.questionFrontendId, slug, ctx, q.metaData, jsTemplate, code, lim, rounds, setRounds, summaryParts);
    if (!local.ok) {
      this.repo.updateProblemLifecycle(slug, {
        lifecycle: 'skipped',
        skip_reason: local.reason,
        retry_after: Date.now() + lim.skipRetryDays * 86_400_000,
      });
      log(`题目 ${slug} 本地闭环未通过（${local.reason}）→ skipped`, 'warn');
      return;
    }
    code = local.code;

    /* ---- submit + 失败分流（docs/06 §4） ---- */
    while (submitsUsed < lim.maxSubmits) {
      if (!lim.dryRun && this.quotaReached()) {
        log('达到每日提交配额，停止提交', 'warn');
        break;
      }
      this.emitStep(slug, 'submit', 'start', `第 ${submitsUsed + 1}/${lim.maxSubmits} 次`);
      let verdict;
      try {
        if (lim.dryRun) {
          verdict = await this.dry.awaitVerdict(slug, sampleCases[0]?.input.join('\n') ?? null);
        } else {
          const sid = await this.lc.submit(slug, q.questionId, code, lim.submitLang);
          verdict = await this.lc.awaitVerdict(sid);
        }
      } catch (e) {
        this.emitStep(slug, 'submit', 'fail', (e as Error).message);
        throw e;
      }
      submitsUsed++;
      const kind = mapVerdict(verdict.statusCode, verdict.statusMsg);
      this.repo.addAttempt({
        problem_id: q.questionFrontendId,
        round: submitsUsed,
        kind: 'submit',
        lang: lim.submitLang,
        code_snapshot: code,
        verdict: kind,
        error_digest: kind === 'AC' ? null : `${kind}:${verdict.statusMsg ?? ''}`.slice(0, 200),
        detail: {
          runtime: verdict.runtimeMs,
          memory: verdict.memoryKb,
          correct: verdict.totalCorrect,
          total: verdict.totalTestcases,
          failing: verdict.failingInput?.slice(0, 2000) ?? null,
        },
      });
      emit('attempt_result', {
        problem_id: q.questionFrontendId,
        slug,
        verdict: kind,
        runtime_ms: verdict.runtimeMs,
        memory_percentile: verdict.memoryPercentile,
      });
      this.machine.anchorCooldown(); // 每次真实提交都锚定冷却
      this.emitStep(slug, 'submit', kind === 'AC' ? 'done' : 'fail', `${kind} ${verdict.totalCorrect ?? '?'}/${verdict.totalTestcases ?? '?'}`);

      if (kind === 'AC') {
        this.repo.updateProblemLifecycle(slug, { lifecycle: 'accepted', ac_status: 1 });
        summaryParts.push(`提交 ${submitsUsed} 次通过`);
        // 翻译为其他语言并提交（docs/06 §5）：全部真实提交、计入每日配额；失败不阻塞归档
        const codes = await this.translateAndSubmit(q, slug, code, llmCalls, summaryParts);
        await this.archive(q, ctx, slug, code, verdict, summaryParts.join('；'), codes);
        return;
      }

      if (submitsUsed >= lim.maxSubmits) break;
      if (debugRounds >= lim.selfDebugRounds || llmCalls >= lim.llmPerProblemCalls) break;

      // WA：回填失败用例（docs/06 §4）
      if (kind === 'WA' && verdict.failingInput) {
        const truncated = verdict.failingInput.length > 4000;
        this.repo.addTestCase(q.questionFrontendId, verdict.failingInput.slice(0, 4000), verdict.expectedOutput, 'lc_failure', false, truncated);
        summaryParts.push(`WA 回填失败用例（截断=${truncated}）`);
      }
      // TLE/RE/WA → AI 修复（TLE 走复杂度反思路径，由 prompt 内 kindHint 控制）
      let newCode: string | null = null;
      if (lim.dryRun && !this.llmConfigured()) {
        // dry-run：模拟"修复"——沿用同一份代码，让第二次提交命中模拟 AC
        log('dry-run：模拟 AI 修复（沿用占位解法）');
        newCode = code;
        debugRounds++;
      }
      if (!newCode) try {
        const fix = await this.ai.debugSolution(
          ctx,
          code,
          { kind: kind === 'WA' ? 'WA' : kind === 'TLE' ? 'TLE' : 'RE', detail: this.describeFailure(kind, verdict) },
          summaryParts.join('；')
        );
        llmCalls++;
        debugRounds++;
        if (fix.unfixable || !fix.code.trim()) {
          summaryParts.push(`AI 判定无法修复：${fix.unfixable ?? ''}`);
          break;
        }
        newCode = fix.code;
      } catch (e) {
        if (e instanceof BudgetExceededError) break;
        logAiError('debug', e);
        break;
      }
      // 修复后先本地复验再提交
      const re = await this.localTestLoop(q.questionFrontendId, slug, ctx, q.metaData, jsTemplate, newCode!, lim, rounds, setRounds, summaryParts, false);
      if (!re.ok) {
        summaryParts.push(`修复后本地仍未通过（${re.reason}）`);
        break;
      }
      code = re.code;
    }

    this.repo.updateProblemLifecycle(slug, {
      lifecycle: 'skipped',
      skip_reason: `exhausted:submits=${submitsUsed},debugs=${debugRounds}`,
      retry_after: Date.now() + lim.skipRetryDays * 86_400_000,
    });
    log(`题目 ${slug} 重试预算耗尽 → skipped`, 'warn');
  }

  /** 本地沙盒测试 + self-debug 循环（allowDebug=false 时仅复验一轮） */
  private async localTestLoop(
    questionId: string,
    slug: string,
    ctx: ProblemCtx,
    metaData: string,
    jsTemplate: string,
    initialCode: string,
    lim: LimitsConfig,
    getRounds: () => { debugRounds: number; llmCalls: number },
    setRounds: (r: number, l: number) => void,
    summaryParts: string[],
    allowDebug = true
  ): Promise<{ ok: true; code: string } | { ok: false; reason: string; code: string }> {
    let code = initialCode;
    const loadCases = (): DriverCase[] =>
      this.repo.getTestCases(questionId).map((t) => ({
        input: t.input.split('\n'),
        expected: t.expected,
        truncated: t.truncated === 1,
      }));

    while (true) {
      this.emitStep(slug, 'local_test', 'start');
      const cases = loadCases();
      const run = await this.executeSandbox(metaData, jsTemplate, code, cases);
      const failed = run.result?.cases.filter((c) => !c.pass) ?? [];
      const ok = run.ok && run.result !== null && failed.length === 0 && cases.length > 0;
      this.repo.addAttempt({
        problem_id: questionId,
        round: 0,
        kind: 'local',
        code_snapshot: code,
        verdict: ok ? 'local_pass' : 'local_fail',
        error_digest: ok ? null : String(failed[0]?.error ?? 'sandbox_error').slice(0, 200),
        detail: {
          cases: cases.length,
          failed: failed.length,
          timeout: run.timeout,
          // 沙盒整体失败时带上 stderr 尾部，面板/排查可直接看到 docker 报错
          ...(run.ok ? {} : { exit: run.exitCode, stderr: String(run.stderrTail ?? '').slice(-300) }),
        },
      });
      this.emitStep(slug, 'local_test', ok ? 'done' : 'fail', `${cases.length} 用例，失败 ${failed.length}${run.timeout ? '（沙盒超时）' : ''}`);
      if (ok) return { ok: true, code };
      if (!allowDebug) return { ok: false, reason: 'local_fail', code };

      const r = getRounds();
      if (r.debugRounds >= lim.selfDebugRounds || r.llmCalls >= lim.llmPerProblemCalls) {
        return { ok: false, reason: `local_fail_exhausted(rounds=${r.debugRounds},llm=${r.llmCalls})`, code };
      }
      const failInfo = run.result
        ? failed.slice(0, 3).map((c, i) => `失败用例 ${i + 1}: error=${c.error ?? '-'}; actual=${c.actual ?? '-'}; expected=${c.expected ?? '-'}`).join('\n') || '（沙盒结果异常）'
        : `沙盒未产出结果：timeout=${run.timeout} exit=${run.exitCode}\n${run.stderrTail.slice(-1200)}`;
      try {
        const fix = await this.ai.debugSolution(ctx, code, { kind: 'local', detail: failInfo }, summaryParts.join('；'));
        setRounds(r.debugRounds + 1, r.llmCalls + 1);
        if (fix.unfixable || !fix.code.trim()) {
          return { ok: false, reason: `ai_unfixable:${fix.unfixable ?? ''}`, code };
        }
        code = fix.code;
        summaryParts.push(`self-debug 第 ${r.debugRounds + 1} 轮`);
      } catch (e) {
        if (e instanceof BudgetExceededError) return { ok: false, reason: 'llm_budget_exhausted', code };
        logAiError('local-debug', e);
        return { ok: false, reason: 'llm_error', code };
      }
    }
  }

  private async executeSandbox(metaData: string, jsTemplate: string, code: string, cases: DriverCase[]) {
    const plan = prepareRun(metaData, jsTemplate, code, cases);
    if (plan.unsupportedReason || plan.files.length === 0) {
      throw new Error(`不支持的结构：${plan.unsupportedReason ?? 'unknown'}`);
    }
    return this.sandbox.run(plan.files, { wallTimeoutMs: 15_000 });
  }

  /**
   * 样例分块：
   * - leetcode.cn 的 exampleTestcases 是原始串：所有用例按行拼接，每个用例占 paramCount 行；
   * - leetcode.com 是 JSON 字符串数组（每元素一个用例）。两种都兼容。
   */
  private parseSampleBlocks(exampleTestcases: string, sampleTestCase: string, paramCount: number): string[] {
    const raw = (exampleTestcases || sampleTestCase || '').replace(/\r/g, '');
    if (!raw) return [];
    // 尝试 JSON 字符串数组格式（国际站）
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed as string[];
      }
    } catch {
      /* 非合法 JSON → 按 cn 原始格式分块 */
    }
    const lines = raw.split('\n');
    if (paramCount <= 0) return lines.length > 0 ? [raw] : [];
    if (lines.length % paramCount !== 0) return [];
    const blocks: string[] = [];
    for (let i = 0; i < lines.length; i += paramCount) {
      blocks.push(lines.slice(i, i + paramCount).join('\n'));
    }
    return blocks;
  }

  private describeFailure(
    kind: VerdictKind,
    v: { failingInput: string | null; expectedOutput: string | null; codeOutput: string | null; totalCorrect: number | null; totalTestcases: number | null; statusMsg: string | null }
  ): string {
    if (kind === 'TLE') return `判题超时（TLE）。通过 ${v.totalCorrect ?? '?'}/${v.totalTestcases ?? '?'}。请优化复杂度。`;
    if (kind === 'WA') {
      return [
        `答案错误（WA）。通过 ${v.totalCorrect ?? '?'}/${v.totalTestcases ?? '?'}。`,
        v.failingInput ? `失败输入：\n${v.failingInput.slice(0, 1500)}` : '（未提供失败输入）',
        v.expectedOutput ? `期望输出：${v.expectedOutput.slice(0, 500)}` : '',
        v.codeOutput ? `实际输出：${v.codeOutput.slice(0, 500)}` : '',
      ].filter(Boolean).join('\n');
    }
    return `判题异常（${kind}）：${v.statusMsg ?? 'unknown'}。通过 ${v.totalCorrect ?? '?'}/${v.totalTestcases ?? '?'}。`;
  }

  /**
   * AC 后翻译为其他语言并真实提交（docs/06 §5）：
   * - 语言列表取 limits.translateLangs（不含主语言）；每语言最多 2 次提交（翻译 + AI 修复一次）；
   * - 翻译解法无本地沙盒预验（沙盒仅支持 JS），直接提交，凭判题回执说话；
   * - 单语言失败不阻塞其他语言与归档；返回 langSlug → code 的合集（含主语言）。
   */
  private async translateAndSubmit(
    q: LcDetail,
    slug: string,
    acCode: string,
    llmCalls: number,
    summaryParts: string[]
  ): Promise<Record<string, string>> {
    const lim = this.limits();
    const codes: Record<string, string> = { [lim.submitLang]: acCode };
    const langs = resolveTranslateTargets(lim.translateLangs ?? [], q, lim.submitLang);
    if (!langs.length) return codes;

    this.emitStep(slug, 'translate', 'start', langs.join(' / '));
    let calls = llmCalls;
    let acCount = 0;
    for (const lang of langs) {
      if (this.machine.haltRequested) break; // 请求终止时不再翻译
      if (calls >= lim.llmPerProblemCalls || this.quotaReached()) {
        summaryParts.push(`翻译跳过 ${langLabel(lang)}（预算/配额）`);
        break;
      }
      const tpl = q.codeSnippets?.find((s) => s.langSlug === lang);
      if (!tpl) {
        summaryParts.push(`跳过 ${langLabel(lang)}（站点无该语言模板）`);
        continue;
      }
      let passed = false;
      let lastKind = '';
      let lastDetail = '';
      let code: string | null = null;
      for (let tries = 0; tries < 2 && !passed; tries++) {
        try {
          if (tries === 0) {
            let tBuf = '';
            let tLast = 0;
            const onDelta = (d: string) => {
              tBuf += d;
              const now = Date.now();
              if (now - tLast >= 400 || tBuf.length >= 800) {
                this.emitStep(slug, 'translate', 'delta', tBuf);
                tBuf = '';
                tLast = now;
              }
            };
            const r = await this.ai.translateSolution({ ...this.describeCtx(q) }, acCode, lang, tpl.code, onDelta);
            if (tBuf) this.emitStep(slug, 'translate', 'delta', tBuf);
            calls++;
            code = r.code;
          } else {
            const fix = await this.ai.debugSolution(
              this.describeCtx(q),
              code!,
              { kind: lastKind === 'WA' ? 'WA' : lastKind === 'TLE' ? 'TLE' : 'RE', detail: lastDetail },
              summaryParts.join('；'),
              { lang, langTemplate: tpl.code }
            );
            calls++;
            if (fix.unfixable || !fix.code.trim()) break;
            code = fix.code;
          }
        } catch (e) {
          logAiError(`translate:${lang}`, e);
          break;
        }
        if (!code?.trim()) break;

        let verdict: LcVerdict;
        try {
          const sid = await this.lc.submit(slug, q.questionId, code, lang);
          verdict = await this.lc.awaitVerdict(sid);
        } catch (e) {
          log(`[${lang}] 提交/判题异常：${(e as Error).message}`, 'warn');
          this.emitStep(slug, 'translate', 'fail', `${lang} 提交异常`);
          break;
        }
        const kind = mapVerdict(verdict.statusCode, verdict.statusMsg);
        lastKind = kind;
        lastDetail = this.describeFailure(kind, verdict);
        this.repo.addAttempt({
          problem_id: q.questionFrontendId,
          round: 1,
          kind: 'submit',
          lang,
          code_snapshot: code,
          verdict: kind,
          error_digest: kind === 'AC' ? null : `${kind}:${verdict.statusMsg ?? ''}`.slice(0, 200),
          detail: {
            runtime: verdict.runtimeMs,
            memory: verdict.memoryKb,
            correct: verdict.totalCorrect,
            total: verdict.totalTestcases,
            failing: verdict.failingInput?.slice(0, 2000) ?? null,
          },
        });
        emit('attempt_result', {
          problem_id: q.questionFrontendId,
          slug,
          lang,
          verdict: kind,
          runtime_ms: verdict.runtimeMs,
          memory_percentile: verdict.memoryPercentile,
        });
        this.machine.anchorCooldown();
        this.emitStep(slug, 'translate', kind === 'AC' ? 'done' : 'fail', `${langLabel(lang)} ${kind}`);
        if (kind === 'AC') {
          passed = true;
          acCount++;
          codes[lang] = code;
          summaryParts.push(`${langLabel(lang)} 翻译后同样 AC`);
        }
      }
      if (!passed) summaryParts.push(`${langLabel(lang)}: ${lastKind || '未完成'}（未通过，不阻塞）`);
    }
    log(`多语言翻译完成：${acCount}/${langs.length} 个语言 AC`);
    this.emitStep(slug, 'translate', acCount === langs.length ? 'done' : 'fail', `${acCount}/${langs.length} AC`);
    return codes;
  }

  /** 构造给 AI 的最小题目上下文（翻译阶段不重复传整段题面，签名即可） */
  private describeCtx(q: LcDetail): ProblemCtx {
    return {
      frontendId: q.questionFrontendId,
      title: q.translatedTitle || q.title,
      difficulty: q.difficulty,
      statement: '',
      jsTemplate: '',
      sampleInputs: [],
    };
  }

  private async archive(
    q: { questionFrontendId: string },
    ctx: ProblemCtx,
    slug: string,
    code: string,
    verdict: { runtimeMs: number | null; runtimePercentile: number | null; memoryPercentile: number | null },
    summary: string,
    codes?: Record<string, string>
  ): Promise<void> {
    try {
      this.emitStep(slug, 'archive', 'start');
      await this.archiver.archive(ctx, slug, code, {
        runtimeMs: verdict.runtimeMs,
        runtimePercentile: verdict.runtimePercentile,
        memoryPercentile: verdict.memoryPercentile,
      }, summary, codes);
      this.emitStep(slug, 'archive', 'done');
    } catch (e) {
      this.emitStep(slug, 'archive', 'fail', (e as Error).message);
      log(`归档失败（不影响 AC 结果）：${(e as Error).message}`, 'warn');
    }
  }
}
