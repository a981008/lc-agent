import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config.js';
import { log } from '../events.js';

/**
 * 本地沙盒（docs/06 §2 安全模型的容器实现）：
 * - 一次性容器：--network none / --read-only / 内存与 CPU 双门限 / pids-limit / cap-drop ALL / 非特权用户
 * - 题目输入与代码经只读挂载注入；结果经 stdout 单行 sentinel 回传
 * - 硬门限：RLIMIT_CPU + 墙钟超时双保险
 */

export interface SandboxFile {
  name: string;
  content: string;
}

export interface SandboxResult {
  ok: boolean; // 进程跑完并产出可解析结果
  timeout: boolean;
  exitCode: number | null;
  stderrTail: string;
  result: {
    cases: Array<{ pass: boolean; actual?: string; expected?: string; error?: string }>;
    error?: string;
  } | null;
}

const RESULT_SENTINEL = '__LCA_RESULT__';

function execDocker(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\n[sandbox] host wall-timeout ${timeoutMs}ms`;
      resolve({ code, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      stderr += `\n[sandbox] spawn error: ${e.message}`;
      resolve({ code: -1, stdout, stderr });
    });
  });
}

export class SandboxRunner {
  constructor(private image: string = env.sandboxImage) {}

  async ensureImage(): Promise<void> {
    const inspect = await execDocker(['image', 'inspect', this.image], 15_000);
    if (inspect.code === 0) return;
    log(`沙盒镜像 ${this.image} 不存在，开始构建（首次可能需拉取基础镜像）…`, 'warn');
    const dockerfile = path.join(env.dataDir, 'sandbox-tmp', 'Dockerfile.sandbox');
    fs.writeFileSync(dockerfile, 'FROM node:22-slim\n');
    let build = await execDocker(['build', '-f', dockerfile, '-t', this.image, path.dirname(dockerfile)], 600_000);
    if (build.code !== 0) {
      // 基础镜像缺失时尝试国内镜像源拉取后重试构建
      log('node:22-slim 拉取失败，尝试 daocloud 镜像源…', 'warn');
      await execDocker(['pull', 'docker.m.daocloud.io/library/node:22-slim'], 600_000);
      await execDocker(['tag', 'docker.m.daocloud.io/library/node:22-slim', 'node:22-slim'], 30_000);
      build = await execDocker(['build', '-f', dockerfile, '-t', this.image, path.dirname(dockerfile)], 600_000);
    }
    if (build.code !== 0) {
      throw new Error(`沙盒镜像构建失败：${build.stderr.slice(-500)}`);
    }
    log(`沙盒镜像 ${this.image} 构建完成`);
  }

  /**
   * 在一次性容器中运行 main.js。
   * 约定：main.js 最后一行输出 `${SENTINEL}<json>`。
   */
  async run(files: SandboxFile[], opts?: { wallTimeoutMs?: number; cpuSeconds?: number }): Promise<SandboxResult> {
    const wall = opts?.wallTimeoutMs ?? 10_000;
    const cpu = opts?.cpuSeconds ?? 4;
    const workdir = fs.mkdtempSync(path.join(env.dataDir, 'sandbox-tmp', 'run-'));
    const containerName = `lc-agent-sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      for (const f of files) {
        // 校验文件名，防止路径逃逸
        if (!/^[A-Za-z0-9._-]+$/.test(f.name)) throw new Error(`非法沙盒文件名：${f.name}`);
        fs.writeFileSync(path.join(workdir, f.name), f.content, { mode: 0o644 });
      }
      const args = [
        'run',
        '--rm',
        '--name', containerName,
        '--network', 'none',
        '--read-only',
        '--tmpfs', `/tmp:rw,size=32m,noexec`,
        '--memory', '512m',
        '--cpus', '1',
        '--pids-limit', '64',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--ulimit', `cpu=${cpu}`,
        '--ulimit', `fsize=1000000`,
        '--user', '1000:1000',
        '-v', `${workdir}:/work:ro`,
        '-w', '/work',
        this.image,
        'node', 'main.js',
      ];
      const r = await execDocker(args, wall + 15_000);
      const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const sentinelLine = [...lines].reverse().find((l) => l.startsWith(RESULT_SENTINEL));
      const timedOut = /wall-timeout/.test(r.stderr) || r.code === 137 || r.code === 124;
      if (!sentinelLine) {
        return {
          ok: false,
          timeout: timedOut,
          exitCode: r.code,
          stderrTail: r.stderr.slice(-2000),
          result: null,
        };
      }
      try {
        const result = JSON.parse(sentinelLine.slice(RESULT_SENTINEL.length));
        return { ok: true, timeout: false, exitCode: r.code, stderrTail: r.stderr.slice(-2000), result };
      } catch {
        return {
          ok: false,
          timeout: false,
          exitCode: r.code,
          stderrTail: `结果 JSON 解析失败：${sentinelLine.slice(0, 500)}\n${r.stderr.slice(-1000)}`,
          result: null,
        };
      }
    } finally {
      // 兜底清理容器与临时目录
      void execDocker(['rm', '-f', containerName], 5_000);
      setTimeout(() => {
        try {
          fs.rmSync(workdir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }, 1000).unref?.();
    }
  }
}

/** 预热：确保镜像存在（启动时调用，失败不致命——沙盒会在真正运行时再试） */
export async function ensureSandboxImage(): Promise<void> {
  try {
    if (os.platform() !== 'linux') {
      log('当前非 Linux 宿主，沙盒仍按 docker CLI 调用', 'warn');
    }
    await new SandboxRunner().ensureImage();
  } catch (e) {
    log(`沙盒镜像预热失败（不影响启动）：${(e as Error).message}`, 'warn');
  }
}
