import { emit, log } from '../events.js';

/**
 * 全局单例状态机（docs/03）：
 * 六态 IDLE / RUNNING / COOLING / IN_PROGRESS / PAUSED / BLOCKED，
 * 迁移以 docs/03 §2 迁移表为权威；冷却锚定 last_submit_at（docs/04 §3）。
 * 状态每次迁移持久化到 runtime_state（崩溃恢复，docs/02 §3）。
 */

export type State = 'IDLE' | 'RUNNING' | 'COOLING' | 'IN_PROGRESS' | 'PAUSED' | 'BLOCKED';

export interface SmSnapshot {
  state: State;
  lastSubmitAt: number | null;
  lastCooldownMs: number | null;
  captcha: { date: string; count: number; lockUntil: number | null };
  blockedReason: string | null;
}

export interface CooldownConfig {
  enabled: boolean;
  muMs: number;
  sigmaMs: number;
  minMs: number;
  maxMs: number;
}

type CooldownCfg = () => CooldownConfig;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Box-Muller 正态采样并截断至 [min, max] */
export function sampleCooldown(cfg: CooldownConfig): number {
  let u1 = Math.random();
  if (u1 <= 0) u1 = 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = cfg.muMs + cfg.sigmaMs * z;
  return Math.round(Math.min(Math.max(ms, cfg.minMs), cfg.maxMs));
}

export class StateMachine {
  private snap: SmSnapshot;
  private pendingPause = false;
  private pendingHalt = false;

  /** 是否有挂起的终止请求（翻译等多阶段流程在阶段间检查，尽早收尾） */
  get haltRequested(): boolean {
    return this.pendingHalt;
  }
  private currentProblemSlug: string | null = null;
  private lastStateChangeReason = '';

  constructor(
    private getMeta: <T>(key: string, fallback: T) => T,
    private setMeta: (key: string, value: unknown) => void,
    private cooldownCfg: CooldownCfg
  ) {
    this.snap = this.getMeta<SmSnapshot>('sm', {
      state: 'IDLE',
      lastSubmitAt: null,
      lastCooldownMs: null,
      captcha: { date: today(), count: 0, lockUntil: null },
      blockedReason: null,
    });
    if (this.snap.captcha?.date !== today()) this.snap.captcha = { date: today(), count: 0, lockUntil: null };
  }

  get state(): State {
    return this.snap.state;
  }

  get currentSlug(): string | null {
    return this.currentProblemSlug;
  }

  get blockedReason(): string | null {
    return this.snap.blockedReason;
  }

  snapshot(): SmSnapshot & { pendingPause: boolean; lastStateChangeReason: string } {
    return { ...this.snap, pendingPause: this.pendingPause, lastStateChangeReason: this.lastStateChangeReason };
  }

  private persist(): void {
    this.setMeta('sm', this.snap);
  }

  /** 迁移 + 广播 + 持久化（非法迁移仅告警不崩溃，保持系统可运维） */
  private to(next: State, reason: string): void {
    const from = this.snap.state;
    if (from === next) return;
    this.snap.state = next;
    this.lastStateChangeReason = reason;
    this.persist();
    log(`状态迁移 ${from} → ${next}（${reason}）`);
    emit('state_change', { from, to: next, reason, slug: this.currentProblemSlug ?? null });
  }

  /* ---------- 崩溃恢复（docs/02 §3） ---------- */

  restoreAfterBoot(): void {
    if (this.snap.state === 'IN_PROGRESS') {
      // 崩溃恢复：当前题目标记 interrupted（由 Worker 读取 current slug 重新入队）
      this.to('IDLE', '崩溃恢复：IN_PROGRESS 中断题将回队列头部');
      return;
    }
    if (this.snap.state === 'RUNNING' || this.snap.state === 'COOLING') {
      // RUNNING 类状态回到 RUNNING 并重新校验 Cookie（校验由 Monitor 完成；先回 IDLE 等待探针结果）
      this.to('IDLE', '崩溃恢复：等待凭据探针确认');
      return;
    }
    // IDLE / PAUSED / BLOCKED 原样保留
  }

  /* ---------- 指令（docs/03 §3） ---------- */

  canResume(): boolean {
    return this.snap.state === 'IDLE' || this.snap.state === 'PAUSED';
  }

  /** 返回 'paused'（立即）| 'pending'（待当前题结束）| 'noop' */
  requestPause(reason = 'manual'): 'paused' | 'pending' | 'noop' {
    this.pendingHalt = false;
    switch (this.snap.state) {
      case 'IDLE':
      case 'BLOCKED':
        return 'noop';
      case 'PAUSED':
        return 'noop';
      case 'IN_PROGRESS':
        this.pendingPause = true;
        this.persist();
        return 'pending';
      case 'RUNNING':
      case 'COOLING':
        this.pendingPause = false;
        this.to('PAUSED', `pause:${reason}`);
        return 'paused';
    }
  }

  requestHalt(reason = 'manual'): 'paused' | 'pending' | 'noop' {    switch (this.snap.state) {
      case 'IDLE':
        return 'noop';
      case 'IN_PROGRESS':
        this.pendingHalt = true;
        this.pendingPause = false;
        this.persist();
        return 'pending';
      case 'RUNNING':
      case 'COOLING':
      case 'PAUSED':
      case 'BLOCKED':
        this.pendingHalt = false;
        this.pendingPause = false;
        this.currentProblemSlug = null;
        this.setMeta('current', null);
        this.to('IDLE', `halt:${reason}`);
        return 'paused';
    }
  }

