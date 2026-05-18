// ---- neca ↔ neca2 双向桥 ----
// 让 neca2（右手/紧凑协议）可以调用 neca（左手/万能工具）的能力。
//
// 双向协作模型：
//
// neca2 → neca（请求执行）:
//   当 neca2 收到 exec/read/write/search 消息且目标为 'neca' 时，
//   通过 spawn neca CLI 执行对应命令，取回结果。
//
// neca → neca2（协议编码）:
//   neca 可以通过黑板报读取 neca2 的状态，或通过共享文件交换数据。
//
// 为什么不直接用 neca2 的 spawnExec？
//   neca 有 40+ 工具，包括 VS Code 操作、文件监听、Claude Code 子代理编排
//   等复杂能力。neca2 不需要重复实现这些，通过桥接直接复用。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';
import { readBlackboard, isNecaAlive } from './blackboard.js';
import type { Message, AnyPayload } from '../protocol/types.js';
import type { ExecPayload, ReadPayload, WritePayload, SearchPayload } from '../protocol/types.js';
import { spawnExec } from '../relay/subprocess.js';

// ---- 配置 ----

const NECA_CLI = process.platform === 'win32' ? 'neca.cmd' : 'neca';
const BRIDGE_TIMEOUT = parseInt(process.env.NECA2_BRIDGE_TIMEOUT || '30000', 10);

// ---- 桥接结果 ----

export interface BridgeResult {
  success: boolean;
  data?: any;
  error?: string;
  source: 'neca' | 'neca2_self' | 'fallback';
  durationMs: number;
}

// ---- 核心桥接函数 ----

/**
 * 尝试通过 neca 执行命令
 * 如果 neca 在线，委托给它；否则自己执行
 */
