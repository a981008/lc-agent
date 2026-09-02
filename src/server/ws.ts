import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { subscribe, eventsSince } from '../events.js';
import { checkWsToken } from './auth.js';
import { resolveAdminToken } from './auth.js';
import type { Repository } from '../db/repository.js';

/**
 * WebSocket 广播（docs/10 §2）：单向推送，统一信封；重连按 last_seq 补发，缺口超出缓冲时提示全量回放。
 */

export function attachWs(server: Server, repo: Repository): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket: Duplex, head) => {
    const url = req.url ?? '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const token = resolveAdminToken(
      (k, f) => repo.getMeta(k, f),
      (k, v) => repo.setMeta(k, v)
    );
    if (!checkWsToken(url, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const u = new URL(req.url ?? '/ws', 'http://x');
    const lastSeq = Number(u.searchParams.get('last_seq') ?? 0) || 0;
    // 补发缺口
    const { events, gap } = eventsSince(lastSeq);
    if (gap) {
      ws.send(JSON.stringify({ type: 'state_change', seq: lastSeq, ts: Date.now(), payload: { from: '-', to: '-', reason: 'log_gap_detected: 请调用 GET /api/logs 全量回放' } }));
    }
    for (const e of events) ws.send(JSON.stringify(e));
    // 实时订阅
    const unsub = subscribe((e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
    });
    ws.on('close', unsub);
    ws.on('error', unsub);
    // 保活
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
      else clearInterval(ping);
    }, 30_000);
    ws.on('close', () => clearInterval(ping));
  });

  return wss;
}