  resume(): boolean {
    if (!this.canResume()) return false;
    this.pendingHalt = false;
    this.pendingPause = false;
    this.persist();
    if (this.cooldownRemainingMs() > 0) this.to('COOLING', 'resume:冷却未满');
    else this.to('RUNNING', 'resume');
    return true;
  }

  /* ---------- 调度循环使用的迁移 ---------- */

  toCooling(reason = 'cooldown'): void {
    if (this.snap.state === 'RUNNING' || this.snap.state === 'PAUSED') this.to('COOLING', reason);
  }

  toRunning(reason = 'cooldown_done'): void {
    if (this.snap.state === 'COOLING' || this.snap.state === 'RUNNING') this.to('RUNNING', reason);
  }

  canStartProblem(): boolean {
    return this.snap.state === 'RUNNING';
  }

  toInProgress(slug: string, reason = 'start_problem'): void {
    if (!this.canStartProblem() && this.snap.state !== 'COOLING') return;
    this.currentProblemSlug = slug;
    this.setMeta('current', { slug, startedAt: Date.now() });
    this.to('IN_PROGRESS', `${reason}:${slug}`);
  }

  /** Trigger Once 专用：允许从 IDLE / PAUSED 进入 IN_PROGRESS（docs/03 §3），跑完由 notifyTriggerDone 归位 */
  toInProgressManual(slug: string): void {
    if (this.snap.state !== 'IDLE' && this.snap.state !== 'PAUSED') return;
    this.currentProblemSlug = slug;
    this.setMeta('current', { slug, startedAt: Date.now() });
    this.to('IN_PROGRESS', `trigger_once:${slug}`);
  }

  /** 单题流程结束（AC / skipped）：无挂起暂停 → COOLING（锚定冷却，立即到期则回 RUNNING）；有挂起暂停 → PAUSED */
  notifyProblemFinished(result: 'accepted' | 'skipped'): 'PAUSED' | 'COOLING' | 'IDLE' | 'RUNNING' {
    this.currentProblemSlug = null;
    this.setMeta('current', null);
    if (this.pendingHalt) {
      this.pendingHalt = false;
      this.to('IDLE', 'halt:当前题结束');
      return 'IDLE';
    }
    if (this.pendingPause) {
      this.pendingPause = false;
      this.to('PAUSED', `pause:当前题结束（${result}）`);
      return 'PAUSED';
    }
    if (this.cooldownRemainingMs() > 0) {
      this.to('COOLING', `problem_finished:${result}`);
      return 'COOLING';
    }
    this.to('RUNNING', `problem_finished:${result}`);
    return 'RUNNING';
  }

  /** Trigger Once 完成：归位原状态（docs/03 §3） */
  notifyTriggerDone(returnTo: 'IDLE' | 'PAUSED'): void {
    this.currentProblemSlug = null;
    this.setMeta('current', null);
    this.pendingHalt = false;
    this.pendingPause = false;
    this.to(returnTo, 'trigger_once_done');
  }

  /* ---------- 冷却（锚定 last_submit_at，docs/04 §3） ---------- */

  cooldownRemainingMs(): number {
    const cfg = this.cooldownCfg();
    if (!cfg.enabled || !this.snap.lastSubmitAt) return 0;
    const raw = this.snap.lastCooldownMs ?? sampleCooldown(cfg);
    // clamp 到当前配置区间：修改 min/max 对已锚定的冷却即时生效
    const cd = Math.min(Math.max(raw, cfg.minMs), cfg.maxMs);
    const remain = this.snap.lastSubmitAt + cd - Date.now();
    return Math.max(0, remain);
  }

  /** 每次真实提交后调用：采样新冷却并锚定 */
  anchorCooldown(): number {
    const cfg = this.cooldownCfg();
    const cd = cfg.enabled ? sampleCooldown(cfg) : 0;
    this.snap.lastSubmitAt = Date.now();
    this.snap.lastCooldownMs = cd;
    this.persist();
    return cd;
  }

  /* ---------- 熔断（docs/04 §2） ---------- */

  /** CAPTCHA / Cookie 失效。返回进入的级别：L3 熔断 | L4 停机（单日 CAPTCHA ≥ 2 锁 24h） */
  circuitBreak(reason: string, opts?: { captcha?: boolean }): { level: 'L3' | 'L4'; lockUntil: number | null } {
    let lockUntil: number | null = null;
    if (opts?.captcha) {
      if (this.snap.captcha.date !== today()) this.snap.captcha = { date: today(), count: 0, lockUntil: null };
      this.snap.captcha.count += 1;
      if (this.snap.captcha.count >= 2) {
        lockUntil = Date.now() + 24 * 3600_000;
        this.snap.captcha.lockUntil = lockUntil;
      }
    }
    this.pendingPause = false;
    this.pendingHalt = false;
    this.snap.blockedReason = reason;
    this.currentProblemSlug = null;
    this.setMeta('current', null);
    this.to('BLOCKED', `circuit_break:${reason}`);
    this.persist();
    return { level: lockUntil ? 'L4' : 'L3', lockUntil };
  }

  isLocked(): boolean {
    return Boolean(this.snap.captcha.lockUntil && this.snap.captcha.lockUntil > Date.now());
  }

  /** 人工更新凭据并确认后的唯一恢复路径（docs/04 §2） */
  unblock(): boolean {
    if (this.snap.state !== 'BLOCKED') return false;
    this.snap.blockedReason = null;
    this.to('IDLE', 'unblock:人工确认');
    return true;
  }
}
