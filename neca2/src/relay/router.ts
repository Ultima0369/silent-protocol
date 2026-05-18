// ---- 消息路由器 ----
// 负责将紧凑协议消息路由到正确的目标实体。
//
// 路由策略：
//   neca          → 本地处理（ping/pong/内部查询）
//   cloud_claude  → relay 到 Claude API
//   cloud_ds      → relay 到 DeepSeek API
//   local_claude  → spawn 本地子进程执行（exec）/ 或 spawn claude 处理（delegate/query）
//   user          → 入待处理队列，等待 poll
//   tork_local    → 转发到本地 TORK 实例（TCP socket）
//   ext_*         → 根据注册的外部 Agent 转发

import type { Message, SessionRecord, AnyPayload } from '../protocol/types.js';
import { ERROR_CODES } from '../protocol/types.js';
import { makeErrorMessage, now, makeMessage } from '../protocol/codec.js';
import { createSession, updateSession, getSession } from './session.js';
import { relayManager } from './http-relay.js';
import { spawnExec, spawnClaudeTask, cancelProcess, processRegistryStats } from './subprocess.js';
import {
  startTrace, startSpan, endSpan, completeTrace,
  recordAgentInteraction, setAgentLoad, adaptive,
  getBudget, spendBudget,
} from '../meta/orchestrator.js';
import { routeToTork, torkAgent } from './tork-agent.js';

const pendingDeliveries = new Map<string, Message[]>();

// 工具数量缓存（启动时由 index.ts 设置）
let _toolCount = 9;
export function setToolCount(n: number): void { _toolCount = n; }

/**
 * 主路由入口
 */
export async function routeMessage(msg: Message): Promise<SessionRecord> {
  // 启动时序追踪
  startTrace(msg.id);
  startSpan(msg.id, 'route', `to=${msg.to} type=${msg.type}`);

  const session = createSession(msg);
  try {
    // 断路器检查
    if (!adaptive.shouldSendTo(msg.to)) {
      const errMsg = makeErrorMessage(msg, ERROR_CODES.TARGET_UNREACHABLE, `Circuit breaker open for ${msg.to}`);
      updateSession(session.id, { status: 'error', response: errMsg });
      endSpan(msg.id, 'route', 'error', `circuit breaker open for ${msg.to}`);
      completeTrace(msg.id);
      return getSession(session.id)!;
    }

    let result: SessionRecord;
    switch (msg.to) {
      case 'neca': result = await routeToNeca(session); break;
      case 'cloud_claude': result = await routeToCloud(session, 'claude'); break;
      case 'cloud_ds': result = await routeToCloud(session, 'deepseek'); break;
      case 'local_claude': result = await routeToLocalClaude(session); break;
      case 'tork_local': result = await routeToTork(session); break;
      case 'user': result = routeToUser(session); break;
      default:
        if ((msg.to as string).startsWith('ext_')) {
          result = routeToExternal(session);
        } else {
          result = await routeToLocalClaude(session);
        }
    }

    endSpan(msg.id, 'route', 'ok');
    completeTrace(msg.id);

    // 记录 Agent 交互（用于元感知）
    const latency = Date.now() - session.createdAt;
    const isError = result.status === 'error' || result.status === 'timeout';
    recordAgentInteraction(msg.to, latency, isError);
    if (isError) {
      adaptive.recordFailure(msg.to);
    } else {
      adaptive.recordSuccess(msg.to);
    }

    return result;
  } catch (err: any) {
    endSpan(msg.id, 'route', 'error', err.message);
    completeTrace(msg.id);
    const errorMsg = makeErrorMessage(msg, ERROR_CODES.INTERNAL_ERROR, err.message);
    updateSession(session.id, { status: 'error', response: errorMsg });
    recordAgentInteraction(msg.to, Date.now() - session.createdAt, true);
    adaptive.recordFailure(msg.to);
    return getSession(session.id)!;
  }
}

// ---- 路由到 neca（自身） ----

