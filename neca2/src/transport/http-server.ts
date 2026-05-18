// ---- HTTP 传输层：让云端 DS 能通过紧凑协议直连 neca2 ----
// 
// neca2 在指定端口启动 HTTP 服务器，暴露两个核心端点：
//   1. POST /api/v1/message  — 接收紧凑协议消息，返回 session 状态
//   2. GET  /api/v1/pending/:agent — 拉取指定 Agent 的待处理消息
//   3. GET  /api/v1/session/:id — 查询会话状态
//   4. GET  /api/v1/health  — 健康检查
//   5. POST /api/v1/register — 注册外部 Agent（扩展用）
//
// 云端 DS 可通过 HTTP 直接发送紧凑协议消息到 neca2，
// 绕过 MCP 层，实现真正的"硅基原生通信"。

import http from 'node:http';
import url from 'node:url';
import crypto from 'node:crypto';

import type { Message, AnyPayload, AgentId } from '../protocol/types.js';
import { STANDARD_AGENTS, ERROR_CODES } from '../protocol/types.js';
import { validateMessage as validateMsgType } from '../protocol/types.js';
import { makeMessage, makeErrorMessage, now } from '../protocol/codec.js';
import { routeMessage } from '../relay/router.js';
import { getSession, listSessions, sessionStats } from '../relay/session.js';
import { getPendingFor } from '../relay/router.js';

// ---- 配置 ----

const PORT = parseInt(process.env.NECA2_HTTP_PORT || '3101', 10);
const API_KEY = process.env.NECA2_API_KEY || '';

// 简单 API Key 鉴权
function authenticate(req: http.IncomingMessage): boolean {
  if (!API_KEY) return true; // 未配置 key 时放行（开发模式）
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${API_KEY}` || auth === `Bearer ${API_KEY}`;
}

// ---- 请求体解析 ----

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e: any) {
        reject(new Error('JSON parse error: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

// ---- JSON 响应辅助 ----

function jsonResponse(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ---- 消息处理（入站） ----

async function handleIncomingMessage(body: any): Promise<any> {
  // 1. 验证消息结构
  const validation = validateMsgType(body);
  if (!validation.valid) {
    return { success: false, error: validation.error || 'invalid message' };
  }

  // 2. 构造标准 Message 对象
  const msg: Message = {
    ver: body.ver ?? 1,
    id: body.id || `http_${crypto.randomUUID()}`,
    from: body.from,
    to: body.to,
    type: body.type,
    payload: (body.payload ?? {}) as AnyPayload,
    callback: body.callback ?? false,
    priority: body.priority ?? 'normal',
    ts: body.ts ?? now(),
  };

  // 3. 路由
  const session = await routeMessage(msg);

  // 4. 如果是 callback 模式，等待回复
  if (msg.callback) {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      const current = getSession(session.id);
      if (!current) break;
      if (current.status === 'reply_received' || current.status === 'completed') {
        return { success: true, data: { sessionId: current.id, status: current.status, response: current.response } };
      }
      if (current.status === 'error' || current.status === 'timeout' || current.status === 'cancelled') {
        return { success: false, error: 'session ' + current.status, data: { sessionId: current.id, response: current.response } };
      }
    }
    return { success: false, error: 'callback timeout', data: { sessionId: session.id } };
  }

  return { success: true, data: { sessionId: session.id, status: session.status } };
}

// ---- 路由处理器 ----

const routes: Record<string, Record<string, (body: any, req: http.IncomingMessage) => Promise<any>>> = {
  '/api/v1/message': {
    POST: async (body) => handleIncomingMessage(body),
  },
  '/api/v1/pending': {
    POST: async (body) => {
      const agent = body.agent || 'cloud_ds';
      const messages = getPendingFor(agent);
      return { success: true, data: { agent, count: messages.length, messages } };
    },
  },
  '/api/v1/session': {
    POST: async (body) => {
      const s = getSession(body.id || '');
      if (!s) return { success: false, error: 'session not found' };
      return { success: true, data: { id: s.id, status: s.status, response: s.response, age: Date.now() - s.createdAt } };
    },
  },
  '/api/v1/health': {
    GET: async () => ({
      success: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        sessionStats: sessionStats(),
        port: PORT,
        apiKeyConfigured: !!API_KEY,
      },
    }),
    POST: async () => ({
      success: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        sessionStats: sessionStats(),
      },
    }),
  },
};

// ---- 启动 HTTP 服务器 ----

let server: http.Server | null = null;

export function startHttpServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      // CORS
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 鉴权
      if (!authenticate(req)) {
        jsonResponse(res, 401, { success: false, error: 'unauthorized' });
        return;
      }

      // 路径解析
      const parsedUrl = url.parse(req.url || '', true);
      const pathname = parsedUrl.pathname || '';

      try {
        // 动态路由：/api/v1/pending/:agent
        const pendingMatch = pathname.match(/^\/api\/v1\/pending\/(.+)$/);
        if (pendingMatch) {
          const agent = pendingMatch[1];
          const messages = getPendingFor(agent);
          jsonResponse(res, 200, {
            success: true,
            data: { agent, count: messages.length, messages: messages.map(m => ({ id: m.id, from: m.from, type: m.type, payload: m.payload, ts: m.ts })) },
          });
          return;
        }

        // 动态路由：/api/v1/session/:id
        const sessionMatch = pathname.match(/^\/api\/v1\/session\/(.+)$/);
        if (sessionMatch) {
          const s = getSession(sessionMatch[1]);
          if (!s) { jsonResponse(res, 404, { success: false, error: 'session not found' }); return; }
          jsonResponse(res, 200, { success: true, data: { id: s.id, status: s.status, response: s.response, age: Date.now() - s.createdAt } });
          return;
        }

        // 精确路由
        const route = routes[pathname];
        if (!route) {
          jsonResponse(res, 404, { success: false, error: 'not found: ' + pathname });
          return;
        }

        const handler = route[req.method || ''];
        if (!handler) {
          jsonResponse(res, 405, { success: false, error: 'method not allowed: ' + req.method });
          return;
        }

        const body = req.method === 'GET' ? {} : await parseBody(req);
        const result = await handler(body, req);
        jsonResponse(res, result.success ? 200 : 400, result);
      } catch (e: any) {
        jsonResponse(res, 500, { success: false, error: e.message });
      }
    });

    server.listen(PORT, () => {
      console.error(`[neca2] HTTP server listening on port ${PORT}`);
      resolve(PORT);
    });

    server.on('error', reject);
  });
}

export function stopHttpServer(): void {
  if (server) {
    server.close();
    server = null;
    console.error('[neca2] HTTP server stopped');
  }
}
