import { prepareRun } from '../src/sandbox/driver.js';
import { SandboxRunner } from '../src/sandbox/runner.js';
import { LeetCodeClient, htmlToText, parseVerdict } from '../src/leetcode/client.js';
import { loadEnv, env, ensureDirs } from '../src/config.js';

/**
 * 无凭据自测（scripts/selftest.ts）：
 * 1. driver 黄金用例：数组 / 链表 / 二叉树 / 字符串数组 / 成环输入
 * 2. 沙盒：一次性容器运行 + 超时防护
 * 3. LC 匿名接口：题单分页 / twoSum 详情 / metaData 解析
 * 4. （可选）LLM 连通性：配置 .env SELFTEST_LLM_* 时执行
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

const META_TWO_SUM = JSON.stringify({
  name: 'twoSum',
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  return: { type: 'int[]' },
});
const JS_TWO_SUM = 'var twoSum = function(nums, target) {\n  \n};';

const META_REVERSE_LIST = JSON.stringify({
  name: 'reverseList',
  params: [{ name: 'head', type: 'ListNode' }],
  return: { type: 'ListNode' },
});
const JS_REVERSE_LIST = 'var reverseList = function(head) {\n  \n};';

const META_INVERT_TREE = JSON.stringify({
  name: 'invertTree',
  params: [{ name: 'root', type: 'TreeNode' }],
  return: { type: 'TreeNode' },
});
const JS_INVERT_TREE = 'var invertTree = function(root) {\n  \n};';

const META_HAS_CYCLE = JSON.stringify({
  name: 'hasCycle',
  params: [
    { name: 'head', type: 'ListNode' },
    { name: 'pos', type: 'int' },
  ],
  return: { type: 'boolean' },
});
const JS_HAS_CYCLE = 'var hasCycle = function(head) {\n  \n};';

async function testDriverGolden(sandbox: SandboxRunner): Promise<void> {
  console.log('\n[1] driver 黄金用例');

  // 1.1 twoSum 正确解
  {
    const code = 'var twoSum = function(nums, target) { const m=new Map(); for(let i=0;i<nums.length;i++){ const c=target-nums[i]; if(m.has(c)) return [m.get(c), i]; m.set(nums[i], i);} return []; };';
    const plan = prepareRun(META_TWO_SUM, JS_TWO_SUM, code, [
      { input: ['[2,7,11,15]', '9'], expected: '[0,1]' },
      { input: ['[3,2,4]', '6'], expected: '[1,2]' },
      { input: ['[3,3]', '6'], expected: '[0,1]' },
    ]);
    const r = await sandbox.run(plan.files);
    const allPass = r.ok && r.result?.cases.every((c) => c.pass);
    check('twoSum 正确解 3 用例全过', Boolean(allPass), JSON.stringify(r.result ?? r.stderrTail).slice(0, 200));
  }

  // 1.2 twoSum 错误解 → 必须检出失败
  {
    const wrong = 'var twoSum = function(nums, target) { return [0, 0]; };';
    const plan = prepareRun(META_TWO_SUM, JS_TWO_SUM, wrong, [
      { input: ['[2,7,11,15]', '9'], expected: '[0,1]' },
    ]);
    const r = await sandbox.run(plan.files);
    const detected = r.ok && r.result?.cases[0]?.pass === false;
    check('twoSum 错误解被检出', Boolean(detected), JSON.stringify(r.result ?? r.stderrTail).slice(0, 200));
  }

  // 1.3 反转链表
  {
    const code = 'var reverseList = function(head) { let prev=null; while(head){ const n=head.next; head.next=prev; prev=head; head=n; } return prev; };';
    const plan = prepareRun(META_REVERSE_LIST, JS_REVERSE_LIST, code, [
      { input: ['[1,2,3,4,5]'], expected: '[5,4,3,2,1]' },
      { input: ['[]'], expected: '[]' },
    ]);
    const r = await sandbox.run(plan.files);
    const allPass = r.ok && r.result?.cases.every((c) => c.pass);
    check('reverseList（ListNode 往返）', Boolean(allPass), JSON.stringify(r.result ?? r.stderrTail).slice(0, 200));
  }

  // 1.4 反转二叉树
  {
    const code = 'var invertTree = function(root) { if(!root) return null; const l=root.left; root.left=invertTree(root.right); root.right=invertTree(l); return root; };';
    const plan = prepareRun(META_INVERT_TREE, JS_INVERT_TREE, code, [
      { input: ['[4,2,7,1,3,6,9]'], expected: '[4,7,2,9,6,3,1]' },
    ]);
    const r = await sandbox.run(plan.files);
    const allPass = r.ok && r.result?.cases.every((c) => c.pass);
    check('invertTree（TreeNode 往返）', Boolean(allPass), JSON.stringify(r.result ?? r.stderrTail).slice(0, 200));
  }

  // 1.5 环形链表（pos 处理）
  {
    const code = 'var hasCycle = function(head) { let slow=head, fast=head; while(fast && fast.next){ slow=slow.next; fast=fast.next.next; if(slow===fast) return true; } return false; };';
    const plan = prepareRun(META_HAS_CYCLE, JS_HAS_CYCLE, code, [
      { input: ['[3,2,0,-4]', '1'], expected: 'true' },
      { input: ['[1,2]', '0'], expected: 'true' },
      { input: ['[1]', '-1'], expected: 'false' },
    ]);
    const r = await sandbox.run(plan.files);
    const allPass = r.ok && r.result?.cases.every((c) => c.pass);
    check('hasCycle（pos 成环输入）', Boolean(allPass), JSON.stringify(r.result ?? r.stderrTail).slice(0, 300));
  }

  // 1.6 死循环防护（超时门限）
  {
    const plan = prepareRun(META_TWO_SUM, JS_TWO_SUM, 'var twoSum = function(nums, target) { while(true){} };', [
      { input: ['[1]', '2'], expected: '[0]' },
    ]);
    const r = await sandbox.run(plan.files, { wallTimeoutMs: 12000 });
    check('死循环被沙盒门限拦截', r.timeout === true || r.ok === false, `timeout=${r.timeout} ok=${r.ok}`);
  }
}

async function testLcAnonymous(): Promise<void> {
  console.log('\n[2] LeetCode 匿名接口（leetcode.cn）');
  const lc = new LeetCodeClient(() => null, { getMinIntervalMs: () => 3000 });

  try {
    const q = await lc.getQuestion('two-sum');
    check('questionDetail(two-sum) 拉取', q.questionId === '1' && q.metaData.length > 10, `id=${q.questionId}`);
    const text = htmlToText(q.translatedContent || q.content);
    check('题面 HTML→文本', text.includes('整数数组') || text.toLowerCase().includes('array'), text.slice(0, 80));
    const js = q.codeSnippets?.find((s) => s.langSlug === 'javascript');
    check(
      'JavaScript 模板存在',
      Boolean(js && /(function|var|let|const)[\s\S]*twoSum[\s\S]*function\s*\(/.test(js?.code ?? '')),
      js?.code.slice(0, 60)
    );
    // leetcode.cn 的 exampleTestcases 是按行拼接的原始串（每用例 paramCount 行），非 JSON 数组
    check('样例格式（行拼接原始串）', (q.exampleTestcases ?? '').includes('\n') && q.exampleTestcases.includes('[3,3]'), q.exampleTestcases.slice(0, 60));
  } catch (e) {
    check('questionDetail(two-sum) 拉取', false, (e as Error).message);
  }

  try {
    let first = 0;
    const rows = await lc.listAllProblems((synced) => {
      if (first === 0) first = synced;
    });
    check('题单同步（全量分页）', rows.length > 2000, `共 ${rows.length}`);
    const twoSum = rows.find((r) => r.slug === 'two-sum');
    const twoSumOk = twoSum !== undefined && twoSum.frontendQuestionId === '1';
    check('题单含 two-sum 元数据', twoSumOk, JSON.stringify(twoSum ?? {}).slice(0, 120));
    void first;
  } catch (e) {
    check('题单同步（全量分页）', false, (e as Error).message);
  }
}

/** 判题回执解析的回归锁定（docs/10：WA 回填依赖 last_testcase 形态解析） */
function testVerdictParsing(): void {
  console.log('\n[3] 判题回执解析（离线形态回归）');
  // 就绪中状态
  const pending = parseVerdict({ state: 'PENDING' });
  check('PENDING 状态', pending.state === 'PENDING' && pending.statusCode === null, JSON.stringify(pending.statusCode));
  // AC（cn 数字型 runtime/memory + 百分位小数）
  const ac = parseVerdict({
    state: 'FINISHED', status_code: 10, status_msg: 'Accepted',
    runtime: 52, runtime_percentile: 84.53, memory: 41520000, memory_percentile: 50.12,
    total_correct: 58, total_testcases: 58,
  });
  check('AC 形态解析', ac.statusCode === 10 && ac.statusMsg === 'Accepted' && ac.totalCorrect === 58 && ac.runtimePercentile === 84.53, JSON.stringify(ac));
  // cn 真实回执形态：state=SUCCESS + finished:true + 无 runtime 字段（时长在 status_runtime）
  const cnAc = parseVerdict({
    state: 'SUCCESS', finished: true, status_code: 10, status_msg: 'Accepted',
    status_runtime: '2 ms', display_runtime: '2', memory: 57084000, elapsed_time: 96,
    runtime_percentile: 90.6856, memory_percentile: 34.36,
    total_correct: 65, total_testcases: 65, last_testcase: '', code_output: '',
  });
  check(
    'cn SUCCESS 形态解析',
    cnAc.state === 'SUCCESS' && cnAc.statusCode === 10 && cnAc.totalCorrect === 65 && cnAc.runtimeMs === 2 && cnAc.failingInput === null,
    JSON.stringify(cnAc)
  );
  // WA（嵌套 last_testcase）
  const waNested = parseVerdict({
    state: 'FINISHED', status_code: 11, status_msg: 'Wrong Answer',
    total_correct: 17, total_testcases: 58,
    last_testcase: { input: '[2,7,11,15]\n9', expected_output: '[0,1]', code_output: '[1,0]' },
  });
  check(
    'WA 嵌套形态解析',
    waNested.statusCode === 11 && waNested.failingInput === '[2,7,11,15]\n9' && waNested.expectedOutput === '[0,1]' && waNested.codeOutput === '[1,0]',
    JSON.stringify(waNested)
  );
  // WA（平铺形态：last_testcase 为原始串）
  const waFlat = parseVerdict({
    state: 'FINISHED', status_code: 11,
    last_testcase: '[3,2,4]\n6', expected_output: '[1,2]', code_output: '[0,0]',
  });
  check('WA 平铺形态解析', waFlat.failingInput === '[3,2,4]\n6' && waFlat.expectedOutput === '[1,2]' && waFlat.codeOutput === '[0,0]', JSON.stringify(waFlat));
  // 带单位字符串的 runtime
  const unitStr = parseVerdict({ state: 'FINISHED', status_code: 10, runtime: '52 ms', memory: '41.52 MB' });
  check('带单位字段解析', unitStr.runtimeMs === 52 && unitStr.memoryKb === 41.52, JSON.stringify(unitStr));
  // TLE（无失败用例输入——分流不得误用）
  const tle = parseVerdict({ state: 'FINISHED', status_code: 14, status_msg: 'Time Limit Exceeded', total_correct: 40, total_testcases: 58 });
  check('TLE 无输入', tle.statusCode === 14 && tle.failingInput === null && tle.expectedOutput === null, JSON.stringify(tle));
}