async function routeToNeca(session: SessionRecord): Promise<SessionRecord> {
  const msg = session.message;
  startSpan(msg.id, 'neca_handler', `type=${msg.type}`);

  if (msg.type === 'ping') {
    const budget = getBudget('exec');
    const budgetResult = spendBudget(budget!, 'route', 100);
    const reply: Message = {
      ver: 1, id: msg.id, from: 'neca', to: msg.from, type: 'pong',
      payload: {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        queueDepth: pendingDeliveries.size,
        processStats: processRegistryStats(),
        withinBudget: budgetResult.withinBudget,
      },
      callback: false, ts: now(),
    };
    updateSession(session.id, { status: 'reply_received', response: reply });
    endSpan(msg.id, 'neca_handler', 'ok');
  } else if (msg.type === 'query') {
    const reply: Message = {
      ver: 1, id: msg.id, from: 'neca', to: msg.from, type: 'report',
      payload: {
        taskId: msg.id,
        status: 'completed',
        result: {
          uptime: process.uptime(),
          toolCount: _toolCount,
          processStats: processRegistryStats(),
          metaState: {
            recommendedConcurrency: adaptive.recommendedConcurrency(),
            preferredRelay: adaptive.preferredRelayProvider(),
          },
        },
      },
      callback: false, ts: now(),
    };
    updateSession(session.id, { status: 'reply_received', response: reply });
    endSpan(msg.id, 'neca_handler', 'ok');
  } else if (msg.type === 'cancel') {
    const pld = msg.payload as any;
    const cancelled = cancelProcess(pld.taskId || '');
    const reply: Message = {
      ver: 1, id: msg.id, from: 'neca', to: msg.from, type: 'report',
      payload: { taskId: pld.taskId || '', status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : 'task not found' },
      callback: false, ts: now(),
    };
    updateSession(session.id, { status: 'completed', response: reply });
    endSpan(msg.id, 'neca_handler', 'ok');
  } else {
    const errMsg = makeErrorMessage(msg, ERROR_CODES.UNKNOWN_TYPE, 'neca does not handle type: ' + msg.type);
    updateSession(session.id, { status: 'error', response: errMsg });
    endSpan(msg.id, 'neca_handler', 'error', `unknown type ${msg.type}`);
  }
  return getSession(session.id)!;
}

// ---- 路由到云端 API（Claude / DeepSeek） ----

async function routeToCloud(session: SessionRecord, preferred: string): Promise<SessionRecord> {
  const msg = session.message;
  startSpan(msg.id, `relay_${preferred}`);

  if (msg.type !== 'query') {
    const errMsg = makeErrorMessage(msg, ERROR_CODES.UNKNOWN_TYPE, 'cloud only handles query type');
    updateSession(session.id, { status: 'error', response: errMsg });
    endSpan(msg.id, `relay_${preferred}`, 'error', 'not query type');
    return getSession(session.id)!;
  }

  if (!relayManager.available) {
    const errMsg = makeErrorMessage(msg, ERROR_CODES.API_AUTH_FAILED, 'No API keys configured');
    updateSession(session.id, { status: 'error', response: errMsg });
    endSpan(msg.id, `relay_${preferred}`, 'error', 'no api keys');
    return getSession(session.id)!;
  }

  updateSession(session.id, { status: 'sent' });

  // 自适应选择提供商
  const actualProvider = adaptive.preferredRelayProvider();
  startSpan(msg.id, 'api_call', `provider=${actualProvider}`);

  const result = await relayManager.query(msg.payload, actualProvider);

  if (result.error) {
    endSpan(msg.id, 'api_call', 'error', result.error);
    const ec = result.error.startsWith('TIMEOUT') ? ERROR_CODES.TIMEOUT
      : result.error.includes('AUTH') ? ERROR_CODES.API_AUTH_FAILED
      : result.error.includes('RATE') ? ERROR_CODES.API_RATE_LIMITED
      : ERROR_CODES.API_SERVER_ERROR;
    const errMsg = makeErrorMessage(msg, ec, result.error);
    updateSession(session.id, { status: 'error', response: errMsg });
    adaptive.recordFailure(actualProvider === 'claude' ? 'cloud_claude' : 'cloud_ds');
  } else {
    endSpan(msg.id, 'api_call', 'ok', `tokens=${result.tokensUsed}`);
    const reply: Message = {
      ver: 1, id: msg.id, from: msg.to, to: msg.from, type: 'query',
      payload: { question: '', answer: result.answer, tokensUsed: result.tokensUsed, model: result.model },
      callback: false, ts: now(),
    };
    updateSession(session.id, { status: 'reply_received', response: reply });
    adaptive.recordSuccess(actualProvider === 'claude' ? 'cloud_claude' : 'cloud_ds');
  }
  endSpan(msg.id, `relay_${preferred}`);
  return getSession(session.id)!;
}

// ---- 路由到本地 Claude Code（子进程执行） ----

