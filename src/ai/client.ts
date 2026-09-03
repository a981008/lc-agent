import { log } from '../events.js';
import type { BudgetManager } from '../budget.js';

/**
 * LLM Chat 客户端（OpenAI 兼容 / Anthropic Messages 双协议）+ Prompt 构造（docs/06 §1 / docs/07 / docs/08）。
 * - openai：…/v1 → /v1/chat/completions；Bearer 鉴权。
 * - anthropic：…/v1 → /v1/messages；x-api-key + anthropic-version 鉴权；
 *   推理模型（如 glm 系）会在 content 里输出 thinking 块——只拼接 text 块，
 *   且 max_tokens 需为不可见思考预留余量（默认 +12000）。
 * - generate 要求模型返回严格 JSON：{ code, predicted[] }；debug/reflect 返回 { code } 或 { unfixable }。
 * - 每次调用计入预算（docs/08）。
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: 'openai' | 'anthropic';
}

export class AiNotConfiguredError extends Error {}

export interface ProblemCtx {
  frontendId: string;
  title: string;
  difficulty: string;
  statement: string; // 纯文本题面（截断后）
  jsTemplate: string;
  sampleInputs: string[][];
}

export class AiClient {
  constructor(
    private getConfig: () => LlmConfig | null,
    private budget: BudgetManager
  ) {}

  private endpoint(baseUrl: string, protocol: 'openai' | 'anthropic'): string {
    let b = baseUrl.trim().replace(/\/+$/, '');
    if (protocol === 'anthropic') {
      if (b.endsWith('/messages')) return b;
      if (b.endsWith('/v1')) return `${b}/messages`;
      return `${b}/v1/messages`;
    }
    if (b.endsWith('/chat/completions')) return b;
    if (b.endsWith('/v1')) return `${b}/chat/completions`;
    return `${b}/v1/chat/completions`;
  }

  async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { maxTokens?: number; temperature?: number; onDelta?: (delta: string) => void }
  ): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }> {
    const cfg = this.getConfig();
    if (!cfg?.baseUrl || !cfg?.apiKey || !cfg?.model) throw new AiNotConfiguredError('LLM 未配置（baseUrl / apiKey / model）');
    this.budget.preCall();
    const protocol = cfg.protocol === 'anthropic' ? 'anthropic' : 'openai';
    // 推理模型的思考块消耗输出预算且不可见，Anthropic 协议下为思考预留余量
    // 推理模型（glm 系）思考会消耗输出预算：两种协议都预留思考余量
    const maxTokens = (opts?.maxTokens ?? 2400) + 12_000;
    const temperature = opts?.temperature ?? 0.2;

    let url: string;
    let headers: Record<string, string>;
    let body: string;
    const stream = typeof opts?.onDelta === 'function';
    if (protocol === 'anthropic') {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
      url = this.endpoint(cfg.baseUrl, protocol);
      headers = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
      body = JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature, stream, system: system || undefined, messages: rest });
    } else {
      url = this.endpoint(cfg.baseUrl, protocol);
      headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` };
      body = JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens, stream, stream_options: stream ? { include_usage: true } : undefined });
    }

    // 网络级瞬时抖动（ENOTFOUND/ECONNRESET/套接字中断…）自动重试 1 次；超时/中断不重试（420s 已经很宽）
    let res: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2 && !res; attempt++) {
      try {
        res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(420_000) });
      } catch (e) {
        lastErr = e;
        const name = (e as Error).name;
        if (name === 'AbortError' || name === 'TimeoutError') break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    if (!res) {
      // fetch failed 本身没有信息量；展开 cause 链拿到真实原因（ENOTFOUND/ECONNREFUSED/ETIMEDOUT…）
      const cause = (lastErr as { cause?: { code?: string; message?: string } } | null)?.cause;
      const detail = cause?.code ?? cause?.message;
      throw new Error(`LLM 请求失败：${(lastErr as Error).message}${detail ? `（${detail}）` : ''}`);
    }
    if (stream) {
      return this.consumeStream(res, protocol, body.length, opts!.onDelta!);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}：${text.slice(0, 300)}`);
    let data: {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`LLM 响应非 JSON：${text.slice(0, 200)}`);
    }
    if (data.error?.message) throw new Error(`LLM 错误：${data.error.message}`);

    let content: string;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    if (protocol === 'anthropic') {
      // 只取 text 块（推理模型的 thinking 块不是答案）
      content = (data.content ?? [])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
      if (data.usage) {
        usage = { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens };
      }
    } else {
      content = data.choices?.[0]?.message?.content ?? '';
      // 推理模型在 OpenAI 兼容接口下可能只输出 reasoning_content（思考占用全部预算、content 为空）
      if (!String(content).trim() && data.choices?.[0]?.message?.reasoning_content) {
        content = data.choices[0].message.reasoning_content;
      }
      usage = data.usage ?? null;
    }
    if (!content.trim()) throw new Error('LLM 返回空内容（可能输出预算被思考耗尽：推理模型建议使用 anthropic 协议或加大 maxTokens）');
    this.budget.record(usage, body.length, content.length);
    return { content, usage };
  }

  /** SSE 流式消费：解析 anthropic / openai 两种协议的增量事件，拼接全文并回传 usage */
  private async consumeStream(
    res: Response,
    protocol: 'anthropic' | 'openai',
    reqBytes: number,
    onDelta: (delta: string) => void
  ): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }> {
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}：${text.slice(0, 300)}`);
    }
    let full = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') break outer;
        let ev: {
          type?: string;
          delta?: { text?: string; content?: string; reasoning_content?: string };
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          message?: { content?: string; reasoning_content?: string };
          usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
        };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // 心跳/注释行
        }
        if (ev.usage) {
          usage = { prompt_tokens: ev.usage.prompt_tokens ?? ev.usage.input_tokens, completion_tokens: ev.usage.completion_tokens ?? ev.usage.output_tokens };
        }
        let delta = '';
        if (protocol === 'anthropic') {
          if (ev.type === 'content_block_delta') delta = ev.delta?.text ?? '';
          else if (ev.type === 'message_delta' && ev.usage) usage = { prompt_tokens: usage?.prompt_tokens, completion_tokens: ev.usage.completion_tokens ?? ev.usage.output_tokens };
        } else {
          delta = ev.choices?.[0]?.delta?.content ?? '';
          // 思考增量：面板同样展示（用户要看解题过程，reasoning 正是过程本身）
          if (!delta && ev.choices?.[0]?.delta?.reasoning_content) delta = ev.choices[0].delta.reasoning_content;
        }
        if (delta) {
          full += delta;
          try { onDelta(delta); } catch { /* 回调异常不影响生成 */ }
        }
      }
    }
    if (!full.trim()) throw new Error('LLM 流式返回空内容（可能输出预算被思考耗尽）');
    this.budget.record(usage, reqBytes, full.length);
    return { content: full, usage };
  }

  /* ---------------- Prompt 构造 ---------------- */

  private problemSection(ctx: ProblemCtx): string {
    const samples = ctx.sampleInputs
      .map((lines, i) => `示例 ${i + 1} 输入（每行一个参数）：\n${lines.join('\n')}`)
      .join('\n\n');
    return [
      `题目：${ctx.frontendId}. ${ctx.title}（难度：${ctx.difficulty}）`,
      '',
      '题面：',
      ctx.statement.slice(0, 6000),
      '',
      'JavaScript 函数模板：',
      '```javascript',
      ctx.jsTemplate,
      '```',
      '',
      samples,
    ].join('\n');
  }

  /** 首次生成：返回 { code, predicted[] } */
  async generateSolution(ctx: ProblemCtx, onDelta?: (delta: string) => void): Promise<{ code: string; predicted: Array<string | null>; usage: unknown }> {
    const system = '你是精通数据结构与算法的竞赛选手。只输出一个严格的 JSON 对象，不要输出任何其他文本或解释。';
    const user = `${this.problemSection(ctx)}

请完成以下任务：
1. 用 JavaScript（LeetCode 判题格式）实现该题：只定义函数本身，不要 require / console 输入输出 / 文件访问。
2. 预测每个示例的输出，序列化格式与 LeetCode 一致（如 \`[0,1]\`、\`3\`、\`"abc"\`、\`[3,9,20,null,null,15,7]\`）；无法确定填 null。

输出 JSON：{"code": "<完整代码>", "predicted": ["<示例1输出>", ...]}`;
    const { content, usage } = await this.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { onDelta }
    );
    const parsed = extractJson(content) as { code?: string; predicted?: Array<string | null> };
    if (!parsed?.code?.trim()) throw new Error('AI 未返回有效代码');
    return {
      code: parsed.code,
      predicted: Array.isArray(parsed.predicted) ? parsed.predicted : [],
      usage,
    };
  }

  /** 解法规划：AI 自主判断该题有多少种值得呈现的主流解法（返回思路名列表，主解法之外的数量即补充目标） */
  async planApproaches(ctx: ProblemCtx, acceptedCode: string): Promise<{ approaches: string[]; usage: unknown }> {
    const user = `${this.problemSection(ctx)}

已通过（AC）的当前解法：
\`\`\`javascript
${acceptedCode}
\`\`\`

任务：以算法竞赛视角判断——这道题还存在哪些**思路本质不同**且正确性可靠的主流解法？
- 只列真正值得写进题解的（不同算法范式/数据结构），机械变体、纯常数优化不要列；
- 简单题可能一个补充解法都没有（返回空数组）；经典题可能有 2-3 个；
- 每项用一句话概括思路（≤25 字）。

输出 JSON：{"approaches": ["<思路1>", "<思路2>", ...]}`;
    const { content, usage } = await this.chat([
      { role: 'system', content: '你是精通数据结构与算法的竞赛选手。只输出一个严格的 JSON 对象，不要输出任何其他文本。' },
      { role: 'user', content: user },
    ]);
    const parsed = extractJson(content) as { approaches?: unknown };
    const approaches = Array.isArray(parsed.approaches)
      ? (parsed.approaches as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
      : [];
    return { approaches, usage };
  }

  /** 补充解法：参考已 AC 的主解法，产出一个「不同思路」的新解 + 预测输出（要求同签名、可独立运行） */
  async generateAlternativeSolution(
    ctx: ProblemCtx,
    acceptedCode: string,
    existingApproaches: string[],
    onDelta?: (delta: string) => void
  ): Promise<{ code: string; approach?: string; predicted: Array<string | null>; usage: unknown }> {
    const system = '你是精通数据结构与算法的竞赛选手。只输出一个严格的 JSON 对象，不要输出任何其他文本或解释。';
    const user = `${this.problemSection(ctx)}

已通过（AC）的参考解法：
\`\`\`javascript
${acceptedCode}
\`\`\`

任务：给出一种**与以下已有思路全部明显不同**的解法（不同算法范式或不同数据结构，而非变量改名/写法微调）。

已有思路（禁止重复）：
${existingApproaches.map((a, i) => `${i + 1}. ${a}`).join('\n')}

要求：
1. 用 JavaScript（LeetCode 判题格式）：只定义函数本身，签名与函数模板一致；不 require / 不 console / 不读输入。
2. 算法必须正确且能通过全部测试（不仅是示例），复杂度在题目约束内可接受。
3. 预测每个示例的输出（与 LeetCode 序列化一致，如 \`[0,1]\`、\`3\`）；无法确定填 null。

输出 JSON：{"approach": "<思路一句话，≤30字>", "code": "<完整代码>", "predicted": ["<示例1输出>", ...]}`;
    const { content, usage } = await this.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { onDelta }
    );
    const parsed = extractJson(content) as { code?: string; approach?: string; predicted?: Array<string | null> };
    if (!parsed?.code?.trim()) throw new Error('AI 未返回有效代码');
    return {
      code: parsed.code,
      approach: typeof parsed.approach === 'string' ? parsed.approach : undefined,
      predicted: Array.isArray(parsed.predicted) ? parsed.predicted : [],
      usage,
    };
  }

  /** 自愈：基于失败信息修复代码（opts.lang/langTemplate 用于翻译解法的语言内修复） */
  async debugSolution(
    ctx: ProblemCtx,
    code: string,
    failure: { kind: 'local' | 'WA' | 'RE' | 'TLE' | 'CE'; detail: string },
    historyDigest: string,
    opts?: { lang?: string; langTemplate?: string }
  ): Promise<{ code: string; unfixable?: string; usage: unknown }> {
    const system = '你是精通数据结构与算法的竞赛选手。只输出一个严格的 JSON 对象，不要输出任何其他文本。';
    const kindHint =
      failure.kind === 'TLE'
        ? '当前解法超时。请重新审视算法复杂度，给出渐近意义下更优的算法，而不是做常数级微优化。'
        : failure.kind === 'RE' || failure.kind === 'CE'
          ? '当前代码运行/编译出错。请优先检查边界条件、空输入、类型转换与数组越界。'
          : failure.kind === 'WA'
            ? '当前代码存在答案错误。请对照失败用例修正逻辑，不要改用截然不同的算法（除非必要）。'
            : '请修复以下本地测试失败。';
    const langLabel = opts?.lang ?? 'javascript';
    const user = `${opts?.lang ? `目标语言为 ${opts.lang}（保持该语言的模板签名不变）。` : ''}
${this.problemSection(ctx)}

当前代码（${langLabel}）：
\`\`\`${opts?.lang ?? 'javascript'}
${code}
\`\`\`
${opts?.langTemplate ? `\n${opts.lang} 函数模板（签名不得改动）：\n\`\`\`\n${opts.langTemplate}\n\`\`\`\n` : ''}
失败信息（${failure.kind}）：
${failure.detail.slice(0, 3000)}