/** 多语言页签约定：archiver 的 ac-tabs 块 + 前端渲染器闭环 */
async function testAcTabs(): Promise<void> {
  console.log('\n[4] 多语言页签（ac-tabs 约定闭环）');
  const { buildAcTabsBlock } = await import('../src/engine/archiver.js');
  // @ts-expect-error 前端 JS 模块无类型声明
  const { renderMarkdown } = (await import('../web/src/markdown.js')) as { renderMarkdown: (md: string) => string };

  const codes = { JavaScript: 'var f=(x)=>x;', 'Python 3': 'class Solution:\n    def f(self, x): return x', 'C++': 'int f(int x){return x;} // i-->0' };
  const md = `# 题\n\n思路说明。\n\n## AC 代码\n\n${buildAcTabsBlock(codes)}\n`;
  const html = renderMarkdown(md);
  const paneCount = (html.match(/class="ac-pane/g) || []).length;
  check('页签组件生成', html.includes('ac-tabs') && html.includes('ac-tab-bar') && paneCount === 3, `${paneCount} 个 pane`);
  check('页签标题', html.includes('>JavaScript<') && html.includes('>Python 3<') && html.includes('>C++<'), '三个语言页签');
  check('代码转义防注入', html.includes('=&gt;') && html.includes('i--&gt;0'), 'HTML 特殊字符已转义');
  check('C++ 箭头完好（i-->0）', html.includes('i--&gt;0'), '--> 未破坏结构');
  check('旧版纯代码块兼容', renderMarkdown('```javascript\nvar a=1;\n```').includes('<pre><code>'), '无 ac-tabs 的旧题解仍正常');
  check('非法 JSON 回退代码块', renderMarkdown('```ac-tabs\nnot-json\n```').includes('<pre><code>not-json</code></pre>'), '容错处理');
  check('GFM 表格渲染', renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |').includes('<table>'), '不再裸管道文本');
  check('列表包裹', renderMarkdown('1. one\n2. two').includes('<ol>') && renderMarkdown('- x\n- y').includes('<ul>'), '有序/无序列表');
  check('原始 HTML 转义', renderMarkdown('<script>alert(1)</script>').includes('&lt;script&gt;'), 'LLM 输出防注入');
  check('javascript: 链接降级', !renderMarkdown('[点我](javascript:alert(1))').includes('javascript:'), '协议白名单');
  check('正常链接保留', renderMarkdown('[LC](https://leetcode.cn)').includes('href="https://leetcode.cn"'), 'http(s) 可用');
}

/** 冷却可配置：mergeLimits 深合并/清洗 + clamp 对已锚定冷却即时生效 */
async function testCooldownConfig(): Promise<void> {
  console.log('\n[5] 冷却配置（可配 + 即时生效）');
  const { sampleCooldown, StateMachine } = await import('../src/state/machine.js');
  const { mergeLimits, LIMITS_DEFAULTS } = await import('../src/config.js');

  check('min==max 采样恒定', sampleCooldown({ enabled: true, muMs: 0, sigmaMs: 0, minMs: 300000, maxMs: 300000 }) === 300000, '恒 300s');
  check('采样落在 [min,max]', (() => {
    for (let i = 0; i < 200; i++) {
      const v = sampleCooldown(LIMITS_DEFAULTS.cooldown);
      if (v < LIMITS_DEFAULTS.cooldown.minMs || v > LIMITS_DEFAULTS.cooldown.maxMs) return false;
    }
    return true;
  })(), '200 次采样越界检查');

  // mergeLimits：面板只传 enabled 不得丢参数（回归浅合并缺陷）
  const m1 = mergeLimits(LIMITS_DEFAULTS, { cooldown: { enabled: false } } as never);
  check('深合并不丢冷却参数', m1.cooldown.enabled === false && m1.cooldown.minMs === LIMITS_DEFAULTS.cooldown.minMs && m1.cooldown.muMs === LIMITS_DEFAULTS.cooldown.muMs, 'enabled 与参数共存');
  const m2 = mergeLimits(LIMITS_DEFAULTS, { cooldown: { minMs: 600000, maxMs: 120000 } } as never);
  check('min>max 自动交换', m2.cooldown.minMs === 120000 && m2.cooldown.maxMs === 600000, `min=${m2.cooldown.minMs}`);
  const m3 = mergeLimits(LIMITS_DEFAULTS, { cooldown: { minMs: Number.NaN } } as never);
  check('非法数值回退默认', m3.cooldown.minMs === LIMITS_DEFAULTS.cooldown.minMs, `min=${m3.cooldown.minMs}`);
  const m4 = mergeLimits({ ...LIMITS_DEFAULTS }, { cooldown: { minMs: 30000, maxMs: 60000 } } as never);
  check('收缩区间不改写 μ', m4.cooldown.muMs === LIMITS_DEFAULTS.cooldown.muMs, `mu=${m4.cooldown.muMs}`);

  // 状态机：修改 max 对已锚定冷却即时收缩
  let cfg = { enabled: true, muMs: 420000, sigmaMs: 0, minMs: 180000, maxMs: 720000 };
  const kv = new Map<string, unknown>();
  const machine = new StateMachine(
    ((k: string, f: unknown) => (kv.has(k) ? kv.get(k) : f)) as never,
    ((k: string, v: unknown) => void kv.set(k, v)) as never,
    () => cfg
  );
  const anchored = machine.anchorCooldown();
  check('锚定值=μ（σ=0）', anchored === 420000, `${anchored}ms`);
  cfg = { ...cfg, maxMs: 300000 }; // 用户把上限缩到 5 分钟
  check('max 收缩即时生效', machine.cooldownRemainingMs() <= 300000, `${Math.round(machine.cooldownRemainingMs() / 1000)}s`);
  cfg = { ...cfg, maxMs: 720000, minMs: 600000 }; // 抬高下限到 10 分钟
  check('min 抬高即时生效', machine.cooldownRemainingMs() >= 600000 - 1000, `${Math.round(machine.cooldownRemainingMs() / 1000)}s`);
  check('禁用开关即时归零', ((cfg = { ...cfg, enabled: false }), machine.cooldownRemainingMs() === 0), '0ms');
}

/** 翻译语言解析：all 语义 / 显式交集 / 旧 go 归一化 */
async function testTranslateTargets(): Promise<void> {
  console.log('\n[9] 翻译语言解析');
  const { resolveTranslateTargets } = await import('../src/engine/worker.js');
  const q = { codeSnippets: [{ langSlug: 'javascript' }, { langSlug: 'python3' }, { langSlug: 'golang' }, { langSlug: 'cangjie' }] };

  const all = resolveTranslateTargets(['all'], q, 'javascript');
  check("'all' 解析为站点全部语言（除主语言）", JSON.stringify(all) === JSON.stringify(['python3', 'golang', 'cangjie']), JSON.stringify(all));

  const picked = resolveTranslateTargets(['python3', 'rust', 'go'], q, 'javascript');
  check('显式列表取交集 + 旧 go 归一化 golang', JSON.stringify(picked) === JSON.stringify(['python3', 'golang']), JSON.stringify(picked));

  const withJs = resolveTranslateTargets(['javascript', 'python3'], q, 'javascript');
  check('主提交语言被剔除', JSON.stringify(withJs) === JSON.stringify(['python3']), JSON.stringify(withJs));
}

/** ac-tabs 增强：语法高亮 + 复制全部按钮 */
async function testAcTabsEnhancements(): Promise<void> {
  console.log('\n[10] ac-tabs 高亮与复制');
  // @ts-expect-error 前端 JS 模块无类型声明
  const { renderMarkdown } = (await import('../web/src/markdown.js')) as { renderMarkdown: (md: string) => string };
  const md = '```ac-tabs\n' + JSON.stringify({ JavaScript: 'var x = 1;', 'Python 3': 'x = 1\n' }) + '\n```';
  const html = renderMarkdown(md);
  check('代码语法高亮（hljs 标记）', html.includes('hljs-keyword') || html.includes('hljs'), 'hljs 类出现 ' + (html.match(/hljs/g) ?? []).length + ' 次');
  check('「复制全部」按钮存在', html.includes('ac-copy') && html.includes('复制全部'), '按钮 OK');
  check('pane 带语言标识（复制排序用）', html.includes('data-lang="JavaScript"'), 'data-lang OK');
}

/** 数学式：$…$ / $$…$$ 走 KaTeX，代码块内保持原样 */
async function testMathRender(): Promise<void> {
  console.log('\n[8] 数学式渲染');
  // @ts-expect-error 前端 JS 模块无类型声明
  const { renderMarkdown: md } = (await import('../web/src/markdown.js')) as { renderMarkdown: (md: string) => string };

  const inline = md('复杂度为 $n^2$ 的算法');
  check('行内 $n^2$ 渲染为 KaTeX', inline.includes('katex') && inline.includes('n'), inline.slice(0, 80));

  const block = md('$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$');
  check('块级 $$…$$ 渲染 display 模式', block.includes('math-block') && block.includes('katex-display'), block.slice(0, 80));

  const code = md('```bash\necho $HOME cost $5\n```');
  check('代码块内 $ 不触发数学渲染', !code.includes('katex') && code.includes('$HOME'), code.slice(0, 80));

  const literal = md('价格是 $5 和 $10');
  check('未配对的 $ 保持原文', !literal.includes('katex'), literal.slice(0, 80));
}

/** env 动态读取：.env 加载时序无关（回归：BIND 曾因模块快照失效） */
async function testEnvGetters(): Promise<void> {
  console.log('\n[7] env 动态读取');
  const { env } = await import('../src/config.js');
  process.env.BIND = '0.0.0.0';
  process.env.PORT = '3999';
  check('修改 process.env 即时生效', env.bind === '0.0.0.0' && env.port === 3999, `bind=${env.bind} port=${env.port}`);
  delete process.env.BIND;
  delete process.env.PORT;
  check('未设置时回退默认', env.bind === '127.0.0.1' && env.port === 3081, `bind=${env.bind} port=${env.port}`);
}

/** 原题链接注入：归档正文含 leetcode.cn 链接且渲染为 <a> */
async function testLcLink(): Promise<void> {
  console.log('\n[6] 原题链接注入');
  const { withLcLink } = await import('../src/engine/archiver.js');
  // @ts-expect-error 前端 JS 模块无类型声明
  const { renderMarkdown } = (await import('../web/src/markdown.js')) as { renderMarkdown: (md: string) => string };

  const md1 = withLcLink('# 66. 加一\n\n## 思路\n正文', 'plus-one', '66. 加一');
  check('标题后插入链接', md1.startsWith('# 66. 加一\n\n> 原题链接：[66. 加一](https://leetcode.cn/problems/plus-one/)\n\n## 思路'), '位置与格式');
  const md2 = withLcLink('无标题正文', 'two-sum', '');
  check('无标题前置链接', md2.startsWith('> 原题链接：[two-sum](https://leetcode.cn/problems/two-sum/)\n\n无标题正文'), '回退 slug');
  const md3 = withLcLink('# 已有链接\n\n> 原题链接：[x](https://leetcode.cn/problems/y/)\n', 'y', 'x');
  check('幂等（不重复插入）', (md3.match(/原题链接/g) || []).length === 1, '单次出现');
  check('渲染为 <a>', renderMarkdown(md1).includes('<a href="https://leetcode.cn/problems/plus-one/"'), '前端可点击');
}

async function testLlm(): Promise<void> {
  const baseUrl = process.env.SELFTEST_LLM_BASE_URL;
  const apiKey = process.env.SELFTEST_LLM_API_KEY;
  const model = process.env.SELFTEST_LLM_MODEL;
  if (!baseUrl || !apiKey || !model) {
    console.log('\n[11] LLM 连通性：未设置 SELFTEST_LLM_* 环境变量，跳过');
    return;
  }
  console.log('\n[11] LLM 连通性');
  const { AiClient } = await import('../src/ai/client.js');
  const { BudgetManager } = await import('../src/budget.js');
  const mem = new Map<string, unknown>();
  const budget = new BudgetManager(
    (k, f) => (mem.has(k) ? mem.get(k) : f) as never,
    (k, v) => mem.set(k, v),
    () => 1_000_000
  );
  const ai = new AiClient(() => ({ baseUrl, apiKey, model }), budget);
  try {
    const out = await ai.chat([{ role: 'user', content: '回复 JSON：{"ok":true}' }], { maxTokens: 50 });
    check('LLM chat 连通', out.content.length > 0, out.content.slice(0, 60));
  } catch (e) {
    check('LLM chat 连通', false, (e as Error).message);
  }
}

async function main(): Promise<void> {
  loadEnv();
  ensureDirs();
  console.log('=== lc-agent 无凭据自测 ===');
  console.log(`数据目录: ${env.dataDir}`);

  // 沙盒镜像就绪
  const sandbox = new SandboxRunner();
  console.log('\n[0] 沙盒镜像准备');
  try {
    await sandbox.ensureImage();
    check('沙盒镜像存在/构建成功', true);
  } catch (e) {
    check('沙盒镜像存在/构建成功', false, (e as Error).message);
    console.log('（无沙盒无法继续 driver 测试）');
    process.exit(1);
  }

  await testDriverGolden(sandbox);
  await testLcAnonymous();
  testVerdictParsing();
  await testAcTabs();
  await testCooldownConfig();
  await testLcLink();
  await testEnvGetters();
  await testMathRender();
  await testTranslateTargets();
  await testAcTabsEnhancements();
  await testLlm();

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('自测脚本异常：', e);
  process.exit(1);
});
