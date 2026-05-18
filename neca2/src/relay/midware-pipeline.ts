// ---- 消息处理管道（Middleware Pipeline） ----
// 在路由之前执行一系列中间件：校验 → 日志 → 去重 → 速率限制 → 调度
//
// 管道流程：
//   入站消息 → 校验中间件 → 结构化日志 → 去重检查 → 速率限制 → 调度选择 → 路由
//
// v0.3.0 新增：
//   - 增强的速率限制（令牌桶 + 滑动窗口）
//   - 调度器集成
//   - 可配置中间件链

import type { Message, ValidationResult } from '../protocol/types.js';
import { validateMessageMiddleware, ValidationMiddlewareResult } from '../protocol/validator.js';
import { logger } from '../utils/logger.js';
import { retryQueue } from './retry-queue.js';
import { makeErrorMessage, now } from '../protocol/codec.js';
import { ERROR_CODES } from '../protocol/types.js';
import { schedulerManager } from './router-scheduler.js';

// ---- 中间件结果 ----

export interface MiddlewareResult {
  /** 是否允许进入路由 */
  allowed: boolean;
  /** 如果拒绝，原因 */
  error?: string;
  /** 错误码 */
  errorCode?: string;
  /** 可能被修改的消息 */
  message?: Message;
  /** 校验详情 */
  validation?: ValidationMiddlewareResult;
  /** 调度选择的端点 */
  selectedEndpoint?: string;
}

// ---- 增强速率限制器（令牌桶 + 滑动窗口） ----

interface BucketState {
  tokens: number;
  lastRefill: number;
  /** 滑动窗口时间戳 */
  windowTimestamps: number[];
  /** 当前窗口内请求数 */
  windowCount: number;
  /** 窗口开始时间 */
  windowStart: number;
}

export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private readonly MAX_TOKENS = 20;
  private readonly REFILL_RATE = 5;   // 每秒恢复 5 个令牌
  private readonly REFILL_INTERVAL = 1000;
  private readonly WINDOW_MS = 60_000; // 滑动窗口 60 秒
  private readonly WINDOW_LIMIT = 60;  // 每分钟最多 60 请求

  /** 检查是否允许通过，返回 { allowed, remaining, resetMs } */
  check(from: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(from);

    if (!bucket) {
      bucket = {
        tokens: this.MAX_TOKENS,
        lastRefill: now,
        windowTimestamps: [now],
        windowCount: 1,
        windowStart: now,
      };
      this.buckets.set(from, bucket);
      return { allowed: true, remaining: this.MAX_TOKENS - 1, resetMs: this.WINDOW_MS };
    }

    // 1. 令牌桶补充
    const elapsed = now - bucket.lastRefill;
    const refillTokens = Math.floor(elapsed / this.REFILL_INTERVAL) * this.REFILL_RATE;
    if (refillTokens > 0) {
      bucket.tokens = Math.min(this.MAX_TOKENS, bucket.tokens + refillTokens);
      bucket.lastRefill = now;
    }

    // 2. 滑动窗口清理
    const windowStart = now - this.WINDOW_MS;
    bucket.windowTimestamps = bucket.windowTimestamps.filter(ts => ts > windowStart);
    bucket.windowCount = bucket.windowTimestamps.length;

    // 3. 双重检查：令牌桶 + 窗口
    if (bucket.tokens > 0 && bucket.windowCount < this.WINDOW_LIMIT) {
      bucket.tokens--;
      bucket.windowTimestamps.push(now);
      bucket.windowCount++;
      return {
        allowed: true,
        remaining: Math.min(bucket.tokens, this.WINDOW_LIMIT - bucket.windowCount),
        resetMs: bucket.windowTimestamps[0]
          ? Math.max(1000, bucket.windowTimestamps[0] + this.WINDOW_MS - now)
          : 1000,
      };
    }

    // 被限速
    const resetMs = bucket.windowTimestamps.length > 0
      ? Math.max(1000, bucket.windowTimestamps[0] + this.WINDOW_MS - now)
      : 1000;
    return { allowed: false, remaining: 0, resetMs };
  }

  /** 重置（用于测试） */
  reset(): void {
    this.buckets.clear();
  }

  /** 获取所有限速器状态 */
  getStates(): Record<string, { tokens: number; windowCount: number }> {
    const states: Record<string, any> = {};
    for (const [key, bucket] of this.buckets) {
      states[key] = { tokens: bucket.tokens, windowCount: bucket.windowCount };
    }
    return states;
  }
}

