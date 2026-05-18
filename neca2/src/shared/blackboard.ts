// ---- 统一黑板报 ----
// neca + neca2 共享态势感知层。
//
// 设计：
//   1. 共享文件 `~/.neca/shared-blackboard.json`
//   2. neca 和 neca2 各自写入自己的状态
//   3. 各自读取对方的状态
//   4. 写入时使用原子写（写 tmp → rename），避免读写冲突
//
// 黑板报内容：
//   {
//     version: 1,
//     updatedAt: "...",
//     agents: {
//       neca:   { status, uptime, toolCount, lastSeen },
//       neca2:  { status, uptime, toolCount, lastSeen },
//       cloud_ds: { status, lastSeen },
//       cloud_claude: { status, lastSeen },
//     },
//     sessions: { total, active, error },
//     resources: { cpuLoad, freeMem, totalMem },
//     messages: [ { from, to, type, ts, summary } ],  // 最近 20 条
//   }

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';
import { sessionStats } from '../relay/session.js';
import { retryQueue } from '../relay/retry-queue.js';
import { schedulerManager } from '../relay/router-scheduler.js';

// ---- 类型定义 ----

export interface AgentStatus {
  status: 'alive' | 'degraded' | 'offline';
  uptime: number;
  toolCount: number;
  lastSeen: string;           // ISO 时间戳
  version: string;
  features: string[];
  relayProviders: string[];
}

export interface BlackboardSnapshot {
  version: number;
  updatedAt: string;
  agents: {
    neca?: AgentStatus;
    neca2?: AgentStatus;
    cloud_ds?: { status: string; lastSeen: string };
    cloud_claude?: { status: string; lastSeen: string };
    [key: string]: any;
  };
  sessions: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    error: number;
  };
  retryQueue: {
    depth: number;
    enqueued: number;
    succeeded: number;
    failed: number;
  };
  scheduler: {
    strategy: string;
    endpoints: any[];
  };
  resources: {
    cpuLoad: number;
    freeMem: string;
    totalMem: string;
    pid: number;
  };
  recentMessages: Array<{
    from: string;
    to: string;
    type: string;
    ts: number;
    summary: string;
  }>;
}

// ---- 共享文件路径 ----

const SHARED_DIR = path.join(os.homedir(), '.neca');
const SHARED_FILE = path.join(SHARED_DIR, 'shared-blackboard.json');
const LOCK_FILE = path.join(SHARED_DIR, 'blackboard.lock');

// ---- 读写锁（文件锁的简易替代） ----

function acquireLock(): boolean {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false; // 被其他进程持有锁
  }
}

