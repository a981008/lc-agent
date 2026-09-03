/* 全局响应式 store + 动作（WS/轮询/REST）——无 pinia 的轻量状态层 */

import { reactive } from 'vue';
import { api, getToken, setToken, clearToken } from './api.js';

export const STAGE_KEYS = ['fetch', 'generate', 'local_test', 'submit', 'translate', 'archive'];

/** leetcode.cn 题目页 */
/** 左侧配置面板当前标签页 */
export function setConfigTab(tab) {
  store.configTab = tab;
}

export function lcProblemUrl(slug) {
  return `https://leetcode.cn/problems/${slug}/`;
}

export const store = reactive({
  configTab: 'strategy',
  authed: false,
  gateError: '',
  gateInput: '',
  status: null,
  conn: { text: 'WS 未连接', muted: true },
  logs: [],
  logSeq: 0,
  lastSeq: 0,
  stages: { fetch: '', generate: '', local_test: '', submit: '', translate: '', archive: '' },
  pipelineSlug: null,
  currentProblem: '（当前无任务）',
  tab: 'problems',
  problems: { items: [], total: 0 },
  languages: [],
  pFilters: { q: '', status: '', difficulty: [], tag: '' },
  sFilters: { q: '', difficulty: [], tag: '' },
  page: 1,
  pageSize: 20,
  solutions: [],
  modal: { open: false, kind: 'solution', html: '', text: '' },
  cookieResult: '',
  forms: {
    mode: 'sequential',
    difficulty: [],
    tag: '',
    session: '',
    csrftoken: '',
    cookieHeader: '',
    llmProtocol: 'openai',
    llmBase: '',
    llmModel: '',
    llmKey: '',
    cooldownEnabled: true,
    cooldownMin: 180,
    cooldownMax: 720,
    dryRun: false,
    quota: 10,
    quotaUnlimited: false,
    translateLangs: ['python3', 'cpp', 'java'],
  },
  _filled: false,
});

/* ---------------- 内部状态 ---------------- */

let ws = null;
let wsBackoff = 1000;
let pollTimer = null;

function resetStages() {
  for (const k of STAGE_KEYS) store.stages[k] = '';
}

/* ---------------- 事件处理 ---------------- */

export function appendLog(level, text) {
  store.logs.push({ id: ++store.logSeq, level, text });
  if (store.logs.length > 800) store.logs.splice(0, store.logs.length - 800);
}

export function markStage(p) {
  if (store.pipelineSlug !== p.slug) {
    resetStages();
    store.pipelineSlug = p.slug;
  }
  if (STAGE_KEYS.includes(p.stage)) store.stages[p.stage] = p.status;
  if (p.status === 'start') store.currentProblem = `当前题目：${p.slug}`;
  if (p.detail) appendLog('debug', `[pipeline] ${p.slug}/${p.stage}: ${p.detail}`);
}
export function handleEvent(e) {
  switch (e.type) {
    case 'log_stream':
      appendLog(e.payload.level || 'info', e.payload.text);
      break;
    case 'state_change': {
      const prev = store.status?.state;
      refreshStatus();
      // 一题结束（IN_PROGRESS → 空闲/冷却）：刷新题目列表（尝试数、三态状态即时更新）
      if (prev === 'IN_PROGRESS' && (e.payload?.to === 'IDLE' || e.payload?.to === 'COOLING')) {
        loadProblems();
      }
      break;
    }
    case 'pipeline_step':
      markStage(e.payload);
      // 归档完成 → AC 题解列表自动刷新（并按当前所在页签即时可见）
      if (e.payload?.stage === 'archive' && e.payload?.status === 'done') {
        loadSolutions();
        loadProblems();
      }
      break;
    case 'attempt_result':
      appendLog('info', `[判题] ${e.payload.slug}: ${e.payload.verdict} ${e.payload.runtime_ms ?? '?'}ms（内存击败 ${e.payload.memory_percentile ?? '?'}%）`);
      break;
    case 'budget_warning':
      appendLog('warn', `[预算] ${JSON.stringify(e.payload)}`);
      break;
  }
}

/* ---------------- 状态轮询 + WS ---------------- */

