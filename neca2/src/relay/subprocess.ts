// ---- 子进程管理器 ----
// 负责 spawn 本地子进程来消费 delegate/query/exec 消息
// 
// 核心能力：
//   1. 非阻塞执行 exec 命令（spawn 代替 execSync）
//   2. 通过 spawn claude 子进程来处理复杂任务
//   3. 超时控制、并发限制、优雅取消

import { spawn, execSync, ChildProcess } from 'node:child_process';
import type { Message, AnyPayload } from '../protocol/types.js';
import { now, makeMessage } from '../protocol/codec.js';
import { updateSession, getSession } from './session.js';

interface SubprocessInfo {
  pid: number;
  sessionId: string;
  spawnedAt: number;
  process: ChildProcess;
  type: 'exec' | 'claude';
  status: 'running' | 'completed' | 'failed' | 'timed_out';
}

const activeProcesses = new Map<string, SubprocessInfo>();
const MAX_CONCURRENCY = parseInt(process.env.NECA2_MAX_PROCESSES || '4', 10);

// ---- 核心函数 ----

/**
 * 非阻塞执行命令，返回结果
 */
export function spawnExec(
  cmd: string,
  options: { cwd?: string; timeout?: number; maxOutput?: number },
  sessionId: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedout: boolean }> {
  return new Promise((resolve) => {
    const timeout = options.timeout ?? 30000;
    const maxOutput = options.maxOutput ?? 64 * 1024;
    const cwd = options.cwd || process.cwd();

    const child = spawn(cmd, [], {
      shell: true,
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const info: SubprocessInfo = {
      pid: child.pid ?? 0,
      sessionId,
      spawnedAt: Date.now(),
      process: child,
      type: 'exec',
      status: 'running',
    };
    activeProcesses.set(sessionId, info);

    let stdout = '';
    let stderr = '';
    let timedout = false;

    child.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < maxOutput) stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < maxOutput) stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedout = true;
      child.kill('SIGTERM');
      // 等 2 秒强制杀
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      info.status = timedout ? 'timed_out' : (exitCode === 0 ? 'completed' : 'failed');
      // 延迟一点删除，让调用方可以查到状态
      setTimeout(() => activeProcesses.delete(sessionId), 1000);
      resolve({ exitCode: exitCode ?? -1, stdout, stderr, timedout });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      info.status = 'failed';
      setTimeout(() => activeProcesses.delete(sessionId), 1000);
      resolve({ exitCode: -1, stdout, stderr: err.message, timedout: false });
    });
  });
}

/**
 * 派发任务给本地 Claude Code 子进程
 * 通过 spawn 'claude' 并传入紧凑协议消息
 */
export async function spawnClaudeTask(
  msg: Message,
  sessionId: string,
  options: { timeout?: number } = {},
): Promise<{ success: boolean; result?: any; error?: string }> {
  const timeout = options.timeout ?? 120_000;
  
  // 构造传给子进程的指令
  const taskPayload = {
    action: 'process_message',
    message: {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      type: msg.type,
      payload: msg.payload,
    },
    meta: {
      sessionId,
      protocol: 'silent-protocol',
      version: 1,
    },
  };

  const jsonInput = JSON.stringify(taskPayload);

  return new Promise((resolve) => {
    let claudeCmd = 'claude';
    // Windows 上用 claude.cmd
    if (process.platform === 'win32') {
      claudeCmd = 'claude';
    }

    try {
      const child = spawn(claudeCmd, ['--json'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, SILENT_PROTOCOL_MESSAGE: jsonInput },
      });

      const info: SubprocessInfo = {
        pid: child.pid ?? 0,
        sessionId,
        spawnedAt: Date.now(),
        process: child,
        type: 'claude',
        status: 'running',
      };
      activeProcesses.set(sessionId, info);

      // 通过 stdin 传递消息
      child.stdin?.write(jsonInput + '\n');
      child.stdin?.end();

      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        info.status = 'timed_out';
        setTimeout(() => activeProcesses.delete(sessionId), 1000);
        resolve({ success: false, error: 'claude subprocess timed out' });
      }, timeout);

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        info.status = exitCode === 0 ? 'completed' : 'failed';
        setTimeout(() => activeProcesses.delete(sessionId), 1000);

        if (exitCode === 0 && output) {
          try {
            const result = JSON.parse(output);
            resolve({ success: true, result });
          } catch {
            resolve({ success: true, result: { rawOutput: output } });
          }
        } else {
          resolve({
            success: false,
            error: errorOutput || `claude exited with code ${exitCode}`,
            result: { rawOutput: output, rawError: errorOutput },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        info.status = 'failed';
        setTimeout(() => activeProcesses.delete(sessionId), 1000);
        resolve({ success: false, error: err.message });
      });
    } catch (err: any) {
      resolve({ success: false, error: 'failed to spawn claude: ' + err.message });
    }
  });
}

/**
 * 取消正在运行的子进程
 */
export function cancelProcess(sessionId: string): boolean {
  const info = activeProcesses.get(sessionId);
  if (!info || info.status !== 'running') return false;
  try {
    info.process.kill('SIGTERM');
    info.status = 'failed';
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取子进程管理器状态
 */
export function processRegistryStats() {
  const running: { sessionId: string; type: string; elapsed: number }[] = [];
  for (const [id, info] of activeProcesses) {
    if (info.status === 'running') {
      running.push({
        sessionId: id,
        type: info.type,
        elapsed: Date.now() - info.spawnedAt,
      });
    }
  }
  return {
    active: activeProcesses.size,
    running: running.length,
    maxConcurrency: MAX_CONCURRENCY,
    processes: running,
  };
}
