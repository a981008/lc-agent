/* 题解 Markdown 渲染：marked（GFM 表格/列表/引用完整支持）+ 定制渲染器。
 * - ```ac-tabs 约定块 → 多语言页签组件（语言名 → 代码 的 JSON）
 * - 数学式：$...$ 行内 / $$...$$ 块级 → KaTeX（marked 扩展 tokenizer，代码块内不生效）
 * - 原始 HTML 一律转义为可见文本（LLM 输出防注入）
 * - 链接仅放行 http(s)/mailto，其余协议降级为纯文本
 */
import { marked } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import dart from 'highlight.js/lib/languages/dart';
import scala from 'highlight.js/lib/languages/scala';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import lisp from 'highlight.js/lib/languages/lisp';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('elixir', elixir);
hljs.registerLanguage('erlang', erlang);
hljs.registerLanguage('lisp', lisp);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);

/** LC langSlug → highlight.js 语言名（没有对应实现的保持原样） */
const LANG_TO_HLJS = {
  javascript: 'javascript', typescript: 'typescript', python3: 'python', python: 'python',
  cpp: 'cpp', c: 'c', java: 'java', csharp: 'csharp', golang: 'go', go: 'go',
  rust: 'rust', ruby: 'ruby', php: 'php', dart: 'dart', scala: 'scala',
  kotlin: 'kotlin', swift: 'swift', elixir: 'elixir', erlang: 'erlang',
  racket: 'lisp', mysql: 'sql', mssql: 'sql', oraclesql: 'sql', bash: 'bash',
  // ac-tabs 块的键是语言显示名（archiver 以 langLabel 落盘），同步支持反查
  JavaScript: 'javascript', TypeScript: 'typescript', 'Python 3': 'python', Python: 'python',
  'C++': 'cpp', C: 'c', Java: 'java', 'C#': 'csharp', Go: 'go', Golang: 'go',
  Rust: 'rust', Ruby: 'ruby', PHP: 'php', Dart: 'dart', Scala: 'scala',
  Kotlin: 'kotlin', Swift: 'swift', Elixir: 'elixir', Erlang: 'erlang', Racket: 'lisp',
  MySQL: 'sql', 'MS SQL Server': 'sql', Bash: 'bash',
};

/** LC langSlug/显示名 → 复制全部时用的注释前缀 */
const LANG_TO_COMMENT = {
  python3: '#', python: '#', ruby: '#', bash: '#', elixir: '#', 'Python 3': '#', Python: '#',
  Ruby: '#', Bash: '#', Elixir: '#',
  mysql: '--', mssql: '--', oraclesql: '--', MySQL: '--', 'MS SQL Server': '--',
  racket: ';;', Racket: ';;',
};

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** ac-tabs JSON → 页签 HTML（pane 内代码同样转义） */
function renderAcTabs(jsonText) {
  let codes;
  try {
    codes = JSON.parse(jsonText);
  } catch {
    return `<pre><code>${escapeHtml(jsonText)}</code></pre>`;
  }
  const langs = Object.keys(codes);
  if (!langs.length) return '';
  const bar = langs
    .map((l, i) => `<button type="button" data-tab="${i}" class="ac-tab${i === 0 ? ' active' : ''}">${escapeHtml(l)}</button>`)
    .join('') + '<button type="button" class="ac-copy" data-copy-ac>⧉ 复制代码</button>';
  const panes = langs
    .map((l, i) => {
      const code = codes[l] ?? '';
      const hl = LANG_TO_HLJS[l];
      let body;
      try {
        body = hl ? hljs.highlight(code, { language: hl, ignoreIllegals: true }).value : escapeHtml(code);
      } catch {
        body = escapeHtml(code);
      }
      return `<pre class="ac-pane${i === 0 ? ' active' : ''}" data-pane="${i}" data-lang="${escapeHtml(l)}"><code class="hljs">${body}</code></pre>`;
    })
    .join('');
  return `<div class="ac-tabs"><div class="ac-tab-bar">${bar}</div>${panes}</div>`;
}

/** 复制 ac-tabs 当前激活页签的代码（纯代码原文；http 环境回退 execCommand） */
export async function copyAcTabsCode(group) {
  const pane = group.querySelector('.ac-pane.active') ?? group.querySelector('.ac-pane');
  if (!pane) return false;
  const text = pane.textContent ?? '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* http 环境回退 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const safeUrl = (raw) => {
  try {
    const u = new URL(String(raw), 'https://placeholder.invalid');
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? String(raw) : null;
  } catch {
    return null;
  }
};

/** LaTeX → KaTeX HTML（throwOnError=false：非法式子降级为红色原文，不炸整篇渲染） */
function renderMath(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, output: 'html' });
  } catch {
    return escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`);
  }
}

/** 数学式扩展：需要在默认 inline 规则之前吃掉 $…$，避免 _ * \ 被 markdown 规则搅乱 */
const mathExtensions = [
  {
    name: 'blockMath',
    level: 'block',
    start(src) {
      const i = src.indexOf('$$');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
      if (m) return { type: 'blockMath', raw: m[0], tex: m[1].trim() };
      return undefined;
    },
    renderer(token) {
      return `<div class="math-block">${renderMath(token.tex, true)}</div>`;
    },
  },
  {
    name: 'inlineMath',
    level: 'inline',
    start(src) {
      const i = src.indexOf('$');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      // $$…$$（行内块式）优先于 $…$
      const dm = /^\$\$([^$]+?)\$\$/.exec(src);
      if (dm) return { type: 'inlineMath', raw: dm[0], tex: dm[1].trim(), display: true };
      // $…$：开式后一位不能是空白，闭式前一位不能是空白（排除 "$5 和 $10" 这类金额误匹配）
      const im = /^\$(?!\s)((?:\\.|[^\\\n$])+?)(?<!\s)\$(?!\d)/.exec(src);
      if (im) return { type: 'inlineMath', raw: im[0], tex: im[1].trim(), display: false };
      return undefined;
    },
    renderer(token) {
      return renderMath(token.tex, token.display);
    },
  },
];

marked.use({
  gfm: true,
  breaks: false,
  extensions: mathExtensions,
  renderer: {
    code(token) {
      if ((token.lang ?? '').trim() === 'ac-tabs') return renderAcTabs(token.text ?? '');
      return `<pre><code>${escapeHtml(token.text ?? '')}</code></pre>`;
    },
    html(token) {
      return escapeHtml(token.text ?? '');
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens ?? []);
      const href = safeUrl(token.href ?? '');
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    },
    image(token) {
      const href = safeUrl(token.href ?? '');
      const alt = escapeHtml(token.text ?? '');
      return href ? `<img src="${escapeHtml(href)}" alt="${alt}" loading="lazy">` : alt;
    },
  },
});

export function renderMarkdown(md) {
  return marked.parse(String(md ?? ''));
}