function releaseLock(): void {
  try {
    const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    if (pid === String(process.pid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch { /* ignore */ }
}

// ---- 黑板报核心 ----

/** 读取共享黑板报 */
export function readBlackboard(): BlackboardSnapshot | null {
  try {
    ensureDir();
    if (!fs.existsSync(SHARED_FILE)) return null;
    const raw = fs.readFileSync(SHARED_FILE, 'utf-8');
    return JSON.parse(raw) as BlackboardSnapshot;
  } catch {
    return null;
  }
}

/** 写入本 agent 状态到黑板报 */
export function writeSelfStatus(
  agentName: 'neca2',
  status: AgentStatus['status'] = 'alive',
): boolean {
  try {
    ensureDir();

    // 读取现有黑板报（或创建新的）
    let bb = readBlackboard() || createEmptyBlackboard();

    // 更新本 agent 状态
    bb.agents[agentName] = {
      status,
      uptime: Math.floor(process.uptime()),
      toolCount: 13,  // neca2 的 MCP 工具数
      lastSeen: new Date().toISOString(),
      version: '0.3.0',
      features: [
        'json-codec', 'binary-codec', 'validator-middleware',
        'retry-queue', 'auto-persist', 'structured-logging',
        'codec-factory', 'router-scheduler', 'cli',
      ],
      relayProviders: [],
    };

    // 更新会话统计
    const ss = sessionStats();
    bb.sessions = {
      total: ss.total,
      pending: ss.pending,
      running: ss.running,
      completed: ss.completed,
      error: ss.error,
    };

    // 更新重试队列统计
    bb.retryQueue = {
      depth: retryQueue.depth,
      enqueued: retryQueue.stats.enqueued,
      succeeded: retryQueue.stats.succeeded,
      failed: retryQueue.stats.failed,
    };

    // 更新调度器统计
    const sched = schedulerManager.getStats();
    bb.scheduler = {
      strategy: sched.strategy,
      endpoints: sched.endpoints,
    };

    // 更新资源
    bb.resources = {
      cpuLoad: 0,  // 无法在 Node 中准确获取，保留为占位
      freeMem: '0MB',
      totalMem: '0MB',
      pid: process.pid,
    };

    bb.updatedAt = new Date().toISOString();

    // 原子写入
    atomicWrite(bb);
    return true;
  } catch (err: any) {
    logger.error('Failed to write blackboard', { error: err.message }, { module: 'blackboard' });
    return false;
  }
}

/** 添加一条消息到黑板报的最近消息列表 */
export function addMessageToBlackboard(
  from: string, to: string, type: string, summary: string,
): void {
  try {
    const bb = readBlackboard() || createEmptyBlackboard();
    bb.recentMessages.unshift({ from, to, type, ts: Date.now(), summary });
    if (bb.recentMessages.length > 20) bb.recentMessages.pop();
    bb.updatedAt = new Date().toISOString();
    atomicWrite(bb);
  } catch { /* silent */ }
}

/** 获取黑板报中的 neca 状态 */
export function getNecaStatus(): AgentStatus | null {
  const bb = readBlackboard();
  if (!bb?.agents?.neca) return null;
  return bb.agents.neca as AgentStatus;
}

/** 检查 neca 是否在线 */
export function isNecaAlive(): boolean {
  const status = getNecaStatus();
  if (!status) return false;
  // 30 秒内更新过视为 alive
  const elapsed = Date.now() - new Date(status.lastSeen).getTime();
  return elapsed < 30_000 && status.status === 'alive';
}

/** 获取黑板报摘要字符串 */
export function getBlackboardSummary(): string {
  const bb = readBlackboard();
  if (!bb) return 'No blackboard data';

  const agents = Object.entries(bb.agents)
    .map(([name, info]: [string, any]) => `${name}=${info.status || 'unknown'}`)
    .join(', ');

  return [
    `Agents: [${agents}]`,
    `Sessions: ${bb.sessions.total} (${bb.sessions.running} running)`,
    `Retry: depth=${bb.retryQueue.depth}`,
    `Updated: ${bb.updatedAt}`,
  ].join(' | ');
}

// ---- 辅助函数 ----

function ensureDir(): void {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
}

function createEmptyBlackboard(): BlackboardSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: {},
    sessions: { total: 0, pending: 0, running: 0, completed: 0, error: 0 },
    retryQueue: { depth: 0, enqueued: 0, succeeded: 0, failed: 0 },
    scheduler: { strategy: 'round-robin', endpoints: [] },
    resources: { cpuLoad: 0, freeMem: '0MB', totalMem: '0MB', pid: 0 },
    recentMessages: [],
  };
}

function atomicWrite(data: BlackboardSnapshot): void {
  const tmpFile = SHARED_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, SHARED_FILE);
}

/** 启动黑板报定时刷新（每 15 秒写入一次） */
export function startBlackboardSync(): void {
  // 初始写入
  writeSelfStatus('neca2');
  logger.info('Blackboard initialized', {}, { module: 'blackboard' });

  // 定时刷新
  const timer = setInterval(() => {
    writeSelfStatus('neca2');
  }, 15_000);
  timer.unref?.();

  logger.info('Blackboard sync started (15s interval)', {}, { module: 'blackboard' });
}
