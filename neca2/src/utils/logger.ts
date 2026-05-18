// ---- 结构化日志系统（JSON Lines） ----
// 所有日志以 JSON Lines 格式写入文件，便于机器解析和检索。
//
// 设计原则：
//   1. 结构化 — 每条日志是一个 JSON 对象，字段固定
//   2. 可检索 — 写入文件后可用 grep/jq 查询
//   3. 低开销 — 异步写入，不阻塞主流程
//   4. 分级 — error / warn / info / debug
//
// 日志文件：
//   ~/.neca2/neca2.log       — 主日志
//   ~/.neca2/neca2-error.log — 仅错误日志（便于监控）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---- 日志级别 ----

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_DIR = path.join(os.homedir(), '.neca2');

// ---- 日志条目结构 ----

export interface LogEntry {
  /** 时间戳（ISO 格式） */
  t: string;
  /** 日志级别 */
  l: LogLevel;
  /** 消息 */
  m: string;
  /** 可选附属数据 */
  d?: Record<string, unknown>;
  /** 关联的消息 ID（如果有） */
  msgId?: string;
  /** 关联的 session ID（如果有） */
  sessionId?: string;
  /** 模块名 */
  module?: string;
}

// ---- 写入器 ----

class JsonLinesWriter {
  private stream: fs.WriteStream | null = null;
  private errorStream: fs.WriteStream | null = null;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL = 2000; // 2 秒刷一次盘

  constructor() {
    this.ensureDir();
    this.openStreams();
    this.startAutoFlush();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch { /* ignore */ }
  }

  private openStreams(): void {
    try {
      const logFile = path.join(LOG_DIR, 'neca2.log');
      const errorFile = path.join(LOG_DIR, 'neca2-error.log');
      this.stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
      this.errorStream = fs.createWriteStream(errorFile, { flags: 'a', encoding: 'utf-8' });
    } catch { /* ignore */ }
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
    this.flushTimer.unref?.();
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    this.buffer.push(line);

    // 错误日志同步写入错误流（确保不丢）
    if (entry.l === 'error' && this.errorStream) {
      try {
        this.errorStream.write(line);
      } catch { /* ignore */ }
    }

    // 缓冲区超过 100 条时立即刷盘
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0 || !this.stream) return;
    try {
      const lines = this.buffer.join('');
      this.buffer = [];
      this.stream.write(lines);
    } catch { /* ignore */ }
  }

  close(): void {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    try { this.stream?.close(); } catch { /* ignore */ }
    try { this.errorStream?.close(); } catch { /* ignore */ }
  }
}

// ---- 全局日志实例 ----

const writer = new JsonLinesWriter();

// ---- 日志 API（函数式）----

function log(level: LogLevel, message: string, data?: Record<string, unknown>, meta?: { msgId?: string; sessionId?: string; module?: string }): void {
  const entry: LogEntry = {
    t: new Date().toISOString(),
    l: level,
    m: message,
    ...(data ? { d: data } : {}),
    ...(meta?.msgId ? { msgId: meta.msgId } : {}),
    ...(meta?.sessionId ? { sessionId: meta.sessionId } : {}),
    ...(meta?.module ? { module: meta.module } : {}),
  };

  writer.write(entry);

  // 同时输出到 stderr（开发友好）
  const prefix = `[${level.toUpperCase()}]`;
  const suffix = meta?.module ? ` [${meta.module}]` : '';
  if (level === 'error') {
    console.error(`${prefix}${suffix} ${message}`, data ? JSON.stringify(data).substring(0, 200) : '');
  } else if (level === 'warn') {
    console.warn(`${prefix}${suffix} ${message}`);
  } else {
    console.error(`${prefix}${suffix} ${message}`);
  }
}

export const logger = {
  error: (msg: string, data?: Record<string, unknown>, meta?: { msgId?: string; sessionId?: string; module?: string }) =>
    log('error', msg, data, meta),
  warn: (msg: string, data?: Record<string, unknown>, meta?: { msgId?: string; sessionId?: string; module?: string }) =>
    log('warn', msg, data, meta),
  info: (msg: string, data?: Record<string, unknown>, meta?: { msgId?: string; sessionId?: string; module?: string }) =>
    log('info', msg, data, meta),
  debug: (msg: string, data?: Record<string, unknown>, meta?: { msgId?: string; sessionId?: string; module?: string }) =>
    log('debug', msg, data, meta),

  /** 关闭日志系统 */
  shutdown: (): void => {
    writer.close();
  },
};

/** 获取日志目录路径 */
export function getLogDir(): string {
  return LOG_DIR;
}
