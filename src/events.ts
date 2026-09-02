/**
 * 事件中心：docs/10 §2 契约的进程内实现。
 * - 统一信封 { type, seq, ts, payload }，seq 单调递增并持久化（重启不回退）。
 * - 内存环形缓冲（默认 2000 条）支持 WS 断线补发；缺口超出缓冲时由调用方回退 REST 回放。
 * - log_stream 同时打到控制台（本地脱敏在出口统一做一次兜底）。
 */

export type EventType = 'state_change' | 'pipeline_step' | 'log_stream' | 'attempt_result' | 'budget_warning';

export interface Envelope {
  type: EventType;
  seq: number;
  ts: number;
  payload: Record<string, unknown>;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/LEETCODE_SESSION=[^;\s"']+/gi, 'LEETCODE_SESSION=***'],
  [/csrftoken=[^;\s"']+/gi, 'csrftoken=***'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer ***'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of SENSITIVE_PATTERNS) out = out.replace(re, replacement);
  return out;
}

type Listener = (e: Envelope) => void;

export class EventHub {
  private listeners = new Set<Listener>();
  private buffer: Envelope[] = [];
  private seq = 0;
  private persistSeq: (seq: number) => void;

  constructor(persistSeq: (seq: number) => void, restoredSeq: number) {
    this.persistSeq = persistSeq;
    this.seq = restoredSeq;
  }

  publish(type: EventType, payload: Record<string, unknown>): Envelope {
    if (type === 'log_stream' && typeof payload.text === 'string') {
      payload = { ...payload, text: redact(payload.text) };
    }
    const env: Envelope = { type, seq: ++this.seq, ts: Date.now(), payload };
    this.buffer.push(env);
    if (this.buffer.length > 2000) this.buffer.shift();
    try {
      this.persistSeq(this.seq);
    } catch {
      /* 持久化失败不阻断 */
    }
    for (const l of this.listeners) {
      try {
        l(env);
      } catch {
        /* 监听器异常不阻断 */
      }
    }
    return env;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** 断线补发：返回 seq > since 的事件；gap=true 表示 since 低于缓冲窗口，需客户端全量回放。 */
  since(sinceSeq: number): { events: Envelope[]; gap: boolean; latest: number } {
    const first = this.buffer[0]?.seq ?? this.seq + 1;
    const gap = this.buffer.length > 0 ? sinceSeq + 1 < first : false;
    return { events: this.buffer.filter((e) => e.seq > sinceSeq), gap, latest: this.seq };
  }

  get latestSeq(): number {
    return this.seq;
  }
}

let hub: EventHub | null = null;
let seqPersist: ((seq: number) => void) | null = null;

export function initEvents(persist: (seq: number) => void, restoredSeq: number): void {
  seqPersist = persist;
  hub = new EventHub(persist, restoredSeq);
}

function mustHub(): EventHub {
  if (!hub) throw new Error('EventHub 未初始化');
  return hub;
}

export function emit(type: EventType, payload: Record<string, unknown>): void {
  // 未初始化（脚本/单测场景）时静默丢弃事件
  hub?.publish(type, payload);
}

export function log(text: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${redact(text)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  hub?.publish('log_stream', { level, text });
}

export function subscribe(l: Listener): () => void {
  return mustHub().subscribe(l);
}

export function eventsSince(sinceSeq: number): { events: Envelope[]; gap: boolean; latest: number } {
  return mustHub().since(sinceSeq);
}

export function currentSeq(): number {
  return mustHub().latestSeq;
}
