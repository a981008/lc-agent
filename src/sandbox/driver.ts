/**
 * Driver 生成器（docs/06 §3）：
 * 基于 LeetCode 题目元数据（metaData）+ JavaScript 代码模板（codeSnippets）自动生成
 * 「反序列化 → 运行 → 序列化 → 比对」的本地测试脚手架，注入一次性沙盒执行。
 *
 * 类型映射表：int/long/float/double→number；bool→boolean；char/string→string；
 * T[] / List<T> → 数组；ListNode → 链表；TreeNode → 二叉树；Node → 随机指针图或 N 叉树（启发式）。
 * 不可识别的类型一律抛 UnsupportedTypeError → 题目标记 unsupported（docs/06 §3）。
 */

export interface MetaParam {
  name: string;
  type: string;
}

export interface MetaData {
  name: string;
  params: MetaParam[];
  return?: { type: string };
}

export class UnsupportedTypeError extends Error {}

export interface ParsedMeta {
  entryFn: string;
  argNames: string[]; // 真正传给函数的参数名（来自 JS 模板签名）
  params: MetaParam[]; // metaData 全部参数（含 pos 这类未传入参数）
  returnType: string;
}

/** 解析 metaData 与 JS 模板签名 */
export function parseMeta(metaDataStr: string, jsTemplate?: string): ParsedMeta {
  const md = JSON.parse(metaDataStr) as MetaData;
  if (!md?.name || !Array.isArray(md.params)) throw new UnsupportedTypeError('metaData 结构无法解析');
  let argNames = md.params.map((p) => p.name);
  let entryFn = md.name;
  if (jsTemplate) {
    // 兼容两种模板：`function twoSum(...) {}` 与 `var twoSum = function(...) {}`
    const m =
      jsTemplate.match(/function\s+(\w+)\s*\(([^)]*)\)/) ??
      jsTemplate.match(/(?:var|let|const)\s+(\w+)\s*=\s*function\s*\(([^)]*)\)/);
    if (m && m[1] && m[2] !== undefined) {
      entryFn = m[1];
      argNames = m[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // JS 模板签名必须都能在 metaData 里找到对应类型
      const known = new Set(md.params.map((p) => p.name));
      for (const a of argNames) {
        if (!known.has(a)) throw new UnsupportedTypeError(`签名参数 ${a} 不在 metaData 中`);
      }
    }
  }
  return { entryFn, argNames, params: md.params, returnType: md.return?.type ?? 'void' };
}

/* ---------------- 类型树 ---------------- */

type TypeNode =
  | { k: 'number' }
  | { k: 'boolean' }
  | { k: 'string' }
  | { k: 'void' }
  | { k: 'array'; of: TypeNode }
  | { k: 'list' }
  | { k: 'tree' }
  | { k: 'node' } // 随机指针图 / N 叉树（运行时启发式）
  | { k: 'unknown'; raw: string };

export function parseType(raw: string): TypeNode {
  const t = raw.trim();
  const listMatch = t.match(/^(List|ArrayList)<(.+)>$/);
  if (listMatch && listMatch[2]) {
    return { k: 'array', of: parseType(listMatch[2]) };
  }
  if (t.endsWith('[]')) return { k: 'array', of: parseType(t.slice(0, -2)) };
  switch (t) {
    case 'int':
    case 'Integer':
    case 'integer':
    case 'long':
    case 'Long':
    case 'double':
    case 'Double':
    case 'float':
    case 'Float':
      return { k: 'number' };
    case 'bool':
    case 'Boolean':
    case 'boolean':
      return { k: 'boolean' };
    case 'char':
    case 'Character':
    case 'character':
    case 'string':
    case 'String':
    case 'str':
      return { k: 'string' };
    case 'void':
      return { k: 'void' };
    case 'ListNode':
      return { k: 'list' };
    case 'TreeNode':
      return { k: 'tree' };
    case 'Node':
      return { k: 'node' };
    default:
      return { k: 'unknown', raw: t };
  }
}

export function assertSupported(parsed: ParsedMeta): void {
  for (const p of parsed.params) {
    const t = parseType(p.type);
    if (t.k === 'unknown') throw new UnsupportedTypeError(`参数 ${p.name} 类型不支持：${p.type}`);
  }
  const rt = parseType(parsed.returnType);
  if (rt.k === 'unknown') throw new UnsupportedTypeError(`返回类型不支持：${parsed.returnType}`);
}

/* ---------------- 注入沙盒的运行库（预置代码） ---------------- */

