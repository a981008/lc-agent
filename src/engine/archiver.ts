import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { env } from '../config.js';
import { log } from '../events.js';
import type { Repository } from '../db/repository.js';
import type { AiClient, ProblemCtx } from '../ai/client.js';

/**
 * 题解归档（docs/07）：AC 触发 → LLM 生成 Markdown（LLM 不可用时回退模板）→
 * 写盘 data/solutions/{frontendId}_{slug}.md → 若为 git 仓库则幂等 commit，配置了 remote 则尝试 push。
 */

export interface ArchivePerf {
  runtimeMs: number | null;
  runtimePercentile: number | null;
  memoryPercentile: number | null;
}

/** langSlug → 展示名 */
export const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python3: 'Python 3',
  python: 'Python',
  cpp: 'C++',
  java: 'Java',
  c: 'C',
  csharp: 'C#',
  golang: 'Go',
  go: 'Go', // 旧配置遗留别名
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  rust: 'Rust',
  php: 'PHP',
  dart: 'Dart',
  scala: 'Scala',
  elixir: 'Elixir',
  erlang: 'Erlang',
  racket: 'Racket',
  cangjie: '仓颉',
  mysql: 'MySQL',
  mssql: 'MS SQL Server',
  oraclesql: 'Oracle SQL',
  bash: 'Bash',
};

export function langLabel(langSlug: string): string {
  return LANG_LABELS[langSlug] ?? langSlug;
}

/**
 * 构建多语言 AC 代码块（页签约定）：
 * 输出一个特殊 info 串为 `ac-tabs` 的 fenced 块，内容为 JSON（langLabel → code）。
 * 前端 markdown 渲染器（web/src/markdown.js）将其转换为可切换的页签组件。
 */
export function buildAcTabsBlock(codes: Record<string, string>): string {
  return `\`\`\`ac-tabs\n${JSON.stringify(codes)}\n\`\`\``;
}

/** leetcode.cn 原题页 URL */
export function lcProblemUrl(slug: string): string {
  return `https://leetcode.cn/problems/${slug}/`;
}

