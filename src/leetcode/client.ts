import { log } from '../events.js';

/**
 * LeetCode（leetcode.cn）客户端。
 * - 全站请求经同一限速队列：全局串行 + 最小间隔（docs/01 §3 限频硬顶）。
 * - 未登录可用的公开查询（题单/详情）与需要凭据的操作（提交/探针）分离。
 * - 状态映射：Authenticated / Session Expired / Challenged（docs/04 §1）。
 */

const BASE = 'https://leetcode.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type ProbeStatus = 'Authenticated' | 'Session Expired' | 'Challenged';

export class LcNotConfiguredError extends Error {}
export class LcChallengeError extends Error {}

export interface LcQuestion {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  translatedTitle: string | null;
  content: string | null;
  translatedContent: string | null;
  difficulty: string;
  paidOnly: boolean;
  isPaidOnly?: boolean;
  metaData: string;
  exampleTestcases: string;
  sampleTestCase: string;
  codeSnippets: Array<{ lang: string; langSlug: string; code: string }>;
  topicTags?: Array<{ name: string; translatedName: string | null; slug: string } | null>;
}

export interface LcVerdict {
  state: string;
  statusCode: number | null; // 10 AC / 11 WA / 13 MLE / 14 TLE / 15 RE / 20 CE ...
  statusMsg: string | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  runtimePercentile: number | null;
  memoryPercentile: number | null;
  totalCorrect: number | null;
  totalTestcases: number | null;
  failingInput: string | null;
  expectedOutput: string | null;
  codeOutput: string | null;
  raw: unknown;
}

export interface Credentials {
  session: string;
  csrftoken: string;
}

interface RateLimiter {
  getMinIntervalMs(): number;
}

