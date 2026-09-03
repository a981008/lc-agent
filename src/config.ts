import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 配置加载与敏感信息加密。
 * - 环境变量来自 .env（若存在）与进程 env，进程 env 优先。
 * - 敏感值（Cookie / LLM Key）落库前用 AES-256-GCM 加密，密钥来自 SECRET_KEY 或 data/secret.key。
 * - 可调参数（冷却、配额、预算等）存于 runtime_state，运行时可经 API 修改。
 */

export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * env 用 getter 动态读取（而非模块加载时快照）：
 * ESM import 先于 index.ts 的 loadEnv() 执行，静态快照会让 .env 的
 * BIND/PORT/SECRET_KEY/DATA_DIR/SANDBOX_IMAGE 全部失效（访问时 .env 已加载）。
 */
export const env = {
  get port(): number { return Number(process.env.PORT ?? 3081); },
  get bind(): string { return process.env.BIND ?? '127.0.0.1'; },
  get dataDir(): string { return path.resolve(process.env.DATA_DIR ?? './data'); },
  get secretKey(): string { return process.env.SECRET_KEY ?? ''; },
  get adminToken(): string { return process.env.ADMIN_TOKEN ?? ''; },
  get sandboxImage(): string { return process.env.SANDBOX_IMAGE ?? 'lc-agent-sandbox:latest'; },
};

export function ensureDirs(): void {
  for (const sub of ['', 'solutions', 'sandbox-tmp']) {
    fs.mkdirSync(path.join(env.dataDir, sub), { recursive: true });
  }
}

/* ---------------- secrets: AES-256-GCM ---------------- */

function loadOrCreateSecretKey(): Buffer {
  if (env.secretKey) {
    return crypto.createHash('sha256').update(env.secretKey).digest();
  }
  const keyFile = path.join(env.dataDir, 'secret.key');
  if (fs.existsSync(keyFile)) {
    return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  return key;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  cachedKey ??= loadOrCreateSecretKey();
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [version, ivB64, tagB64, ctB64] = enc.split(/[:.]/);
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('bad secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(s: string): string {
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

/* ---------------- 可调参数（默认值；运行期覆盖存 runtime_state） ---------------- */

export interface LimitsConfig {
  cooldown: { enabled: boolean; muMs: number; sigmaMs: number; minMs: number; maxMs: number };
  /** 每日提交配额；0 = 无限制 */
  dailySubmitLimit: number;
  runWindow: { enabled: boolean; start: string; end: string }; // HH:mm，end 可为 "24:00"
  minRequestIntervalMs: number;
  selfDebugRounds: number;
  maxSubmits: number;
  skipRetryDays: number;
  llmPerProblemCalls: number;
  llmDailyTokenLimit: number;
  submitLang: string;
  /** AC 后翻译并提交的其他语言（langSlug 列表；空数组=禁用）。注意：每个语言都是真实提交，计入每日配额 */
  translateLangs: string[];
  notifyWebhook: string;
  dryRun: boolean;
}

export const LIMITS_DEFAULTS: LimitsConfig = {
  cooldown: { enabled: true, muMs: 7 * 60_000, sigmaMs: 2 * 60_000, minMs: 3 * 60_000, maxMs: 12 * 60_000 },
  dailySubmitLimit: 10,
  runWindow: { enabled: false, start: '08:00', end: '24:00' },
  minRequestIntervalMs: 5000,
  selfDebugRounds: 4,
  maxSubmits: 2,
  skipRetryDays: 7,
  llmPerProblemCalls: 8,
  llmDailyTokenLimit: 2_000_000,
  submitLang: 'javascript',
  // Go 的正确 slug 是 golang；全语言用 ['all']
  translateLangs: ['python3', 'cpp', 'java'],
  notifyWebhook: '',
  dryRun: false,
};

const numOr = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);

/**
 * limits 合并（POST /api/config/limits 用）：cooldown 子对象深合并，
 * 数值清洗（非法回退默认值）并约束 minMs <= muMs <= maxMs。
 * 修复浅合并缺陷：此前面板仅回传 cooldown.enabled 会把 mu/sigma/min/max 覆盖丢失。
 */
export function mergeLimits(prev: LimitsConfig, patch?: Partial<LimitsConfig>): LimitsConfig {
  const p = patch ?? {};
  const cd = { ...prev.cooldown, ...(p.cooldown ?? {}) };
  cd.muMs = numOr(cd.muMs, LIMITS_DEFAULTS.cooldown.muMs);
  cd.sigmaMs = Math.max(0, numOr(cd.sigmaMs, LIMITS_DEFAULTS.cooldown.sigmaMs));
  cd.minMs = Math.max(0, numOr(cd.minMs, LIMITS_DEFAULTS.cooldown.minMs));
  cd.maxMs = Math.max(0, numOr(cd.maxMs, LIMITS_DEFAULTS.cooldown.maxMs));
  if (cd.minMs > cd.maxMs) [cd.minMs, cd.maxMs] = [cd.maxMs, cd.minMs]; // min>max 自动交换
  // μ 不随 [min,max] 收缩被永久钳制：采样时 sampleCooldown 会按区间截断结果
  cd.enabled = Boolean(cd.enabled);
  const translateLangs = Array.isArray(p.translateLangs)
    ? p.translateLangs.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : prev.translateLangs;
  return {
    ...prev,
    ...p,
    cooldown: cd,
    // 0 = 无限制；负数回退默认 10
    dailySubmitLimit: (() => { const q = numOr(p.dailySubmitLimit, prev.dailySubmitLimit); return q < 0 ? 10 : Math.min(1000, q); })(),
    translateLangs,
  };
}