export async function refreshStatus() {
  try {
    const s = await api('/status');
    store.status = s;
    // 当前题目信息以服务端状态为准（刷新页面后不残留旧文案）
    store.currentProblem = s.currentSlug ? `当前题目：${s.currentSlug}` : '（当前无任务）';
    if (!store._filled) {
      store._filled = true;
      store.forms.mode = s.strategy.mode;
      store.forms.difficulty = [...(s.strategy.difficulty || [])];
      store.forms.llmBase = s.llm.baseUrl || '';
      store.forms.llmModel = s.llm.model || '';
      store.forms.llmProtocol = s.llm.protocol === 'anthropic' ? 'anthropic' : 'openai';
      store.forms.cooldownEnabled = s.limits.cooldown.enabled;
      store.forms.cooldownMin = Math.round(s.limits.cooldown.minMs / 1000);
      store.forms.cooldownMax = Math.round(s.limits.cooldown.maxMs / 1000);
      store.forms.dryRun = s.limits.dryRun;
      store.forms.quota = s.limits.dailySubmitLimit;
      store.forms.quotaUnlimited = s.limits.dailySubmitLimit === 0;
      store.forms.translateLangs = (s.limits.translateLangs || []).map((l) => (l === 'go' ? 'golang' : l));
    }
  } catch (e) {
    if (!e.unauthorized) console.error(e);
  }
}

