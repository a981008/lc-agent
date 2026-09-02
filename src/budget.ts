import { emit, log } from './events.js';

/**
 * LLM 成本预算（docs/08）：
 * - 计量：每次调用记录 token_in/out，归属 attempts（由调用方写入）。
 * - 全局每日 token 上限：≥80% 广播 budget_warning（L1）；100% 抛 BudgetExceeded → 调用方转 L2 软停。
 * - 单题调用次数上限由 Worker 循环约束（llmPerProblemCalls）。
 */

export class BudgetExceededError extends Error {}

interface BudgetState {
  date: string; // YYYY-MM-DD
  tokensIn: number;
  tokensOut: number;
  calls: number;
  warnedPct: number; // 已告警的最低百分比档
}

export interface BudgetSnapshot extends BudgetState {
  limit: number;
  usagePct: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class BudgetManager {
  constructor(
    private getMeta: <T>(key: string, fallback: T) => T,
    private setMeta: (key: string, value: unknown) => void,
    private getDailyLimit: () => number
  ) {}

  private load(): BudgetState {
    const st = this.getMeta<BudgetState>('budget', { date: today(), tokensIn: 0, tokensOut: 0, calls: 0, warnedPct: 0 });
    if (st.date !== today()) return { date: today(), tokensIn: 0, tokensOut: 0, calls: 0, warnedPct: 0 };
    return st;
  }

  private save(st: BudgetState): void {
    this.setMeta('budget', st);
  }

  /** 调用前检查；超限抛 BudgetExceededError */
  preCall(): void {
    const st = this.load();
    const limit = this.getDailyLimit();
    if (limit > 0) {
      const used = st.tokensIn + st.tokensOut;
      if (used >= limit) throw new BudgetExceededError(`每日 LLM 预算已用尽（${used}/${limit} tokens）`);
    }
  }

  /** 调用后计量；usage 缺失时按字符数粗估 */
  record(usage: { prompt_tokens?: number; completion_tokens?: number } | null, fallbackCharsIn = 0, fallbackCharsOut = 0): void {
    const st = this.load();
    const tin = usage?.prompt_tokens ?? Math.ceil(fallbackCharsIn / 4);
    const tout = usage?.completion_tokens ?? Math.ceil(fallbackCharsOut / 4);
    st.tokensIn += tin;
    st.tokensOut += tout;
    st.calls += 1;
    const limit = this.getDailyLimit();
    if (limit > 0) {
      const used = st.tokensIn + st.tokensOut;
      const pct = Math.floor((used / limit) * 100);
      if (pct >= 80 && st.warnedPct < 80) {
        st.warnedPct = 80;
        log(`LLM 预算用量达 ${pct}%（${used}/${limit}）`, 'warn');
        emit('budget_warning', { scope: 'daily_tokens', used, limit });
      }
      if (pct >= 100 && st.warnedPct < 100) {
        st.warnedPct = 100;
        emit('budget_warning', { scope: 'daily_tokens', used, limit });
      }
    }
    this.save(st);
  }

  snapshot(): BudgetSnapshot {
    const st = this.load();
    const limit = this.getDailyLimit();
    const used = st.tokensIn + st.tokensOut;
    return { ...st, limit, usagePct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
  }
}