历史修复摘要：
${historyDigest.slice(0, 1000) || '（无）'}

${kindHint}
输出 JSON：{"code": "<修复后的完整 ${langLabel} 代码>"}；若判断无法修复则输出 {"code": "", "unfixable": "<原因>"}。`;
    const { content, usage } = await this.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const parsed = extractJson(content) as { code?: string; unfixable?: string };
    if (!parsed || typeof parsed.code !== 'string') throw new Error('AI 修复响应无法解析');
    return { code: parsed.code, unfixable: parsed.unfixable, usage };
  }

  /** AC 后题解（docs/07：概要/思路/注释代码/复杂度 LaTeX/尝试摘要） */
  async archiveMarkdown(
    ctx: ProblemCtx,
    code: string,
    perf: { runtimeMs: number | null; runtimePercentile: number | null; memoryPercentile: number | null },
    attemptSummary: string
  ): Promise<string> {
    const user = `${this.problemSection(ctx)}

通过的 AC 代码（JavaScript，供理解思路用）：
\`\`\`javascript
${code}
\`\`\`

性能：耗时 ${perf.runtimeMs ?? '?'} ms（超过 ${perf.runtimePercentile ?? '?'}%），内存击败 ${perf.memoryPercentile ?? '?'}%
求解过程摘要：${attemptSummary.slice(0, 1500)}

请生成一份 Markdown 题解，包含：题目概要与难度、核心解题思路（算法选型依据）、时间/空间复杂度分析（用 LaTeX 表达）。
注意：**不要包含任何代码块**（AC 代码由系统以多语言页签形式附加在文末）。
只输出 Markdown 正文，不要额外说明。`;
    const { content } = await this.chat(
      [
        { role: 'system', content: '你是算法题解作者，输出高质量中文 Markdown 题解。' },
        { role: 'user', content: user },
      ],
      { maxTokens: 3000 }
    );
    return content;
  }

  /** 为单个补充解法生成题解讲解（思路/关键点/复杂度，不含代码块——代码由系统附加） */
  async explainAlternative(
    ctx: ProblemCtx,
    acceptedCode: string,
    alt: { approach: string; code: string }
  ): Promise<string> {
    const user = `${this.problemSection(ctx)}

主解法（已 AC）：
\`\`\`javascript
${acceptedCode}
\`\`\`

补充解法（已 AC，思路：${alt.approach}）：
\`\`\`javascript
${alt.code}
\`\`\`

请为这个补充解法写一段中文讲解（Markdown），包含：
1. **解题思路**：该解法如何思考这个问题，与主流 DP/哈希等方法的联系或区别；
2. **关键点**：实现中最容易出错的 1-2 个细节；
3. **复杂度**：时间/空间复杂度（用 LaTeX 表达）。

要求：只讲这一个解法；不输出任何代码块；**不要输出任何标题（#）**，只用加粗小标题与列表；总长不超过 300 字；只输出 Markdown 片段。`;
    const { content } = await this.chat(
      [
        { role: 'system', content: '你是算法题解作者，输出高质量中文 Markdown 题解片段。' },
        { role: 'user', content: user },
      ],
      { maxTokens: 1200 }
    );
    return content;
  }

  /** AC 解法翻译：JS → 目标语言（LeetCode 判题格式，签名与模板一致） */
  async translateSolution(
    ctx: ProblemCtx,
    jsCode: string,
    langSlug: string,
    langTemplate: string,
    onDelta?: (delta: string) => void
  ): Promise<{ code: string; usage: unknown }> {
    const user = `把下面已 AC 的 JavaScript 解法翻译为 ${langSlug}。

题目（${ctx.frontendId}. ${ctx.title}）：签名以模板为准。

已 AC 的 JavaScript 代码：
\`\`\`javascript
${jsCode}
\`\`\`

${langSlug} 函数模板（**必须保持模板给定的函数/方法签名与类名，不得改动**）：
\`\`\`
${langTemplate}
\`\`\`

要求：
1. 只输出 LeetCode 判题格式的完整提交代码：算法与 JS 版一致，不读 stdin、不打印、不定义多余类/函数。
2. 使用该语言的标准写法与数据类型（如整型溢出注意 long/long long）。
3. 代码中不要包含模板注释以外的任何解释。

输出 JSON：{"code": "<完整代码>"}`;
    const { content, usage } = await this.chat(
      [
        { role: 'system', content: '你是精通多语言的数据结构与算法竞赛选手。只输出一个严格的 JSON 对象，不要输出任何其他文本。' },
        { role: 'user', content: user },
      ],
      { onDelta }
    );
    const parsed = extractJson(content) as { code?: string };
    if (!parsed?.code?.trim()) throw new Error(`翻译 ${langSlug} 未返回有效代码`);
    return { code: parsed.code, usage };
  }
}

/** 从模型输出中鲁棒提取 JSON（优先 ```json 围栏，其次首个平衡大括号块） */
export function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as Record<string, unknown>;
    } catch {
      /* fallthrough */
    }
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function logAiError(scope: string, e: unknown): void {
  log(`[${scope}] LLM 调用失败：${(e as Error).message}`, 'warn');
}
