// ---- 消息重试与去重队列 ----
// 自动重试失败的消息，指数退避，最多 3 次。
//
// 设计原则：
//   1. 可靠投递 — 一次性语义（at-most-once + 去重）
//   2. 优雅退化 — 指数退避避免雪崩
//   3. 可观测 — 所有重试事件记录到结构化日志
//
// 重试策略：
//   第 1 次失败 → 等待 1 秒后重试
//   第 2 次失败 → 等待 4 秒后重试
//   第 3 次失败 → 等待 16 秒后重试
//   第 4 次失败 → 放弃，标记为永久失败
//
// 去重策略：
//   基于消息 id 的幂等性检查
//   已成功处理的消息不会重复投递
//   已在队列中的消息不会重复入队

import type { Message, SessionRecord } from '../protocol/types.js';
import { updateSession, getSession } from './session.js';
import { routeMessage } from './router.js';

// ---- 配置 ----

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始退避基数（ms） */
  baseDelayMs: number;
  /** 退避乘数 */
  backoffMultiplier: number;
  /** 最大退避时间（ms） */
  maxDelayMs: number;
  /** 是否启用去重 */
  deduplicate: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 4,
  maxDelayMs: 60_000,
  deduplicate: true,
};

// ---- 去重缓存 ----

/**
 * 去重缓存
 * 记录已成功处理的消息 ID，避免重复投递
 */
class DedupCache {
  private cache = new Set<string>();
  private timestamps = new Map<string, number>();
  private readonly TTL = 10 * 60 * 1000; // 10 分钟

  /** 检查消息是否已处理过 */
  has(id: string): boolean {
    this.evict();
    return this.cache.has(id);
  }

  /** 标记消息为已处理 */
  mark(id: string): void {
    this.cache.add(id);
    this.timestamps.set(id, Date.now());
    this.evict();
  }

  /** 清理过期记录 */
  private evict(): void {
    const now = Date.now();
    for (const [id, ts] of this.timestamps) {
      if (now - ts > this.TTL) {
        this.cache.delete(id);
        this.timestamps.delete(id);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

const dedupCache = new DedupCache();

// ---- 重试条目 ----

interface RetryEntry {
  msg: Message;
  attempt: number;
  nextAttemptAt: number;
  lastError: string;
  createdAt: number;
}

// ---- 重试队列 ----

export class RetryQueue {
  private queue: RetryEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: RetryConfig;
  private processing = false;

  /** 重试统计 */
  stats = {
    enqueued: 0,
    succeeded: 0,
    failed: 0,
    dropped: 0,
    deduped: 0,
  };

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /** 启动定时处理 */
  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.process(), intervalMs);
    this.timer.unref?.();
  }

  /** 停止定时处理 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 将消息加入重试队列 */
  enqueue(msg: Message, error: string): void {
    // 去重检查：缓存 + 队列中已存在
    if (this.config.deduplicate) {
      if (dedupCache.has(msg.id)) {
        this.stats.deduped++;
        return;
      }
      if (this.queue.some(e => e.msg.id === msg.id)) {
        this.stats.deduped++;
        return;
      }
    }

    this.queue.push({
      msg,
      attempt: 0,
      nextAttemptAt: Date.now() + this.config.baseDelayMs,
      lastError: error,
      createdAt: Date.now(),
    });
    this.stats.enqueued++;
  }

  /** 计算退避延迟 */
  private getDelay(attempt: number): number {
    const delay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    return Math.min(delay, this.config.maxDelayMs);
  }

  /** 处理队列 */
  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const now = Date.now();
    const ready: RetryEntry[] = [];
    const remaining: RetryEntry[] = [];

    for (const entry of this.queue) {
      if (entry.nextAttemptAt <= now) {
        ready.push(entry);
      } else {
        remaining.push(entry);
      }
    }
    this.queue = remaining;

    for (const entry of ready) {
      try {
        entry.attempt++;
        // 检查去重
        if (this.config.deduplicate && dedupCache.has(entry.msg.id)) {
          this.stats.deduped++;
          continue;
        }

        const session = await routeMessage(entry.msg);

        if (session.status === 'reply_received' || session.status === 'completed') {
          // 成功
          dedupCache.mark(entry.msg.id);
          this.stats.succeeded++;
        } else if (entry.attempt >= this.config.maxRetries) {
          // 超过最大重试次数
          this.stats.failed++;
          // 更新 session 状态为最终失败
          updateSession(session.id, {
            status: 'error',
            response: {
              error: `Retry exhausted after ${entry.attempt} attempts`,
              lastError: entry.lastError,
            },
          });
        } else {
          // 需要继续重试
          const delay = this.getDelay(entry.attempt);
          entry.nextAttemptAt = Date.now() + delay;
          this.queue.push(entry);
        }
      } catch (err: any) {
        // 路由抛出异常
        if (entry.attempt >= this.config.maxRetries) {
          this.stats.failed++;
        } else {
          const delay = this.getDelay(entry.attempt);
          entry.nextAttemptAt = Date.now() + delay;
          entry.lastError = err.message;
          this.queue.push(entry);
        }
      }
    }

    this.processing = false;
  }

  /** 获取队列深度 */
  get depth(): number {
    return this.queue.length;
  }

  /** 获取所有待重试条目 */
  get entries(): RetryEntry[] {
    return [...this.queue];
  }

  /** 清空队列 */
  clear(): void {
    this.queue = [];
  }
}

// ---- 全局单例 ----

export const retryQueue = new RetryQueue();

/** 初始化重试队列 */
export function initRetryQueue(): void {
  retryQueue.start();
}

/** 关闭重试队列 */
export function shutdownRetryQueue(): void {
  retryQueue.stop();
}