const rateLimiter = new RateLimiter();

// ---- 主管道 ----

/**
 * 执行完整消息处理管道
 * 返回中间件结果，调用方根据结果决定是否继续路由
 */
export async function runMiddlewarePipeline(
  msg: Partial<Message>,
  options: {
    checkRate?: boolean;
    logOnPass?: boolean;
    autoRepair?: boolean;
    scheduleRoute?: boolean;
  } = {},
): Promise<MiddlewareResult> {
  const { checkRate = true, logOnPass = true, autoRepair = true, scheduleRoute = true } = options;

  // 1. 校验中间件
  const validation = validateMessageMiddleware(msg);

  // 如果是校验失败但可以自动修复
  if (!validation.valid && autoRepair && validation.sanitized) {
    const repaired = validation.sanitized as Message;
    logger.warn('Message auto-repaired',
      { original: { id: msg.id, from: msg.from }, warnings: validation.warnings },
      { msgId: repaired.id, module: 'midware' },
    );
    msg = repaired;
  } else if (!validation.valid) {
    const firstError = validation.errors[0] || 'Unknown validation error';
    logger.warn('Message rejected by validator',
      { errors: validation.errors, from: msg.from, type: msg.type },
      { msgId: msg.id, module: 'midware' },
    );
    return {
      allowed: false,
      error: firstError,
      errorCode: 'PARSE_ERROR',
      validation,
    };
  }

  // 2. 速率限制检查（增强版）
  if (checkRate && msg.from) {
    const rateResult = rateLimiter.check(msg.from as string);
    if (!rateResult.allowed) {
      logger.warn('Rate limit exceeded',
        { from: msg.from, remaining: rateResult.remaining, resetMs: rateResult.resetMs },
        { msgId: msg.id, module: 'midware' },
      );
      return {
        allowed: false,
        error: `Rate limit exceeded. Reset in ${Math.ceil(rateResult.resetMs / 1000)}s`,
        errorCode: 'API_RATE_LIMITED',
        validation,
        message: msg as Message,
      };
    }
  }

  // 3. 调度器选择
  let selectedEndpoint: string | undefined;
  if (scheduleRoute && msg.to) {
    const endpoint = schedulerManager.selectFor(msg as Message);
    if (endpoint) {
      selectedEndpoint = endpoint.name;
      // 更新负载
      schedulerManager.updateLoad(endpoint.name, endpoint.load + 1);
      logger.debug('Scheduler selected endpoint',
        { endpoint: endpoint.name, target: endpoint.target, strategy: schedulerManager.currentStrategyName },
        { msgId: msg.id, module: 'midware' },
      );
    }
  }

  // 4. 日志记录（通过的请求）
  if (logOnPass) {
    logger.info('Message processed',
      {
        from: msg.from,
        to: msg.to,
        type: msg.type,
        id: msg.id,
        callback: msg.callback,
        scheduledEndpoint: selectedEndpoint,
      },
      { msgId: msg.id, module: 'midware' },
    );
  }

  return {
    allowed: true,
    message: msg as Message,
    validation,
    selectedEndpoint,
  };
}

/**
 * 重置速率限制器（测试用）
 */
export function resetRateLimiter(): void {
  rateLimiter.reset();
}

/**
 * 获取速率限制器状态
 */
export function getRateLimiterStates(): Record<string, { tokens: number; windowCount: number }> {
  return rateLimiter.getStates();
}