export async function bridgeExec(payload: ExecPayload): Promise<BridgeResult> {
  const start = Date.now();

  // 检查 neca 是否在线
  if (isNecaAlive()) {
    try {
      const result = await callNecaTool('neca_execute_command', {
        command: payload.cmd,
        cwd: payload.cwd || process.cwd(),
        timeout: payload.timeout || BRIDGE_TIMEOUT,
      });
      return {
        success: true,
        data: result,
        source: 'neca',
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.warn('Neca bridge failed, falling back to self',
        { error: err.message, cmd: payload.cmd?.substring(0, 60) },
        { module: 'bridge' },
      );
    }
  }

  // 回退：自己执行
  const selfResult = await spawnExec(payload.cmd || '', {
    cwd: payload.cwd,
    timeout: payload.timeout || 30000,
    maxOutput: payload.maxOutput,
  }, `bridge_${Date.now()}`);

  return {
    success: selfResult.exitCode === 0,
    data: selfResult,
    source: 'neca2_self',
    durationMs: Date.now() - start,
    error: selfResult.exitCode !== 0
      ? selfResult.stderr || `exit code ${selfResult.exitCode}`
      : undefined,
  };
}

/**
 * 通过 neca 读取文件
 */
export async function bridgeRead(payload: ReadPayload): Promise<BridgeResult> {
  const start = Date.now();

  if (isNecaAlive()) {
    try {
      const result = await callNecaTool('neca_read_file', {
        path: payload.path,
        ...(payload.offset ? { startLine: payload.offset } : {}),
        ...(payload.maxLines ? { endLine: payload.offset! + payload.maxLines } : {}),
      });
      return { success: true, data: result, source: 'neca', durationMs: Date.now() - start };
    } catch { /* fallback */ }
  }

  // 回退：直接用 fs
  try {
    const content = fs.readFileSync(payload.path, 'utf-8');
    const lines = content.split('\n');
    const startLine = payload.offset || 0;
    const endLine = payload.maxLines ? startLine + payload.maxLines : lines.length;
    const sliced = lines.slice(startLine, endLine).join('\n');

    return {
      success: true,
      data: { content: sliced, totalLines: lines.length, startLine, truncated: endLine < lines.length },
      source: 'neca2_self',
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { success: false, error: err.message, source: 'fallback', durationMs: Date.now() - start };
  }
}

/**
 * 通过 neca 写入文件
 */
export async function bridgeWrite(payload: WritePayload): Promise<BridgeResult> {
  const start = Date.now();

  if (isNecaAlive()) {
    try {
      const result = await callNecaTool('neca_write_file', {
        path: payload.path,
        content: payload.content,
        append: payload.append || false,
      });
      return { success: true, data: result, source: 'neca', durationMs: Date.now() - start };
    } catch { /* fallback */ }
  }

  // 回退：直接用 fs
  try {
    const dir = path.dirname(payload.path);
    fs.mkdirSync(dir, { recursive: true });
    if (payload.append) {
      fs.appendFileSync(payload.path, payload.content, 'utf-8');
    } else {
      fs.writeFileSync(payload.path, payload.content, 'utf-8');
    }
    const stat = fs.statSync(payload.path);
    return {
      success: true,
      data: { path: payload.path, size: stat.size, written: true },
      source: 'neca2_self',
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { success: false, error: err.message, source: 'fallback', durationMs: Date.now() - start };
  }
}

/**
 * 通过 neca 搜索文件
 */
export async function bridgeSearch(payload: SearchPayload): Promise<BridgeResult> {
  const start = Date.now();

  if (isNecaAlive()) {
    try {
      const result = await callNecaTool('neca_search_file', {
        path: payload.path,
        pattern: payload.pattern,
        contextLines: payload.contextLines || 0,
      });
      return { success: true, data: result, source: 'neca', durationMs: Date.now() - start };
    } catch { /* fallback */ }
  }

  // 回退：自己用 grep 或简单搜索
  try {
    const content = fs.readFileSync(payload.path, 'utf-8');
    const lines = content.split('\n');
    const regex = new RegExp(payload.pattern, 'g');
    const matches: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const ctxLines = payload.contextLines || 0;
        matches.push({
          line: i + 1,
          content: lines[i],
          before: lines.slice(Math.max(0, i - ctxLines), i),
          after: lines.slice(i + 1, i + 1 + ctxLines),
        });
        if (payload.maxResults && matches.length >= payload.maxResults) break;
      }
    }

    return {
      success: true,
      data: { matches, total: matches.length },
      source: 'neca2_self',
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return { success: false, error: err.message, source: 'fallback', durationMs: Date.now() - start };
  }
}

/**
 * 获取 neca 的状态摘要
 */
export function getNecaSummary(): string {
  const bb = readBlackboard();
  if (!bb?.agents?.neca) return 'neca: offline';
  const n = bb.agents.neca;
  const elapsed = Math.floor((Date.now() - new Date(n.lastSeen).getTime()) / 1000);
  return `neca: ${n.status} (uptime: ${Math.floor(n.uptime / 60)}m, lastSeen: ${elapsed}s ago, tools: ${n.toolCount})`;
}

/**
 * 获取桥接器统计
 */
export function getBridgeStats() {
  return {
    necaAlive: isNecaAlive(),
    necaSummary: getNecaSummary(),
    bridgeTimeout: BRIDGE_TIMEOUT,
  };
}

// ---- 内部：调用 neca CLI 工具 ----

async function callNecaTool(toolName: string, args: Record<string, any>): Promise<any> {
  // 构造 neca MCP 调用
  // neca 支持通过命令行或 HTTP 调用
  // 这里使用 spawn 执行 neca 的 MCP 查询

  const input = JSON.stringify({
    tool: toolName,
    args,
  });

  try {
    const result = execSync(
      `${NECA_CLI} --json "${toolName}"`,
      {
        input,
        timeout: BRIDGE_TIMEOUT,
        windowsHide: true,
        encoding: 'utf-8',
        env: { ...process.env, NECA_MODE: 'mcp-call' },
      },
    );
    return JSON.parse(result.trim());
  } catch (err: any) {
    throw new Error(`neca bridge call failed: ${err.message}`);
  }
}