async function routeToLocalClaude(session: SessionRecord): Promise<SessionRecord> {
  const msg = session.message;
  startSpan(msg.id, 'local_claude');
  updateSession(session.id, { status: 'sent' });

  try {
    // 更新 Agent 负载
    const runningProcesses = processRegistryStats().running;
    setAgentLoad('local_claude', runningProcesses);
    setAgentLoad('local_claude', runningProcesses);

    switch (msg.type) {
      case 'exec': {
        const pld = msg.payload as any;
        updateSession(session.id, { status: 'running' });
        startSpan(msg.id, 'spawn_exec', `cmd=${(pld.cmd || '').substring(0, 60)}`);

        const result = await spawnExec(pld.cmd || '', {
          cwd: pld.cwd,
          timeout: pld.timeout ?? 30000,
          maxOutput: pld.maxOutput,
        }, session.id);

        endSpan(msg.id, 'spawn_exec', result.exitCode === 0 ? 'ok' : 'error', `exit=${result.exitCode}`);

        const reply: Message = {
          ver: 1, id: msg.id, from: 'local_claude', to: msg.from, type: 'exec',
          payload: {
            cmd: pld.cmd || '',
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedout: result.timedout,
            duration: 0,
          },
          callback: false, ts: now(),
        };

        if (result.exitCode === 0 && !result.timedout) {
          updateSession(session.id, { status: 'reply_received', response: reply });
        } else {
          updateSession(session.id, { status: 'error', response: reply });
        }
        break;
      }

      case 'delegate':
      case 'query': {
        updateSession(session.id, { status: 'running' });
        startSpan(msg.id, 'spawn_claude', `type=${msg.type}`);

        const result = await spawnClaudeTask(msg, session.id, {
          timeout: (msg.payload as any)?.timeout ?? 120_000,
        });

        endSpan(msg.id, 'spawn_claude', result.success ? 'ok' : 'error');

        if (result.success) {
          const reply: Message = {
            ver: 1, id: msg.id, from: 'local_claude', to: msg.from, type: msg.type,
            payload: { taskId: msg.id, status: 'completed', result: result.result },
            callback: false, ts: now(),
          };
          updateSession(session.id, { status: 'reply_received', response: reply });
        } else {
          const reply: Message = {
            ver: 1, id: msg.id, from: 'local_claude', to: msg.from, type: 'report',
            payload: { taskId: msg.id, status: 'failed', error: result.error, result: result.result },
            callback: false, ts: now(),
          };
          updateSession(session.id, { status: 'error', response: reply });
        }
        break;
      }

      case 'cancel': {
        const pld = msg.payload as any;
        const cancelled = cancelProcess(pld.taskId || session.id);
        const reply: Message = {
          ver: 1, id: msg.id, from: 'local_claude', to: msg.from, type: 'report',
          payload: { taskId: pld.taskId || session.id, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : 'no running process' },
          callback: false, ts: now(),
        };
        updateSession(session.id, { status: 'completed', response: reply });
        break;
      }

      default: {
        const deliveries = pendingDeliveries.get('local_claude') || [];
        deliveries.push(msg);
        pendingDeliveries.set('local_claude', deliveries);
        break;
      }
    }
  } catch (err: any) {
    const reply: Message = {
      ver: 1, id: msg.id, from: 'local_claude', to: msg.from, type: 'report',
      payload: { taskId: msg.id, status: 'failed', error: err.message },
      callback: false, ts: now(),
    };
    updateSession(session.id, { status: 'error', response: reply });
  }

  endSpan(msg.id, 'local_claude');
  return getSession(session.id)!;
}

// ---- 路由到用户（入队列） ----

function routeToUser(session: SessionRecord): SessionRecord {
  const msg = session.message;
  const deliveries = pendingDeliveries.get('user') || [];
  deliveries.push(msg);
  pendingDeliveries.set('user', deliveries);
  return session;
}

// ---- 路由到外部 Agent ----

function routeToExternal(session: SessionRecord): SessionRecord {
  const msg = session.message;
  const agentId = msg.to as string;
  const deliveries = pendingDeliveries.get(agentId) || [];
  deliveries.push(msg);
  pendingDeliveries.set(agentId, deliveries);
  return session;
}

// ---- 公共 API ----

/**
 * 获取并消费指定 Agent 的待处理消息
 */
export function getPendingFor(agent: string): Message[] {
  const msgs = pendingDeliveries.get(agent) || [];
  pendingDeliveries.set(agent, []);
  return msgs;
}

/**
 * 获取所有待处理队列深度
 */
export function pendingCount(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [agent, msgs] of pendingDeliveries) {
    if (msgs.length > 0) counts[agent] = msgs.length;
  }
  return counts;
}

/**
 * 取消指定 Agent 的所有待处理消息
 */
export function clearPendingFor(agent: string): number {
  const msgs = pendingDeliveries.get(agent) || [];
  pendingDeliveries.set(agent, []);
  return msgs.length;
}