/** 在题解 Markdown 首个一级标题后插入原题链接（无标题则整体前置） */
export function withLcLink(markdown: string, slug: string, title: string): string {
  const line = `> 原题链接：[${title || slug}](${lcProblemUrl(slug)})`;
  if (markdown.includes('原题链接：')) return markdown; // 幂等：已含链接不重复插入
  const m = markdown.match(/^#[^\n]*\n/);
  if (m && m.index === 0) {
    const rest = markdown.slice(m[0].length);
    return `${markdown.slice(0, m[0].length)}\n${line}\n${rest.startsWith('\n') ? '' : '\n'}${rest}`;
  }
  return `${line}\n\n${markdown}`;
}

function runGit(args: string[], cwd: string): { ok: boolean; output: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

export class Archiver {
  constructor(
    private repo: Repository,
    private ai: AiClient
  ) {}

  async archive(
    ctx: ProblemCtx,
    slug: string,
    code: string,
    perf: ArchivePerf,
    attemptSummary: string,
    extraCodes?: Record<string, string>, // langSlug → code（含主语言 javascript）
    alternatives?: Array<{ approach: string; code: string }>, // 已 AC 的补充解法（多解法小节）
    tledCodes?: Record<string, string> // 翻译后正确但 TLE 的解法（langSlug → code；页签标注 TLE）
  ): Promise<{ file: string; commit: string | null; pushed: boolean }> {
    let markdown: string;
    try {
      markdown = await this.ai.archiveMarkdown(ctx, code, perf, attemptSummary);
    } catch (e) {
      log(`题解 LLM 生成失败，回退模板：${(e as Error).message}`, 'warn');
      markdown = [
        `# ${ctx.frontendId}. ${ctx.title}`,
        '',
        `- 难度：${ctx.difficulty}`,
        `- 耗时：${perf.runtimeMs ?? '?'} ms（超过 ${perf.runtimePercentile ?? '?'}%）`,
        `- 内存：击败 ${perf.memoryPercentile ?? '?'}%`,
        '',
        '## 求解过程',
        '',
        attemptSummary || '（一次通过）',
        '',
      ].join('\n');
    }

    // 多语言 AC 代码：按 langLabel 排序（主语言 JavaScript 恒在首位），以页签块附加
    const codes: Record<string, string> = {};
    if (extraCodes) {
      for (const [lang, c] of Object.entries(extraCodes)) {
        codes[langLabel(lang)] = c;
      }
    } else {
      codes['JavaScript'] = code;
    }
    const ordered: Record<string, string> = {};
    if (codes['JavaScript']) ordered['JavaScript'] = codes['JavaScript']!;
    for (const k of Object.keys(codes).sort()) {
      if (k !== 'JavaScript') ordered[k] = codes[k]!;
    }
    // 正确但 TLE 的翻译解法：页签标注（TLE），排在已 AC 语言之后
    if (tledCodes) {
      for (const [lang, c] of Object.entries(tledCodes)) {
        ordered[`${langLabel(lang)}（TLE）`] = c;
      }
    }
    markdown = withLcLink(markdown, slug, `${ctx.frontendId}. ${ctx.title}`);
    // 多解法：每个解法一个页签（```alt-tabs 块，key=解法名，value=讲解 markdown + 代码块），前端按页签切换
    let altSection = '';
    if (alternatives?.length) {
      const altMap: Record<string, string> = {};
      for (let i = 0; i < alternatives.length; i++) {
        const a = alternatives[i]!;
        // 每个补充解法生成专属讲解（思路/关键点/复杂度）；LLM 失败回退一句话
        let explain = '';
        try {
          explain = await this.ai.explainAlternative(ctx, code, a);
        } catch (e) {
          log(`补充解法讲解生成失败，回退简述：${(e as Error).message}`, 'warn');
          explain = `**解题思路**：${a.approach}。`;
        }
        const cleaned = explain
          .replace(/^#{1,6}\s.*$/gm, '') // 剥掉讲解里可能出现的标题行，避免打乱文档层级
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        altMap[`解法 ${i + 2}：${a.approach}`] = `${cleaned || `**解题思路**：${a.approach}。`}\n\n\`\`\`javascript\n${a.code}\n\`\`\``;
      }
      altSection = `\n## 多解法\n\n> 以下解法均已提交 LeetCode 并 AC，点击页签查看各解法讲解与实现。\n\n\`\`\`alt-tabs\n${JSON.stringify(altMap)}\n\`\`\`\n`;
    }
    markdown = `${markdown.trimEnd()}${altSection}\n## AC 代码\n\n${buildAcTabsBlock(ordered)}\n`;

    const dir = path.join(env.dataDir, 'solutions');
    const file = path.join(dir, `${ctx.frontendId}_${slug}.md`);
    fs.writeFileSync(file, markdown, 'utf8');

    // Git 幂等归档：仅当 solutions 目录本身是 git 仓库时执行
    let commit: string | null = null;
    let pushed = false;
    if (fs.existsSync(path.join(dir, '.git'))) {
      runGit(['add', '-A'], dir);
      const unique = `solve(${ctx.frontendId}): ${slug} @ ${new Date().toISOString()}`;
      const c = runGit(['commit', '-m', unique, '--allow-empty'], dir);
      if (c.ok) {
        const sha = runGit(['rev-parse', 'HEAD'], dir);
        commit = sha.ok ? sha.output : null;
        const hasRemote = runGit(['remote', 'get-url', 'origin'], dir);
        if (hasRemote.ok) {
          const p = runGit(['push', 'origin', 'HEAD'], dir);
          pushed = p.ok;
          if (!p.ok) log(`Git push 失败（保留 pending，稍后可补推）：${p.output.slice(-200)}`, 'warn');
        }
      }
    }

    this.repo.saveSolution({
      problem_id: ctx.frontendId, // 以 frontendId 作为 solutions 关联键（与 problem_records.problem_id 一致性由调度层保证）
      markdown,
      codes: JSON.stringify(ordered),
      runtime_ms: perf.runtimeMs,
      runtime_percentile: perf.runtimePercentile,
      memory_percentile: perf.memoryPercentile,
      git_commit: commit,
    });
    log(`题解已归档：${file}${commit ? `（commit ${commit.slice(0, 8)}${pushed ? '，已推送' : ''}）` : ''}`);
    return { file, commit, pushed };
  }
}