export const PRELUDE = String.raw`
'use strict';
class ListNode { constructor(v){ this.val = v; this.next = null; } }
class TreeNode { constructor(v){ this.val = v; this.left = null; this.right = null; } }
class NNode { constructor(v){ this.val = v; this.neighbors = null; this.random = null; this.children = null; } }

function __parseLine(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  return JSON.parse(t.replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false'));
}

function __buildList(arr, pos) {
  const dummy = new ListNode(null);
  let cur = dummy; const nodes = [];
  for (const v of arr) { cur.next = new ListNode(v); cur = cur.next; nodes.push(cur); }
  if (Number.isInteger(pos) && pos >= 0 && pos < nodes.length && nodes.length > 0) {
    nodes[nodes.length - 1].next = nodes[pos]; // 成环
  }
  return dummy.next;
}

function __listToArr(head) {
  const out = []; let cur = head; const seen = new Set();
  while (cur) {
    if (seen.has(cur)) throw new Error('输出链表存在环，无法序列化');
    seen.add(cur); out.push(cur.val); cur = cur.next;
    if (out.length > 100000) throw new Error('输出链表过长');
  }
  return out;
}

function __buildTree(arr) {
  if (!arr || arr.length === 0 || arr[0] === null) return null;
  const root = new TreeNode(arr[0]);
  const q = [root]; let i = 1;
  while (q.length && i < arr.length) {
    const n = q.shift();
    if (i < arr.length) { const v = arr[i++]; if (v !== null) { n.left = new TreeNode(v); q.push(n.left); } }
    if (i < arr.length) { const v = arr[i++]; if (v !== null) { n.right = new TreeNode(v); q.push(n.right); } }
  }
  return root;
}

function __treeToArr(root) {
  const out = []; const q = [root];
  while (q.length) {
    const n = q.shift();
    if (n === null || n === undefined) { out.push(null); continue; }
    out.push(n.val); q.push(n.left); q.push(n.right);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

// Node：随机指针图输入形如 [[7,null],[13,0]]；N 叉树输入形如 [1,null,3,2,4,null,5,6]
function __looksLikeGraph(raw) {
  return Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]);
}

function __buildNode(raw) {
  if (__looksLikeGraph(raw)) {
    const nodes = raw.map(() => new NNode(null));
    for (let i = 0; i < raw.length; i++) {
      const [val, rnd] = raw[i];
      nodes[i].val = val === null ? null : val;
      nodes[i].neighbors = nodes; // 邻接即全表（LC 随机指针约定靠 random 表达）
      if (rnd !== null && rnd !== undefined) nodes[i].random = nodes[rnd] ?? null;
    }
    return nodes.length ? nodes[0] : null;
  }
  // N 叉树：层序 + null 分隔
  if (!raw || raw.length === 0 || raw[0] === null) return null;
  const root = new NNode(raw[0]);
  const q = [root]; let i = 1;
  while (q.length && i < raw.length) {
    const parent = q.shift();
    const kids = [];
    while (i < raw.length && raw[i] !== null) { const c = new NNode(raw[i++]); kids.push(c); q.push(c); }
    i++; // 跳过分隔 null
    parent.neighbors = kids;
  }
  return root;
}

function __nodeToArr(root) {
  // 输出端按图（随机指针）序列化：[[val, randomIdx], ...]
  if (root && root.neighbors && Array.isArray(root.neighbors) && root.neighbors.length > 0 && root.random !== undefined) {
    const nodes = root.neighbors; const idx = new Map(nodes.map((n, i) => [n, i]));
    return nodes.map((n) => [n.val, n.random ? idx.get(n.random) : (n.random === null ? null : undefined)]);
  }
  // N 叉树层序
  const out = []; const q = [root];
  while (q.length) {
    const n = q.shift();
    if (n === null || n === undefined) { out.push(null); continue; }
    out.push(n.val);
    for (const c of (n.children ?? n.neighbors ?? [])) q.push(c);
    if (n.children ?? n.neighbors) out.push(null);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

function __deserialize(type, raw) {
  const v = __parseLine(raw);
  return __deserializeValue(type, v);
}

function __deserializeValue(type, v) {
  if (type.k === 'array') {
    if (!Array.isArray(v)) throw new Error('期望数组输入: ' + JSON.stringify(v));
    return v.map((x) => __deserializeValue(type.of, x));
  }
  if (type.k === 'list') return __buildList(v, undefined);
  if (type.k === 'tree') return __buildTree(v);
  if (type.k === 'node') return __buildNode(v);
  return v; // number / boolean / string
}

function __serialize(type, value) {
  if (value === undefined) return undefined;
  if (type.k === 'array') return value.map((x) => __serialize(type.of, x));
  if (type.k === 'list') return __listToArr(value);
  if (type.k === 'tree') return __treeToArr(value);
  if (type.k === 'node') return __nodeToArr(value);
  return value;
}

function __eqNum(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

function __deepEq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => __deepEq(x, b[i]));
  }
  return __eqNum(a, b);
}
`;

