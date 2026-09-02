/* 题解 Markdown 渲染：marked（GFM 表格/列表/引用完整支持）+ 定制渲染器。
 * - ```ac-tabs 约定块 → 多语言页签组件（语言名 → 代码 的 JSON）
 * - 原始 HTML 一律转义为可见文本（LLM 输出防注入）
 * - 链接仅放行 http(s)/mailto，其余协议降级为纯文本
 */
import { marked } from 'marked';

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
    .join('');
  const panes = langs
    .map((l, i) => `<pre class="ac-pane${i === 0 ? ' active' : ''}" data-pane="${i}"><code>${escapeHtml(codes[l] ?? '')}</code></pre>`)
    .join('');
  return `<div class="ac-tabs"><div class="ac-tab-bar">${bar}</div>${panes}</div>`;
}

const safeUrl = (raw) => {
  try {
    const u = new URL(String(raw), 'https://placeholder.invalid');
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? String(raw) : null;
  } catch {
    return null;
  }
};

marked.use({
  gfm: true,
  breaks: false,
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