function connectWs() {
  if (ws) { try { ws.close(); } catch { /* noop */ } }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken())}&last_seq=${store.lastSeq}`);
  ws.onopen = () => { store.conn = { text: 'WS 已连接', muted: false }; wsBackoff = 1000; };
  ws.onclose = () => {
    store.conn = { text: 'WS 未连接', muted: true };
    if (!store.authed) return; // 登出后停止重连
    setTimeout(connectWs, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 2, 15000);
  };
  ws.onmessage = (ev) => {
    let e;
    try { e = JSON.parse(ev.data); } catch { return; }
    if (e.seq && e.seq > store.lastSeq) store.lastSeq = e.seq;
    handleEvent(e);
  };
}

/* ---------------- 会话 ---------------- */

export function logout(msg) {
  store.authed = false;
  store.gateError = msg || '';
  store.status = null;
  store._filled = false;
  clearToken();
  if (ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export async function submitToken() {
  // TokenGate 已把输入写入 store.gateInput
  setToken(store.gateInput.trim());
  await initToken();
}

export async function initToken() {
  if (!getToken()) { logout(); return; }
  try {
    await api('/status');
    store.authed = true;
    store.gateError = '';
    boot();
  } catch (e) {
    if (!e.unauthorized) logout(`连接失败：${e.message}`);
  }
}

/* ---------------- 启动 ---------------- */

function boot() {
  // 断线日志回放：先拉环形缓冲全量，再接 WS 增量
  api('/logs?since_seq=0')
    .then((r) => {
      for (const e of r.events) {
        store.lastSeq = Math.max(store.lastSeq, e.seq);
        handleEvent(e);
      }
      connectWs();
    })
    .catch(() => connectWs());
  refreshStatus();
  loadProblems();
  pollTimer = setInterval(refreshStatus, 5000);
}

/* ---------------- 控制动作 ---------------- */

export async function doResume() {
  try { const r = await api('/control/resume', { method: 'POST' }); appendLog('info', `恢复：${JSON.stringify(r)}`); refreshStatus(); }
  catch (e) { if (!e.unauthorized) appendLog('error', `恢复失败：${e.message}`); }
}

export async function doPause() {
  try { const r = await api('/control/pause', { method: 'POST' }); appendLog('info', `暂停指令：${JSON.stringify(r)}`); refreshStatus(); }
  catch (e) { if (!e.unauthorized) appendLog('error', `暂停失败：${e.message}`); }
}

export async function doHalt() {
  if (!confirm('确认终止？当前题完成后回到 IDLE。')) return;
  try { const r = await api('/control/halt', { method: 'POST' }); appendLog('info', `终止：${JSON.stringify(r)}`); refreshStatus(); }
  catch (e) { if (!e.unauthorized) appendLog('error', `终止失败：${e.message}`); }
}

/** 题目列表「跑这题」：等价于按 slug 触发 Trigger Once（忙时后端 409，原因进日志） */
export async function runProblem(slug) {
  try {
    await api('/control/trigger-once', { method: 'POST', body: JSON.stringify({ slug }) });
    appendLog('info', `已从题目列表触发：${slug}`);
    refreshStatus();
  } catch (e) {
    if (!e.unauthorized) appendLog('error', `触发 ${slug} 失败：${e.message}`);
  }
}

/* ---------------- 策略 / 凭据 / 配置 ---------------- */

/** 从整个 Cookie 请求头中解析需要的两项 */
function parseCookieHeader(header) {
  const get = (name) => {
    const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? m[1].trim() : '';
  };
  return { session: get('LEETCODE_SESSION'), csrftoken: get('csrftoken') };
}

export async function saveStrategy() {
  const body = { mode: store.forms.mode, difficulty: store.forms.difficulty.length ? [...store.forms.difficulty] : undefined };
  const tag = store.forms.tag.trim();
  if (tag && body.mode === 'tag') body.tag = tag;
  try { const r = await api('/control/strategy', { method: 'POST', body: JSON.stringify(body) }); appendLog('info', `策略已保存：${JSON.stringify(r.strategy)}`); }
  catch (e) { if (!e.unauthorized) appendLog('error', `策略保存失败：${e.message}`); }
}

export async function saveCookie() {
  const f = store.forms;
  let session = f.session.trim();
  let csrftoken = f.csrftoken.trim();
  const header = f.cookieHeader.trim();
  if ((!session || !csrftoken) && header) {
    const parsed = parseCookieHeader(header);
    session = parsed.session;
    csrftoken = parsed.csrftoken;
    if (session) f.session = session;
    if (csrftoken) f.csrftoken = csrftoken;
  }
  if (!session || !csrftoken) {
    store.cookieResult = header ? 'Cookie 头中未找到 LEETCODE_SESSION / csrftoken（确认已登录 leetcode.cn）' : '请填写两项或粘贴 Cookie 头';
    return;
  }
  store.cookieResult = '探针中…';
  try {
    const r = await api('/auth/cookie', { method: 'POST', body: JSON.stringify({ session, csrftoken }) });
    store.cookieResult = r.ok ? '✅ 探针通过，Cookie 有效' : `⚠ ${r.probe}: ${r.hint || ''}`;
    refreshStatus();
  } catch (e) { store.cookieResult = e.unauthorized ? '' : `失败：${e.message}`; }
}

export async function saveLlm() {
  const body = { baseUrl: store.forms.llmBase.trim(), model: store.forms.llmModel.trim(), protocol: store.forms.llmProtocol };
  const key = store.forms.llmKey.trim();
  if (key) body.apiKey = key;
  try { await api('/config/llm', { method: 'POST', body: JSON.stringify(body) }); appendLog('info', 'LLM 配置已保存'); store.forms.llmKey = ''; }
  catch (e) { if (!e.unauthorized) appendLog('error', `LLM 配置失败：${e.message}`); }
}

export async function saveLimits() {
  let cdMin = Number(store.forms.cooldownMin);
  let cdMax = Number(store.forms.cooldownMax);
  if (!(cdMin > 0)) cdMin = 180;
  if (!(cdMax > 0)) cdMax = cdMin;
  if (cdMin > cdMax) [cdMin, cdMax] = [cdMax, cdMin]; // min>max 自动交换
  const body = {
    cooldown: {
      enabled: store.forms.cooldownEnabled,
      minMs: Math.round(cdMin * 1000),
      maxMs: Math.round(cdMax * 1000),
    },
    dryRun: store.forms.dryRun,
    dailySubmitLimit: store.forms.quotaUnlimited ? 0 : (Number(store.forms.quota) || 10),
    translateLangs: [...store.forms.translateLangs],
  };
  try { await api('/config/limits', { method: 'POST', body: JSON.stringify(body) }); appendLog('info', '运行参数已保存'); }
  catch (e) { if (!e.unauthorized) appendLog('error', `参数保存失败：${e.message}`); }
}

export async function syncProblems() {
  try { await api('/admin/sync-problems', { method: 'POST' }); appendLog('info', '题库同步已在后台开始'); }
  catch (e) { if (!e.unauthorized) appendLog('error', `同步失败：${e.message}`); }
}

/* ---------------- 题目与题解 ---------------- */

export async function loadProblems() {
  try {
    const f = store.pFilters;
    const qs = new URLSearchParams();
    if (f.q?.trim()) qs.set('q', f.q.trim());
    if (f.status) qs.set('status', f.status);
    if (f.difficulty?.length) qs.set('difficulty', f.difficulty.join(','));
    if (f.tag) qs.set('tag', f.tag);
    const r = await api(`/problems?page=${store.page}&pageSize=${store.pageSize}&${qs}`);
    // 数据变少（如重新同步）后当前页可能越界：回退到最后一页
    const maxPage = Math.max(1, Math.ceil(r.total / store.pageSize));
    if (store.page > maxPage) {
      store.page = maxPage;
      return loadProblems();
    }
    store.problems = { items: r.items, total: r.total };
  } catch (e) { if (!e.unauthorized) appendLog('error', `题目加载失败：${e.message}`); }
}

/** LC 支持的全部提交语言（服务端 24h 缓存；动态获取不写死） */
export async function loadLanguages() {
  try {
    const r = await api('/languages');
    store.languages = [...new Set((r.items ?? []).map((x) => x.slug))].sort();
  } catch (e) { if (!e.unauthorized) appendLog('error', `语言列表加载失败：${e.message}`); }
}

export async function loadSolutions() {
  try {
    const f = store.sFilters;
    const qs = new URLSearchParams();
    if (f.q?.trim()) qs.set('q', f.q.trim());
    if (f.difficulty?.length) qs.set('difficulty', f.difficulty.join(','));
    if (f.tag) qs.set('tag', f.tag);
    const r = await api(`/solutions?${qs}`);
    store.solutions = r.items;
  } catch (e) { if (!e.unauthorized) appendLog('error', `题解加载失败：${e.message}`); }
}

export async function viewAttempts(slug) {
  try {
    const r = await api(`/problems/${slug}/attempts`);
    const lines = r.items.map((a) => `#${a.attempt_id} [${a.kind}] round=${a.round} ${a.verdict ?? '-'} ${new Date(a.created_at).toLocaleTimeString()} ${a.error_digest ?? ''}`);
    store.modal = { open: true, kind: 'attempts', html: '', text: lines.join('\n') || '（无尝试记录）' };
  } catch (e) { if (!e.unauthorized) appendLog('error', `尝试记录加载失败：${e.message}`); }
}