/* ---------------- harness 生成 ---------------- */

export interface DriverCase {
  input: string[]; // 每参数一行原始输入
  expected: string | null; // 权威期望（LC）或预测期望（AI）；null = 仅运行
}

export interface DriverPlan {
  files: Array<{ name: string; content: string }>;
  unsupportedReason?: string;
  parsed?: ParsedMeta;
}

export function buildDriverFiles(parsed: ParsedMeta, userCode: string, cases: DriverCase[]): DriverPlan {
  const metaJson = JSON.stringify(
    parsed.params.map((p) => ({ name: p.name, type: parseType(p.type) }))
  );
  const argNamesJson = JSON.stringify(parsed.argNames);
  const retJson = JSON.stringify(parseType(parsed.returnType));
  const casesJson = JSON.stringify(cases);
  const entry = parsed.entryFn;

  const harness = String.raw`
/* ---- harness ---- */
const __PARAMS = ${metaJson};
const __ARGS = ${argNamesJson};
const __RET = ${retJson};
const __CASES = ${casesJson};
const __fn = typeof ${entry} === 'function' ? ${entry} : null;
if (!__fn) { console.log('__LCA_RESULT__' + JSON.stringify({ cases: [], error: '入口函数 ${entry} 未定义（检查代码模板）' })); process.exit(0); }

const __results = [];
for (let ci = 0; ci < __CASES.length; ci++) {
  const c = __CASES[ci];
  if (c.input.length !== __PARAMS.length) {
    __results.push({ pass: false, error: '输入行数 ' + c.input.length + ' != 参数数 ' + __PARAMS.length + '（可能含不支持的输入结构）' });
    continue;
  }
  try {
    const values = __PARAMS.map((p, i) => __deserializeValue(p.type, __parseLine(c.input[i])));
    // 处理成环输入：metaData 中存在名为 pos 的 int 参数，且存在 ListNode 参数
    const posIdx = __PARAMS.findIndex((p) => p.name === 'pos' && p.type.k === 'number');
    if (posIdx >= 0) {
      const listIdx = __PARAMS.findIndex((p) => p.type.k === 'list');
      if (listIdx >= 0) {
        const arr = __parseLine(c.input[listIdx]);
        const pos = __parseLine(c.input[posIdx]);
        values[listIdx] = __buildList(arr, pos);
      }
    }
    const args = __ARGS.map((name) => { const i = __PARAMS.findIndex((p) => p.name === name); return values[i]; });
    const out = __fn(...args);
    const actual = __RET.k === 'void' ? undefined : __serialize(__RET, out);
    let pass = true; let expectedCanon;
    if (c.expected !== null && c.expected !== undefined && __RET.k !== 'void') {
      expectedCanon = __serialize(__RET, __deserializeValue(__RET, __parseLine(c.expected)));
      pass = __deepEq(actual, expectedCanon);
    }
    __results.push({ pass, actual: JSON.stringify(actual), expected: expectedCanon === undefined ? JSON.stringify(c.expected) : JSON.stringify(expectedCanon) });
  } catch (e) {
    __results.push({ pass: false, error: String((e && e.message) || e) });
  }
}
console.log('__LCA_RESULT__' + JSON.stringify({ cases: __results }));
`;

  const main = `${PRELUDE}\n/* ---- user code ---- */\n${userCode}\n${harness}`;
  return { files: [{ name: 'main.js', content: main }], parsed };
}

/** 便捷封装：metaData 字符串 + JS 模板 + 用例 → 沙盒文件；不支持即返回原因 */
export function prepareRun(metaDataStr: string, jsTemplate: string | undefined, userCode: string, cases: DriverCase[]): DriverPlan {
  let parsed: ParsedMeta;
  try {
    parsed = parseMeta(metaDataStr, jsTemplate);
    assertSupported(parsed);
  } catch (e) {
    if (e instanceof UnsupportedTypeError) return { files: [], unsupportedReason: e.message };
    throw e;
  }
  return buildDriverFiles(parsed, userCode, cases);
}