export class LeetCodeClient {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private getCredentials: () => Credentials | null,
    private limiter: RateLimiter
  ) {}

  /** 全局串行 + 最小间隔的请求闸门 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const gap = Date.now() - this.lastRequestAt;
      const min = Math.max(this.limiter.getMinIntervalMs(), 3000);
      if (this.lastRequestAt > 0 && gap < min) await sleep(min - gap);
      try {
        return await fn();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    // 防止单次失败打断队列
    this.chain = run.catch(() => undefined);
    return run;
  }

  private headers(withAuth: boolean, referer = `${BASE}/`): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': UA,
      referer,
      origin: BASE,
      'x-requested-with': 'XMLHttpRequest',
    };
    if (withAuth) {
      const cred = this.getCredentials();
      if (!cred) throw new LcNotConfiguredError('尚未配置 LeetCode Cookie');
      h['cookie'] = `LEETCODE_SESSION=${cred.session}; csrftoken=${cred.csrftoken}`;
      h['x-csrftoken'] = cred.csrftoken;
    }
    return h;
  }

  private async graphql<T>(query: string, operationName: string, variables: Record<string, unknown>, withAuth: boolean): Promise<T> {
    const res = await fetch(`${BASE}/graphql/`, {
      method: 'POST',
      headers: this.headers(withAuth),
      body: JSON.stringify({ query, operationName, variables }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 403) throw new LcChallengeError(`HTTP 403（可能触发风控/CAPTCHA）`);
    const bodyText = await res.text();
    if (/captcha/i.test(bodyText) && res.status >= 400) throw new LcChallengeError('响应包含 CAPTCHA');
    let body: { data?: T; errors?: Array<{ message: string }> };
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`GraphQL 响应非 JSON（HTTP ${res.status}）：${bodyText.slice(0, 200)}`);
    }
    if (body.errors?.length) throw new Error(`GraphQL 错误：${body.errors.map((e) => e.message).join('; ')}`);
    if (!body.data) throw new Error(`GraphQL 无数据（HTTP ${res.status}）`);
    return body.data;
  }

  /* ---------------- 探针（docs/04 §1） ---------------- */

  async probe(): Promise<ProbeStatus> {
    // leetcode.cn 的 MeNode/userStatus 无 isAuthenticated 字段（leetcode.com 才有），以 isSignedIn 为准
    const data = await this.enqueue(() =>
      this.graphql<{ userStatus: { isSignedIn: boolean; username: string | null } }>(
        `query globalData { userStatus { isSignedIn isPremium username } }`,
        'globalData',
        {},
        true
      )
    );
    const st = data.userStatus;
    if (st?.isSignedIn) return 'Authenticated';
    return 'Session Expired';
  }

  /* ---------------- 题单同步（公开） ---------------- */

  async listAllProblems(onPage?: (synced: number, total: number) => void): Promise<
    Array<{
      questionId: string;
      frontendQuestionId: string;
      title: string;
      titleCn: string | null;
      slug: string;
      difficulty: string;
      paidOnly: boolean;
      tags: string[];
    }>
  > {
    const query = `
      query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
          total
          questions {
            frontendQuestionId
            title
            titleCn
            titleSlug
            difficulty
            paidOnly
            topicTags { slug }
          }
        }
      }`;
    const all: Array<{
      questionId: string;
      frontendQuestionId: string;
      title: string;
      titleCn: string | null;
      slug: string;
      difficulty: string;
      paidOnly: boolean;
      tags: string[];
    }> = [];
    const limit = 100;
    let skip = 0;
    let total = Infinity;
    while (skip < total) {
      const data = await this.enqueue(() =>
        this.graphql<{
          problemsetQuestionList: {
            total: number;
            questions: Array<{
              frontendQuestionId: string;
              title: string;
              titleCn: string | null;
              titleSlug: string;
              difficulty: string;
              paidOnly: boolean;
              topicTags: Array<{ slug: string } | null>;
            }>;
          };
        }>(query, 'problemsetQuestionList', { categorySlug: 'algorithms', limit, skip, filters: {} }, false)
      );
      const list = data.problemsetQuestionList;
      total = list.total;
      for (const q of list.questions) {
        all.push({
          questionId: '', // 题单（QuestionLightNode）不含 questionId，详情阶段补齐
          frontendQuestionId: String(q.frontendQuestionId),
          title: q.title,
          titleCn: q.titleCn,
          slug: q.titleSlug,
          difficulty: normalizeDifficulty(q.difficulty),
          paidOnly: Boolean(q.paidOnly),
          tags: (q.topicTags ?? []).map((t) => t?.slug).filter((s): s is string => Boolean(s)),
        });
      }
      skip += limit;
      onPage?.(all.length, total);
    }
    return all;
  }

  /* ---------------- 题目详情（公开） ---------------- */

  async getQuestion(slug: string): Promise<LcQuestion> {
    const data = await this.enqueue(() =>
      this.graphql<{ question: LcQuestion | null }>(
        `query questionDetail($titleSlug: String!) {
           question(titleSlug: $titleSlug) {
             questionId
             questionFrontendId
             title
             titleSlug
             translatedTitle
             content
             translatedContent
             difficulty
             isPaidOnly
             metaData
             exampleTestcases
             sampleTestCase
             codeSnippets { lang langSlug code }
             topicTags { name translatedName slug }
           }
         }`,
        'questionDetail',
        { titleSlug: slug },
        false
      )
    );
    const q = data.question;
    if (!q) throw new Error(`题目不存在或不可见：${slug}`);
    if (q.isPaidOnly) throw new Error(`Premium 锁卡题不应被调度：${slug}`);
    return {
      ...q,
      topicTags: (q.topicTags ?? []).filter((t): t is NonNullable<typeof t> => Boolean(t)),
      paidOnly: Boolean(q.isPaidOnly),
      difficulty: normalizeDifficulty(q.difficulty),
    };
  }

  /* ---------------- 提交与判题（需凭据；docs/06 §1 提交环节） ---------------- */

  async submit(slug: string, questionId: string, code: string, lang: string): Promise<string> {
    const res = await this.enqueue(() =>
      fetch(`${BASE}/problems/${slug}/submit/`, {
        method: 'POST',
        headers: this.headers(true, `${BASE}/problems/${slug}/description/`),
        body: JSON.stringify({ lang, typed_code: code, question_id: questionId }),
        signal: AbortSignal.timeout(20_000),
      })
    );
    if (res.status === 403) throw new LcChallengeError('提交被拒（HTTP 403，可能触发风控）');
    const text = await res.text();
    let body: { submission_id?: number | string; message?: string };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`提交响应非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!body.submission_id) {
      if (/captcha/i.test(text)) throw new LcChallengeError('提交返回 CAPTCHA');
      throw new Error(`提交失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    log(`LC 提交受理：${slug} submission_id=${body.submission_id}`, 'debug');
    return String(body.submission_id);
  }

  async checkOnce(submissionId: string): Promise<LcVerdict> {
    const res = await this.enqueue(() =>
      fetch(`${BASE}/submissions/detail/${submissionId}/check/`, {
        headers: this.headers(true, `${BASE}/`),
        signal: AbortSignal.timeout(20_000),
      })
    );
    if (res.status === 403) throw new LcChallengeError('判题查询被拒（HTTP 403）');
    const raw = (await res.json()) as Record<string, unknown>;
    return parseVerdict(raw);
  }

  /** 轮询至 FINISHED（指数退避，总时长上限 ~90s） */
  async awaitVerdict(submissionId: string, isCancelled?: () => boolean): Promise<LcVerdict> {
    let delay = 1500;
    for (let waited = 0; waited < 90_000; waited += delay) {
      if (isCancelled?.()) throw new Error('已取消');
      const v = await this.checkOnce(submissionId);
      // 完成态：leetcode.cn 返回 SUCCESS（附 finished:true），国际站为 FINISHED
      const finished = v.state === 'FINISHED' || v.state === 'SUCCESS' || (v.raw as { finished?: boolean })?.finished === true;
      if (finished) return v;
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 8000);
    }
    throw new Error(`判题轮询超时：submission_id=${submissionId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 站点返回 EASY/EASY 大小写不一，统一为 Easy/Medium/Hard */
export function normalizeDifficulty(d: string): string {
  const s = (d ?? '').toLowerCase();
  if (s === 'easy') return 'Easy';
  if (s === 'medium') return 'Medium';
  if (s === 'hard') return 'Hard';
  return d;
}

/**
 * 判题回执解析（纯函数，便于对真实响应形态做回归锁定）。
 * 兼容两种 WA 失败用例形态：
 *  - 嵌套：{ last_testcase: { input, expected_output, code_output } }
 *  - 平铺：{ last_testcase: "<raw>", expected_output, code_output }
 * runtime/memory 兼容数字与带单位字符串（"52 ms" / "41.52 MB"）。
 */
export function parseVerdict(raw: Record<string, unknown>): LcVerdict {
  const state = String(raw.state ?? 'STARTED');
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const last = raw.last_testcase;
  const lastObj = (last && typeof last === 'object' ? last : undefined) as Record<string, unknown> | undefined;
  return {
    state,
    statusCode: num(raw.status_code),
    statusMsg: str(raw.status_msg),
    // cn 回执无 runtime 字段：真实运行时长在 status_runtime（"2 ms"），fallback display_runtime / runtime
    runtimeMs: num(raw.runtime) ?? num(raw.status_runtime) ?? num(raw.display_runtime),
    memoryKb: num(raw.memory),
    runtimePercentile: num(raw.runtime_percentile),
    memoryPercentile: num(raw.memory_percentile),
    totalCorrect: num(raw.total_correct),
    totalTestcases: num(raw.total_testcases),
    failingInput: str(lastObj?.input) ?? str(last) ?? str(raw.failing_case_input),
    expectedOutput: str(lastObj?.expected_output) ?? str(raw.expected_output),
    codeOutput: str(lastObj?.code_output) ?? str(raw.code_output),
    raw,
  };
}

/* ---------------- 静态工具 ---------------- */

/** 粗略 HTML → 纯文本（给 AI 的题面用） */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<pre>[\s\S]*?<\/pre>/gi, (m) => `\n\`\`\`\n${m.replace(/<\/?pre>/gi, '').replace(/<[^>]+>/g, '').trim()}\n\`\`\`\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