export async function viewSolution(problemId) {
  try {
    const s = await api(`/solutions/${problemId}`);
    const { renderMarkdown } = await import('./markdown.js');
    store.modal = { open: true, kind: 'solution', html: renderMarkdown(s.markdown), text: '' };
  } catch (e) { if (!e.unauthorized) appendLog('error', `题解加载失败：${e.message}`); }
}

export function switchTab(tab) {
  store.tab = tab;
  if (tab === 'solutions') loadSolutions();
}

/** 应用题目列表检索（重置到第 1 页）；清空条件 = 全部 */
export function applyPFilters() {
  store.page = 1;
  loadProblems();
}

/** 应用题解列表检索 */
export function applySFilters() {
  loadSolutions();
}

export function setPageSize(n) {
  const size = [20, 50, 100].includes(Number(n)) ? Number(n) : 20;
  if (store.pageSize === size) return;
  store.pageSize = size;
  store.page = 1;
  loadProblems();
}

export function pagePrev() { if (store.page > 1) { store.page--; loadProblems(); } }
export function pageNext() { store.page++; loadProblems(); }

/* 组件统一引用的动作集合 */
export const actions = {
  setConfigTab, setPageSize,
  initToken, submitToken, logout, refreshStatus,
  doResume, doPause, doHalt, runProblem,
  saveStrategy, saveCookie, saveLlm, saveLimits, syncProblems,
  loadProblems, loadSolutions, viewAttempts, viewSolution, loadLanguages, applyPFilters, applySFilters,
  switchTab, pagePrev, pageNext,
};
