import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../events.js';
import { env } from '../config.js';

/**
 * HTTP/WS 鉴权（docs/09 §3）：默认开启 Token 认证，仅绑定 127.0.0.1。
 * - Token：ADMIN_TOKEN env 优先，否则首次启动自动生成并持久化。
 * - /api/* 一律需要 Bearer；静态面板资源放行（页面本身不含数据，凭据由前端 localStorage 携带）。
 */

let cached: string | null = null;

export function resolveAdminToken(getMeta: <T>(k: string, f: T) => T, setMeta: (k: string, v: unknown) => void): string {
  if (cached) return cached;
  const envToken = process.env.ADMIN_TOKEN?.trim();
  if (envToken) {
    cached = envToken;
    return cached;
  }
  const stored = getMeta<string | null>('auth:dashboard-token', null);
  if (stored) {
    cached = stored;
    return cached;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  setMeta('auth:dashboard-token', token);
  cached = token;
  return token;
}

export function requireBearer(token: string): (req: { headers: Record<string, string | string[] | undefined> }, res: { status: (n: number) => { json: (v: unknown) => void } }, next: () => void) => void {
  return (req, res, next) => {
    const h = req.headers['authorization'] ?? req.headers['Authorization'];
    const value = Array.isArray(h) ? h[0] : h;
    if (value === `Bearer ${token}`) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}

export function checkWsToken(url: string, token: string): boolean {
  try {
    const u = new URL(url, 'http://x');
    return u.searchParams.get('token') === token;
  } catch {
    return false;
  }
}

export function announceToken(token: string, port: number, bind: string): void {
  const file = path.join(env.dataDir, 'dashboard-token.txt');
  try {
    fs.writeFileSync(file, token, { mode: 0o600 });
  } catch {
    /* ignore */
  }
  log(`Dashboard: http://${bind}:${port}  访问 Token: ${token}（已写入 ${file}）`);
}
